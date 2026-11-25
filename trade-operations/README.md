# Trade Operations

![Trade Operations application](docs/screenshots/application.webp)

An order-centered B2B trading, distribution and manufacturing workspace with two-way **Kingdee KIS**
SQL Server integration. Quotations, sales orders and purchase orders share one unified agreement model:
a quotation confirms and syncs into a live ERP order without moving tables, while deliveries, invoices,
payments, stock lots, credit holds and margins stay reconciled back to each order.

## Key capabilities

- **Unified sales & purchasing agreements:** Manage domestic and foreign quotations, sales orders and
  purchase orders in one model (`orders` + `order_lines`) with pricing-floor enforcement, optional
  manager approval holds, bilingual EN/ZH printable PDF contracts (with optional custom HTML print
  layouts and company stamp), and workbook CSV/XLSX import/export.
- **Two-way Kingdee KIS sync:** Poll masters, stock lots, deliveries, receipts, invoices, payments and
  aging over bounded SQL Server rowversion windows (no triggers or CDC on ERP tables), and write SO/PO
  creations and amendments back through an idempotent outbox.
- **Credit control & release approvals:** Surface read-only ERP credit snapshots alongside formal
  two-step credit-release approvals (`commercial_managers` → `finance`) for credit-blocked unaudited
  deliveries, confirmed against Kingdee `t_Log` (`XS100016`).
- **Lot-level stock, margin & aging analysis:** Compare live lot-weighted inventory costs against sales
  prices, track open SO/PO commitments per SKU and warehouse region, and inspect AR/AP aging without
  inventing payment allocations.
- **Dynamic commissions & monthly statements:** Evaluate configurable CEL commission rules pinned to each
  order's date and run a single monthly `commission_statements` approval workflow.

## Apps and roles

| App                          | Pages                          | Audience                                                        |
| ---------------------------- | ------------------------------ | --------------------------------------------------------------- |
| **Dashboard** (`operations`) | Dashboard                      | Attention queue (drafts, approvals, credit & overdue AR)        |
| **Trade** (`operations`)     | Orders                         | `Sales` (own SOs), `Procurement` (own POs), managers, `Finance` |
| **Partners** (`operations`)  | Parties                        | Customers, suppliers, contacts & credit snapshots               |
| **Warehouse** (`operations`) | Stock                          | `Logistics` (commercial fields masked), operations              |
| **Analysis** (`operations`)  | Reports                        | `Commercial Managers`, `Finance`                                |
| **Trade configuration**      | Documents, Prices & commission | `Configurators`, `Commercial Managers`                          |

- Six teams map 1-to-1 to policies: **Sales** (`sales`), **Procurement** (`procurement`), **Commercial
  Managers** (`manager`), **Finance** (`finance`), **Logistics** (`logistics`) and **Configurators**
  (`configuration`).
- Below-floor sales lines and sales draft deletions require `commercial_managers` approval; credit releases
  route through `commercial_managers` → `finance`.

## Data model

26 models separating local commercial agreements from read-only ERP source mirrors:

- **Agreements & fulfillment (`orders`):** `orders`, `order_lines`, `activities`, `order_files`,
  `transactions` (deliveries, receipts, invoices), `source_payments`, `source_sales_lines`.
- **Master data & stock:** `parties` (`contacts`, `credit_snapshots`), `products` (`pricing_floors`,
  `stock_snapshots`), `warehouses`, `settlements`.
- **Commercial governance:** `commercial_settings` (`document_templates`, `commission_rules`),
  `commission_statements`, `credit_releases`.
- **ERP reporting mirrors:** `source_lot_costs`, `source_payables`, `source_purchase_lines`,
  `source_purchase_orders`, `source_receivables`, `source_stock_commitments`.

## Automations and integrations

- **`kingdee` integration (`src/integration/kingdee/`):** Multi-ledger SQL Server connector managed under
  **Settings → Integrations → Connections**. Validates SQL read/write permissions before activating
  per-ledger syncs.
- **`source_health` automation:** Notifies workspace administrators whenever a Kingdee ledger connection
  changes health or fails.

## Getting started

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

Public seed data (`seed/public/`) ships generic commercial settings and EN/ZH layouts for quotations,
sales contracts and purchase contracts; no credentials or live ERP rows ship with the template.

- [Documentation index](docs/README.md) (ordered path from `0000-objective.md` to `0008-manual-probe-matrix.md`)
- [Architecture](docs/0001-architecture.md) and [Kingdee integration boundary](docs/0002-integration.md)
- [Kingdee implementation runbook](docs/0004-kingdee-implementation.md) and [order lifecycle](docs/0005-kingdee-order-lifecycle.md)
- [Print layouts](docs/0007-print-layouts.md) and [source reference](docs/0003-source-reference.md)
