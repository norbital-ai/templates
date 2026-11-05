# Field Operations source

This is the coding-agent map for this workspace. Norbius reads [`+agent.md`](./+agent.md); this file says where the source lives and what an edit must not break.

## Model ownership

`src/data/model/` mirrors ownership. A child model sits inside its owner's folder; only the leaf folder names the model.

```text
sites/
  job_assignments/
    communication_logs/
    photo_evidence/
    suspicion_reviews/
      suspicious_activity_logs/
```

Keep a new model in the branch of the record that owns it. Moving a model folder does not rename it: its leaf folder name is the model name.

## Surfaces

- Apps: `field_ops_contractor`, `field_ops_controller`
- Kiosks: none
- Automations: `inspect_photo_evidence`, `job_assignments_import_work_orders`, `review_job_assignment_suspicion`, `site_handover`, `suspicious_activity_logs_resolve`
- Policies: `field_ops_contractor`, `field_ops_controller`, `field_ops_whatsapp`, `suspicion_review_automation`
- Custom fields: `photo_source`
- Integrations: none

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the workspace tests. `bolt build` writes `.norbital/` and the release artifact; run it only when a schema or release change is intended. Migrations under `migrations/` are generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.

## Invariants

- A site is its address. File one site per address, and a job under that site.
- A photo belongs to exactly one job assignment; its file and parent never change.
- Linking a contractor dispatches the job; an unmatched contact leaves the job unassigned.
- Suspicion findings are explanations of mechanical evidence, not an agent verdict.

## Read next

- [`+agent.md`](./+agent.md) — the workspace brief Norbius loads.
- `README.md` and `docs/` — operator walkthrough and design detail.
