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

## Theme and layout

`src/+workspace.ts` owns the workspace-wide `theme.light` and `theme.dark` tokens. Use it for palette/accent changes; retain semantic UI classes and native app/record primitives. Reference images guide layout and palette separately. Inspect all images by their complete file IDs, preserve calculation helpers and approval policies, and verify both modes in the current change's preview before proposing a merge. The public README and Bolt's workspace-theme authoring reference document the same mechanism.

Long forms use native `RecordShell sections` in create, edit and read modes. Group fields by the operator’s task, keep related short controls on one row, and collapse optional evidence or notes. Use native `TimeInput` for days and months and `TimeRangeInput` for periods; never substitute browser `input type="date"` or `type="month"` popups. A month-end selects one month; a cost report can select an inclusive month range.

### Responsibility boundaries

- `facility` stores agreed credit limits and reusable pricing/tenor terms. `facility_fee` is a fee rule; `sub_limit` partitions the existing limit rather than adding credit.
- `purchase_order` owns the current commercial order, items and invoice links. `business_partner` is the sole supplier/customer directory; `supplier_bank` stores eligibility only.
- `facility_form`, displayed as **Financing request**, holds the application and its document facts. It can exist before a saved order and links one when available. Copied document facts are evidence, not an alternative current order or bank facility. Editing a request does not allocate credit or settle financing.
- `drawdown` owns the financing lifecycle and financial facts. `drawdown_charge` holds actual charges; fee rules only estimate charges until actuals exist.
- `bank_document` keeps the original evidence and extracted proposal. Native approval owns review and acceptance; no extra approval/status model or ledger is needed.
- `month_end` and `month_end_line` hold frozen closing snapshots. They are not a second editable financing ledger.
- Domain attachments name the business role of native files. The exported PDF pack’s signature spaces are paper content, not a second platform approval workflow.

## Surfaces

- Apps: `treasury`, `purchasing`, `configuration`
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
