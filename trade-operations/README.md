# Trade Operations

![Trade Operations application](docs/screenshots/application.webp)

A public Bolt starter for trading and manufacturing teams. Customer quotations and sales orders
share one agreement model; supplier purchase orders use the same model with purchasing direction.
A quotation becomes a finalized agreement without moving to another table.

## Documentation

Start with [the documentation index](docs/README.md). It orders the objective, architecture, integration,
source inventory and the deeper Kingdee, capability, print and probe references.

## Apps and roles

Operations contains Trade (one filterable Orders table), Partners (one customer/supplier table),
Warehouse (SKUs, inventory and warehouses), and Analysis (reports). Trade configuration contains
Documents (each printed document's layout per language) and Prices and commission (monthly price book,
historical prices and commission rules).

An order has General, Activities and Transactions. General holds its customer/supplier, owner,
contract SKU, quota quantities, prices, credit/payment terms and validity, with the Kingdee SO or PO state.
Activities contains follow-ups. Native History combines the revision scrubber with order, item, activity and source-record changes; it is the order's audit trail. Transactions shows delivery orders and invoices against the agreed quota. Each transaction
owns its documents. Partners has General, Contacts and Orders.

Editable child tables use an explicit create form in a modal opened by a right-aligned
`+ Model` toolbar button. Source-owned tables have no create button or editable form.
The base pack supplies generic commercial settings and EN/ZH layouts for each printed document:
quotation, sales contract and purchase contract. An order chooses only its document language; to
customise an output, revise that document's layout in Trade configuration → Documents and publish it.
Confirmation seals the contract version the order used. Preview and Export PDF render the saved order
as one generated file. The commercial table includes the saved item specification, quantity, price,
discount, tax and totals. Company letterhead and contract-stamp artwork are optional tenant PNGs.
A sales order's quotation and contract carry the stamp when **Include company stamp** is ticked in the
preview; a purchase contract never does. A document field may offer fixed choices (`options`, one per line).

A published layout can also carry an optional **Print layout HTML** upload. It controls print
CSS, typography and artwork placement. Use this when recreating an approved document or
workbook. The [print layout guide](docs/0007-print-layouts.md) lists supported fields and the renderer
configuration.

Contract SKU, quota, prices, credit terms and validity belong to the order in General; History
shows every earlier value. To keep a customer PO or signed return received later, add it under
Filed documents on the confirmed order.

Orders has Sales orders and Purchase orders views for the teams that use them. A purchase order can
also start from the supplier record. Procurement confirms it without commercial manager approval; once
the ledger's purchase documents are verified, confirming writes it to Kingdee as an unaudited PO, a line
change replaces the PO's lines until it is audited, and its receipts, purchase invoices and payments
attach to it. A sales rep's confirmation, and any later change to a confirmed sales order, use native
Bolt commercial approval. Credit limits and
balances are read-only source facts, with credit enforcement owned by the source system.

Stock rows represent remaining lots, including lot number and unit cost. Price warnings compare a sales item’s net unit price with quantity-weighted remaining inventory cost for the same SKU, unit and currency. Realized sales margins use the consumed lot’s captured cost; missing costs remain unknown. Aging combines unpaid invoices and unallocated receipts in one grid without pretending that a receipt has been allocated to an invoice.

Teams (`src/access_control/team/+team.ts`) link one policy each, by handle: **Sales** (`sales` →
`sales`), **Procurement** (`procurement` → `procurement`), **Commercial Managers**
(`commercial_managers` → `manager`), **Finance** (`finance` → `finance`), **Logistics**
(`logistics` → `logistics`) and **Configurators** (`configurators` → `configuration`). Sales confirmations go to a `commercial_managers` approval step.

Sales reads its own customer agreements and financial facts; procurement reads its own supplier
agreements. Logistics sees operational quantities with commercial fields masked. Finance and
managers use the reports; configuration access does not grant commercial records. Source records
are written only by their Kingdee sync; configurators and commercial managers can change only a
product's local commission settings.
English and Chinese catalogs own captions, business statuses and error messages. Native Bolt
history, permissions, approvals, Actions, kinds and runs are reused.

## Data model

- `orders` / `order_lines`: our sales or purchase agreement and its contract SKU rows, holding the
  terms. A confirmed order is a two-way shadow of its Kingdee SO or PO: confirmation creates it, a later
  line change amends it, and a Kingdee change updates the order. Kingdee keeps the header.
- `transactions`: read-only deliveries (receipts, for a purchase) and invoices linked to their order.
  Issued invoices retain their actual issue date, due date and total; AR does not invent these values.
- `source_payments`: one read-only receipt/payment/refund ledger, optionally applied to an invoice transaction.
  Deposits remain separate, refunds reduce payments, withdrawn receipts remain inspectable and replay
  converges by source identity. There is no parallel manual payment ledger.
- `source_sales_lines`: canonical financial reporting facts distinguishing shipments, returns and
  invoice-only revenue. This remains separate until verified source mappings provide equivalent
  transaction financial facts without counting shipment/invoice pairs twice.
- `commission_rules`: dynamic CEL expressions and parameters. A confirmed order keeps the rule in
  force when it was confirmed; its lines keep their floors and conversion facts.
- `commission_statements`: the single retained monthly commission approval workflow. No extra
  per-order commission acknowledgment model or duplicate table.
- `stock_snapshots`: read-only source lots with lot number, on-hand quantity and unit cost. The Stock
  tab shows beside each lot what open Kingdee sales orders await (`source_stock_commitments`) and what
  is available, per product and warehouse; a missing or stale feed, a unit mismatch or an open order
  without a warehouse leaves Available blank.

There is one delivery/invoice ledger. Closure counts delivery items once. Archive is reversible and local:
it never voids the Kingdee order or releases its commitment; only Kingdee's void or close ends it. A
confirmed order cannot be deleted.

## Automations and integrations

| Automation      | Trigger                                   | What it does                                                               |
| --------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| `source_health` | every 5 minutes, over `kingdee` instances | Notifies workspace administrators when a ledger connection needs attention |

Order documents need no automation. The shared preview generates a PDF with `ctx.preview_pdf` and uses
its file for both preview and download. The `orders` file sync imports and exports the order
workbook (XLSX or CSV), not documents.
The price book opens a month matrix per warehouse group and currency with inline day-cell editing; the dated rows keep native Excel and CSV import/export with ledger-scoped SKU codes.

The custom [Kingdee integration](docs/0004-kingdee-implementation.md) lives in
`src/integration/kingdee/`. It owns SQL Server rowversion polling and complete listings, source identity,
ordered positions and header/item submission. Each source model declares a `kingdee` sync with a
`read`; `orders` and `order_lines` mirror the SO or PO header and lines, and write the order and its line
changes. Purchase orders take part once the ledger's purchase documents are verified.
Bolt supplies the generic SQL Server request driver, sync scheduling, the outbox and its retries,
ledger-scoped identity and atomic cursor/model writes.
Each Kingdee ledger is one `sys_integration` instance with its sealed credential and safe
configuration; an administrator adds each at run time (the workspace declares no connection slot).
Every read stamps its rows with the ledger it came from (`source`), and an order belongs to its party's
ledger (`ledger`). Every active ledger receives order changes; the `orders` write submits an order only to
its own ledger.

Workspace administrators open Settings → Integrations → Connections → Kingdee for native
pairing, testing, sync options and data freshness. The Connections list shows the ledger state.
Saving a SQL credential checks the master and stock projections and their SQL read permissions
before activating SQL sync. Unpaired or paused
instances leave queued order writes waiting.
Administrators are notified when a ledger needs attention. Trade configuration keeps each rule beside
what it governs: Documents holds each printed document's layout per language (quotation, sales contract, purchase
contract); Prices and commission holds the minimum-price enforcement on the price book and the freight treatment beside the
commission rules. Source documents are read-only.

The Kingdee bindings use actual `dbo` masters, sales orders and verified source-document relationships.
Focused local probes use synthetic physical tables with CDC disabled. Trade Operations connects directly
to on-premises SQL Server 2017 over the Alibaba network path. Deployment acceptance covers the SQL
endpoint’s address policy and TLS, source defaults, permissions and query plans. Credit is opt-in: set
`creditPolicy` to `kis-sales-out-v1`, `creditAccount` to the actual database/recovery-fork identity,
and base currency to CNY. The same SQL reads native `ICCreditOption`, `ICCreditField`, `ICCreditObject`,
`t_RP_Contact`, `ICSale`, `t_RP_NewReceiveBill`, `ICStockBill` and `ICStockBillEntry` on a simulator
or a matching KIS account; it requires no simulator schema, custom view or database name.
The selected catalogue terms determine exposure. Kingdee's amount/term controls determine the
**Credit blocked** indicator; `FIsCreditMgr` is not a hold flag. The minute feed reflects invoice audit,
allocated payments and DO matching. Unknown formula items, unsupported currencies/control modes,
missing mappings or failed reads preserve last-good evidence. Native audit/receipt predicates still
require verification against the target account's Kingdee version before production use.

## Seed

- **public** — `seed/public/*.json`: the default commercial settings and the six document layouts, shipped
  in the release's base pack.
- **test** — `seed/test/*.json`: synthetic commercial settings, document templates, a ledger, parties, products
  and warehouses for `bolt test`. They never enter a release; no credentials or live financial facts ship with the
  starter.
- **private** — `seed/+seeder.ts` names the seed bank tree `trade-operations`, which
  `bolt seed --bank=<checkout>` loads into one demo.

## Checks

```bash
bun install
bunx bolt check   # types, Svelte warnings, layout and declarations
bun run test    # bolt test
```

`.norbital/` is generated and never committed.

Final acceptance requires individually probing every page, order tab, representation, nested modal,
picker, approval, report/export and integration surface in the final build. Check behavior and ease
of use, role scope, confirmed/draft states, English/Chinese, desktop/narrow screens, keyboard/touch and
light/dark appearance. Record evidence, fix confusing behavior and repeat the affected probes.
Tests and mockups do not replace the manual acceptance gate.

## Maintained source reference

See [the source reference](docs/0003-source-reference.md) for the current applications/pages, model outputs and writes, automation policies, integrations and browser screenshot. The inventory is checked against this template's declarations; provider setup and deployed-release readiness remain separate checks.

For the boundary that keeps Kingdee reliable and cheap, read [the integration document](docs/0002-integration.md). It lists the local tables the sync writes and the platform cursor/outbox tables beside them.

See the [workspace capability guide](docs/0006-workspace-capabilities.md), [manual probe matrix](docs/0008-manual-probe-matrix.md) and [Kingdee order lifecycle](docs/0005-kingdee-order-lifecycle.md) for supported workflows, acceptance checks and ERP write boundaries.
