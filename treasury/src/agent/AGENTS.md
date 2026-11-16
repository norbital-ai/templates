# Treasury source

This is the coding-agent map for this workspace. Norbius reads [`+agent.md`](./+agent.md); this file says where the source lives and what an edit must not break.

## Model ownership

`src/data/model/` mirrors ownership. A child model sits inside its owner's folder; only the leaf folder names the model.

```text
bank/
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
  facility_form/
    facility_attachment/
  invoice/
    invoice_line/
  po_document/
  po_financing/
  po_line/
business_partner/
  supplier_bank/
```

Keep a new model in the branch of the record that owns it. Moving a model folder does not rename it: its leaf folder name is the model name.

## Surfaces

- Apps: `business_partners`, `configuration`, `purchasing`, `treasury`
- Kiosks: none
- Automations: `bank_document_apply`, `bank_document_read`, `daily_alerts`, `drawdown_allocate`, `drawdown_cancel`, `drawdown_close_bill`, `drawdown_record_advice`, `drawdown_settle`, `facility_form_read`, `facility_form_pack`, `month_end_lock`, `month_end_unlock`
- Policies: `bank_advices`, `facility_forms`, `finance`, `month_end_closing`, `purchasing`, `treasury`, `viewer`
- Custom fields: none
- Integrations: none

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the workspace tests. `bolt build` writes `.norbital/` and the release artifact; run it only when a schema or release change is intended. Migrations under `migrations/` are generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.

## Invariants

- A line's status only moves forward; a settled or cancelled line is sealed (`sealed_line`).
- Every figure comes from `src/lib/calculations.ts`, `treasury.ts` and `purchasing.ts`; pages,
  automations and write callbacks share them. Estimated charges are computed, never stored.
- Advice extraction schedules a uniquely matched financing proposal under `bank_advices`; the line, charges
  and evidence share one native Treasury approval. Never add a direct allow to that automation policy.
- A locked month-end never changes (`locked_month`).
- Purchasing never writes treasury records.

## Read next

- [`+agent.md`](./+agent.md) — the workspace brief Norbius loads.
- `README.md` and `docs/` — operator walkthrough and design detail.
