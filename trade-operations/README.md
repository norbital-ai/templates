# Trade Operations

A public Bolt starter for trading and manufacturing teams. Customer quotations and sales orders
share one agreement model; supplier purchase orders use the same model with purchasing direction.
A quotation becomes a finalized agreement without moving to another table.

## Documentation

Start with [the documentation index](docs/README.md). It orders the objective, architecture, integration,
source inventory and the deeper Kingdee, parity, print and probe references.

## Apps and roles

Operations contains Trade (one filterable Orders table), Partners (one customer/supplier table),
Warehouse (SKUs, inventory and warehouses), and Analysis (reports). Trade Configuration contains
Settings, Pricing Floors, Commission Rules and Document Templates.

An order has General, Activities and Transactions. General holds its customer/supplier, owner,
contract SKU, quota quantities, prices, credit/payment terms, validity and the sealed agreement.
Activities contains follow-ups. Native History combines the revision scrubber with order, item, activity and source-record changes. Matching issued confirmations appear as record links in General. Transactions shows delivery orders and invoices against the agreed quota. Each transaction
owns its documents. Partners has General, POC and Orders.

Editable child tables use an explicit create form in a modal opened by a right-aligned
`+ Model` toolbar button. Source-owned tables have no create button or editable form.
The base pack supplies generic commercial settings and EN/ZH document layouts. To customise an
output, publish a named layout in Document Templates and select it in the order draft. A recorded
revision retains that layout, its wording and its artwork. Preview and Export PDF use the same
generated file. The commercial table includes the saved item specification, quantity, price,
discount, tax and totals. Company letterhead and contract-stamp artwork are optional tenant PNGs.
The stamp is applied when the layout is used on a sealed local sales agreement.

A published layout can also carry an optional **Print layout HTML** upload. It controls print
CSS, typography and artwork placement. Use this when recreating an approved document or
workbook. The [print layout guide](docs/0007-print-layouts.md) lists supported fields and the renderer
configuration.

Contract SKU, quota, prices, credit terms and validity belong to the agreement in General. The
approved-version selector shows earlier terms, and native Actions previews or exports the selected
version on demand. Attach supporting documents before recording the agreement. To keep a customer
PO or signed return received later, select its recorded version and choose **File a document**.
The filing retains the received bytes with that version while the agreement and order stay intact.

Orders has Sales orders and Purchase orders views for the teams that use them. Supplier commitments can
also start from the supplier record. Record a purchase commitment when the terms are worth retaining,
revise it if quantities or prices change, and archive it if the purchase falls through. A recorded
version preserves the terms from that point in time. The purchase action needs no Kingdee submission or
commercial manager approval. Sales agreements use native Bolt commercial approval. Credit limits and
balances are read-only source facts, with credit enforcement owned by the source system.

Stock rows represent remaining lots, including lot number and unit cost. Price warnings compare a sales item’s net unit price with quantity-weighted remaining inventory cost for the same SKU, unit and currency. Realized sales margins use the consumed lot’s captured cost; missing costs remain unknown. Aging combines unpaid invoices and unallocated receipts in one grid without pretending that a receipt has been allocated to an invoice.

Teams (`src/access_control/team/+team.ts`) link one policy each, by handle: **Sales** (`sales` →
`sales`), **Procurement** (`procurement` → `procurement`), **Commercial Managers**
(`commercial_managers` → `manager`), **Finance** (`finance` → `finance`), **Logistics**
(`logistics` → `logistics`) and **Configurators** (`configurators` → `configuration`). Sales confirmations go to a `commercial_managers` approval step.

Sales reads its own customer agreements and financial facts; procurement reads its own supplier
agreements. Logistics sees operational quantities with commercial fields masked. Finance and
managers use the reports; configuration access does not grant commercial records. Source records
are written only by their Kingdee sync; administrators can change only a table's local fields
(product commission settings).
English and Chinese catalogs own captions, business statuses and error messages. Native Bolt
history, permissions, approvals, Actions, kinds and runs are reused.

## Data model

- `orders` / `order_lines`: our sales or purchase agreement and its editable contract SKU rows.
  Confirmation seals that version permanently. Revision starts a separate draft on the same order
  and approval makes it current even when the Kingdee link is off.
  Read-only Kingdee SOs, deliveries and invoices retain that agreement seal.
- `ext_sales_orders` / `ext_purchase_orders`: read-only source confirmations linked to our agreement.
- `transactions`: read-only deliveries and invoices linked to the appropriate external order.
  Issued invoices retain their actual issue date, due date and total; AR does not invent these values.
- `source_payments`: one read-only receipt/refund ledger, optionally applied to an invoice transaction.
  Deposits remain separate, refunds reduce payments, withdrawn receipts remain inspectable and replay
  converges by source identity. There is no parallel manual payment ledger.
- `source_sales_lines`: canonical financial reporting facts distinguishing shipments, returns and
  invoice-only revenue. This remains separate until verified source mappings provide equivalent
  transaction financial facts without counting shipment/invoice pairs twice.
- `commission_rules`: dynamic CEL expressions and parameters. Each finalized agreement seals the
  applicable expressions, engine version, floors and conversion facts.
- `commission_statements`: the single retained monthly commission approval workflow. No extra
  per-order commission acknowledgment model or duplicate table.
- `stock_snapshots`: source stock and reservation quantities. Projection subtracts our commitments
  only until a matching issued sales-order confirmation is included in the stock source position.
  Missing/stale source facts and unreconciled movements remain unavailable.

There is one delivery/invoice ledger. Closure counts delivery items once and
retains the original agreement seal and released quota. A remaining source commitment cannot be
released locally while its external order is still active; a matching synced void confirmation is
required. Issued transactions or active payments prevent cancellation.

## Automations and integrations

| Automation      | Trigger                                   | What it does                                                            |
| --------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| `source_health` | every 5 minutes, over `kingdee` instances | Notifies configuration holders when a ledger connection needs attention |

Order documents need no automation. The shared preview generates a PDF with `ctx.preview_pdf` and uses
its file for both preview and download. The `orders` file export renders the same saved quotation or
retained agreement. The price book opens a month matrix per warehouse group and currency with inline day-cell editing; the dated rows keep native Excel and CSV import/export with ledger-scoped SKU codes.

The custom [Kingdee integration](docs/0004-kingdee-implementation.md) lives in
`src/integration/kingdee/`. It owns SQL Server rowversion polling and complete listings, source identity,
ordered positions and header/item submission. Each source model declares a `kingdee` sync with a
`read`; `orders` reads observed sales versions and writes verified sales submissions and supported amendments.
Supplier commitments are local records.
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
instances leave queued sales work waiting.
Administrators are notified when a ledger needs attention. Trade configuration groups document and
pricing defaults with their respective tools. An issued `ext_*` confirmation confirms business
receipt. Source documents are read-only.

The Kingdee bindings use actual `dbo` masters, sales orders and verified source-document relationships.
Focused local probes use synthetic physical tables with CDC disabled. Trade Operations connects directly
to on-premises SQL Server 2017 over the Alibaba network path. Deployment acceptance covers the SQL
endpoint’s address policy and TLS, source defaults, permissions and query plans. Credit-policy
binding and unsupported document/write types remain explicitly unavailable.

## Seed

- **test** — `seed/test/*.json`: synthetic commercial settings, document templates, parties, products and
  warehouses for `bolt test`. They never enter a release; no credentials or live financial facts ship with the
  starter.
- **private** — `seed/+seeder.ts` names the seed bank tree `trade-operations`, which
  `bolt seed --bank=<checkout>` loads into one demo.

## Checks

```bash
bun install
bunx bolt check   # types, Svelte warnings, layout and declarations
bun run test    # bolt build, then bolt test (including tests/e2e)
```

`.norbital/` is generated and never committed.

Final acceptance requires individually probing every page, order tab, representation, nested modal,
picker, approval, report/export and integration surface in the final build. Check behavior and ease
of use, role scope, sealed/draft states, English/Chinese, desktop/narrow screens, keyboard/touch and
light/dark appearance. Record evidence, fix confusing behavior and repeat the affected probes.
Tests and mockups do not replace the manual acceptance gate.

## Maintained source reference

See [the source reference](docs/0003-source-reference.md) for the current applications/pages, model outputs and writes, automation policies, integrations and browser screenshot. The inventory is checked against this template's declarations; provider setup and deployed-release readiness remain separate checks.

For the boundary that keeps Kingdee reliable and cheap, read [the integration document](docs/0002-integration.md). It lists the local tables the sync writes and the platform cursor/outbox tables beside them.

See the [SalesBridge parity catalogue](docs/0006-salesbridge-parity.md), [manual probe matrix](docs/0008-manual-probe-matrix.md) and [Kingdee order lifecycle](docs/0005-kingdee-order-lifecycle.md) for coverage, acceptance evidence and the source writer incident.
