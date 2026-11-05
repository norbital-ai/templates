# Construction Operations source

This is the coding-agent map for this workspace. Norbius reads [`+agent.md`](./+agent.md); this file says where the source lives and what an edit must not break.

## Model ownership

`src/data/model/` mirrors ownership. A child model sits inside its owner's folder; only the leaf folder names the model.

```text
certification_types/
projects/
  asset_documents/
  bim_reference_matrix/
  jobs/
    defects/
    job_assignments/
    jobs_certification_types/
    jobs_site_locations/
  payment_claims/
  permits_to_work/
    permits_to_work_certification_types/
    permits_to_work_workers/
  rfis/
  site_locations/
workers/
```

Keep a new model in the branch of the record that owns it. Moving a model folder does not rename it: its leaf folder name is the model name.

## Surfaces

- Apps: `construction_project_workspace`, `construction_settings_reference_matrix`, `construction_settings_workforce`
- Kiosks: none
- Automations: `defect_closeout_digest`, `payment_claim_readiness_watch`, `permit_expiry_watch`, `rfi_followup_watch`
- Policies: `construction_project_workspace`, `construction_read`, `construction_settings_reference_matrix`, `construction_settings_workforce`
- Custom fields: `emergency_contact`, `permit_signatures`, `project_address`, `site_coordinates`
- Integrations: none

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the workspace tests. `bolt build` writes `.norbital/` and the release artifact; run it only when a schema or release change is intended. Migrations under `migrations/` are generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.

## Invariants

- A worker is assigned to a work front only when active permits in force today cover every certification required by at least one job linked to that work front.
- A payment claim's claimed amount and certified amount are different facts; never conflate them.
- Work under a lapsed permit is a compliance failure; permit dates are legal facts.

## Read next

- [`+agent.md`](./+agent.md) — the workspace brief Norbius loads.
- `README.md` and `docs/` — operator walkthrough and design detail.
