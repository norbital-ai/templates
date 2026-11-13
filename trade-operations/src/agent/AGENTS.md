# Trade Operations source

This is the coding-agent map for this workspace. Norbius reads [`+agent.md`](./+agent.md); this file says where the source lives and what an edit must not break.

## Model ownership

`src/data/model/` mirrors ownership. A child model sits inside its owner's folder; only the leaf folder names the model.

```text
commercial_settings/
  commission_rules/
  document_templates/
commission_statements/
source_receivables/
orders/
  activities/
  ext_purchase_orders/
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
- Automations: `source_health`
- Policies: `configuration`, `finance`, `logistics`, `manager`, `procurement`, `sales`
- Custom fields: none
- Integrations: `kingdee`

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the workspace tests. `bolt build` writes `.norbital/` and the release artifact; run it only when a schema or release change is intended. Migrations under `migrations/` are generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.

## Invariants

- An order holds its own terms; there are no contract versions. A confirmed sales order syncs both ways with its Kingdee SO (`orders` and `order_lines` `kingdee` syncs), and record history is its audit trail.
- A confirmed order never returns to draft. A sales rep's change to it waits for a commercial manager.
- Source confirmations, transactions, payments, receivables snapshots and stock facts are read-only.
- There is one delivery/invoice ledger and one payment ledger; do not create a parallel one.
- Money is a value and a currency together; never add or convert across currencies.

## Read next

- [`+agent.md`](./+agent.md) — the workspace brief Norbius loads.
- [`README.md`](../README.md) and [`docs/README.md`](../docs/README.md) — operator walkthrough and the numbered design set.
