"""FM Database — local web UI.

A coach-friendly front-end for browsing the catalogue and authoring plans.
Sits directly on top of the fmdb/ Python engine — same models, same
storage, same plan-check. No server, no auth, no deployment. Runs at
http://localhost:8501 via:

    cd fm-database
    .venv/bin/streamlit run fmdb_ui/app.py

Or use ./run-fmdb.sh from the project root.

Design rules:
- Every error message tells the user what to do next.
- No slug typing — pick everything from dropdowns populated from the live catalogue.
- Plan-check panel is always visible; turns red on CRITICAL findings.
- Save is always to draft. Lifecycle transitions are explicit buttons.
"""

from __future__ import annotations

import base64
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# Make sibling package importable when running via `streamlit run`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# ---------------------------------------------------------------------------
# Force-evict cached fmdb modules at every script rerun.
#
# Why: Streamlit reruns app.py on every UI interaction in the SAME Python
# process. Python's sys.modules cache holds the version of fmdb.* loaded on
# the FIRST import. So edits to fmdb/ files don't take effect even after a
# rerun — you'd see ImportError when new symbols are added to a model file
# but the cached module pre-dates the edit.
#
# This block deletes every fmdb.* entry from sys.modules at the top of every
# rerun. The next `from fmdb.* import ...` reads from disk fresh.
#
# Cost: ~50-100ms per rerun (parsing ~10 small modules). Acceptable.
# Trade-off: any module-level state inside fmdb is reset each rerun. We
# don't depend on any such state, so this is safe.
# ---------------------------------------------------------------------------
for _modname in list(sys.modules.keys()):
    if _modname == "fmdb" or _modname.startswith("fmdb."):
        del sys.modules[_modname]

# Auto-load .env so ANTHROPIC_API_KEY etc. are present (mirrors CLI behavior)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)
except ImportError:
    pass

import streamlit as st

from fmdb import backlog as backlog_mod
from fmdb.assess import suggester as suggester_mod
from fmdb.resources import storage as resources_storage
from fmdb.resources.models import Resource
from fmdb.assess.mindmap import build_tree, curated_to_mermaid, to_mermaid
from fmdb.assess.subgraph import build_subgraph

# Resolve names at call time (not import time) — this avoids stale module-cache
# import errors when streamlit reloads after a source-file edit.
def synthesize(*args, **kwargs):
    return suggester_mod.synthesize(*args, **kwargs)


def ai_chat(*args, **kwargs):
    return suggester_mod.chat(*args, **kwargs)
from fmdb.enums import PlanStatus
from fmdb.plan import storage as plan_storage
from fmdb.plan import transitions as plan_transitions
from fmdb.plan.checker import check_plan
from fmdb.plan.models import (
    CatalogueSnapshot,
    ChatTurn,
    Client,
    EducationModule,
    HypothesizedDriver,
    Measurements,
    NutritionPlan,
    Plan,
    PracticeItem,
    Session,
    SupplementItem,
    Tracking,
    TrackingHabit,
    UploadedFileRef,
    LabOrderItem,
    ReferralItem,
)
from fmdb.validator import load_all


# ---------------------------------------------------------------------------
# Page setup
# ---------------------------------------------------------------------------

st.set_page_config(
    page_title="FM Coach",
    page_icon="🌿",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------------------------------------------------------------------------
# Global CSS polish — softens Streamlit's default look without leaving Streamlit
# ---------------------------------------------------------------------------
st.markdown("""
<style>
/* Tighten section spacing */
.block-container { padding-top: 2rem; padding-bottom: 3rem; max-width: 1400px; }
/* Headings — softer hierarchy */
h1 { font-weight: 600; letter-spacing: -0.02em; color: #1a3a52; }
h2 { font-weight: 600; letter-spacing: -0.01em; margin-top: 1.5rem; color: #1a3a52; }
h3 { font-weight: 600; color: #2c4a63; }
/* Sidebar — softer */
section[data-testid="stSidebar"] { background: #f7f5f0; }
section[data-testid="stSidebar"] .stRadio label p { font-size: 0.95rem; padding: 0.2rem 0; }
/* Buttons — softer corners, less aggressive */
button[kind="primary"] {
    border-radius: 8px !important;
    font-weight: 500 !important;
    background: #2d6a4f !important;
    border: none !important;
}
button[kind="primary"]:hover { background: #1e4d38 !important; }
button[kind="secondary"] { border-radius: 8px !important; font-weight: 500 !important; }
/* Containers (with border=True) — softer borders, light wash */
[data-testid="stContainer"] > div[data-testid="stContainerInner"] {
    background: #fcfbf8 !important;
}
/* Captions — slightly bigger and softer */
.stCaption, [data-testid="stCaptionContainer"] { color: #6b7d8c; font-size: 0.85rem; }
/* Badges/chips for entity types — used by the mind map cards */
.fm-chip {
    display: inline-block; padding: 3px 10px; border-radius: 12px;
    font-size: 0.75rem; font-weight: 500; margin-right: 4px;
}
.fm-chip-topic { background: #e3f2fd; color: #0d47a1; }
.fm-chip-mechanism { background: #f3e5f5; color: #4a148c; }
.fm-chip-symptom { background: #e8f5e9; color: #1b5e20; }
.fm-chip-supplement { background: #fff3e0; color: #e65100; }
.fm-chip-claim { background: #fffde7; color: #827717; }
.fm-chip-cooking { background: #fce4ec; color: #880e4f; }
.fm-chip-remedy { background: #e0f2f1; color: #004d40; }
/* Hide some streamlit clutter */
footer { visibility: hidden; }
[data-testid="stToolbar"] { visibility: hidden; }
</style>
""", unsafe_allow_html=True)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


@st.cache_data(ttl=10)
def load_catalogue_cached():
    """Cache catalogue load for 10s so the UI feels snappy without going stale."""
    return load_all(DATA_DIR)


def plans_root():
    return plan_storage.plans_root()


# ---------------------------------------------------------------------------
# Evidence-tier badge helper
# ---------------------------------------------------------------------------

_TIER_STYLE = {
    "strong":                  ("#0d6e2e", "🟢", "Strong"),
    "plausible_emerging":      ("#a86b00", "🟡", "Plausible / emerging"),
    "fm_specific_thin":        ("#a8530a", "🟠", "FM-specific / thin evidence"),
    "confirm_with_clinician":  ("#a82020", "🔴", "Confirm with clinician"),
}


def _evidence_badge(tier: str) -> str:
    """HTML badge for a catalogue evidence_tier — returned as inline HTML
    suitable for st.markdown(unsafe_allow_html=True)."""
    color, icon, label = _TIER_STYLE.get(
        tier, ("#666", "⚪", tier or "unknown")
    )
    return (
        f"<span style='display:inline-block; padding:2px 8px; "
        f"border-radius:10px; background:{color}; color:white; "
        f"font-size:0.75em; font-weight:500;'>{icon} {label}</span>"
    )


# ---------------------------------------------------------------------------
# Plan status badge helper
# ---------------------------------------------------------------------------

_PLAN_STATUS_STYLE = {
    "draft":             ("#6c757d", "Draft"),               # gray
    "ready_to_publish":  ("#c39000", "Ready to publish"),    # yellow/amber
    "published":         ("#1f7a3a", "Published"),           # green
    "superseded":        ("#c66400", "Superseded"),          # orange
    "revoked":           ("#a82020", "Revoked"),             # red
}


def _plan_status_badge(status_value: str) -> str:
    color, label = _PLAN_STATUS_STYLE.get(status_value, ("#666", status_value or "unknown"))
    return (
        f"<span style='display:inline-block; padding:3px 10px; "
        f"border-radius:10px; background:{color}; color:white; "
        f"font-size:0.8em; font-weight:600;'>{label}</span>"
    )


# ---------------------------------------------------------------------------
# Sidebar — page navigation + global state
# ---------------------------------------------------------------------------

st.sidebar.markdown("## 🌿 FM Coach")
st.sidebar.caption("Functional medicine workspace")

page = st.sidebar.radio(
    "Page",
    [
        "🧠 Assess & Suggest",
        "📋 Plans",
        "👥 Clients",
        "🧭 Mind Map",
        "🧰 Resources Toolkit",
        "📚 Catalogue Browser",
        "📝 Catalogue Backlog",
    ],
    label_visibility="collapsed",
)

st.sidebar.divider()
st.sidebar.caption(f"📁 Plans dir: `{plans_root()}`")
st.sidebar.caption(f"📁 Catalogue: `{DATA_DIR}`")

# Cache refresh button
if st.sidebar.button("🔄 Reload catalogue from disk"):
    load_catalogue_cached.clear()
    st.rerun()


# ---------------------------------------------------------------------------
# Page: Catalogue Browser (read-only)
# ---------------------------------------------------------------------------

def render_catalogue_browser():
    st.title("📚 Catalogue Browser")
    st.caption("Read-only view of every catalogue entity. Pick a type, then pick an entry.")

    cat = load_catalogue_cached()
    type_to_items = {
        "Topics": cat.topics,
        "Symptoms": cat.symptoms,
        "Mechanisms": cat.mechanisms,
        "Supplements": cat.supplements,
        "Claims": cat.claims,
        "Cooking Adjustments": cat.cooking_adjustments,
        "Home Remedies": cat.home_remedies,
        "Sources": cat.sources,
    }

    col_left, col_right = st.columns([1, 2])

    with col_left:
        kind = st.selectbox("Type", list(type_to_items.keys()))
        items = type_to_items[kind]
        if not items:
            st.info(f"No {kind.lower()} in the catalogue yet.")
            return
        # Build a label per item: prefer display_name, fallback to slug/id
        def _label(it):
            name = getattr(it, "display_name", None) or getattr(it, "title", None) or ""
            ident = getattr(it, "slug", None) or getattr(it, "id", None) or "?"
            return f"{ident} — {name}" if name else ident
        labels = [_label(it) for it in items]

        search = st.text_input("Filter", "")
        if search:
            filtered = [(i, lbl) for i, lbl in enumerate(labels) if search.lower() in lbl.lower()]
        else:
            filtered = list(enumerate(labels))
        if not filtered:
            st.warning(f"No matches for {search!r}.")
            return
        st.caption(f"{len(filtered)} of {len(items)}")
        chosen_idx = st.radio(
            "Pick one",
            options=[i for i, _ in filtered],
            format_func=lambda i: filtered_dict[i],
            label_visibility="collapsed",
        ) if False else None  # use a simpler list:

        chosen_label = st.selectbox("Pick one", [lbl for _, lbl in filtered])
        chosen_i = next(i for i, lbl in filtered if lbl == chosen_label)
        item = items[chosen_i]

    with col_right:
        st.subheader(_label(item))
        # Render whatever fields exist
        d = item.model_dump(mode="json")
        # Pretty-print key fields first
        priority_keys = [
            "summary", "description", "statement", "rationale", "coaching_translation",
            "category", "severity", "evidence_tier", "aliases",
            "common_symptoms", "red_flags", "indications", "contraindications",
            "upstream_drivers", "downstream_effects",
            "linked_to_topics", "linked_to_mechanisms", "linked_to_claims",
            "linked_to_supplements", "key_mechanisms", "related_topics",
            "related_mechanisms",
        ]
        for k in priority_keys:
            if k in d and d[k]:
                st.markdown(f"**{k.replace('_', ' ').title()}**")
                v = d[k]
                if isinstance(v, list):
                    for x in v:
                        st.markdown(f"- {x}")
                else:
                    st.write(v)
        with st.expander("Raw YAML payload"):
            st.code(item.model_dump_json(indent=2), language="json")


# ---------------------------------------------------------------------------
# Page: Clients
# ---------------------------------------------------------------------------

def render_clients_page():
    st.title("👥 Clients")
    root = plans_root()

    tab_list, tab_new, tab_edit = st.tabs(["📋 List", "➕ New", "✏️ Edit / Delete"])

    with tab_list:
        clients = plan_storage.list_clients(root)
        if not clients:
            st.info(f"No clients yet at `{root / 'clients'}`. Create one in the **New** tab.")
        else:
            rows = [{
                "client_id": c.client_id,
                "display_name": c.display_name or "—",
                "intake_date": c.intake_date,
                "age_band": c.age_band,
                "sex": c.sex,
                "active_conditions": ", ".join(c.active_conditions) or "—",
                "goals": " · ".join(c.goals) or "—",
            } for c in clients]
            st.dataframe(rows, hide_index=True, use_container_width=True)

            with st.expander("Show full record for one client"):
                c_choice = st.selectbox(
                    "Client",
                    [c.client_id for c in clients],
                    format_func=lambda cid: f"{cid} — {next((c.display_name for c in clients if c.client_id == cid), '')}",
                )
                if c_choice:
                    c = next(c for c in clients if c.client_id == c_choice)
                    st.json(c.model_dump(mode="json"))

    with tab_new:
        st.markdown(
            "Create a new client. The **client ID is auto-generated**. "
            "Use a pseudonym or full name in *Display name* — your call."
        )
        # Auto-generate next client_id
        existing_ids = [c.client_id for c in plan_storage.list_clients(root)]
        next_num = 1
        used_nums = []
        for cid_existing in existing_ids:
            if cid_existing.startswith("cl-"):
                try:
                    used_nums.append(int(cid_existing[3:]))
                except ValueError:
                    pass
        if used_nums:
            next_num = max(used_nums) + 1
        suggested_cid = f"cl-{next_num:03d}"

        with st.form("new_client", clear_on_submit=False):
            st.markdown("##### 🪪 Identity")
            st.info(f"This client will be saved as **`{suggested_cid}`** (auto-generated).")
            display = st.text_input("Display name *", placeholder="Hariharan Raman, or a pseudonym")
            col1, col2, col3 = st.columns(3)
            with col1:
                intake = st.date_input("Intake date *", value=date.today())
            with col2:
                age_band = st.text_input("Age band *", placeholder="45-50",
                                         help="A 5-year band (e.g. '45-50'). Used for BMR estimation.")
            with col3:
                sex = st.selectbox("Sex *", ["F", "M", "other"])

            st.markdown("##### 🩺 Clinical context")
            conditions = st.text_area(
                "Currently active conditions (one per line)",
                placeholder="perimenopause\nIBS-pattern dysbiosis",
                help="Conditions that are clinically active right now. "
                     "Use Medical history below for past / in-remission diagnoses.",
            )
            history = st.text_area(
                "Medical history — past diagnoses & status (one per line) *new*",
                placeholder=(
                    "Hashimoto's diagnosed 2018, TPO antibodies normalized 2023, on levothyroxine 75mcg\n"
                    "Cesarean 2014\n"
                    "Long-term PPI use 2010-2018"
                ),
                help="Past diagnoses, surgeries, prolonged medication courses, "
                     "or anything historically relevant — even if not currently active. "
                     "FM still uses this (genetic susceptibility, environmental triggers, "
                     "gut effects of past meds, etc.).",
            )
            meds = st.text_area("Current medications (one per line)", placeholder="levothyroxine 75mcg")
            allergies = st.text_area("Known allergies (one per line)")
            goals = st.text_area("Goals (one per line)", placeholder="reduce 3am wakeups\nmore daytime energy")

            st.markdown("##### 📏 Bio measurements (intake baseline — all optional)")
            mc1, mc2, mc3 = st.columns(3)
            with mc1:
                height = st.number_input("Height (cm)", min_value=0.0, max_value=250.0, value=0.0, step=0.5)
                waist = st.number_input("Waist (cm)", min_value=0.0, max_value=200.0, value=0.0, step=0.5)
                rhr = st.number_input("Resting heart rate (bpm)", min_value=0, max_value=200, value=0)
            with mc2:
                weight = st.number_input("Weight (kg)", min_value=0.0, max_value=300.0, value=0.0, step=0.1)
                hip = st.number_input("Hip (cm)", min_value=0.0, max_value=200.0, value=0.0, step=0.5)
                bp_sys = st.number_input("BP systolic (mmHg)", min_value=0, max_value=250, value=0)
            with mc3:
                measured = st.date_input("Measured on", value=date.today())
                bp_dia = st.number_input("BP diastolic (mmHg)", min_value=0, max_value=200, value=0)
            measurement_notes = st.text_input("Measurement notes",
                                              placeholder="e.g. measured first thing in morning, fasted")
            st.caption(
                "BMI, waist:hip ratio and BMR (Mifflin-St Jeor) auto-compute "
                "from these — you don't need to enter them."
            )

            notes = st.text_area("Other notes")

            submitted = st.form_submit_button("Create client")
            if submitted:
                if not display.strip() or not age_band.strip() or not sex:
                    st.error(
                        "**Display name, age band, and sex are required.** "
                        "Your other entries are preserved — just fill these in and submit again."
                    )
                else:
                    try:
                        now = datetime.now(timezone.utc)
                        m = Measurements(
                            height_cm=height or None,
                            weight_kg=weight or None,
                            waist_cm=waist or None,
                            hip_cm=hip or None,
                            resting_heart_rate=int(rhr) if rhr else None,
                            blood_pressure_systolic=int(bp_sys) if bp_sys else None,
                            blood_pressure_diastolic=int(bp_dia) if bp_dia else None,
                            measured_on=measured if (height or weight or waist or hip or rhr or bp_sys) else None,
                            notes=measurement_notes,
                        )
                        client = Client(
                            client_id=suggested_cid,
                            display_name=display.strip(),
                            intake_date=intake,
                            age_band=age_band.strip(),
                            sex=sex,
                            active_conditions=[x.strip() for x in conditions.splitlines() if x.strip()],
                            medical_history=[x.strip() for x in history.splitlines() if x.strip()],
                            current_medications=[x.strip() for x in meds.splitlines() if x.strip()],
                            known_allergies=[x.strip() for x in allergies.splitlines() if x.strip()],
                            goals=[x.strip() for x in goals.splitlines() if x.strip()],
                            notes=notes,
                            measurements=m,
                            created_at=now,
                            updated_at=now,
                            updated_by="shivani",
                        )
                        p = plan_storage.write_client(root, client)
                        st.success(
                            f"✅ Created **{display.strip()}** as `{suggested_cid}`. "
                            "Switch to **List** tab to view, or **🧠 Assess & Suggest** to start their plan."
                        )
                        st.toast(f"Client {suggested_cid} created", icon="✅")
                    except Exception as e:
                        st.error(
                            "**Couldn't save the client.** Your inputs are preserved — "
                            "fix the issue and resubmit. Details below."
                        )
                        st.exception(e)

    with tab_edit:
        clients_for_edit = plan_storage.list_clients(root)
        if not clients_for_edit:
            st.info("No clients yet — create one in the **➕ New** tab.")
        else:
            st.markdown(
                "Edit a client's record, or **permanently delete** it. "
                "Deletion removes the client directory including all sessions and uploaded files. "
                "Active plans block deletion — revoke or delete them first."
            )
            cid_choice = st.selectbox(
                "Pick client",
                [c.client_id for c in clients_for_edit],
                format_func=lambda cid: (
                    f"{cid} — {next((c.display_name for c in clients_for_edit if c.client_id == cid), '')}"
                ),
                key="edit_client_choice",
            )
            client_to_edit = next(c for c in clients_for_edit if c.client_id == cid_choice)
            _render_client_edit_form(client_to_edit, root)


def _render_client_edit_form(client: Client, root: Path):
    """Edit form for an existing client. Mirrors the New form but pre-filled."""
    st.divider()
    st.markdown(f"### Editing `{client.client_id}` &nbsp; <small>v{client.version}</small>", unsafe_allow_html=True)

    with st.form("edit_client", clear_on_submit=False):
        st.markdown("##### 🪪 Identity")
        display = st.text_input("Display name", value=client.display_name)
        col1, col2, col3 = st.columns(3)
        with col1:
            intake = st.date_input("Intake date", value=client.intake_date)
        with col2:
            age_band = st.text_input("Age band", value=client.age_band)
        with col3:
            sex = st.selectbox(
                "Sex",
                ["F", "M", "other"],
                index=["F", "M", "other"].index(client.sex) if client.sex in ("F", "M", "other") else 2,
            )

        st.markdown("##### 🩺 Clinical context")
        conditions = st.text_area(
            "Currently active conditions (one per line)",
            value="\n".join(client.active_conditions),
        )
        history = st.text_area(
            "Medical history — past diagnoses & status (one per line)",
            value="\n".join(client.medical_history),
        )
        meds = st.text_area("Current medications (one per line)", value="\n".join(client.current_medications))
        allergies = st.text_area("Known allergies (one per line)", value="\n".join(client.known_allergies))
        goals = st.text_area("Goals (one per line)", value="\n".join(client.goals))

        st.markdown("##### 📏 Bio measurements")
        m = client.measurements
        mc1, mc2, mc3 = st.columns(3)
        with mc1:
            height = st.number_input("Height (cm)", min_value=0.0, max_value=250.0, value=float(m.height_cm or 0), step=0.5)
            waist = st.number_input("Waist (cm)", min_value=0.0, max_value=200.0, value=float(m.waist_cm or 0), step=0.5)
            rhr = st.number_input("Resting heart rate (bpm)", min_value=0, max_value=200, value=int(m.resting_heart_rate or 0))
        with mc2:
            weight = st.number_input("Weight (kg)", min_value=0.0, max_value=300.0, value=float(m.weight_kg or 0), step=0.1)
            hip = st.number_input("Hip (cm)", min_value=0.0, max_value=200.0, value=float(m.hip_cm or 0), step=0.5)
            bp_sys = st.number_input("BP systolic (mmHg)", min_value=0, max_value=250, value=int(m.blood_pressure_systolic or 0))
        with mc3:
            measured = st.date_input("Measured on", value=m.measured_on or date.today())
            bp_dia = st.number_input("BP diastolic (mmHg)", min_value=0, max_value=200, value=int(m.blood_pressure_diastolic or 0))
        measurement_notes = st.text_input("Measurement notes", value=m.notes)

        notes = st.text_area("Other notes", value=client.notes)

        col_save, col_cancel = st.columns([1, 1])
        save_clicked = col_save.form_submit_button("💾 Save changes", type="primary")
        col_cancel.markdown("&nbsp;")

        if save_clicked:
            try:
                new_meas = Measurements(
                    height_cm=height or None,
                    weight_kg=weight or None,
                    waist_cm=waist or None,
                    hip_cm=hip or None,
                    resting_heart_rate=int(rhr) if rhr else None,
                    blood_pressure_systolic=int(bp_sys) if bp_sys else None,
                    blood_pressure_diastolic=int(bp_dia) if bp_dia else None,
                    measured_on=measured if (height or weight or waist or hip or rhr or bp_sys) else None,
                    notes=measurement_notes,
                )
                updated = client.model_copy(update={
                    "display_name": display.strip(),
                    "intake_date": intake,
                    "age_band": age_band.strip(),
                    "sex": sex,
                    "active_conditions": [x.strip() for x in conditions.splitlines() if x.strip()],
                    "medical_history": [x.strip() for x in history.splitlines() if x.strip()],
                    "current_medications": [x.strip() for x in meds.splitlines() if x.strip()],
                    "known_allergies": [x.strip() for x in allergies.splitlines() if x.strip()],
                    "goals": [x.strip() for x in goals.splitlines() if x.strip()],
                    "notes": notes,
                    "measurements": new_meas,
                    "version": client.version + 1,
                    "updated_at": datetime.now(timezone.utc),
                    "updated_by": "shivani",
                })
                plan_storage.write_client(root, updated)
                st.success(f"✅ Saved `{client.client_id}` (v{updated.version})")
                st.toast("Saved", icon="✅")
            except Exception as e:
                st.error("**Couldn't save changes.** Details below.")
                st.exception(e)

    # ---- Delete (outside the form) ----
    st.divider()
    st.markdown("##### 🗑️ Delete client")
    st.caption(
        "Permanently remove this client and ALL their data — sessions, uploaded files, "
        "everything in their directory. **Cannot be undone.** Active plans block deletion."
    )
    confirm = st.text_input(
        f"Type the client_id (`{client.client_id}`) to enable deletion",
        key=f"del_confirm_{client.client_id}",
    )
    if confirm == client.client_id:
        if st.button(
            f"🗑️ Permanently delete {client.client_id}",
            type="secondary",
            key=f"del_btn_{client.client_id}",
        ):
            try:
                summary = plan_storage.delete_client(root, client.client_id)
                st.success(
                    f"✅ Deleted `{summary['client_id']}` "
                    f"({summary['files_deleted']} files, {summary['sessions_deleted']} sessions)"
                )
                st.toast("Client deleted", icon="🗑️")
                # Force a rerun so the dropdown updates
                st.rerun()
            except Exception as e:
                st.error("**Couldn't delete client.**")
                st.exception(e)
    else:
        st.button(
            f"🗑️ Permanently delete {client.client_id}",
            type="secondary",
            disabled=True,
            help=f"Type `{client.client_id}` in the box above to enable.",
        )


# ---------------------------------------------------------------------------
# Page: Plans
# ---------------------------------------------------------------------------

def render_plans_page():
    st.title("📋 Plans")
    root = plans_root()
    cat = load_catalogue_cached()

    clients = plan_storage.list_clients(root)
    if not clients:
        st.warning(
            "**No clients yet.** Go to the **Clients** page in the sidebar and "
            "create one before authoring a plan."
        )
        return

    # Top-level: pick a client first
    client_choice = st.selectbox(
        "Client",
        options=[c.client_id for c in clients],
        format_func=lambda cid: (
            f"{cid} — {next((c.display_name for c in clients if c.client_id == cid), '')}"
        ),
        key="plan_client_choice",
    )
    client = next(c for c in clients if c.client_id == client_choice)

    # Plans for this client
    all_plans = plan_storage.list_plans(root)
    client_plans = [p for p in all_plans if p.client_id == client_choice]

    tab_existing, tab_new = st.tabs([
        f"📋 {client.client_id} — existing plans ({len(client_plans)})",
        "➕ New plan",
    ])

    with tab_existing:
        if not client_plans:
            st.info(f"No plans yet for `{client_choice}`. Create one in the **New plan** tab.")
        else:
            # Status filter
            status_filter = st.multiselect(
                "Filter by status",
                options=[s.value for s in PlanStatus],
                default=[s.value for s in PlanStatus],
                key="plans_status_filter",
            )
            visible = [p for p in client_plans if p.status.value in status_filter]

            # Compact summary table (slug · status · version)
            with st.expander(f"📑 {len(visible)} plan(s) — slug · status · version", expanded=False):
                for p in visible:
                    color, label = _PLAN_STATUS_STYLE.get(
                        p.status.value, ("#666", p.status.value)
                    )
                    st.markdown(
                        f"- `{p.slug}` &nbsp; "
                        f"<span style='color:{color}; font-weight:600'>{label}</span> &nbsp; "
                        f"v{p.version}",
                        unsafe_allow_html=True,
                    )

            if not visible:
                st.info("No plans match the current status filter.")
            else:
                chosen = st.selectbox(
                    "Plan",
                    [p.slug for p in visible],
                    format_func=lambda s: (
                        f"{s} · v{next((p.version for p in visible if p.slug == s), '?')} "
                        f"[{next((p.status.value for p in visible if p.slug == s), '?')}]"
                    ),
                )
                plan = next(p for p in visible if p.slug == chosen)
                render_plan_editor(plan, client, cat, root)

    with tab_new:
        render_new_plan_form(client, root)


def render_new_plan_form(client: Client, root: Path):
    st.markdown(f"Create a draft plan for **{client.client_id}** ({client.display_name or '—'}).")
    with st.form("new_plan", clear_on_submit=True):
        suggested = f"{client.client_id}-{date.today().isoformat()}-foundations"
        slug = st.text_input(
            "Plan slug *",
            value=suggested,
            help="A unique identifier, e.g. cl-001-2026-04-29-peri-foundations.",
        )
        c1, c2 = st.columns(2)
        with c1:
            start = st.date_input("Plan start", value=date.today())
        with c2:
            weeks = st.number_input("Duration (weeks)", min_value=1, max_value=52, value=8, step=1)
        submitted = st.form_submit_button("Create plan")
        if submitted:
            try:
                now = datetime.now(timezone.utc)
                plan = Plan(
                    slug=slug,
                    client_id=client.client_id,
                    plan_period_start=start,
                    plan_period_weeks=int(weeks),
                    plan_period_recheck_date=start + timedelta(weeks=int(weeks)),
                    catalogue_snapshot=CatalogueSnapshot(snapshot_date=date.today()),
                    created_at=now,
                    updated_at=now,
                    updated_by="shivani",
                )
                # Refuse if slug already exists
                try:
                    existing = plan_storage.find_plan_path(root, slug)
                    st.error(
                        f"**A plan with slug `{slug}` already exists** at `{existing}`. "
                        "Pick a different slug."
                    )
                    return
                except FileNotFoundError:
                    pass
                p = plan_storage.write_plan(root, plan)
                st.success(f"✅ Created draft at `{p}`")
                st.info("Switch to the **existing plans** tab to start editing.")
            except Exception as e:
                st.error(
                    "**Couldn't create the plan.** Usually this is the slug format "
                    "(must be lowercase letters/numbers/hyphens only)."
                )
                st.exception(e)


# ---------------------------------------------------------------------------
# Plan editor (the meat)
# ---------------------------------------------------------------------------

def render_plan_editor(plan: Plan, client: Client, cat, root: Path):
    """Tabbed editor for a single plan + live plan-check sidebar."""
    st.markdown(
        f"### `{plan.slug}` &nbsp; · &nbsp; v{plan.version} &nbsp; "
        f"{_plan_status_badge(plan.status.value)} &nbsp; "
        f"<span style='color:#888'>client {plan.client_id}</span>",
        unsafe_allow_html=True,
    )
    st.caption(
        f"Plan period: **{plan.plan_period_start} → {plan.plan_period_recheck_date}** "
        f"({plan.plan_period_weeks} weeks)"
    )

    # Two-column layout: editor on left, live findings on right
    col_edit, col_check = st.columns([3, 1])

    # ---------- LIVE CHECK (right column) ----------
    with col_check:
        st.subheader("🔍 Plan check")
        findings = check_plan(plan, client, cat)
        if not findings:
            st.success("✅ **0 findings** — clean.")
        else:
            counts = {"CRITICAL": 0, "WARNING": 0, "INFO": 0}
            for f in findings:
                counts[f.severity] += 1
            badge_lines = []
            if counts["CRITICAL"]:
                badge_lines.append(f"🔴 **{counts['CRITICAL']} critical**")
            if counts["WARNING"]:
                badge_lines.append(f"🟡 {counts['WARNING']} warning")
            if counts["INFO"]:
                badge_lines.append(f"🔵 {counts['INFO']} info")
            st.markdown(" · ".join(badge_lines))
            for f in findings:
                icon = {"CRITICAL": "🔴", "WARNING": "🟡", "INFO": "🔵"}[f.severity]
                st.markdown(f"{icon} **{f.section}.{f.field}**")
                st.caption(f.detail)

    # ---------- EDITOR (left column) ----------
    with col_edit:
        editable = plan.status.value == "draft"
        if not editable:
            st.warning(
                f"This plan is **{plan.status.value}** — viewing only. "
                "Drafts are the only editable state."
            )

        tabs = st.tabs([
            "🩺 Assessment",
            "🌿 Lifestyle & Nutrition",
            "🎓 Education",
            "💊 Supplements",
            "🧪 Labs & Referrals",
            "📊 Tracking",
            "📝 Notes & Raw",
            "🚀 Lifecycle",
        ])

        # === Assessment ===
        with tabs[0]:
            edit_assessment(plan, cat, editable, root)

        # === Lifestyle & Nutrition ===
        with tabs[1]:
            edit_lifestyle_nutrition(plan, cat, editable, root)

        # === Education ===
        with tabs[2]:
            edit_education(plan, cat, editable, root)

        # === Supplements ===
        with tabs[3]:
            edit_supplements(plan, cat, editable, root)

        # === Labs & Referrals ===
        with tabs[4]:
            edit_labs_referrals(plan, editable, root)

        # === Tracking ===
        with tabs[5]:
            edit_tracking(plan, cat, editable, root)

        # === Notes & Raw ===
        with tabs[6]:
            edit_notes_raw(plan, editable, root)

        # === Lifecycle ===
        with tabs[7]:
            render_lifecycle_panel(plan, client, cat, root)


# ---------------------------------------------------------------------------
# Lifecycle panel (status timeline + transition buttons + diff viewer)
# ---------------------------------------------------------------------------

def _coach_user() -> str:
    return os.environ.get("FMDB_USER", "shivani")


def _render_findings(findings: list, key_prefix: str) -> int:
    """Render findings grouped by severity. Returns count of CRITICAL findings."""
    if not findings:
        st.success("✅ Plan check is clean — 0 findings.")
        return 0
    counts = {"CRITICAL": 0, "WARNING": 0, "INFO": 0}
    for f in findings:
        counts[f.severity] += 1
    cols = st.columns(3)
    cols[0].metric("🔴 Critical", counts["CRITICAL"])
    cols[1].metric("🟡 Warning", counts["WARNING"])
    cols[2].metric("🔵 Info", counts["INFO"])
    for sev, icon in [("CRITICAL", "🔴"), ("WARNING", "🟡"), ("INFO", "🔵")]:
        sev_findings = [f for f in findings if f.severity == sev]
        if not sev_findings:
            continue
        with st.expander(f"{icon} {sev} ({len(sev_findings)})", expanded=(sev == "CRITICAL")):
            for f in sev_findings:
                st.markdown(f"**{f.section}.{f.field}** — {f.detail}")
    return counts["CRITICAL"]


def render_lifecycle_panel(plan: Plan, client: Client, cat, root: Path):
    """Status timeline + transition buttons + diff viewer."""
    st.subheader("🚀 Lifecycle")

    # ----- Status header -----
    snap = plan.catalogue_snapshot
    snap_sha = snap.git_sha if (snap and snap.git_sha) else "—"
    snap_date = snap.snapshot_date.isoformat() if (snap and snap.snapshot_date) else "—"
    cols = st.columns([2, 1, 2, 2])
    cols[0].markdown(
        f"**Status**<br>{_plan_status_badge(plan.status.value)}",
        unsafe_allow_html=True,
    )
    cols[1].markdown(f"**Version**<br>v{plan.version}", unsafe_allow_html=True)
    cols[2].markdown(f"**Snapshot date**<br>{snap_date}", unsafe_allow_html=True)
    cols[3].markdown(f"**Catalogue SHA**<br>`{snap_sha}`", unsafe_allow_html=True)
    if plan.supersedes:
        st.caption(f"This plan supersedes `{plan.supersedes}`.")

    st.divider()

    # ----- Status history timeline -----
    st.markdown("**📜 Status history**")
    if not plan.status_history:
        st.caption("No transitions yet — plan is still in its initial state.")
    else:
        for ev in plan.status_history:
            at_str = ev.at.isoformat(timespec="minutes") if ev.at else "—"
            reason_str = f" — _{ev.reason}_" if ev.reason else ""
            st.markdown(
                f"- {_plan_status_badge(ev.state.value)} &nbsp; "
                f"by **{ev.by}** at `{at_str}`{reason_str}",
                unsafe_allow_html=True,
            )

    st.divider()

    # ----- State-appropriate action buttons -----
    status = plan.status
    user = _coach_user()

    if status == PlanStatus.draft:
        _lifecycle_actions_draft(plan, client, cat, root, user)
    elif status == PlanStatus.ready_to_publish:
        _lifecycle_actions_ready(plan, client, cat, root, user)
    elif status == PlanStatus.published:
        _lifecycle_actions_published(plan, client, root, user)
    else:  # superseded | revoked
        st.info(
            f"This plan is **{status.value}** — terminal state. "
            "No further transitions available."
        )

    st.divider()

    # ----- Diff viewer -----
    render_diff_viewer(plan, root)


def _lifecycle_actions_draft(plan: Plan, client: Client, cat, root: Path, user: str):
    st.markdown("**Actions**")
    c1, c2 = st.columns(2)
    if c1.button("🔍 Run plan-check", key=f"check_{plan.slug}"):
        st.session_state[f"_show_check_{plan.slug}"] = True
    if c2.button("📤 Submit for publishing", key=f"submit_{plan.slug}", type="primary"):
        st.session_state[f"_submit_attempt_{plan.slug}"] = True

    # Inline plan-check display
    if st.session_state.get(f"_show_check_{plan.slug}") or \
            st.session_state.get(f"_submit_attempt_{plan.slug}"):
        st.markdown("**Plan check findings**")
        findings = check_plan(plan, client, cat)
        critical = _render_findings(findings, f"chk_{plan.slug}")

        if st.session_state.get(f"_submit_attempt_{plan.slug}"):
            if critical:
                st.error(
                    f"❌ **Cannot submit** — {critical} CRITICAL finding(s). "
                    "Fix these first."
                )
            else:
                reason = st.text_input(
                    "Submit note (optional)",
                    key=f"submit_reason_{plan.slug}",
                )
                if st.button("✅ Confirm submit",
                             key=f"submit_confirm_{plan.slug}", type="primary"):
                    try:
                        plan_transitions.submit_plan(
                            root, plan.slug, by=user,
                            catalogue_dir=DATA_DIR, reason=reason,
                        )
                        st.success("✅ Submitted to ready_to_publish.")
                        st.session_state.pop(f"_submit_attempt_{plan.slug}", None)
                        st.rerun()
                    except (RuntimeError, ValueError) as e:
                        st.error(f"❌ Submit failed: {e}")


def _lifecycle_actions_ready(plan: Plan, client: Client, cat, root: Path, user: str):
    st.markdown("**Actions**")
    st.info(
        "📌 This plan is **ready to publish**. Publishing is **irreversible** — "
        "it freezes the catalogue snapshot to the current git SHA and bumps the version."
    )

    reason = st.text_input("Publish note (optional)", key=f"pub_reason_{plan.slug}")
    confirm = st.checkbox(
        "I understand this is irreversible",
        key=f"pub_confirm_check_{plan.slug}",
    )
    if st.button("🚀 Publish now", key=f"pub_btn_{plan.slug}",
                 type="primary", disabled=not confirm):
        try:
            _, written, sha = plan_transitions.publish_plan(
                root, plan.slug, by=user,
                catalogue_dir=DATA_DIR, reason=reason,
            )
            st.success(
                f"✅ Published to `{written.name}`. "
                f"Catalogue SHA frozen at `{sha or '—'}`."
            )
            st.rerun()
        except (RuntimeError, ValueError) as e:
            st.error(f"❌ Publish failed: {e}")


def _lifecycle_actions_published(plan: Plan, client: Client, root: Path, user: str):
    st.markdown("**Actions**")

    # Revoke + Successor side by side
    rev_col, sup_col = st.columns(2)

    with rev_col:
        st.markdown("##### 🛑 Revoke")
        rev_reason = st.text_input(
            "Reason (required)", key=f"rev_reason_{plan.slug}",
        )
        rev_confirm = st.checkbox(
            "I understand revoke is irreversible",
            key=f"rev_confirm_check_{plan.slug}",
        )
        if st.button("Revoke this plan", key=f"rev_btn_{plan.slug}",
                     disabled=not (rev_confirm and rev_reason.strip())):
            try:
                plan_transitions.revoke_plan(
                    root, plan.slug, by=user, reason=rev_reason,
                )
                st.success("✅ Plan revoked.")
                st.rerun()
            except (RuntimeError, ValueError) as e:
                st.error(f"❌ Revoke failed: {e}")

    with sup_col:
        st.markdown("##### 🆕 Create successor")
        st.caption(
            "Creates a new draft pre-filled with `supersedes` pointing to "
            "this plan. Edit it, submit, and publish to supersede this version."
        )
        new_slug_default = f"{plan.client_id}-{date.today().isoformat()}-successor"
        new_slug = st.text_input(
            "New plan slug", value=new_slug_default,
            key=f"successor_slug_{plan.slug}",
        )
        if st.button("Create successor draft",
                     key=f"successor_btn_{plan.slug}", type="primary"):
            try:
                # Refuse if slug exists
                try:
                    existing = plan_storage.find_plan_path(root, new_slug)
                    st.error(
                        f"❌ A plan with slug `{new_slug}` already exists at `{existing}`."
                    )
                except FileNotFoundError:
                    now = datetime.now(timezone.utc)
                    successor = Plan(
                        slug=new_slug,
                        client_id=plan.client_id,
                        plan_period_start=date.today(),
                        plan_period_weeks=plan.plan_period_weeks,
                        plan_period_recheck_date=date.today() + timedelta(
                            weeks=plan.plan_period_weeks),
                        catalogue_snapshot=CatalogueSnapshot(snapshot_date=date.today()),
                        created_at=now,
                        updated_at=now,
                        updated_by=user,
                        supersedes=plan.slug,
                    )
                    p = plan_storage.write_plan(root, successor)
                    st.success(
                        f"✅ Created successor draft at `{p.name}`. "
                        f"Switch the **Plan** selector at the top to `{new_slug}` "
                        "to start editing it."
                    )
                    st.rerun()
            except Exception as e:
                st.error(f"❌ Couldn't create successor: {e}")


def render_diff_viewer(plan: Plan, root: Path):
    st.markdown("**🔀 Diff viewer**")
    all_plans = plan_storage.list_plans(root)
    if len(all_plans) < 2:
        st.caption("Need at least 2 plans to diff.")
        return
    slugs = [p.slug for p in all_plans]
    default_a = plan.slug if plan.slug in slugs else slugs[0]
    default_b = plan.supersedes if (plan.supersedes and plan.supersedes in slugs) \
        else (slugs[1] if slugs[0] == default_a else slugs[0])
    c1, c2 = st.columns(2)
    slug_a = c1.selectbox(
        "Plan A", slugs,
        index=slugs.index(default_a),
        key=f"diff_a_{plan.slug}",
    )
    slug_b = c2.selectbox(
        "Plan B", slugs,
        index=slugs.index(default_b) if default_b in slugs else 0,
        key=f"diff_b_{plan.slug}",
    )
    if st.button("Show diff", key=f"diff_btn_{plan.slug}"):
        if slug_a == slug_b:
            st.info("Pick two different plans to diff.")
        else:
            try:
                diff = plan_transitions.diff_plans(root, slug_a, slug_b)
                if not diff.strip():
                    st.info("No differences.")
                else:
                    st.code(diff, language="diff")
            except Exception as e:
                st.error(f"❌ Diff failed: {e}")


def _save(plan: Plan, root: Path, msg: str = "Saved."):
    plan.updated_by = "shivani"
    plan_storage.write_plan(root, plan)
    st.toast(msg, icon="✅")
    st.rerun()


# ----- Section editors -----------------------------------------------------


def edit_assessment(plan: Plan, cat, editable: bool, root: Path):
    st.subheader("Assessment")
    topic_slugs = sorted([t.slug for t in cat.topics])
    symptom_slugs = sorted([s.slug for s in cat.symptoms])
    mech_slugs = sorted([m.slug for m in cat.mechanisms])

    primary = st.multiselect(
        "Primary topics",
        topic_slugs,
        default=plan.primary_topics,
        disabled=not editable,
        help="The main clinical area(s) for this client.",
    )
    contributing = st.multiselect(
        "Contributing topics",
        topic_slugs,
        default=plan.contributing_topics,
        disabled=not editable,
    )
    presenting = st.multiselect(
        "Presenting symptoms",
        symptom_slugs,
        default=plan.presenting_symptoms,
        disabled=not editable,
    )

    st.markdown("**Hypothesized drivers**")
    if plan.hypothesized_drivers:
        for i, hd in enumerate(plan.hypothesized_drivers):
            with st.container(border=True):
                cols = st.columns([2, 4, 1])
                cols[0].markdown(f"`{hd.mechanism}`")
                cols[1].caption(hd.reasoning or "—")
                if editable and cols[2].button("🗑️", key=f"del_hd_{i}"):
                    plan.hypothesized_drivers.pop(i)
                    _save(plan, root, "Driver removed.")
    else:
        st.caption("No drivers yet.")

    if editable:
        with st.form("add_driver", clear_on_submit=True):
            new_mech = st.selectbox("Add driver — mechanism", [""] + mech_slugs)
            new_reason = st.text_area("Reasoning (why is this in play for this client?)")
            if st.form_submit_button("Add driver"):
                if not new_mech:
                    st.error("Pick a mechanism.")
                else:
                    plan.hypothesized_drivers.append(
                        HypothesizedDriver(mechanism=new_mech, reasoning=new_reason)
                    )
                    _save(plan, root, "Driver added.")

    if editable and st.button("💾 Save assessment", type="primary"):
        plan.primary_topics = primary
        plan.contributing_topics = contributing
        plan.presenting_symptoms = presenting
        _save(plan, root, "Assessment saved.")


def edit_lifestyle_nutrition(plan: Plan, cat, editable: bool, root: Path):
    st.subheader("Lifestyle practices")
    if plan.lifestyle_practices:
        for i, pr in enumerate(plan.lifestyle_practices):
            with st.container(border=True):
                cols = st.columns([3, 2, 5, 1])
                cols[0].markdown(f"**{pr.name}**")
                cols[1].caption(pr.cadence)
                cols[2].caption(pr.details or "—")
                if editable and cols[3].button("🗑️", key=f"del_pr_{i}"):
                    plan.lifestyle_practices.pop(i)
                    _save(plan, root, "Practice removed.")
    else:
        st.caption("None yet.")
    if editable:
        with st.form("add_practice", clear_on_submit=True):
            c1, c2 = st.columns([2, 1])
            with c1:
                pname = st.text_input("Practice name", placeholder="morning sunlight")
            with c2:
                pcad = st.selectbox("Cadence", ["daily", "nightly", "weekly", "twice-daily", "as-needed", "other"])
            pdet = st.text_area("Details", placeholder="10 min outside within 30 min of waking")
            if st.form_submit_button("Add practice"):
                if not pname:
                    st.error("Practice name is required.")
                else:
                    plan.lifestyle_practices.append(PracticeItem(name=pname, cadence=pcad, details=pdet))
                    _save(plan, root, "Practice added.")

    st.divider()
    st.subheader("Nutrition")
    n = plan.nutrition
    pattern = st.text_input("Pattern label", value=n.pattern, disabled=not editable,
                            placeholder="gentle anti-inflammatory")
    add_str = st.text_area(
        "Foods to add (one per line)",
        value="\n".join(n.add),
        disabled=not editable,
        placeholder="protein at every meal\nleafy greens 2 cups/day",
    )
    reduce_str = st.text_area(
        "Foods to reduce (one per line)",
        value="\n".join(n.reduce),
        disabled=not editable,
    )
    timing = st.text_input("Meal timing", value=n.meal_timing, disabled=not editable,
                           placeholder="9am-7pm window; nothing within 3h of bed")
    ca_slugs = sorted([c.slug for c in cat.cooking_adjustments])
    hr_slugs = sorted([h.slug for h in cat.home_remedies])
    cas = st.multiselect("Cooking adjustments", ca_slugs, default=n.cooking_adjustments, disabled=not editable)
    hrs = st.multiselect("Home remedies", hr_slugs, default=n.home_remedies, disabled=not editable)

    if editable and st.button("💾 Save nutrition", type="primary"):
        plan.nutrition = NutritionPlan(
            pattern=pattern,
            add=[x.strip() for x in add_str.splitlines() if x.strip()],
            reduce=[x.strip() for x in reduce_str.splitlines() if x.strip()],
            meal_timing=timing,
            cooking_adjustments=cas,
            home_remedies=hrs,
        )
        _save(plan, root, "Nutrition saved.")


def edit_education(plan: Plan, cat, editable: bool, root: Path):
    st.subheader("Education modules")
    if plan.education:
        for i, em in enumerate(plan.education):
            with st.container(border=True):
                cols = st.columns([2, 2, 5, 1])
                cols[0].markdown(f"`{em.target_kind}`")
                cols[1].markdown(f"`{em.target_slug}`")
                cols[2].caption(em.client_facing_summary or "—")
                if editable and cols[3].button("🗑️", key=f"del_ed_{i}"):
                    plan.education.pop(i)
                    _save(plan, root, "Education module removed.")
    else:
        st.caption("None yet.")
    if not editable:
        return
    with st.form("add_education", clear_on_submit=True):
        kind = st.selectbox("Target type", ["topic", "mechanism", "claim"])
        if kind == "topic":
            slugs = sorted([t.slug for t in cat.topics])
        elif kind == "mechanism":
            slugs = sorted([m.slug for m in cat.mechanisms])
        else:
            slugs = sorted([c.slug for c in cat.claims])
        slug = st.selectbox(f"{kind.title()} slug", slugs)
        summary = st.text_area("Client-facing summary",
                               placeholder="What you'll actually say in session…")
        if st.form_submit_button("Add education module"):
            plan.education.append(EducationModule(
                target_kind=kind, target_slug=slug, client_facing_summary=summary
            ))
            _save(plan, root, "Module added.")


def edit_supplements(plan: Plan, cat, editable: bool, root: Path):
    st.subheader("Supplement protocol")
    supp_slugs = sorted([s.slug for s in cat.supplements])
    supp_by_slug = {s.slug: s for s in cat.supplements}

    if plan.supplement_protocol:
        for i, item in enumerate(plan.supplement_protocol):
            supp = supp_by_slug.get(item.supplement_slug)
            with st.container(border=True):
                cols = st.columns([3, 5, 1])
                with cols[0]:
                    st.markdown(f"**{item.supplement_slug}**")
                    bits = [item.form, item.dose, item.timing]
                    if item.duration_weeks:
                        bits.append(f"{item.duration_weeks}wk")
                    st.caption(" / ".join([b for b in bits if b]) or "(no params)")
                    if supp and supp.evidence_tier.value == "confirm_with_clinician":
                        st.warning("⚠️ catalogue tier: confirm with clinician")
                with cols[1]:
                    if item.coach_rationale:
                        st.markdown("*Rationale:* " + item.coach_rationale)
                    if item.titration:
                        st.caption("Titration: " + item.titration)
                if editable and cols[2].button("🗑️", key=f"del_sp_{i}"):
                    plan.supplement_protocol.pop(i)
                    _save(plan, root, "Supplement removed.")
    else:
        st.caption("None yet.")

    if not editable:
        return
    with st.form("add_supplement", clear_on_submit=True):
        slug = st.selectbox("Supplement", supp_slugs)
        chosen = supp_by_slug.get(slug)
        if chosen:
            st.caption(
                f"Catalogue: **{chosen.display_name}** "
                f"[{chosen.evidence_tier.value}] — "
                f"forms: {', '.join(f.value for f in chosen.forms_available) or '—'}"
            )
            if chosen.contraindications.conditions:
                st.caption("Contraindications: " + ", ".join(chosen.contraindications.conditions))
        c1, c2, c3 = st.columns(3)
        with c1:
            form = st.text_input("Form", placeholder="capsule")
        with c2:
            dose = st.text_input("Dose", placeholder="200-400 mg")
        with c3:
            timing = st.text_input("Timing", placeholder="bedtime")
        c4, c5 = st.columns(2)
        with c4:
            with_food = st.text_input("Take with food", placeholder="optional")
        with c5:
            duration = st.number_input("Duration (weeks)", min_value=0, value=8, step=1)
        titration = st.text_input("Titration",
                                  placeholder="Start 200mg x 2 weeks; if tolerated, up to 300mg")
        rationale = st.text_area("Rationale (why for this client?)",
                                 placeholder="3am wakeups + new anxiety = peri progesterone pattern")
        if st.form_submit_button("Add supplement"):
            plan.supplement_protocol.append(SupplementItem(
                supplement_slug=slug,
                form=form,
                dose=dose,
                timing=timing,
                take_with_food=with_food,
                duration_weeks=int(duration) if duration else None,
                titration=titration,
                coach_rationale=rationale,
            ))
            _save(plan, root, "Supplement added.")


def edit_labs_referrals(plan: Plan, editable: bool, root: Path):
    st.subheader("Lab orders")
    if plan.lab_orders:
        for i, lo in enumerate(plan.lab_orders):
            with st.container(border=True):
                cols = st.columns([3, 6, 1])
                cols[0].markdown(f"**{lo.test}**")
                cols[1].caption(lo.reason or "—")
                if editable and cols[2].button("🗑️", key=f"del_lo_{i}"):
                    plan.lab_orders.pop(i)
                    _save(plan, root, "Lab removed.")
    else:
        st.caption("None yet.")
    if editable:
        with st.form("add_lab", clear_on_submit=True):
            test = st.text_input("Test name", placeholder="hs-CRP")
            reason = st.text_input("Reason", placeholder="Inflammation baseline")
            if st.form_submit_button("Add lab"):
                if not test:
                    st.error("Test name is required.")
                else:
                    plan.lab_orders.append(LabOrderItem(test=test, reason=reason))
                    _save(plan, root, "Lab added.")

    st.divider()
    st.subheader("Referrals")
    if plan.referrals:
        for i, r in enumerate(plan.referrals):
            with st.container(border=True):
                cols = st.columns([3, 5, 1, 1])
                cols[0].markdown(f"**{r.to}**")
                cols[1].caption(r.reason)
                cols[2].caption(r.urgency.value)
                if editable and cols[3].button("🗑️", key=f"del_ref_{i}"):
                    plan.referrals.pop(i)
                    _save(plan, root, "Referral removed.")
    else:
        st.caption("None yet.")
    if editable:
        with st.form("add_referral", clear_on_submit=True):
            to = st.text_input("Refer to", placeholder="menopause-certified clinician")
            reason = st.text_input("Reason", placeholder="HRT consultation")
            urgency = st.selectbox("Urgency", ["routine", "soon", "urgent", "emergency"])
            if st.form_submit_button("Add referral"):
                if not to or not reason:
                    st.error("Both fields required.")
                else:
                    plan.referrals.append(ReferralItem(to=to, reason=reason, urgency=urgency))
                    _save(plan, root, "Referral added.")


def edit_tracking(plan: Plan, cat, editable: bool, root: Path):
    st.subheader("Tracking habits")
    if plan.tracking.habits:
        for i, h in enumerate(plan.tracking.habits):
            with st.container(border=True):
                cols = st.columns([4, 2, 1])
                cols[0].markdown(f"**{h.name}**")
                cols[1].caption(h.cadence)
                if editable and cols[2].button("🗑️", key=f"del_hb_{i}"):
                    plan.tracking.habits.pop(i)
                    _save(plan, root, "Habit removed.")
    else:
        st.caption("None yet.")
    if editable:
        with st.form("add_habit", clear_on_submit=True):
            c1, c2 = st.columns([3, 1])
            with c1:
                hname = st.text_input("Habit", placeholder="time in bed by 10:30pm")
            with c2:
                hcad = st.selectbox("Cadence", ["nightly", "daily", "weekly", "twice-daily", "as-needed"])
            if st.form_submit_button("Add habit"):
                if not hname:
                    st.error("Habit name is required.")
                else:
                    plan.tracking.habits.append(TrackingHabit(name=hname, cadence=hcad))
                    _save(plan, root, "Habit added.")

    st.divider()
    st.subheader("Symptoms to monitor")
    sym_slugs = sorted([s.slug for s in cat.symptoms])
    monitored = st.multiselect(
        "Pick symptoms to track week-over-week",
        sym_slugs,
        default=plan.tracking.symptoms_to_monitor,
        disabled=not editable,
    )

    st.subheader("Recheck questions")
    rq_str = st.text_area(
        "One question per line",
        value="\n".join(plan.tracking.recheck_questions),
        disabled=not editable,
        placeholder="Sleep onset compared to 4 weeks ago?\nHow many 3am wakeups per week?",
    )

    if editable and st.button("💾 Save tracking", type="primary"):
        plan.tracking.symptoms_to_monitor = monitored
        plan.tracking.recheck_questions = [x.strip() for x in rq_str.splitlines() if x.strip()]
        _save(plan, root, "Tracking saved.")


def edit_notes_raw(plan: Plan, editable: bool, root: Path):
    st.subheader("Coach notes (private)")
    notes = st.text_area("Working notes", value=plan.notes_for_coach, disabled=not editable, height=150)
    if editable and st.button("💾 Save notes", type="primary"):
        plan.notes_for_coach = notes
        _save(plan, root, "Notes saved.")
    st.divider()
    st.subheader("Raw YAML")
    st.code(plan.model_dump_json(indent=2), language="json")
    if editable:
        st.caption(
            "To edit advanced fields not exposed above, use the CLI:  \n"
            f"`.venv/bin/python -m fmdb.cli plan-edit {plan.slug}`"
        )


# ---------------------------------------------------------------------------
# Page: Assess & Suggest
# ---------------------------------------------------------------------------

def _session_history_bundle(prior_sessions: list[Session]) -> list[dict]:
    """Compact representation of prior sessions for the synthesis prompt.
    We keep what's useful for longitudinal reasoning, skip raw chat logs
    and full subgraph state."""
    out: list[dict] = []
    for s in prior_sessions:
        ai = s.ai_analysis or {}
        # Compress: just the headline of each suggestion category
        out.append({
            "session_id": s.session_id,
            "date": s.date.isoformat(),
            "presenting_complaints": s.presenting_complaints,
            "selected_symptoms": s.selected_symptoms,
            "selected_topics": s.selected_topics,
            "measurements_at_session": (
                s.measurements_snapshot.model_dump(mode="json")
                if s.measurements_snapshot else None
            ),
            "uploaded_files": [
                {"filename": f.filename, "kind": f.kind} for f in s.uploaded_files
            ],
            "key_drivers_identified": [
                {"mechanism": d.get("mechanism_slug"), "rank": d.get("rank")}
                for d in (ai.get("likely_drivers") or [])
            ],
            "supplements_suggested": [
                sp.get("supplement_slug") for sp in (ai.get("supplement_suggestions") or [])
            ],
            "extracted_labs": ai.get("extracted_labs") or [],
            "synthesis_notes": ai.get("synthesis_notes", ""),
            "generated_plan_slug": s.generated_plan_slug,
            "coach_notes": s.coach_notes,
        })
    return out


def render_assess_page():
    st.title("🧠 Assess & Suggest")
    st.caption(
        "Pick a client, drop in their symptoms / topics / lab reports / food log, and the "
        "tool synthesizes possible drivers + interventions drawn from the catalogue. "
        "Each Analyze run is saved as a session — when you Analyze again later, "
        "prior sessions are auto-included so the AI can compare timepoints."
    )

    root = plans_root()
    cat = load_catalogue_cached()

    clients = plan_storage.list_clients(root)
    if not clients:
        st.warning(
            "**No clients yet.** Go to the **👥 Clients** page in the sidebar and "
            "create one first — even a quick 30-second one with just basic info."
        )
        return

    # ---------- Step 1: pick client ----------
    st.subheader("1. Client")
    client_choice = st.selectbox(
        "Pick a client",
        options=[c.client_id for c in clients],
        format_func=lambda cid: (
            f"{cid} — {next((c.display_name for c in clients if c.client_id == cid), '')}"
        ),
        key="assess_client",
    )
    client = next(c for c in clients if c.client_id == client_choice)

    with st.expander("🩻 Client snapshot", expanded=False):
        st.write(f"**Age band:** {client.age_band} · **Sex:** {client.sex}")
        st.write(f"**Active conditions:** {', '.join(client.active_conditions) or '—'}")
        if client.medical_history:
            st.markdown("**Medical history:**")
            for h in client.medical_history:
                st.markdown(f"- {h}")
        st.write(f"**Medications:** {', '.join(client.current_medications) or '—'}")
        st.write(f"**Allergies:** {', '.join(client.known_allergies) or '—'}")
        st.write("**Goals:**")
        for g in client.goals:
            st.markdown(f"- {g}")
        m = client.measurements
        if any([m.height_cm, m.weight_kg, m.waist_cm, m.hip_cm,
                m.resting_heart_rate, m.blood_pressure_systolic]):
            st.markdown("**📏 Bio:**")
            bio_bits = []
            if m.height_cm:
                bio_bits.append(f"H {m.height_cm} cm")
            if m.weight_kg:
                bio_bits.append(f"W {m.weight_kg} kg")
            if m.bmi:
                bio_bits.append(f"BMI **{m.bmi}**")
            if m.waist_cm:
                bio_bits.append(f"waist {m.waist_cm} cm")
            if m.waist_hip_ratio:
                bio_bits.append(f"W:H **{m.waist_hip_ratio}**")
            if m.resting_heart_rate:
                bio_bits.append(f"HR {m.resting_heart_rate}")
            if m.blood_pressure_systolic and m.blood_pressure_diastolic:
                bio_bits.append(f"BP {m.blood_pressure_systolic}/{m.blood_pressure_diastolic}")
            age = client.estimated_age()
            bmr = m.bmr_mifflin_st_jeor(age, client.sex) if age else None
            if bmr:
                bio_bits.append(f"BMR ~{int(bmr)} kcal/d (est. age {age})")
            st.markdown(" · ".join(bio_bits))

    # ---------- Step 2: symptoms ----------
    st.subheader("2. Symptoms")

    sym_options = []
    sym_labels = {}
    for s in sorted(cat.symptoms, key=lambda x: x.display_name.lower()):
        label = f"{s.display_name} ({s.slug})"
        if s.aliases:
            label += f"  — also: {', '.join(s.aliases[:3])}"
        sym_options.append(s.slug)
        sym_labels[s.slug] = label

    selected_symptoms = st.multiselect(
        "Pick all that apply (search by name or alias)",
        options=sym_options,
        format_func=lambda slug: sym_labels[slug],
        key="assess_symptoms",
    )

    free_text_symptoms = st.text_area(
        "Anything else the client described that doesn't match a symptom above? (free text)",
        placeholder="e.g. 'feels like the floor is tilted in the morning', 'period clots are bigger this year'…",
        key="assess_free_text",
    )

    # ---------- Step 3: topics ----------
    st.subheader("3. Topics (optional)")
    topic_options = sorted([t.slug for t in cat.topics])
    selected_topics = st.multiselect(
        "Clinical areas you suspect are in play",
        options=topic_options,
        key="assess_topics",
        help="Leave empty if you want the AI to infer topics from symptoms only.",
    )

    # ---------- Step 4: lab uploads ----------
    st.subheader("4. Lab reports (optional)")
    uploaded_files = st.file_uploader(
        "Upload PDF / image files — Claude reads them directly",
        type=["pdf", "png", "jpg", "jpeg", "webp", "txt", "md"],
        accept_multiple_files=True,
        key="assess_labs",
        help="Standard panels: thyroid, lipids, CBC, metabolic; FM panels: DUTCH, GI-MAP, GTIR, etc.",
    )

    # ---------- Step 4b: food journal uploads ----------
    st.subheader("4b. Food journal / food log (optional)")
    food_files = st.file_uploader(
        "Upload food log — PDF, image, or text. The AI reads what the client is eating, "
        "meal timing, fiber, common offenders.",
        type=["pdf", "png", "jpg", "jpeg", "webp", "txt", "md"],
        accept_multiple_files=True,
        key="assess_food",
    )

    # ---------- Step 5: analyze ----------
    st.subheader("5. Synthesize")

    if not os.environ.get("ANTHROPIC_API_KEY"):
        st.error(
            "**ANTHROPIC_API_KEY is not set.** "
            "Add it to `fm-database/.env` and restart this app, then come back."
        )
        return

    # Show prior sessions inline so the coach knows what context the AI will see
    prior_sessions = plan_storage.list_sessions(root, client.client_id)
    if prior_sessions:
        with st.expander(f"🕰️ Session timeline ({len(prior_sessions)})", expanded=False):
            st.caption(
                "All prior sessions for this client — auto-included as context the "
                "next time you click Analyze. Click into any one to view full details."
            )
            for s in reversed(prior_sessions):  # newest first
                drivers = ", ".join(
                    d.get("mechanism_slug", "") for d in (s.ai_analysis.get("likely_drivers") or [])[:3]
                ) or "—"
                supps = ", ".join(
                    sp.get("supplement_slug", "") for sp in (s.ai_analysis.get("supplement_suggestions") or [])[:5]
                ) or "—"
                with st.container(border=True):
                    cols = st.columns([2, 5, 1])
                    cols[0].markdown(f"**{s.date}**")
                    cols[0].caption(s.session_id)
                    cols[1].markdown(f"_drivers:_ {drivers}")
                    cols[1].caption(f"supplements: {supps}")
                    if cols[2].button("View", key=f"view_session_{s.session_id}"):
                        st.session_state["viewing_session_id"] = s.session_id
                        st.session_state["viewing_session_client"] = client.client_id

            # Detail view for the picked session
            viewing_id = st.session_state.get("viewing_session_id")
            if viewing_id and st.session_state.get("viewing_session_client") == client.client_id:
                try:
                    sess = plan_storage.load_session(root, client.client_id, viewing_id)
                except FileNotFoundError:
                    st.warning(f"session {viewing_id} not found")
                    sess = None
                if sess:
                    st.divider()
                    st.markdown(f"### 🔎 Session detail — {sess.date} · `{sess.session_id}`")
                    if sess.presenting_complaints:
                        st.markdown(f"**Presenting complaints:** {sess.presenting_complaints}")
                    if sess.selected_symptoms:
                        st.markdown(f"**Symptoms:** {', '.join(sess.selected_symptoms)}")
                    if sess.selected_topics:
                        st.markdown(f"**Topics:** {', '.join(sess.selected_topics)}")
                    if sess.uploaded_files:
                        st.markdown("**Uploaded files at session:**")
                        for f in sess.uploaded_files:
                            st.markdown(f"  - `{f.filename}` ({f.kind})")
                    if sess.measurements_snapshot:
                        ms = sess.measurements_snapshot
                        bits = []
                        if ms.weight_kg:
                            bits.append(f"W {ms.weight_kg} kg")
                        if ms.bmi:
                            bits.append(f"BMI {ms.bmi}")
                        if ms.waist_hip_ratio:
                            bits.append(f"W:H {ms.waist_hip_ratio}")
                        if bits:
                            st.markdown("**Measurements at session:** " + " · ".join(bits))
                    ai = sess.ai_analysis or {}
                    if ai.get("likely_drivers"):
                        st.markdown("**Drivers identified:**")
                        for d in ai["likely_drivers"]:
                            st.markdown(f"  - {d.get('mechanism_slug')} — {d.get('reasoning', '')}")
                    if ai.get("supplement_suggestions"):
                        st.markdown("**Supplements suggested:**")
                        for sp in ai["supplement_suggestions"]:
                            bits = [sp.get("supplement_slug", "?")]
                            if sp.get("dose"): bits.append(sp["dose"])
                            if sp.get("timing"): bits.append(sp["timing"])
                            st.markdown(f"  - {' / '.join(bits)} — {sp.get('rationale', '')[:150]}")
                    if ai.get("synthesis_notes"):
                        st.info(f"**Synthesis notes:** {ai['synthesis_notes']}")
                    if sess.generated_plan_slug:
                        st.markdown(f"**Generated plan:** `{sess.generated_plan_slug}`")
                    if st.button("Close session detail", key=f"close_session_{sess.session_id}"):
                        st.session_state.pop("viewing_session_id", None)
                        st.rerun()

    if st.button("🔮 Analyze with AI", type="primary", use_container_width=True):
        if (not selected_symptoms and not selected_topics
                and not uploaded_files and not food_files
                and not free_text_symptoms.strip()):
            st.error(
                "**Nothing to analyze yet.** Pick at least one symptom or topic, "
                "upload a lab report or food log, or describe something in free-text."
            )
        else:
            with st.spinner("Synthesizing — this takes 20-60 seconds…"):
                try:
                    subgraph = build_subgraph(
                        cat,
                        symptom_slugs=selected_symptoms,
                        topic_slugs=selected_topics,
                    )

                    # ---- save uploaded files to client's files/ dir + build payloads ----
                    today = date.today()
                    file_refs: list[UploadedFileRef] = []
                    lab_payload = []
                    for uf in (uploaded_files or []):
                        data = uf.read()
                        # Save under clients/<id>/files/ with date prefix to avoid collisions
                        stored_name = f"{today.isoformat()}-{uf.name}"
                        plan_storage.save_client_file(root, client.client_id, stored_name, data)
                        file_refs.append(UploadedFileRef(
                            filename=stored_name,
                            kind="lab_report",
                            uploaded_at=datetime.now(timezone.utc),
                        ))
                        lab_payload.append({
                            "filename": stored_name,
                            "mime_type": uf.type or "application/octet-stream",
                            "data_b64": base64.b64encode(data).decode("ascii"),
                            "kind": "lab_report",
                        })
                    food_payload = []
                    for uf in (food_files or []):
                        data = uf.read()
                        stored_name = f"{today.isoformat()}-{uf.name}"
                        plan_storage.save_client_file(root, client.client_id, stored_name, data)
                        file_refs.append(UploadedFileRef(
                            filename=stored_name,
                            kind="food_journal",
                            uploaded_at=datetime.now(timezone.utc),
                        ))
                        food_payload.append({
                            "filename": stored_name,
                            "mime_type": uf.type or "application/octet-stream",
                            "data_b64": base64.b64encode(data).decode("ascii"),
                            "kind": "food_journal",
                        })

                    # ---- client context including bio + computed BMR/BMI ----
                    m = client.measurements
                    age = client.estimated_age()
                    bmr = m.bmr_mifflin_st_jeor(age, client.sex) if age else None
                    client_ctx = {
                        "client_id": client.client_id,
                        "age_band": client.age_band,
                        "estimated_age": age,
                        "sex": client.sex,
                        "active_conditions": client.active_conditions,
                        "medical_history": client.medical_history,
                        "current_medications": client.current_medications,
                        "known_allergies": client.known_allergies,
                        "goals": client.goals,
                        "notes": client.notes,
                        "measurements": {
                            "height_cm": m.height_cm,
                            "weight_kg": m.weight_kg,
                            "waist_cm": m.waist_cm,
                            "hip_cm": m.hip_cm,
                            "bmi": m.bmi,
                            "waist_hip_ratio": m.waist_hip_ratio,
                            "bmr_estimated_kcal_per_day": bmr,
                            "resting_heart_rate": m.resting_heart_rate,
                            "blood_pressure": (
                                f"{m.blood_pressure_systolic}/{m.blood_pressure_diastolic}"
                                if m.blood_pressure_systolic and m.blood_pressure_diastolic
                                else None
                            ),
                            "measured_on": m.measured_on.isoformat() if m.measured_on else None,
                            "notes": m.notes,
                        },
                    }

                    # ---- session history bundle (history-aware Analyze) ----
                    history_bundle = _session_history_bundle(prior_sessions)

                    result = synthesize(
                        client_context=client_ctx,
                        selected_symptom_slugs=selected_symptoms,
                        selected_topic_slugs=selected_topics,
                        subgraph=subgraph,
                        lab_files=lab_payload + food_payload,
                        additional_notes=free_text_symptoms,
                        session_history=history_bundle,
                    )

                    # ---- persist as a Session ----
                    now = datetime.now(timezone.utc)
                    sid = plan_storage.next_session_id(root, client.client_id, today)
                    sess = Session(
                        session_id=sid,
                        client_id=client.client_id,
                        date=today,
                        created_at=now,
                        selected_symptoms=selected_symptoms,
                        selected_topics=selected_topics,
                        presenting_complaints=free_text_symptoms,
                        uploaded_files=file_refs,
                        measurements_snapshot=client.measurements,
                        ai_analysis=result.get("suggestions", {}),
                        api_usage=result.get("usage", {}),
                    )
                    plan_storage.write_session(root, sess)
                    st.session_state["current_session_id"] = sid

                    # Auto-capture catalogue additions the AI flagged
                    additions = (result.get("suggestions", {}) or {}).get("catalogue_additions_suggested") or []
                    captured = 0
                    for it in additions:
                        if not it.get("name"):
                            continue
                        backlog_mod.add(
                            DATA_DIR,
                            kind=it.get("kind", "other"),
                            name=it["name"],
                            why=it.get("why", ""),
                            suggested_by="ai",
                            source_session_id=sid,
                            source_client_id=client.client_id,
                        )
                        captured += 1
                    if captured:
                        st.toast(f"Captured {captured} catalogue addition(s) — see 📝 Catalogue Backlog", icon="📝")

                    st.session_state["assess_result"] = result
                    st.session_state["assess_for_client"] = client.client_id
                    # Reset chat history when a new analysis runs
                    st.session_state["chat_messages"] = []
                    st.session_state["chat_context"] = {
                        "client_ctx": client_ctx,
                        "subgraph": subgraph,
                        "selected_symptoms": selected_symptoms,
                        "selected_topics": selected_topics,
                        "additional_notes": free_text_symptoms,
                        "suggestions": result.get("suggestions", {}),
                        "session_history": history_bundle,
                    }
                except Exception as e:
                    st.error("**The AI call failed.** Details below.")
                    st.exception(e)
                    return

    # ---------- Step 6: render suggestions ----------
    result = st.session_state.get("assess_result")
    if not result:
        st.info("Suggestions appear here after you click **Analyze**.")
        return
    if st.session_state.get("assess_for_client") != client.client_id:
        st.warning(
            "The previous analysis was for a different client. Click **Analyze** "
            "again to refresh for this client."
        )
        return

    suggestions = result.get("suggestions", {})
    usage = result.get("usage", {})

    st.divider()
    st.header("✨ Suggestions")
    st.caption(
        f"model: {usage.get('model', '?')} · "
        f"in: {usage.get('input_tokens', '?')} tokens · "
        f"out: {usage.get('output_tokens', '?')} tokens · "
        f"stop: {usage.get('stop_reason', '?')}"
    )

    if suggestions.get("synthesis_notes"):
        st.info(f"**🧐 Synthesis notes:** {suggestions['synthesis_notes']}")

    # Track which suggestions to add to a draft plan
    if "plan_draft_picks" not in st.session_state:
        st.session_state["plan_draft_picks"] = {}
    picks = st.session_state["plan_draft_picks"]

    def _check(key: str, default: bool = True) -> bool:
        cur = picks.get(key, default)
        new = st.checkbox("Include in plan", value=cur, key=f"chk_{key}")
        picks[key] = new
        return new

    # ----- Extracted labs -----
    if suggestions.get("extracted_labs"):
        with st.expander(f"🧪 Extracted lab values ({len(suggestions['extracted_labs'])})", expanded=True):
            for i, lab in enumerate(suggestions["extracted_labs"]):
                cols = st.columns([3, 2, 2, 5])
                cols[0].markdown(f"**{lab.get('test_name', '?')}**")
                v = lab.get("value", "?")
                u = lab.get("unit", "")
                cols[1].markdown(f"{v} {u}")
                flag = lab.get("flag", "")
                color = {"low": "🔵", "high": "🔴", "normal": "🟢", "optimal": "🟢", "suboptimal": "🟡"}.get(flag.lower(), "⚪")
                cols[2].markdown(f"{color} {flag or '—'}")
                cols[3].caption(lab.get("fm_interpretation", "—"))

    # ----- Likely drivers -----
    cat_mechs = {m.slug: m for m in cat.mechanisms}
    cat_mech_aliases = {a: m.slug for m in cat.mechanisms for a in m.aliases}
    if suggestions.get("likely_drivers"):
        st.subheader("🎯 Likely root-cause mechanisms")
        for d in suggestions["likely_drivers"]:
            mech_slug = d.get("mechanism_slug", "?")
            canonical = cat_mech_aliases.get(mech_slug, mech_slug)
            mech = cat_mechs.get(canonical)
            with st.container(border=True):
                cols = st.columns([4, 1])
                with cols[0]:
                    line = [f"**#{d.get('rank', '?')} — {mech_slug}**"]
                    if mech:
                        line.append(_evidence_badge(mech.evidence_tier.value))
                    st.markdown(" &nbsp; ".join(line), unsafe_allow_html=True)
                    st.caption(d.get("reasoning", ""))
                    if d.get("supporting_evidence"):
                        st.markdown("_Supporting evidence:_")
                        for ev in d["supporting_evidence"]:
                            st.markdown(f"  - {ev}")
                    if mech and mech.sources:
                        with st.expander("📚 Catalogue sources for this mechanism"):
                            for src in mech.sources:
                                bits = [f"**{src.id}**"]
                                if src.location:
                                    bits.append(src.location)
                                st.markdown(" — ".join(bits))
                                if src.quote:
                                    st.caption(f'"{src.quote}"')
                with cols[1]:
                    _check(f"driver_{mech_slug}")

    # ----- Topics in play -----
    cat_topics = {t.slug: t for t in cat.topics}
    cat_topic_aliases = {a: t.slug for t in cat.topics for a in t.aliases}
    if suggestions.get("topics_in_play"):
        st.subheader("🗂️ Topics in play")
        for t in suggestions["topics_in_play"]:
            t_slug = t.get("topic_slug")
            canonical_t = cat_topic_aliases.get(t_slug, t_slug)
            topic = cat_topics.get(canonical_t)
            with st.container(border=True):
                cols = st.columns([4, 1])
                with cols[0]:
                    role = t.get("role", "?")
                    icon = "🟢" if role == "primary" else "🟡"
                    line = [f"{icon} **{t_slug}** ({role})"]
                    if topic:
                        line.append(_evidence_badge(topic.evidence_tier.value))
                    st.markdown(" &nbsp; ".join(line), unsafe_allow_html=True)
                    if t.get("rationale"):
                        st.caption(t["rationale"])
                with cols[1]:
                    _check(f"topic_{t_slug}_{role}")

    # ----- Additional symptoms to screen -----
    if suggestions.get("additional_symptoms_to_screen"):
        with st.expander("🔍 Symptoms worth screening (the coach didn't mention these)", expanded=False):
            for s in suggestions["additional_symptoms_to_screen"]:
                st.markdown(f"- **{s.get('symptom_slug')}** — {s.get('why_screen', '')}")

    # ----- Lifestyle -----
    if suggestions.get("lifestyle_suggestions"):
        st.subheader("🌿 Lifestyle suggestions")
        for i, ls in enumerate(suggestions["lifestyle_suggestions"]):
            with st.container(border=True):
                cols = st.columns([4, 1])
                with cols[0]:
                    st.markdown(f"**{ls.get('name', '?')}** &nbsp; _({ls.get('cadence', '?')})_")
                    if ls.get("details"):
                        st.caption(ls["details"])
                    st.markdown(f"_{ls.get('rationale', '')}_")
                    if ls.get("addresses_mechanism"):
                        st.caption(f"Addresses: {', '.join(ls['addresses_mechanism'])}")
                with cols[1]:
                    _check(f"lifestyle_{i}_{ls.get('name', '')}")

    # ----- Nutrition -----
    nut = suggestions.get("nutrition_suggestions") or {}
    if nut and any(nut.values()):
        st.subheader("🥗 Nutrition")
        with st.container(border=True):
            cols = st.columns([4, 1])
            with cols[0]:
                if nut.get("pattern"):
                    st.markdown(f"**Pattern:** {nut['pattern']}")
                if nut.get("add"):
                    st.markdown("**Add:**")
                    for x in nut["add"]:
                        st.markdown(f"- {x}")
                if nut.get("reduce"):
                    st.markdown("**Reduce:**")
                    for x in nut["reduce"]:
                        st.markdown(f"- {x}")
                if nut.get("meal_timing"):
                    st.markdown(f"**Meal timing:** {nut['meal_timing']}")
                if nut.get("cooking_adjustment_slugs"):
                    st.markdown(f"**Cooking adjustments:** {', '.join(nut['cooking_adjustment_slugs'])}")
                if nut.get("home_remedy_slugs"):
                    st.markdown(f"**Home remedies:** {', '.join(nut['home_remedy_slugs'])}")
                if nut.get("rationale"):
                    st.caption(nut["rationale"])
            with cols[1]:
                _check("nutrition_block")

    # ----- Supplements -----
    if suggestions.get("supplement_suggestions"):
        st.subheader("💊 Supplement candidates")
        cat_supps = {s.slug: s for s in cat.supplements}
        for sp in suggestions["supplement_suggestions"]:
            slug = sp.get("supplement_slug", "?")
            cat_supp = cat_supps.get(slug)
            with st.container(border=True):
                cols = st.columns([4, 1])
                with cols[0]:
                    # Header line: slug + evidence-tier badge
                    header_parts = [f"**{slug}**"]
                    if cat_supp:
                        tier = cat_supp.evidence_tier.value
                        badge = _evidence_badge(tier)
                        header_parts.append(badge)
                    st.markdown(" &nbsp; ".join(header_parts), unsafe_allow_html=True)

                    bits = []
                    if sp.get("form"): bits.append(sp["form"])
                    if sp.get("dose"): bits.append(sp["dose"])
                    if sp.get("timing"): bits.append(sp["timing"])
                    if sp.get("duration_weeks"): bits.append(f"{sp['duration_weeks']}wk")
                    if bits:
                        st.caption(" / ".join(bits))
                    if sp.get("rationale"):
                        st.markdown(f"_{sp['rationale']}_")
                    if sp.get("evidence_tier_caveat"):
                        st.warning(f"⚠️ {sp['evidence_tier_caveat']}")
                    if sp.get("contraindication_check"):
                        st.error(f"🚫 {sp['contraindication_check']}")
                    if cat_supp and cat_supp.sources:
                        with st.expander("📚 Catalogue sources for this supplement"):
                            for src in cat_supp.sources:
                                bits2 = [f"**{src.id}**"]
                                if src.location:
                                    bits2.append(src.location)
                                st.markdown(" — ".join(bits2))
                                if src.quote:
                                    st.caption(f'"{src.quote}"')
                with cols[1]:
                    _check(f"supp_{slug}")

    # ----- Lab follow-ups -----
    if suggestions.get("lab_followups"):
        st.subheader("🧪 Lab follow-ups")
        for i, lf in enumerate(suggestions["lab_followups"]):
            with st.container(border=True):
                cols = st.columns([4, 1])
                cols[0].markdown(f"**{lf.get('test', '?')}** — {lf.get('reason', '')}")
                with cols[1]:
                    _check(f"lab_{i}_{lf.get('test', '')}")

    # ----- Referrals -----
    if suggestions.get("referral_triggers"):
        st.subheader("🚨 Referral triggers")
        for i, r in enumerate(suggestions["referral_triggers"]):
            with st.container(border=True):
                cols = st.columns([4, 1])
                with cols[0]:
                    urgency = r.get("urgency", "routine")
                    icon = {"emergency": "🚨", "urgent": "🔴", "soon": "🟡", "routine": "🔵"}.get(urgency, "🔵")
                    st.markdown(f"{icon} **Refer to:** {r.get('to', '?')} _({urgency})_")
                    st.caption(r.get("reason", ""))
                with cols[1]:
                    _check(f"ref_{i}", default=urgency in ("emergency", "urgent"))

    # ----- Catalogue additions suggested by AI -----
    additions = suggestions.get("catalogue_additions_suggested") or []
    if additions:
        st.subheader("🆕 Catalogue additions suggested")
        st.caption(
            "These items the AI would have suggested if they existed in the catalogue. "
            "They've been auto-added to the backlog. View / manage in **📝 Catalogue Backlog** in the sidebar."
        )
        existing_open = {
            (it["kind"], it["name"].lower()): it["id"]
            for it in backlog_mod.list_items(DATA_DIR, status="open")
        }
        for it in additions:
            kind = it.get("kind", "?")
            name = it.get("name", "?")
            why = it.get("why", "")
            with st.container(border=True):
                in_backlog = (kind, name.lower()) in existing_open
                badge = "📝 in backlog" if in_backlog else "✨ new"
                st.markdown(f"**{name}** &nbsp; `{kind}` &nbsp; _{badge}_")
                if why:
                    st.caption(why)

    # ----- Education framings -----
    if suggestions.get("education_framings"):
        st.subheader("🎓 Coaching framings")
        for i, ed in enumerate(suggestions["education_framings"]):
            with st.container(border=True):
                cols = st.columns([4, 1])
                with cols[0]:
                    st.markdown(f"**{ed.get('target_kind')}/{ed.get('target_slug')}**")
                    st.markdown(ed.get("client_facing_summary", ""))
                with cols[1]:
                    _check(f"edu_{i}_{ed.get('target_slug', '')}")

    # ---------- Chat panel — follow-up Q&A about this assessment ----------
    st.divider()
    st.subheader("💬 Follow-up chat")
    st.caption(
        "Ask follow-up questions about the suggestions above. "
        "The assistant has full context — your prior selections, the lab data, "
        "the suggestions, and the relevant catalogue subgraph. Each turn "
        "costs ~$0.05-0.10."
    )

    chat_messages = st.session_state.get("chat_messages", [])
    chat_context = st.session_state.get("chat_context", {})

    # Render history
    for msg in chat_messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

    # New input
    if user_q := st.chat_input("Ask a follow-up about this client / these suggestions…"):
        if not chat_context:
            st.error(
                "**No assessment context yet.** Run **🔮 Analyze** first, then come back to chat."
            )
        else:
            chat_messages.append({"role": "user", "content": user_q})
            with st.chat_message("user"):
                st.markdown(user_q)
            with st.chat_message("assistant"):
                with st.spinner("Thinking…"):
                    try:
                        out = ai_chat(
                            chat_context=chat_context,
                            messages=chat_messages,
                        )
                        reply = out.get("reply", "(no reply)")
                        st.markdown(reply)
                        chat_messages.append({"role": "assistant", "content": reply})
                        u = out.get("usage", {})
                        st.caption(
                            f"in: {u.get('input_tokens', '?')} (cache_r: {u.get('cache_read_input_tokens', '?')}) · "
                            f"out: {u.get('output_tokens', '?')} tokens"
                        )
                    except Exception as e:
                        st.error("**Chat failed.** Details below.")
                        st.exception(e)
            st.session_state["chat_messages"] = chat_messages

    if chat_messages and st.button("🗑️ Clear chat history", key="clear_chat"):
        st.session_state["chat_messages"] = []
        st.rerun()

    # ---------- Step 7: generate draft plan ----------
    st.divider()
    st.subheader("6. Generate draft plan from selected suggestions")

    if st.button("📝 Generate draft plan", type="primary", use_container_width=True):
        try:
            slug = generate_plan_from_suggestions(
                client=client,
                suggestions=suggestions,
                picks=picks,
                root=root,
                cat=cat,
                free_text_notes=free_text_symptoms,
            )
            st.success(
                f"✅ Draft plan created: **{slug}**\n\n"
                "Switch to **📋 Plans** in the sidebar to refine and check it."
            )
            # Clear picks so the next analysis starts fresh
            st.session_state["plan_draft_picks"] = {}
        except Exception as e:
            st.error("**Couldn't generate plan.** Details below.")
            st.exception(e)


def generate_plan_from_suggestions(
    *,
    client: Client,
    suggestions: dict,
    picks: dict,
    root: Path,
    cat,
    free_text_notes: str = "",
) -> str:
    """Build a Plan from the AI suggestions the coach checked."""
    now = datetime.now(timezone.utc)
    today = date.today()
    slug = f"{client.client_id}-{today.isoformat()}-assess"
    # Avoid clobbering: bump suffix if exists
    base = slug
    n = 1
    while True:
        try:
            plan_storage.find_plan_path(root, slug)
            n += 1
            slug = f"{base}-{n}"
        except FileNotFoundError:
            break

    plan = Plan(
        slug=slug,
        client_id=client.client_id,
        plan_period_start=today,
        plan_period_weeks=8,
        plan_period_recheck_date=today + timedelta(weeks=8),
        catalogue_snapshot=CatalogueSnapshot(snapshot_date=today),
        created_at=now,
        updated_at=now,
        updated_by="shivani",
    )

    # Hypothesized drivers
    for d in suggestions.get("likely_drivers", []) or []:
        if picks.get(f"driver_{d.get('mechanism_slug')}", True):
            plan.hypothesized_drivers.append(HypothesizedDriver(
                mechanism=d.get("mechanism_slug", ""),
                reasoning=d.get("reasoning", ""),
            ))

    # Topics
    for t in suggestions.get("topics_in_play", []) or []:
        role = t.get("role", "primary")
        slug_t = t.get("topic_slug", "")
        if not slug_t:
            continue
        if picks.get(f"topic_{slug_t}_{role}", True):
            if role == "contributing":
                plan.contributing_topics.append(slug_t)
            else:
                plan.primary_topics.append(slug_t)

    # Lifestyle
    for i, ls in enumerate(suggestions.get("lifestyle_suggestions", []) or []):
        if picks.get(f"lifestyle_{i}_{ls.get('name', '')}", True):
            plan.lifestyle_practices.append(PracticeItem(
                name=ls.get("name", ""),
                cadence=ls.get("cadence", "daily"),
                details=ls.get("details", ""),
            ))

    # Nutrition (single block check)
    nut = suggestions.get("nutrition_suggestions") or {}
    if nut and picks.get("nutrition_block", True):
        plan.nutrition = NutritionPlan(
            pattern=nut.get("pattern", ""),
            add=nut.get("add", []) or [],
            reduce=nut.get("reduce", []) or [],
            meal_timing=nut.get("meal_timing", ""),
            cooking_adjustments=nut.get("cooking_adjustment_slugs", []) or [],
            home_remedies=nut.get("home_remedy_slugs", []) or [],
        )

    # Supplements
    for sp in suggestions.get("supplement_suggestions", []) or []:
        slug_s = sp.get("supplement_slug", "")
        if not slug_s:
            continue
        if picks.get(f"supp_{slug_s}", True):
            plan.supplement_protocol.append(SupplementItem(
                supplement_slug=slug_s,
                form=sp.get("form", "") or "",
                dose=sp.get("dose", "") or "",
                timing=sp.get("timing", "") or "",
                duration_weeks=sp.get("duration_weeks"),
                coach_rationale=(sp.get("rationale", "") or "") + (
                    f"\n\n[evidence-tier note] {sp['evidence_tier_caveat']}"
                    if sp.get("evidence_tier_caveat") else ""
                ),
            ))

    # Lab follow-ups
    for i, lf in enumerate(suggestions.get("lab_followups", []) or []):
        if picks.get(f"lab_{i}_{lf.get('test', '')}", True):
            plan.lab_orders.append(LabOrderItem(
                test=lf.get("test", ""),
                reason=lf.get("reason", ""),
            ))

    # Referrals
    for i, r in enumerate(suggestions.get("referral_triggers", []) or []):
        urgency = r.get("urgency", "routine")
        if picks.get(f"ref_{i}", True):
            plan.referrals.append(ReferralItem(
                to=r.get("to", ""),
                reason=r.get("reason", ""),
                urgency=urgency,
            ))

    # Education
    for i, ed in enumerate(suggestions.get("education_framings", []) or []):
        if picks.get(f"edu_{i}_{ed.get('target_slug', '')}", True):
            plan.education.append(EducationModule(
                target_kind=ed.get("target_kind", "topic"),
                target_slug=ed.get("target_slug", ""),
                client_facing_summary=ed.get("client_facing_summary", ""),
            ))

    # Notes
    if suggestions.get("synthesis_notes") or free_text_notes:
        plan.notes_for_coach = (
            (f"Free-text intake: {free_text_notes}\n\n" if free_text_notes else "")
            + (f"AI synthesis notes: {suggestions['synthesis_notes']}" if suggestions.get("synthesis_notes") else "")
        )

    plan_storage.write_plan(root, plan)
    return slug


# ---------------------------------------------------------------------------
# Page: Mind Map
# ---------------------------------------------------------------------------


def _render_mermaid(source: str, height_px: int = 800) -> None:
    """Embed a mermaid diagram via the CDN. No streamlit-mermaid dep needed."""
    import streamlit.components.v1 as components
    html = f"""
    <div style="background:#fafafa; padding:10px; border-radius:8px;">
      <pre class="mermaid" style="text-align:left; font-size:14px;">{source}</pre>
    </div>
    <script type="module">
      import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
      mermaid.initialize({{
        startOnLoad: true,
        theme: 'default',
        mindmap: {{ padding: 20, maxNodeWidth: 220 }},
        themeVariables: {{
          fontSize: '14px',
          primaryColor: '#e8eaf6',
          primaryBorderColor: '#5c6bc0',
          primaryTextColor: '#1a237e',
          lineColor: '#90a4ae',
        }}
      }});
      mermaid.run();
    </script>
    """
    components.html(html, height=height_px, scrolling=True)


def render_mindmap_page():
    st.title("🧭 Mind Map")
    st.caption(
        "Two modes: **curated** maps are hand-authored clinical mind maps "
        "(like the Vitaone tool); **auto** generates a tree from the "
        "catalogue's cross-references for any entity."
    )

    cat = load_catalogue_cached()
    tab_curated, tab_auto = st.tabs([
        f"📘 Curated mind maps ({len(cat.mindmaps)})",
        "🌐 Auto from catalogue",
    ])
    with tab_curated:
        _render_curated_mindmaps_tab(cat)
    with tab_auto:
        _render_auto_mindmap_tab(cat)


def _render_curated_mindmaps_tab(cat):
    if not cat.mindmaps:
        st.info(
            "**No curated mind maps yet.** Author one as YAML at "
            "`data/mindmaps/<slug>.yaml` (see `fmdb.models.MindMap` for the schema), "
            "or use the Vitaone scraper to ingest existing maps."
        )
        return
    chosen = st.selectbox(
        "Pick a mind map",
        options=[mm.slug for mm in cat.mindmaps],
        format_func=lambda s: f"{next((m.display_name for m in cat.mindmaps if m.slug == s), s)} ({s})",
    )
    mm = next(m for m in cat.mindmaps if m.slug == chosen)
    st.markdown(
        f"### {mm.display_name} &nbsp; {_evidence_badge(mm.evidence_tier.value)}",
        unsafe_allow_html=True,
    )
    if mm.description:
        st.caption(mm.description)
    if mm.related_topics or mm.related_mechanisms:
        bits = []
        if mm.related_topics:
            bits.append(f"**Topics:** {', '.join(mm.related_topics)}")
        if mm.related_mechanisms:
            bits.append(f"**Mechanisms:** {', '.join(mm.related_mechanisms)}")
        st.markdown(" &nbsp;·&nbsp; ".join(bits))
    src = curated_to_mermaid(mm)
    _render_mermaid(src, height_px=900)
    if mm.sources:
        with st.expander("📚 Sources"):
            for s in mm.sources:
                bits = [f"**{s.id}**"]
                if s.location:
                    bits.append(s.location)
                st.markdown(" — ".join(bits))
                if s.quote:
                    st.caption(f'"{s.quote}"')
    with st.expander("🔧 Mermaid source"):
        st.code(src, language="text")


_KIND_LABEL = {
    "topic":              ("🟦", "Clinical area",      "fm-chip-topic"),
    "mechanism":          ("🟪", "Mechanism",          "fm-chip-mechanism"),
    "symptom":            ("🟩", "Symptom",            "fm-chip-symptom"),
    "supplement":         ("🟧", "Supplement",         "fm-chip-supplement"),
    "claim":              ("🟨", "Claim",              "fm-chip-claim"),
    "cooking_adjustment": ("🍳", "Cooking adjustment", "fm-chip-cooking"),
    "home_remedy":        ("🌿", "Home remedy",        "fm-chip-remedy"),
}


def _entity_display_name(cat, kind: str, slug: str) -> str:
    """Look up the display name (not slug) for any entity."""
    if kind == "topic":
        e = next((t for t in cat.topics if t.slug == slug), None)
        return e.display_name if e else slug
    if kind == "mechanism":
        e = next((m for m in cat.mechanisms if m.slug == slug), None)
        return e.display_name if e else slug
    if kind == "symptom":
        e = next((s for s in cat.symptoms if s.slug == slug), None)
        return e.display_name if e else slug
    if kind == "supplement":
        e = next((s for s in cat.supplements if s.slug == slug), None)
        return e.display_name if e else slug
    if kind == "claim":
        e = next((c for c in cat.claims if c.slug == slug), None)
        return (e.statement[:60] + "…") if (e and len(e.statement) > 60) else (e.statement if e else slug)
    if kind == "cooking_adjustment":
        e = next((c for c in cat.cooking_adjustments if c.slug == slug), None)
        return e.display_name if e else slug
    if kind == "home_remedy":
        e = next((h for h in cat.home_remedies if h.slug == slug), None)
        return e.display_name if e else slug
    return slug


def _render_auto_mindmap_tab(cat):
    st.markdown(
        "Pick any concept and see how it connects across your catalogue. "
        "**Click any related card** to drill into it."
    )

    # Build all selectable entities
    options: list[tuple[str, str, str]] = []  # (kind, slug, display)
    for t in sorted(cat.topics, key=lambda x: x.display_name.lower()):
        options.append(("topic", t.slug, t.display_name))
    for m in sorted(cat.mechanisms, key=lambda x: x.display_name.lower()):
        options.append(("mechanism", m.slug, m.display_name))
    for s in sorted(cat.symptoms, key=lambda x: x.display_name.lower()):
        options.append(("symptom", s.slug, s.display_name))
    for s in sorted(cat.supplements, key=lambda x: x.display_name.lower()):
        options.append(("supplement", s.slug, s.display_name))
    for c in sorted(cat.claims, key=lambda x: x.slug):
        options.append(("claim", c.slug, c.statement[:60] + ("…" if len(c.statement) > 60 else "")))

    if not options:
        st.info("Catalogue is empty.")
        return

    # ---- Navigation history in session state ----
    if "mm_history" not in st.session_state:
        st.session_state["mm_history"] = []
    if "mm_current" not in st.session_state:
        # Default to perimenopause topic if present, else first option
        default = next((o for o in options if o[:2] == ("topic", "perimenopause")), options[0])
        st.session_state["mm_current"] = default

    # Honor a "recenter" request set by clicking a card
    rc = st.session_state.pop("mm_recenter", None)
    if rc:
        new_o = next((o for o in options if o[:2] == rc), None)
        if new_o:
            st.session_state["mm_history"].append(st.session_state["mm_current"])
            st.session_state["mm_current"] = new_o

    cur_kind, cur_slug, cur_display = st.session_state["mm_current"]

    # ---- Top bar: back + dropdown ----
    nav_cols = st.columns([1, 6, 2])
    with nav_cols[0]:
        if st.session_state["mm_history"]:
            if st.button("← Back", use_container_width=True):
                st.session_state["mm_current"] = st.session_state["mm_history"].pop()
                st.rerun()
        else:
            st.markdown("")
    with nav_cols[1]:
        labels = [f"{_KIND_LABEL[o[0]][0]}  {o[2]}" for o in options]
        cur_label = f"{_KIND_LABEL[cur_kind][0]}  {cur_display}"
        try:
            cur_idx = labels.index(cur_label)
        except ValueError:
            cur_idx = 0
        chosen = st.selectbox(
            "Jump to",
            labels,
            index=cur_idx,
            key=f"mm_picker_{cur_kind}_{cur_slug}",
            label_visibility="collapsed",
        )
        if chosen != cur_label:
            new_o = options[labels.index(chosen)]
            st.session_state["mm_history"].append(st.session_state["mm_current"])
            st.session_state["mm_current"] = new_o
            st.rerun()
    with nav_cols[2]:
        show_slugs = st.checkbox("Show technical IDs", value=False, key="mm_show_slugs")

    st.write("")  # spacing

    # ---- Build the tree of related entities ----
    tree = build_tree(cat, cur_kind, cur_slug)
    if tree is None:
        st.error(f"Couldn't build a connection map for this entry.")
        return

    # ---- HERO CARD: the centered entity ----
    icon, kind_label, _ = _KIND_LABEL.get(cur_kind, ("⚪", cur_kind, ""))

    with st.container(border=True):
        # Header with icon + name + tier
        if cur_kind == "topic":
            ent = next((t for t in cat.topics if t.slug == cur_slug), None)
            header_html = (
                f"<div style='display:flex; align-items:center; gap:14px; margin-bottom:8px;'>"
                f"<span style='font-size:2rem;'>{icon}</span>"
                f"<div><div style='font-size:0.75rem; color:#6b7d8c; text-transform:uppercase; letter-spacing:0.05em;'>{kind_label}</div>"
                f"<div style='font-size:1.6rem; font-weight:600; color:#1a3a52;'>{cur_display}</div></div>"
                f"</div>"
            )
            st.markdown(header_html, unsafe_allow_html=True)
            if ent:
                st.markdown(_evidence_badge(ent.evidence_tier.value), unsafe_allow_html=True)
                st.markdown(ent.summary or "*(no summary)*")
                if ent.coaching_scope_notes:
                    st.success(f"**What you can coach on:** {ent.coaching_scope_notes}")
                if ent.clinician_scope_notes:
                    st.warning(f"**Refer / clinician territory:** {ent.clinician_scope_notes}")
                if ent.red_flags:
                    with st.expander(f"🚨 Red flags ({len(ent.red_flags)})"):
                        for rf in ent.red_flags:
                            st.markdown(f"- {rf}")
        elif cur_kind == "mechanism":
            ent = next((m for m in cat.mechanisms if m.slug == cur_slug), None)
            header_html = (
                f"<div style='display:flex; align-items:center; gap:14px; margin-bottom:8px;'>"
                f"<span style='font-size:2rem;'>{icon}</span>"
                f"<div><div style='font-size:0.75rem; color:#6b7d8c; text-transform:uppercase; letter-spacing:0.05em;'>{kind_label} · {ent.category.value if ent else ''}</div>"
                f"<div style='font-size:1.6rem; font-weight:600; color:#1a3a52;'>{cur_display}</div></div>"
                f"</div>"
            )
            st.markdown(header_html, unsafe_allow_html=True)
            if ent:
                st.markdown(_evidence_badge(ent.evidence_tier.value), unsafe_allow_html=True)
                st.markdown(ent.summary or "")
                if ent.upstream_drivers:
                    st.markdown("**Upstream drivers:** " + ", ".join(ent.upstream_drivers))
                if ent.downstream_effects:
                    st.markdown("**Downstream effects:** " + ", ".join(ent.downstream_effects))
        elif cur_kind == "symptom":
            ent = next((s for s in cat.symptoms if s.slug == cur_slug), None)
            header_html = (
                f"<div style='display:flex; align-items:center; gap:14px; margin-bottom:8px;'>"
                f"<span style='font-size:2rem;'>{icon}</span>"
                f"<div><div style='font-size:0.75rem; color:#6b7d8c; text-transform:uppercase; letter-spacing:0.05em;'>{kind_label} · {ent.category.value if ent else ''} · {ent.severity.value if ent else ''}</div>"
                f"<div style='font-size:1.6rem; font-weight:600; color:#1a3a52;'>{cur_display}</div></div>"
                f"</div>"
            )
            st.markdown(header_html, unsafe_allow_html=True)
            if ent:
                st.markdown(ent.description or "")
                if ent.when_to_refer:
                    st.warning(f"**When to refer:** {ent.when_to_refer}")
                if ent.aliases:
                    st.caption(f"Also called: {', '.join(ent.aliases)}")
        elif cur_kind == "supplement":
            ent = next((s for s in cat.supplements if s.slug == cur_slug), None)
            header_html = (
                f"<div style='display:flex; align-items:center; gap:14px; margin-bottom:8px;'>"
                f"<span style='font-size:2rem;'>{icon}</span>"
                f"<div><div style='font-size:0.75rem; color:#6b7d8c; text-transform:uppercase; letter-spacing:0.05em;'>{kind_label} · {ent.category.value if ent else ''}</div>"
                f"<div style='font-size:1.6rem; font-weight:600; color:#1a3a52;'>{cur_display}</div></div>"
                f"</div>"
            )
            st.markdown(header_html, unsafe_allow_html=True)
            if ent:
                st.markdown(_evidence_badge(ent.evidence_tier.value), unsafe_allow_html=True)
                if ent.forms_available:
                    st.markdown(f"**Forms:** {', '.join(f.value for f in ent.forms_available)}")
                if ent.typical_dose_range:
                    doses = ", ".join(
                        f"{form}: {dr.min}–{dr.max} {dr.unit.value}"
                        for form, dr in ent.typical_dose_range.items()
                    )
                    st.markdown(f"**Typical dose:** {doses}")
                if ent.timing_options:
                    st.markdown(f"**Timing:** {', '.join(t.value for t in ent.timing_options)}")
                if ent.notes_for_coach:
                    st.info(ent.notes_for_coach)
                if ent.contraindications.conditions:
                    st.warning("**Avoid in:** " + ", ".join(ent.contraindications.conditions))
        elif cur_kind == "claim":
            ent = next((c for c in cat.claims if c.slug == cur_slug), None)
            header_html = (
                f"<div style='display:flex; align-items:center; gap:14px; margin-bottom:8px;'>"
                f"<span style='font-size:2rem;'>{icon}</span>"
                f"<div><div style='font-size:0.75rem; color:#6b7d8c; text-transform:uppercase; letter-spacing:0.05em;'>{kind_label}</div>"
                f"<div style='font-size:1.4rem; font-weight:600; color:#1a3a52;'>{ent.statement if ent else cur_slug}</div></div>"
                f"</div>"
            )
            st.markdown(header_html, unsafe_allow_html=True)
            if ent:
                st.markdown(_evidence_badge(ent.evidence_tier.value), unsafe_allow_html=True)
                if ent.coaching_translation:
                    st.success(f"**In session, you might say:** {ent.coaching_translation}")
                if ent.caveats:
                    st.markdown("**Caveats:** " + " · ".join(ent.caveats))
        if show_slugs:
            st.caption(f"`{cur_kind}/{cur_slug}`")

    st.write("")

    # ---- Connection rows: each group as cards in a 4-column grid ----
    # Filter out groups that are pure-text (no clickable entities)
    NAVIGABLE_KINDS = {"topic", "mechanism", "symptom", "supplement", "claim",
                       "cooking_adjustment", "home_remedy"}

    for branch in tree["children"]:
        children = branch.get("children", [])
        if not children:
            continue
        # Check if any children are navigable (have a slug + clickable kind)
        navigable = [c for c in children if c.get("slug") and c.get("kind") in NAVIGABLE_KINDS]
        text_only = [c for c in children if not (c.get("slug") and c.get("kind") in NAVIGABLE_KINDS)]

        st.markdown(f"#### {branch['label']}")

        # Render navigable as a card grid
        if navigable:
            for row_start in range(0, len(navigable), 4):
                row_items = navigable[row_start:row_start + 4]
                row_cols = st.columns(4)
                for col, item in zip(row_cols, row_items):
                    with col:
                        item_kind = item["kind"]
                        item_slug = item["slug"]
                        item_display = _entity_display_name(cat, item_kind, item_slug)
                        item_icon = _KIND_LABEL.get(item_kind, ("⚪", "", ""))[0]
                        # Use a button for clickability — Streamlit doesn't have proper card click
                        button_label = f"{item_icon}  {item_display}"
                        if show_slugs:
                            button_label += f"\n\n`{item_slug}`"
                        if st.button(
                            button_label,
                            key=f"mmcard_{cur_kind}_{cur_slug}_{item_kind}_{item_slug}",
                            use_container_width=True,
                        ):
                            st.session_state["mm_recenter"] = (item_kind, item_slug)
                            st.rerun()

        # Render text-only items (free-text symptoms, red flags, drivers/effects) as a list
        if text_only:
            with st.container(border=True):
                for item in text_only:
                    st.markdown(f"- {item['label']}")

        st.write("")


# ---------------------------------------------------------------------------
# Page: Catalogue Backlog
# ---------------------------------------------------------------------------

def render_backlog_page():
    st.title("📝 Catalogue Backlog")
    st.caption(
        "Items the AI has flagged as worth adding to the catalogue, plus anything "
        "you manually queue. When you eventually add an item to the catalogue "
        "(via ingest or hand-authoring), mark it **Added** here."
    )

    tab_open, tab_added, tab_rejected, tab_manual = st.tabs([
        "🔵 Open",
        "✅ Added",
        "🚫 Rejected",
        "➕ Add manually",
    ])

    def _render_table(status: str):
        items = backlog_mod.list_items(DATA_DIR, status=status)
        if not items:
            st.info(f"No backlog items in **{status}**.")
            return
        for it in items:
            with st.container(border=True):
                cols = st.columns([3, 1, 5, 2])
                cols[0].markdown(f"**{it['name']}** &nbsp; `{it['kind']}`")
                cols[1].markdown(f"seen **{it.get('seen_count', 1)}**×")
                cols[2].caption(it.get("why", "") or "—")
                with cols[3]:
                    if status == "open":
                        c1, c2 = st.columns(2)
                        if c1.button("✅ Added", key=f"add_{it['id']}", help="Mark as added to catalogue"):
                            backlog_mod.update_status(DATA_DIR, it["id"], "added")
                            st.rerun()
                        if c2.button("🚫 Reject", key=f"rej_{it['id']}", help="Reject this suggestion"):
                            backlog_mod.update_status(DATA_DIR, it["id"], "rejected")
                            st.rerun()
                    else:
                        if st.button("🗑️ Delete", key=f"del_{it['id']}"):
                            backlog_mod.delete(DATA_DIR, it["id"])
                            st.rerun()
                # Show source sessions if any
                if it.get("session_refs"):
                    refs = it["session_refs"][:3]
                    ref_str = ", ".join(
                        f"{r.get('client_id', '?')}/{r.get('session_id', '?')}" for r in refs
                    )
                    st.caption(f"_seen in_: {ref_str}" + (
                        f" (+{len(it['session_refs']) - 3} more)" if len(it['session_refs']) > 3 else ""
                    ))

    with tab_open:
        _render_table("open")
    with tab_added:
        _render_table("added")
    with tab_rejected:
        _render_table("rejected")
    with tab_manual:
        with st.form("add_backlog", clear_on_submit=True):
            kind = st.selectbox("Kind",
                                ["topic", "mechanism", "symptom", "supplement",
                                 "claim", "cooking_adjustment", "home_remedy", "other"])
            name = st.text_input("Name", placeholder="e.g. tudca, racing-thoughts, dutch-test-protocol")
            why = st.text_area("Why is this worth adding?", placeholder="What gap does this fill?")
            if st.form_submit_button("Add to backlog"):
                if not name.strip():
                    st.error("Name is required.")
                else:
                    backlog_mod.add(
                        DATA_DIR,
                        kind=kind,
                        name=name.strip(),
                        why=why.strip(),
                        suggested_by="shivani",
                    )
                    st.success(f"Added **{name}** to backlog.")


# ---------------------------------------------------------------------------
# Page: Resources Toolkit
# ---------------------------------------------------------------------------


def _resources_root():
    return resources_storage.resources_root()


_KIND_ICON = {
    "cheatsheet": "📄",
    "form": "📝",
    "script": "🎙️",
    "recipe": "🥘",
    "slide_deck": "🖼️",
    "protocol": "📘",
    "video": "🎥",
    "article": "📰",
    "lab_form": "🧪",
    "other": "📎",
}


def render_resources_page():
    st.title("🧰 Resources Toolkit")
    st.caption(
        "Cheatsheets, forms, scripts, recipes, slide decks, protocols, and links — "
        "anything you reach for repeatedly during sessions or want to share with clients. "
        "Stored at `~/fm-resources/` (separate from catalogue and from client plans)."
    )

    root = _resources_root()
    resources_storage.ensure_layout(root)
    resources = resources_storage.list_resources(root)

    tab_browse, tab_new = st.tabs([
        f"📚 Browse ({len(resources)})",
        "➕ Add",
    ])

    with tab_browse:
        if not resources:
            st.info(
                f"**No resources yet at `{root}`.** Use the **➕ Add** tab to create one, "
                "or run `python /tmp/import_vitaone_resources.py` to bulk-import the "
                "Vitaone PDFs."
            )
        else:
            # Filter controls
            col1, col2, col3, col4 = st.columns([2, 2, 2, 4])
            with col1:
                all_kinds = sorted(set(r.kind for r in resources))
                kind_filter = st.multiselect("Kind", all_kinds, default=[])
            with col2:
                aud_filter = st.multiselect("Audience", ["client", "coach", "both"], default=[])
            with col3:
                all_topics = sorted({t for r in resources for t in r.related_topics})
                topic_filter = st.multiselect("Topic", all_topics, default=[])
            with col4:
                search = st.text_input("🔍 Search title / description / tags", "")

            filtered = resources
            if kind_filter:
                filtered = [r for r in filtered if r.kind in kind_filter]
            if aud_filter:
                filtered = [r for r in filtered if r.audience in aud_filter]
            if topic_filter:
                filtered = [r for r in filtered if any(t in topic_filter for t in r.related_topics)]
            if search:
                s = search.lower()
                filtered = [r for r in filtered if (
                    s in r.title.lower()
                    or s in r.description.lower()
                    or any(s in tag.lower() for tag in r.tags)
                )]

            st.caption(f"Showing **{len(filtered)}** of {len(resources)}")

            for r in sorted(filtered, key=lambda x: (x.kind, x.title)):
                with st.container(border=True):
                    cols = st.columns([6, 2, 2])
                    with cols[0]:
                        icon = _KIND_ICON.get(r.kind, "📎")
                        st.markdown(f"### {icon} {r.title}")
                        bits = [
                            f"`{r.kind}`",
                            f"audience: **{r.audience}**",
                        ]
                        if r.size_bytes:
                            bits.append(f"{r.size_bytes / 1024 / 1024:.1f} MB")
                        if not r.shareable:
                            bits.append("⚠️ not freely shareable")
                        st.caption(" · ".join(bits))
                        if r.description:
                            st.caption(r.description)
                        if r.tags:
                            st.markdown(" ".join(f"`#{t}`" for t in r.tags))
                        bridges = []
                        if r.related_topics:
                            bridges.append(f"**topics:** {', '.join(r.related_topics)}")
                        if r.related_supplements:
                            bridges.append(f"**supplements:** {', '.join(r.related_supplements)}")
                        if r.related_mechanisms:
                            bridges.append(f"**mechanisms:** {', '.join(r.related_mechanisms)}")
                        if bridges:
                            st.markdown(" &nbsp;·&nbsp; ".join(bridges))
                        if r.license_notes:
                            st.warning(f"⚖️ {r.license_notes}")
                    with cols[1]:
                        # Open / share controls
                        if r.file_path:
                            p = Path(r.file_path).expanduser()
                            if p.exists():
                                st.code(str(p), language="text")
                                # Provide a streamlit download button
                                try:
                                    with open(p, "rb") as f:
                                        st.download_button(
                                            "⬇️ Download",
                                            data=f.read(),
                                            file_name=p.name,
                                            mime=r.mime_type or "application/octet-stream",
                                            key=f"dl_{r.slug}",
                                        )
                                except Exception as e:
                                    st.caption(f"download blocked: {e}")
                            else:
                                st.error(f"file missing: `{p}`")
                        if r.url:
                            st.markdown(f"🔗 [Open link]({r.url})")
                        if r.text:
                            with st.expander("Inline body"):
                                st.markdown(r.text)
                    with cols[2]:
                        if st.button("🗑️ Delete", key=f"del_res_{r.slug}"):
                            resources_storage.delete_resource(root, r.slug)
                            st.toast(f"Deleted {r.slug}", icon="🗑️")
                            st.rerun()

    with tab_new:
        st.markdown(
            "Add a new resource. Pick **one** of: file path on your machine, "
            "external URL, or inline markdown body."
        )
        with st.form("new_resource", clear_on_submit=False):
            slug = st.text_input("Slug *", placeholder="e.g. perimenopause-intake-form-v2")
            title = st.text_input("Title *", placeholder="e.g. Perimenopause Intake Form (v2)")
            kind = st.selectbox("Kind *",
                                ["cheatsheet", "form", "script", "recipe", "slide_deck",
                                 "protocol", "video", "article", "lab_form", "other"])
            audience = st.selectbox("Audience *", ["both", "client", "coach"])
            description = st.text_area("Description", placeholder="What's this for? When would you reach for it?")

            st.markdown("##### Content (pick ONE)")
            col_a, col_b = st.columns(2)
            with col_a:
                file_path = st.text_input("File path (absolute)", placeholder="/Users/.../my-handout.pdf")
                url = st.text_input("External URL", placeholder="https://...")
            with col_b:
                text = st.text_area("Inline markdown body", height=120, placeholder="# Heading\n\nContent...")

            st.markdown("##### Bridges to catalogue (optional)")
            cat = load_catalogue_cached()
            related_topics = st.multiselect("Related topics", sorted([t.slug for t in cat.topics]))
            related_supplements = st.multiselect("Related supplements", sorted([s.slug for s in cat.supplements]))
            related_mechanisms = st.multiselect("Related mechanisms", sorted([m.slug for m in cat.mechanisms]))

            tags_str = st.text_input("Tags (comma-separated)", placeholder="indian-context, vegetarian-friendly, intake-form")
            shareable = st.checkbox("✅ Safe to share with clients as-is", value=True)
            license_notes = st.text_input("License / sharing notes",
                                          placeholder="e.g. 'VitaOne-copyrighted; share via course link'")

            submitted = st.form_submit_button("Add resource", type="primary")
            if submitted:
                if not slug or not title:
                    st.error("**Slug and title are required.**")
                elif sum(bool(x.strip() if x else False) for x in [file_path, url, text]) == 0:
                    st.error("**Add content** — pick one of file path, URL, or inline body.")
                elif (root / "resources" / f"{slug}.yaml").exists():
                    st.error(f"**Slug `{slug}` already exists.** Pick a different one.")
                else:
                    try:
                        size = None
                        mime = None
                        if file_path.strip():
                            p = Path(file_path).expanduser()
                            if p.exists():
                                size = p.stat().st_size
                                ext = p.suffix.lower()
                                mime = {".pdf": "application/pdf", ".png": "image/png",
                                        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                                        ".md": "text/markdown", ".txt": "text/plain"}.get(ext)
                        now = datetime.now(timezone.utc)
                        r = Resource(
                            slug=slug.strip(),
                            title=title.strip(),
                            kind=kind,
                            audience=audience,
                            description=description.strip(),
                            file_path=file_path.strip() or None,
                            url=url.strip() or None,
                            text=text.strip() or None,
                            related_topics=related_topics,
                            related_mechanisms=related_mechanisms,
                            related_supplements=related_supplements,
                            tags=[t.strip() for t in tags_str.split(",") if t.strip()],
                            shareable=shareable,
                            license_notes=license_notes.strip(),
                            size_bytes=size,
                            mime_type=mime,
                            created_at=now,
                            updated_at=now,
                            updated_by="shivani",
                        )
                        resources_storage.write_resource(root, r)
                        st.success(f"✅ Added **{title}** as `{slug}`")
                        st.toast(f"Added {slug}", icon="✅")
                    except Exception as e:
                        st.error("**Couldn't save resource.** Details below.")
                        st.exception(e)


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

if page.startswith("🧠"):
    render_assess_page()
elif page.startswith("📋"):
    render_plans_page()
elif page.startswith("👥"):
    render_clients_page()
elif page.startswith("🧭"):
    render_mindmap_page()
elif page.startswith("🧰"):
    render_resources_page()
elif page.startswith("📚"):
    render_catalogue_browser()
elif page.startswith("📝"):
    render_backlog_page()
