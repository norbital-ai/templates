# Trade Operations source

This is the coding-agent map for this workspace. Norbius reads [`+agent.md`](./+agent.md); this file says where the source lives and what an edit must not break.

## Model ownership

`src/data/model/` mirrors ownership. A child model sits inside its owner's folder; only the leaf folder names the model.

```text
commercial_settings/
  commission_rules/
  document_templates/
commission_statements/
credit_releases/
source_lot_costs/
source_payables/
source_purchase_lines/
source_purchase_orders/
source_receivables/
source_stock_commitments/
orders/
  activities/
  order_files/
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
settlements/
user_profiles/
warehouses/
```

Keep a new model in the branch of the record that owns it. Moving a model folder does not rename it: its leaf folder name is the model name.

## Surfaces

- Apps: `operations/analysis`, `operations/dashboard`, `operations/partners`, `operations/profile`, `operations/trade`, `operations/warehouse`, `trade_configuration`
- Kiosks: none
- Automations: `source_health`
- Policies: `configuration`, `finance`, `kingdee_sync`, `logistics`, `manager`, `procurement`, `sales`, `source_health`
- Custom fields: none
- Integrations: `kingdee`

## Gates

`bolt check` proves discovery, schema history, rules and types. `bolt test` runs the workspace tests. `bolt build` writes `.norbital/` and the release artifact; run it only when a schema or release change is intended. Migrations under `migrations/` are generated: commit SQL, `snapshot.json`, `migrations.lock.json` and `physical.json` together.

## Invariants

- An order holds its own terms; there are no contract versions. Syncing it to Kingdee (`status: confirmed`) happens once; from then on it syncs both ways with its Kingdee SO or PO (`orders` and `order_lines` `kingdee` syncs), and record history is its audit trail.
- A synced order never returns to draft. Kingdee keeps its header (party, currency, date, salesperson, payment terms); everything else stays editable. Approval is for exceptions only: the floor rule's `approve` mode, sales draft deletes, credit-release requests (`credit_releases`: `commercial_managers` → `finance`), and customer credit-limit target changes (`parties.credit_limit_target` / `credit_days_target`, dual-approved between Commercial Managers and Finance).
- Settlement methods and each party's primary contact are Kingdee's (`settlements`, `contacts` `kingdee` syncs); members add other contacts, manage partner profile metadata (`tax_id`, `bank_name`, `bank_account`, `profile_notes`), and maintain their own `user_profiles` Kingdee IDs.
- Source confirmations, transactions (`draft` unaudited DOs + `issued`/`void`, with deterministic `credit_check`), payments, receivables/payables snapshots, stock facts and `credit_releases.source_status` are read-only to members (written only by sync).
- There is one delivery/invoice ledger and one payment ledger; do not create a parallel one.
- Money is a value and a currency together; never add or convert across currencies.

## Read next

- [`+agent.md`](./+agent.md) — the workspace brief Norbius loads.
- [`README.md`](../../README.md) and [`docs/README.md`](../../docs/README.md) — operator walkthrough and the numbered design set.
