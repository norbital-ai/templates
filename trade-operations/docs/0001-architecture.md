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
at the read mirrors and the two-way order sync (SO and PO).

## 2. Application surfaces

| App                    | Page(s)                          | Owns                                                                                                                                                  |
| ---------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operations → Orders    | Sales orders; Purchase orders    | Draft, approve, confirm, change, archive and read one agreement                                                                                       |
| Operations → Partners  | Customers and suppliers          | Parties, contacts, credit evidence, orders and agreement fulfilment                                                                                   |
| Operations → Warehouse | Products; Stock; Warehouses      | Product master, lots with their sellable quantities, warehouse groups                                                                                 |
| Operations → Analysis  | Reports                          | Sales chain and margin, AR aging, commission board and statements, credit exceptions                                                                  |
| Trade configuration    | Documents, Prices and commission | Each document case's layout per language; dated price book with minimum-price enforcement, price history, CEL commission rules with freight treatment |

The navigation is one shell; apps are capability-scoped. `operations` is the commercial application family;
`trade_configuration` is separate and grants no commercial records.

## 3. Core domain

### The order is the agreement

`orders` is one record for a quotation, sales agreement or supplier commitment. `direction` is fixed at
creation (`sales` or `purchasing`). `order_lines` are owned contract lines.

The order and its lines hold the terms: header terms on `orders`, contract SKU, quantity, price, tax, floor
and commission conversion on `order_lines`. There are no contract versions; native record history is the
audit trail of every change. A confirmed order also keeps the commission rule in force when it was confirmed
(`commission`), its freight treatment, and, for an order written to Kingdee, the account set and branch
(`write_target`) and the SO or PO as last read (`kingdee`).

A confirmed order is the shadow of its Kingdee SO or PO (a PO once the ledger's purchase documents are
verified). The `orders` and `order_lines` `kingdee` syncs keep the two equal: confirmation creates it, a later
line change amends an
audited SO or replaces an unaudited PO's lines, and a Kingdee change updates the order and its lines. Kingdee
keeps the header (party, currency, date, settlement); only lines change after confirmation.

### Lifecycle

```text
draft --(sales: approval; purchasing: confirm)--> confirmed --(change: approval for sales)--> confirmed
  ^                                                   |
  +---------------------------------------------------+ archive (reversible)
```

- Sales confirmation needs a Commercial Manager approval. Procurement confirms its purchase orders directly.
- A confirmed order never returns to draft. A sales rep's change to it or its lines waits for a Commercial
  Manager; a Kingdee change applies directly.
- Archive is reversible and keeps the agreement, history, source evidence and sync. It never voids the source.
- `source_health` tells workspace administrators when a ledger needs attention.

### Parties, products and warehouses

- `parties` holds customers and suppliers (`customer`, `supplier`, `both`), their contacts and source evidence.
- `credit_snapshots` is read-only credit evidence. The explicit `kis-sales-out-v1` policy and a verified
  `creditAccount` bind native sales-out exposure and amount/overdue blocking decisions. Its minute feed
  reads native credit, invoice, receipt and DO tables; it refreshes limit, used, derived available credit
  and observation time. Unsupported native settings preserve last-good evidence.
- `products` holds the SKU, code, base unit, tax rate, optional price and commission settings.
- `warehouses` holds warehouse rows and their `group_code`; a price floor is keyed by the group, not a single
  warehouse.
- `stock_snapshots` is the remaining-lot mirror. `source_stock_commitments` holds open source sales quantities,
  which the Stock tab shows beside each lot as Awaiting shipment and Available for its product and warehouse;
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
expression and named parameters. On confirmation the order keeps the applicable rule, its expressions, engine
version, currency, basis unit, fixed rate and spread.

`commission_statements` is the one monthly salesperson review and approval workflow. There is no parallel
per-order acknowledgment table. The commission board and statement retain their calculation basis.

### Where this differs from SalesBridge, on purpose

- **Commission accrues on what shipped and was invoiced**, in the delivery month. SalesBridge accrued on the
  ordered quantity in the order month; an order that never ships earns nothing here.
- **Below-floor is not a separate approval.** Every sales confirmation already waits for a Commercial Manager,
  who sees the floor warning. `require_floor` is the hard gate for a workspace that wants none below it.
- **A quantity band is its own dated row.** The newest row on or before the order date that the quantity meets
  is the floor: retyping the base price on a later day replaces the bands of the earlier day.
- **The floor book is kept in the line's unit.** There is no kg-to-tonne conversion; a book kept per tonne is
  converted when it is imported.
- **Kingdee owns void and close.** Trade Operations reads them and never writes them; archive is local only.
- **A line change waits for Kingdee to audit the SO.** An unaudited SO is edited in Kingdee, and the change
  reads back.
- **Freight is not deducted by default.** No Kingdee feed carries it; a workspace that records freight chooses
  `deduct` in its commercial settings.

## 5. Documents and files

`document_templates` hold one numbered series of layouts per document case (quotation, sales contract, purchase
contract) and language. A layout carries:

- case, locale, version, title and status;
- the Markdown/HTML body and optional print CSS/HTML;
- document fields the order fills in, each free text or a fixed list of choices (`options`, one per line);
- optional letterhead and company-stamp artwork.

An order chooses only its document language: a sales order prints its quotation until confirmed and its sales
contract after, a purchase order its purchase contract, each in the newest published version, and confirmation
seals the contract version it used. Preview and download render the order's current terms as one PDF through
`ctx.preview_pdf`. Supporting documents are attached to the order; `order_files` keeps documents received after
confirmation. A sales order's quotation and contract carry the seller's stamp when **Include company stamp** is
ticked in the preview; a purchase contract never does.

## 6. Access control

Teams map to one policy each:

| Team                | Policy          | Scope                                                          |
| ------------------- | --------------- | -------------------------------------------------------------- |
| Sales               | `sales`         | Own sales orders, lines, activities and files; own commission  |
| Procurement         | `procurement`   | Supplier commitments and their changes                         |
| Commercial Managers | `manager`       | Both directions, approvals, commission statements              |
| Finance             | `finance`       | Payments, invoices, credit, receivables and reports            |
| Logistics           | `logistics`     | Operational quantities; commercial fields masked via an output |
| Configurators       | `configuration` | Business defaults, floors, rules and layouts                   |

Policies filter rows and choose read outputs; they never reshape a model. The `logistics` output removes
commercial prices and totals while preserving quantities, dates and references. Direct permission executes; a
matching policy's approval flow holds a provisional write when direct permission is absent. A confirmed sales
order's terms are protected by the sales policy's commercial review, not by a UI rule alone.

## 7. Automations and effects

| Name            | Trigger              | Policy          | What it does                                                               |
| --------------- | -------------------- | --------------- | -------------------------------------------------------------------------- |
| `source_health` | cron every 5 minutes | `source_health` | Notifies workspace administrators when a ledger connection needs attention |

Models declare no post-commit effects. Ordinary writes, approvals and syncs own their own follow-up.

## 8. Storage and runtime

- Each tenant has one Bolt database. Local development and tests use PGlite; production uses PostgreSQL.
- Reads are live queries; a committed write invalidates the mounted reads. Materialize `ctx.clock` values before
  using them as query inputs.
- Native history records who changed which fields; approvals, files, runs, notifications and audit are Bolt's,
  not a second local mechanism.
- Money is stored as a decimal value plus its currency. A read never adds across currencies; sales margin
  converts a foreign-currency sale only at the exchange rate Kingdee recorded on its order.
- Source mirrors are ordinary tables. "Hidden" means they have no standalone app page, not that they are absent
  from the database. [The integration document](0002-integration.md#5-local-tables-the-sync-writes) lists them.

## 9. Model ownership

The model folder mirrors the owner. A child sits under its parent; only the leaf folder names the model.

```text
commercial_settings/          commission_rules, document_templates
commission_statements/
orders/                       activities, order_files, order_lines, source_payments,
                              source_sales_lines, transactions
parties/                      contacts, credit_snapshots
products/                     pricing_floors, stock_snapshots
source_lot_costs/
source_purchase_lines/
source_receivables/
source_stock_commitments/
warehouses/
```

The current field/output/write inventory is [the source reference](0003-source-reference.md). The coding-agent
map is [`src/agent/AGENTS.md`](../src/agent/AGENTS.md); the workspace brief is
[`src/agent/+agent.md`](../src/agent/+agent.md).

## 10. Invariants

1. An order holds its own terms; a confirmed order never returns to draft, and its history is the audit trail.
2. Kingdee transactions, payments, receivables, credit, stock and cost facts are read-only.
3. There is one delivery/invoice ledger and one payment ledger; no parallel manual ledger.
4. A remaining source commitment cannot be released locally while its external order is active.
5. Missing source facts stay missing; never fill a price, cost, credit limit or exchange rate.
6. Money and currency travel together.
7. A price floor's unit must match the line unit; a missing compatible floor never becomes zero.
8. A line keeps the floor it was priced against and an order the commission rule it was confirmed under, not today's config.

Next: [integration](0002-integration.md) · [source reference](0003-source-reference.md)
