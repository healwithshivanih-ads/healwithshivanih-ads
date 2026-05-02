"""Client + Plan layer.

Plans live OUTSIDE the catalogue git repo because they contain PHI
(client identity, presenting symptoms, prescriptions). The catalogue is
the menu; plans are the prescriptions written from it.

Storage layout (default `~/fm-plans/`, override via FMDB_PLANS_DIR env or
--plans-dir flag):

    ~/fm-plans/
      clients/<client-id>.yaml
      drafts/<plan-slug>.yaml
      ready/<plan-slug>.yaml             # status=ready_to_publish
      published/<plan-slug>-v<n>.yaml    # frozen on publish
      superseded/<plan-slug>-v<n>.yaml
      revoked/<plan-slug>-v<n>.yaml
      _audit.jsonl                        # state changes, edits, publishes
"""
