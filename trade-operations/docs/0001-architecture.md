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

| App                    | Page(s)                        | Owns                                                                                                                                                                              |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operations → Dashboard | Dashboard                      | What needs attention: drafts to sync, order approvals, Kingdee sync failures and pending audits, overdue receivables and credit exceptions; each figure opens its table or report |
| Operations → Orders    | Sales orders; Purchase orders  | Draft, sync to Kingdee, change, approve exceptions, print, archive and read one agreement                                                                                         |
| Operations → Partners  | Customers and suppliers        | Parties, contacts, credit evidence, orders and agreement fulfilment                                                                                                               |
| Operations → Warehouse | Products; Stock; Warehouses    | Product master, lots with their sellable quantities, warehouse regions                                                                                                            |
| Operations → Analysis  | Reports                        | Sales chain and margin, purchase listing, AR and AP aging, commission board and statements, credit exceptions and credit releases                                                 |
| Trade configuration    | Documents, Pricing, Commission | Each document case's layout per language; dated price book with floor rule, floor list, and SalesBridge `.xlsx` matrix import/export; CEL commission rules with freight treatment |

The navigation is one shell; apps are capability-scoped. `operations` is the commercial application family;
`trade_configuration` is separate and grants no commercial records.

## 3. Core domain

### The order is the agreement

`orders` is one record for a quotation, sales agreement or supplier commitment. `direction` is fixed at
creation (`sales` or `purchasing`). `order_lines` are owned contract lines.

The order and its lines hold the terms: header terms on `orders`, contract SKU, quantity, price, tax and floor
on `order_lines`. There are no contract versions; native record history is the
audit trail of every change. Syncing to Kingdee (`status: confirmed`) stamps the commission rule in force on the
order date (`commission`), the freight treatment (`freight_treatment`) and, for an order written to Kingdee, the
account set and branch (`write_target`); the order also keeps the SO or PO as last read (`kingdee`). A stamp is a
record of the basis, not a lock.

A synced order is the shadow of its Kingdee SO or PO (a PO once the ledger's purchase documents are verified).
The `orders` and `order_lines` `kingdee` syncs keep the two equal: syncing creates it, every later saved line change
follows (an unaudited SO's or PO's lines are replaced in place, an audited SO is amended, an audited PO refuses),
and a Kingdee change updates the order and its lines. The writer compares lines only: the domestic delivery date or the foreign shipment window's last day
reaches each line's delivery date when lines are written, and an amendment keeps existing lines' dates. Kingdee keeps the header fields
party, currency, order date, salesperson (`owner`) and payment terms: a local change to them is refused
(`errors.kingdee_header`) and made in Kingdee. Every other term and the lines stay editable; terms other than
the lines print on the documents and are not sent to Kingdee.

### Lifecycle

```text
draft --(Sync to Kingdee, once)--> confirmed --(saved change: follows to Kingdee)--> confirmed
  ^                                   |
  +-----------------------------------+ archive (reversible)
```

- Sales syncs its own orders and Procurement its purchase orders directly. An order with a line awaiting
  approval cannot sync (`errors.lines_pending`; Bolt locks a held record). A sales rep's delete of an own draft
  waits for a Commercial Manager.
- A synced order never returns to draft. A later change to it or its lines is direct, unless the floor rule
  sends a sales line to a Commercial Manager; a Kingdee change applies directly.
- A change to the warehouse, currency, tax basis, order date or party re-prices the order's lines through its
  lines layer. On create, and when the warehouse or party changes, a blank or still-default place of loading
  (sales) or delivery (purchases) takes the warehouse name, a sale's delivery address the party address, and a
  party change resets the buyer contact to the new party's primary contact.
- Archive is reversible and keeps the agreement, history, source evidence and sync. It never voids the source.
- `source_health` tells workspace administrators when a ledger needs attention.

### Parties, products and warehouses

- `parties` holds customers and suppliers (`customer`, `supplier`, `both`), their Kingdee region (`t_SubMessage` list 26), local `related_party` classification (Finance/Admin-editable) and source evidence.
- `contacts` are many per party. The `contacts` `kingdee` sync keeps the one contact on the party's Kingdee
  customer or supplier master as its `primary` contact, listed first and read-only to members
  (`errors.kingdee_contact`); members add, edit and delete the others directly. An order's `buyer_contact` is
  one of its party's contacts.
- `settlements` mirrors Kingdee's settlement methods (`t_Settle`), read-only; an order's `payment_terms` names
  one.
- `credit_snapshots` is read-only credit evidence. The explicit `kis-sales-out-v1` policy and a verified
  `creditAccount` bind native sales-out exposure and amount/overdue blocking decisions. Its minute feed
  reads native credit, invoice, receipt and DO tables; it writes limit, used and derived available credit
  only when the position changes, and its freshness is the feed's health on the ledger. Unsupported native
  settings preserve last-good evidence.
- `credit_releases` tracks unaudited blue Kingdee deliveries blocked by `kis-sales-out-v1` credit control
  (evaluating exposure including `当前单据金额`). Its `kingdee` sync owns `source_status` (`blocked`,
  `released`, `cleared`, `superseded`, `withdrawn`, `bypassed`) and confirms password releases from `t_Log`
  (`XS100016`, incremental `FLogID` seek); members own only the local approval columns (`approval_status`,
  `route`, `proposed_limit`, `reason`), gated by formal two-step approval (`commercial_managers` → `finance`)
  and bound to the DO's SHA-256 `content_hash`. Logistics reads it through the price-free `logistics` output.
- `products` holds the SKU, code, category (`FComCategoryID`, class 2037), base unit, tax rate and optional price.
- `warehouses` holds warehouse rows, their `group_code` and `group_name`; a price floor is keyed by the region (`group_code`), not a single
  warehouse.
- `stock_snapshots` is the remaining-lot mirror. `source_stock_commitments` holds open source sales and purchase
  quantities, which the Stock tab sums per SKU and warehouse region into on hand, promised out, promised in and the
  projected balance; `source_lot_costs` holds audited purchase cost for a lot. They are read-only.

## 4. Pricing and commission

### Pricing floors

`pricing_floors` is a dated book keyed by:

```text
product · group_code · currency · effective_on
```

- A row is the single floor for that exact day, SKU and warehouse region (same-day revisions live in native record history). Blank days have no typed price.
- Orders use the newest row on or before the order date in the order's currency and warehouse region. Compatible mass units (`kg` / `吨`) convert automatically via `unitRatio`. `floorFor` in
  `src/lib/commercial.ts` is the one lookup.
- **Monthly price book** shows one row per product and one column per day, with inline cell editing and SalesBridge-format `.xlsx` matrix download/upload (`每日基准价格汇总`). The
  dated **Floor list** keeps tabular import/export and history.
- `commercial_settings.floor_rule` decides what happens to a sales line below its floor, or with none: `warn`
  (a hint; the default), `approve` (a sales rep's write waits for a Commercial Manager) or `refuse` (refused at
  write; sync also refuses a line below the floor in force then).
- The line editor shows the floor under the unit price: the minimum, its effective day, met or below, and what
  the rule will do.
- The floor is a commercial warning/gate; cost-based margin warnings are separate.

### Commission

`commission_rules` are versioned CEL expressions, not code branches. A rule declares eligibility, the amount
expression and named parameters. At sync the order stamps the rule in force on its order date: its expressions,
engine version, currency, basis unit, fixed rate and spread.

`commission_statements` is the one monthly salesperson review and approval workflow. There is no parallel
per-order acknowledgment table. The commission board and statement retain their calculation basis.

### Where this differs from SalesBridge, on purpose

- **Commission accrues on what shipped and was invoiced**, in the delivery month. SalesBridge accrued on the
  ordered quantity in the order month; an order that never ships earns nothing here.
- **Below-floor is a setting.** The floor rule chooses a hint, a Commercial Manager's approval or a refusal.
- **A quantity band is its own dated row.** The newest row on or before the order date that the quantity meets
  is the floor: retyping the base price on a later day replaces the bands of the earlier day.
- **The floor book is kept in the line's unit.** There is no kg-to-tonne conversion; a book kept per tonne is
  converted when it is imported.
- **Kingdee owns void and close.** Trade Operations reads them and never writes them; archive is local only.
- **Freight is not deducted by default.** No Kingdee feed carries it; a workspace that records freight chooses
  `deduct` in its commercial settings.

## 5. Documents and files

`document_templates` hold one numbered series of layouts per document case (quotation, sales contract, purchase
contract) and language. A layout carries:

- case, locale, version, title and status;
- the Markdown/HTML body and optional print CSS/HTML;
- document fields the order fills in, each free text or a fixed list of choices (`options`, one per line),
  labelled in the layout's language with a translation for the other;
- optional letterhead and company-stamp artwork.

An order's currency chooses its document language (CNY prints Chinese, any other English): a sales order
prints its quotation while draft and its sales contract once synced, a purchase order its purchase
contract, each in its case's newest published version. No
version is kept per order: a newly published layout reaches every order, and the signed copy the customer
returns, filed on the order, is the evidence of what was signed. The Orders table's actions menu has **Preview
document** (one order) and **Download PDFs** (the selection, as one zip); both render the order's current terms
through `ctx.preview_pdf`. Supporting documents are attached to the order; `order_files` keeps documents
received after sync. A sales order's quotation and contract carry the seller's stamp when **Include company
stamp** is ticked in the preview, and in Download PDFs; a purchase contract never does.

## 6. Access control

The starting teams are seed rows (`seed/public/sys_team.json`) an administrator edits; each holds one policy:

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
matching policy's approval flow holds a provisional write when direct permission is absent. A synced order's
Kingdee header and the floor rule are enforced by the model and policies, not by a UI rule alone.

## 7. Automations and effects

| Name            | Trigger                   | Policy          | What it does                                                               |
| --------------- | ------------------------- | --------------- | -------------------------------------------------------------------------- |
| `source_health` | `sys_integration` updates | `source_health` | Notifies workspace administrators when a ledger connection needs attention |

`credit_releases` declares `create.effect` and `update.effect` to emit deduped native `ctx.notify` alerts when
a blocked delivery is detected, approved for KIS release (to Finance, Logistics and the order owner),
superseded after an edit in KIS, or bypassed with an unapproved `XS100016` release. Other models declare no
post-commit effects; ordinary writes, approvals and syncs own their own follow-up.

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
credit_releases/
orders/                       activities, order_files, order_lines, source_payments,
                              source_sales_lines, transactions
parties/                      contacts, credit_snapshots
products/                     pricing_floors, stock_snapshots
settlements/
source_lot_costs/
source_payables/
source_purchase_lines/
source_purchase_orders/
source_receivables/
source_stock_commitments/
warehouses/
```

A sync sits beside its model: `parties/contacts/+kingdee.sync.ts` reads each party's Kingdee contact and
`settlements/+kingdee.sync.ts` Kingdee's settlement methods.

The current field/output/write inventory is [the source reference](0003-source-reference.md). The coding-agent
map is [`src/agent/AGENTS.md`](../src/agent/AGENTS.md); the workspace brief is
[`src/agent/+agent.md`](../src/agent/+agent.md).

## 10. Invariants

1. An order holds its own terms; a synced order never returns to draft, Kingdee keeps its header, and its history
   is the audit trail.
2. Kingdee transactions, payments, receivables, credit, stock and cost facts are read-only.
3. There is one delivery/invoice ledger and one payment ledger; no parallel manual ledger.
4. A remaining source commitment cannot be released locally while its external order is active.
5. Missing source facts stay missing; never fill a price, cost, credit limit or exchange rate.
6. Money and currency travel together.
7. A price floor's unit must match the line unit; a missing compatible floor never becomes zero.
8. A line keeps the floor it was priced against and a synced order the commission rule in force on its order date,
   not today's config.

Next: [integration](0002-integration.md) · [source reference](0003-source-reference.md)
