# Treasury source

This is the coding-agent map for this workspace. Norbius reads [`+agent.md`](./+agent.md); this file says where the source lives and what an edit must not break.

## Model ownership

`src/data/model/` mirrors ownership. A child model sits inside its owner's folder; only the leaf folder names the model.

```text
bank/
  bank_contact/
  letter_of_offer/
  watch_point/
drawdown/
  bank_document/
  drawdown_charge/
facility/
  facility_fee/
  sub_limit/
fx_rate/
month_end/
  month_end_line/
purchase_order/
  invoice/
  po_document/
  po_line/
supplier/
```

Keep a new model in the branch of the record that owns it. Moving a model folder does not rename it: its leaf folder name is the model name.

## Surfaces

- Apps: `purchasing`, `treasury`
- Kiosks: none
- Automations: `daily_alerts`
- Policies: `finance`, `purchasing`, `treasury`
- Custom fields: none
- Integrations: none

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the workspace tests. `bolt build` writes `.norbital/` and the release artifact; run it only when a schema or release change is intended. Migrations under `migrations/` are generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.

## Invariants

- A line's status only moves forward; a settled line cannot be reopened.
- Purchasing never writes treasury records.

## Read next

- [`+agent.md`](./+agent.md) — the workspace brief Norbius loads.
- `README.md` and `docs/` — operator walkthrough and design detail.
