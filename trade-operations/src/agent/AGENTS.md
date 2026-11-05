# Trade Operations source

This is the coding-agent map for this workspace. Norbius reads [`+agent.md`](./+agent.md); this file says where the source lives and what an edit must not break.

## Model ownership

`src/data/model/` mirrors ownership. A child model sits inside its owner's folder; only the leaf folder names the model.

```text
commercial_settings/
  commission_rules/
  document_templates/
commission_statements/
orders/
  activities/
  ext_purchase_orders/
  ext_sales_orders/
  order_lines/
  source_payments/
  source_sales_lines/
  transactions/
parties/
  contacts/
  credit_snapshots/
products/
  pricing_floors/
  stock_snapshots/
warehouses/
```

Keep a new model in the branch of the record that owns it. Moving a model folder does not rename it: its leaf folder name is the model name.

## Surfaces

- Apps: `operations/analysis`, `operations/partners`, `operations/trade`, `operations/warehouse`, `trade_configuration`
- Kiosks: none
- Automations: `orders_revise`, `source_health`
- Policies: `configuration`, `finance`, `logistics`, `manager`, `order_revision`, `procurement`, `sales`
- Custom fields: none
- Integrations: `kingdee`

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the workspace tests. `bolt build` writes `.norbital/` and the release artifact; run it only when a schema or release change is intended. Migrations under `migrations/` are generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.

## Invariants

- A confirmed agreement is sealed permanently; header and lines never return to draft.
- Source confirmations, transactions, payments and stock facts are read-only; only their sync writes them.
- There is one delivery/invoice ledger and one payment ledger; do not create a parallel one.
- Money is a value and a currency together; never add or convert across currencies.

## Read next

- [`+agent.md`](./+agent.md) — the workspace brief Norbius loads.
- `README.md` and `docs/` — operator walkthrough and design detail.
