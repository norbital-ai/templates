# Architecture

Status: normative for this template. The source tree is the final authority; this document explains how the
pieces fit and what an edit must not break. [The integration document](0002-integration.md) owns the Kingdee
boundary and its reliability rules.

## 1. System shape

```text
                 +------------------------------------------------------+
                 |                    Trade Operations                  |
                 |                                                      |
  Kingdee  <---->|  custom integration (SQL Server)                     |
  SQL Server     |      |                                               |
                 |      v                                               |
                 |  source mirrors  ->  order agreement  ->  reports     |
                 |                         |                            |
                 |                         v                            |
                 |                layouts -> PDF preview/download        |
                 +----------------------------+-------------------------+
                                              |
                                   Bolt tenant database
                       (native history, approvals, files, runs, policies)
```

The workspace owns the commercial workflow. Kingdee owns source evidence and credit enforcement. The two meet
at the read mirrors, the observed contract versions, and the verified sales-order write path.

## 2. Application surfaces

| App                    | Page(s)                                   | Owns                                                                                                   |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Operations → Orders    | Sales orders; Purchase orders             | Draft, approve, seal, revise, archive and read one agreement                                           |
| Operations → Partners  | Customers and suppliers                   | Parties, contacts, credit evidence, orders and agreement fulfilment                                    |
| Operations → Warehouse | Products; Stock; Warehouses; Availability | Product master, lots, stock, warehouse groups and sellable quantities                                  |
| Operations → Analysis  | Reports                                   | Sales, AR aging, credit, commission board and statements                                               |
| Trade configuration    | Documents, Pricing                        | Templates with document and pricing defaults; dated price book, price history and CEL commission rules |

The navigation is one shell; apps are capability-scoped. `operations` is the commercial application family;
`trade_configuration` is separate and grants no commercial records.

## 3. Core domain

### The order is the agreement

`orders` is one record for a quotation, sales agreement or supplier commitment. `direction` is fixed at
creation (`sales` or `purchasing`). `order_lines` are owned contract lines.

A confirmed order carries a **version** in `contract_versions`; each version retains:

- the sealed header snapshot and line snapshot;
- the layout and retained wording (`sealed_contract`, `sealed_snapshot`);
- the commission rule, parameters, floor basis and conversion facts (`sealed_commission`);
- the source binding when Kingdee issued or accepted the version (`kingdee`).

`seal_hash` identifies a version. `currentAgreement` is the locally current version; `executableAgreement`
is the version whose terms may be submitted. Kingdee may also report its own versions; those are evidence, not
replacements for the locally approved terms.

### Lifecycle

```text
draft --(sales: approval; purchasing: record)--> confirmed/sealed
  ^                                                   |
  |                                                   +--> revision -> new draft -> approval -> current
  |                                                   |
  +---------------------------------------------------+ archive (reversible)
```

- Sales confirmation needs a Commercial Manager approval. Procurement records a local commitment directly.
- Confirmed terms never return to draft. A revision starts from the current accepted terms.
- `orders_revise` opens the replacement draft and copies the sealed lines one-to-one before editing is enabled.
- Archive is reversible and keeps the agreement, history, source evidence and sync. It never voids the source.
- `source_health` tells configuration holders when a ledger needs attention.

### Parties, products and warehouses

- `parties` holds customers and suppliers (`customer`, `supplier`, `both`), their contacts and source evidence.
- `credit_snapshots` is read-only credit evidence. The verified source binding is not yet available; the sync
  refuses rather than inventing a limit or hold.
- `products` holds the SKU, code, base unit, tax rate, optional price and commission settings.
- `warehouses` holds warehouse rows and their `group_code`; a price floor is keyed by the group, not a single
  warehouse.
- `stock_snapshots` is the remaining-lot mirror. `source_stock_commitments` holds open source sales quantities;
  `source_lot_costs` holds audited purchase cost for a lot. They are read-only.

## 4. Pricing and commission

### Pricing floors

`pricing_floors` is a dated book keyed by:

```text
product · group_code · currency · effective_on · minimum_quantity
```

- A row is the floor for that exact day and quantity band. Blank days have no typed price.
- Orders use the newest row on or before the order date whose quantity band the line meets, in the order's
  currency and warehouse group. The floor's unit must match the line unit.
- The monthly page shows one row per product/band and one column per day, with inline cell editing. The dated
  table keeps import/export and history.
- `commercial_settings.require_floor` makes a sales confirmation refuse a line with no compatible floor.
- The floor is a commercial warning/gate; cost-based margin warnings are separate.

### Commission

`commission_rules` are versioned CEL expressions, not code branches. A rule declares eligibility, the amount
expression and named parameters. On confirmation the order seals the applicable rule, its expressions, engine
version, currency, basis unit, fixed rate and spread.

`commission_statements` is the one monthly salesperson review and approval workflow. There is no parallel
per-order acknowledgment table. The commission board and statement retain their calculation basis.

## 5. Documents and files

`document_templates` are versioned, publishable layouts. A layout carries:

- title, locale, version and status;
- the Markdown/HTML body and optional print CSS/HTML;
- optional letterhead and company-stamp artwork, with read-only support for historical personal artwork.

A draft selects a published layout; a confirmed version retains the layout it used. Preview and download render
the same PDF through `ctx.preview_pdf`. Supporting documents are attached to a draft or filed against a recorded
version; `order_files` keeps received bytes with the relevant `seal_hash`. The company stamp is applied only when
the layout is used on a sealed local sales agreement.

## 6. Access control

Teams map to one policy each:

| Team                | Policy          | Scope                                                          |
| ------------------- | --------------- | -------------------------------------------------------------- |
| Sales               | `sales`         | Own sales orders, lines, activities and files; own commission  |
| Procurement         | `procurement`   | Supplier commitments and their revisions                       |
| Commercial Managers | `manager`       | Both directions, approvals, commission statements              |
| Finance             | `finance`       | Payments, invoices, credit, receivables and reports            |
| Logistics           | `logistics`     | Operational quantities; commercial fields masked via an output |
| Configurators       | `configuration` | Business defaults, floors, rules and layouts                   |

Policies filter rows and choose read outputs; they never reshape a model. The `logistics` output removes
commercial prices and totals while preserving quantities, dates and references. Direct permission executes; a
matching policy's approval flow holds a provisional write when direct permission is absent. Sealed terms are
protected by the order state and the sales policy, not by a UI rule alone.

## 7. Automations and effects

| Name            | Trigger              | Policy           | What it does                                                    |
| --------------- | -------------------- | ---------------- | --------------------------------------------------------------- |
| `orders_revise` | person or code       | `order_revision` | Opens a replacement draft from the current accepted terms       |
| `source_health` | cron every 5 minutes | `configuration`  | Notifies configurators when a ledger connection needs attention |

Models declare no post-commit effects. Ordinary writes, approvals and syncs own their own follow-up.

## 8. Storage and runtime

- Each tenant has one Bolt database. Local development and tests use PGlite; production uses PostgreSQL.
- Reads are live queries; a committed write invalidates the mounted reads. Materialize `ctx.clock` values before
  using them as query inputs.
- Native history records who changed which fields; approvals, files, runs, notifications and audit are Bolt's,
  not a second local mechanism.
- Money is stored as a decimal value plus its currency. A read never adds or converts across currencies.
- Source mirrors are ordinary tables. "Hidden" means they have no standalone app page, not that they are absent
  from the database. [The integration document](0002-integration.md#5-local-tables-the-sync-writes) lists them.

## 9. Model ownership

The model folder mirrors the owner. A child sits under its parent; only the leaf folder names the model.

```text
commercial_settings/          commission_rules, document_templates
commission_statements/
orders/                       activities, order_files, order_lines, ext_sales_orders,
                              ext_purchase_orders, source_payments, source_sales_lines, transactions
parties/                      contacts, credit_snapshots
products/                     pricing_floors, stock_snapshots
source_lot_costs/
source_receivables/
source_stock_commitments/
salesperson_signatures/
warehouses/
```

The current field/output/write inventory is [the source reference](0003-source-reference.md). The coding-agent
map is [`src/agent/AGENTS.md`](../src/agent/AGENTS.md); the workspace brief is
[`src/agent/+agent.md`](../src/agent/+agent.md).

## 10. Invariants

1. A confirmed agreement is sealed permanently; header and lines do not return to draft.
2. Source confirmations, transactions, payments, receivables, stock and cost facts are read-only.
3. There is one delivery/invoice ledger and one payment ledger; no parallel manual ledger.
4. A remaining source commitment cannot be released locally while its external order is active.
5. Missing source facts stay missing; never fill a price, cost, credit limit or exchange rate.
6. Money and currency travel together.
7. A price floor's unit must match the line unit; a missing compatible floor never becomes zero.
8. A layout, floor and commission rule are retained by the version that used them, not re-read from today's config.

Next: [integration](0002-integration.md) · [source reference](0003-source-reference.md)
