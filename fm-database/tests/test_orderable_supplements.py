"""The gap this check exists to close, as a failing-if-broken test.

A prescribed supplement reaches the client's app with a Reorder button only if
a product resolves for it — from ~/fm-plans/supplement_links.yaml, or from a
`buy_link` pinned on the plan entry. When neither exists the button does not
render, and nothing anywhere said so. A coach could prescribe something for a
whole phase and first learn of it when the client asks where to buy it.

The failure is authoring-path-agnostic: the AI suggester never reads the
product file, and neither does a hand- or chat-authored plan. plan-check is
the shared gate, so the check belongs here.

Calibration matters as much as correctness. Measured across the live roster
before shipping: 150 prescribed entries, exactly one fires. A check that cries
wolf gets ignored, so these tests pin the SILENT cases as hard as the loud one.

Run: python -m tests.test_orderable_supplements
"""

from fmdb.plan.checker import _check_orderable


class _Item:
    def __init__(self, slug, buy_link=None):
        self.supplement_slug = slug
        self.buy_link = buy_link


class _Plan:
    def __init__(self, items):
        self.supplement_protocol = items


def _run(items, links, monkeypatch_links):
    findings = []
    monkeypatch_links(links)
    _check_orderable(_Plan(items), findings)
    return findings


def main() -> None:
    import fmdb.plan.checker as checker

    original = checker._load_supplement_links
    installed = {}

    def use(links):
        installed["links"] = links
        checker._load_supplement_links = lambda: links

    try:
        # A product keyed by slug, one that covers an alias, and a retailer row.
        links = {
            "nac": {"display_name": "NAC (N-Acetylcysteine)", "url": "https://x/nac"},
            "coq10": {"display_name": "FMN Liposomal CoQ10", "covers": ["ubiquinol"]},
        }

        # 1. Resolves by its own key → silent.
        assert _run([_Item("nac")], links, use) == [], "a linked supplement must not warn"

        # 2. Resolves through `covers` → silent. This is the tier that carries
        #    most of the roster; if it regressed, the check would warn on plans
        #    that are perfectly fine.
        assert _run([_Item("ubiquinol")], links, use) == [], "a covered alias must not warn"

        # 3. No product anywhere → the one case worth saying out loud.
        out = _run([_Item("cbd-oil")], links, use)
        assert len(out) == 1, f"an unorderable supplement must warn, got {out}"
        assert out[0].severity == "WARNING", "advisory, never a publish blocker"
        assert "cbd-oil" in out[0].detail

        # 4. No product, but the coach pinned a specific one → silent. The
        #    override is the documented escape hatch and must be honoured.
        assert _run([_Item("cbd-oil", "https://shop/cbd")], links, use) == [], (
            "an explicit buy_link must suppress the warning"
        )

        # 5. Links file missing entirely → silent, not 15 warnings. Failing
        #    open here is deliberate: a machine without the file would
        #    otherwise flag every supplement on every plan.
        assert _run([_Item("nac"), _Item("cbd-oil")], {}, use) == [], (
            "no links file must mean no findings, not a wall of them"
        )

        print("test_orderable_supplements: all cases pass")
    finally:
        checker._load_supplement_links = original


if __name__ == "__main__":
    main()
