"use client";

/**
 * ClientIdentityEditor — inline editor for the core identity fields the
 * coach commonly needs to fix after a typo'd intake: display name (e.g.
 * "Sudarshan" → "Sudarshan Karnad"), date of birth, sex, mobile, email,
 * city / state / country.
 *
 * Lives on the v2 Overview tab. Collapsed by default; opens to a panel
 * with prefilled fields. Save writes via updateClientProfile and the
 * page revalidates, so the FmClientHeader + journey strip + dashboard
 * listings all refresh.
 *
 * Other clinical fields (conditions / meds / allergies / goals) live
 * in the existing ClientProfileEditor below.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateClientProfile } from "@/lib/server-actions/clients";

export interface ClientIdentityInitial {
  display_name?: string;
  date_of_birth?: string;
  sex?: "F" | "M" | "other";
  mobile_number?: string;
  email?: string;
  city?: string;
  state?: string;
  country?: string;
  cycle_status?: "menstruating" | "perimenopausal" | "postmenopausal" | "not_applicable";
}

interface Props {
  clientId: string;
  initial: ClientIdentityInitial;
}

export function ClientIdentityEditor({ clientId, initial }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [displayName, setDisplayName] = useState(initial.display_name ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(initial.date_of_birth ?? "");
  const [sex, setSex] = useState<"F" | "M" | "other" | "">(initial.sex ?? "");
  const [mobileNumber, setMobileNumber] = useState(initial.mobile_number ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [city, setCity] = useState(initial.city ?? "");
  const [stateField, setStateField] = useState(initial.state ?? "");
  const [country, setCountry] = useState(initial.country ?? "India");
  const [cycleStatus, setCycleStatus] = useState<
    "menstruating" | "perimenopausal" | "postmenopausal" | "not_applicable" | ""
  >(initial.cycle_status ?? "");

  const reset = () => {
    setDisplayName(initial.display_name ?? "");
    setDateOfBirth(initial.date_of_birth ?? "");
    setSex(initial.sex ?? "");
    setMobileNumber(initial.mobile_number ?? "");
    setEmail(initial.email ?? "");
    setCity(initial.city ?? "");
    setStateField(initial.state ?? "");
    setCountry(initial.country ?? "India");
    setCycleStatus(initial.cycle_status ?? "");
  };

  const save = () => {
    startTransition(async () => {
      const res = await updateClientProfile({
        client_id: clientId,
        display_name: displayName,
        date_of_birth: dateOfBirth,
        sex: sex === "" ? undefined : (sex as "F" | "M" | "other"),
        mobile_number: mobileNumber,
        email,
        city,
        state: stateField,
        country,
        cycle_status: cycleStatus === "" ? undefined : cycleStatus,
      });
      if (res.ok) {
        toast.success("✓ Saved — identity fields updated");
        setOpen(false);
      } else {
        toast.error(res.error ?? "Save failed", { duration: 12000 });
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 600,
          background: "var(--fm-surface)",
          color: "var(--fm-text-secondary)",
          border: "1px solid var(--fm-border)",
          borderRadius: "var(--fm-radius-sm)",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        ✏️ Edit identity
      </button>
    );
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: "14px 16px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border)",
        borderRadius: "var(--fm-radius-md)",
        display: "grid",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--fm-text-primary)",
          }}
        >
          ✏️ Edit identity & contact
        </div>
        <span
          style={{
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            fontStyle: "italic",
          }}
        >
          For clinical fields (conditions, meds, allergies) use the
          profile editor below.
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
        }}
      >
        <Field label="Full name">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Sudarshan Karnad"
            style={inputStyle}
          />
        </Field>
        <Field label="Date of birth">
          <input
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Sex">
          <select
            value={sex}
            onChange={(e) =>
              setSex(e.target.value as "F" | "M" | "other" | "")
            }
            style={inputStyle}
          >
            <option value="">—</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Mobile">
          <input
            type="tel"
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value)}
            placeholder="+91 …"
            style={inputStyle}
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="client@example.com"
            style={inputStyle}
          />
        </Field>
        <Field label="City">
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Bangalore"
            style={inputStyle}
          />
        </Field>
        <Field label="State">
          <input
            type="text"
            value={stateField}
            onChange={(e) => setStateField(e.target.value)}
            placeholder="Karnataka"
            style={inputStyle}
          />
        </Field>
        <Field label="Country">
          <input
            type="text"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            style={inputStyle}
          />
        </Field>
        {sex !== "M" && (
          <Field label="Hormonal stage">
            <select
              value={cycleStatus}
              onChange={(e) =>
                setCycleStatus(
                  e.target.value as
                    | "menstruating"
                    | "perimenopausal"
                    | "postmenopausal"
                    | "not_applicable"
                    | "",
                )
              }
              style={inputStyle}
            >
              <option value="">— not set —</option>
              <option value="menstruating">Menstruating</option>
              <option value="perimenopausal">Perimenopausal</option>
              <option value="postmenopausal">Postmenopausal</option>
              <option value="not_applicable">Not applicable</option>
            </select>
          </Field>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={pending}
          style={{
            padding: "7px 14px",
            fontSize: 12,
            fontWeight: 600,
            background: "transparent",
            color: "var(--fm-text-secondary)",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          style={{
            padding: "7px 14px",
            fontSize: 12,
            fontWeight: 700,
            background: "var(--fm-primary)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--fm-radius-sm)",
            cursor: pending ? "wait" : "pointer",
            fontFamily: "inherit",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "Saving…" : "💾 Save changes"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--fm-text-tertiary)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 9px",
  fontSize: 13,
  background: "var(--fm-surface)",
  border: "1px solid var(--fm-border)",
  borderRadius: "var(--fm-radius-sm)",
  color: "var(--fm-text-primary)",
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};
