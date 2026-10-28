# Trade Operations

A public Bolt starter for trading and manufacturing teams. Customer quotations and sales orders
share one agreement model; supplier purchase orders use the same model with purchasing direction.
A quotation becomes a finalized agreement without moving to another table.

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
Native Actions owns order actions and on-demand document preview/PDF export.

Contract SKU, quota, prices, credit terms and validity belong to the agreement in General. The
approved-version selector shows earlier terms, and native Actions previews or exports the selected
version on demand. Native order history retains record changes; there are no separate contract-file
or revision models. Matching issued confirmations appear as record links in General. Transactions shows deliveries and invoices.

The main Orders view contains customer sales agreements. Supplier purchase orders are created in the supplier’s Orders tab. Direction is fixed at creation. Draft contracts are editable and validity uses one date range; sealing uses native Bolt approval. Credit limits and balances are read-only source facts, with credit enforcement owned by the source system.

Stock rows represent remaining lots, including lot number and unit cost. Price warnings compare a sales item’s net unit price with quantity-weighted remaining inventory cost for the same SKU, unit and currency. Realized sales margins use the consumed lot’s captured cost; missing costs remain unknown. Aging combines unpaid invoices and unallocated receipts in one grid without pretending that a receipt has been allocated to an invoice.

Teams (`src/access_control/team/+team.ts`) link one policy each, by handle: **Sales** (`sales` →
`sales`), **Procurement** (`procurement` → `procurement`), **Commercial Managers**
(`commercial_managers` → `manager`), **Finance** (`finance` → `finance`), **Logistics**
(`logistics` → `logistics`) and **Configurators** (`configurators` → `configuration`). Sales and
procurement confirmations go to a `commercial_managers` approval step.

Sales reads its own customer agreements and financial facts; procurement reads its own supplier
agreements. Logistics sees operational quantities with commercial fields masked. Finance and
managers use the reports; configuration access does not grant commercial records. Source records
are written only by their Kingdee sync; administrators can change only a table's local fields
(product commission settings).
English and Chinese catalogs own captions, business statuses and error messages. Native Bolt
history, permissions, approvals, Actions, kinds and runs are reused.

## Data model

- `orders` / `order_lines`: our sales or purchase agreement and its editable contract SKU rows.
  Confirmation seals the agreement permanently; its header and lines cannot return to draft or be rewritten.
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

| Automation      | Trigger                               | What it does                                                            |
| --------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| `source_health` | a `kingdee` instance's status changes | Notifies configuration holders when a ledger connection needs attention |

Order documents need no automation. The Orders page converts the previewed quotation or contract
version to PDF (`bolt.convert`), and `orders` declares a `document` file sync whose `write` returns
the same rendered document for a view's Export menu.

The custom [Kingdee integration](docs/kingdee-implementation.md) lives in
`src/integration/kingdee/`. It owns SQL Server rowversion polling and complete listings, source identity,
ordered positions and header/item submission. Each source model declares a `kingdee` sync with a
`read`; `orders` declares one with only a `write` for verified initial sales-order submissions. Unsupported purchase/amendment writes fail explicitly.
Bolt supplies the generic SQL Server request driver, sync scheduling, the outbox and its retries,
ledger-scoped identity and atomic cursor/model writes.
Each Kingdee ledger is one `sys_integration` instance with its sealed credential and safe
configuration; the named `kingdee` connection is the first, and more can be added at run time.
Every source record carries its ledger (`source`), and an order belongs to its party's ledger
(`ledger`), which is where its sealed agreement is submitted.

Settings → Integrations sets each ledger’s full-reconciliation interval and window-age alert, and pauses or resumes it.
Configurators are notified when a ledger needs attention. Commercial Settings holds business
controls. A matching issued `ext_*` confirmation confirms business receipt; source documents remain
read-only.

The Kingdee bindings use actual `dbo` masters, sales orders and verified source-document relationships.
Focused local probes use synthetic physical tables with CDC disabled. Live SQL Server 2019,
relay TLS, source defaults/permissions and query plans remain deployment checks. Credit-policy
binding and unsupported document/write types remain explicitly unavailable.

## Seed

- **base** — `seed/*.json`: synthetic commercial settings, document templates, parties, products and
  warehouses. No credentials or live financial facts ship with the starter.
- **sample** — optional native demo rows supplied separately at build time. They extend the public
  defaults by identity; no private sample rows are included in the public starter.

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
