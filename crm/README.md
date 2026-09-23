# CRM

![CRM workspace thumbnail](assets/thumbnail.svg)

A two-sided B2B trade workspace: the **sales side** qualifies accounts and contacts, quotes from a
product catalogue, runs the pipeline to won, and confirms the deal; the **purchase side** raises
purchase orders against suppliers and confirms the buy. Both sides work from master data imported
from the company's system of record — an ERP or accounting system that owns customers, items, and
vendors — and export their committed documents in a fixed, versioned shape. One entry, no re-keying.

This is an executable Bolt template, not a production-operations manual. It demonstrates
server-enforced document lifecycles, revision-safe quoting, snapshot line items, money arithmetic
that holds up to reconciliation, a cost-secrecy boundary drawn by policy omission, and idempotent
master-data imports keyed on the external system's own codes.

## The mental model

```
external system of record (owns customers, items, vendors)
        │ master exports, imported
        ▼
accounts · products · suppliers   (the masters — keyed on external_code, edited in place)

sales chain:   contact → quote → quote_lines →(confirm)→ sales_invoices → sales_invoice_lines
               quote ──▶ contract_signings · quote ──▶ settlements (received)
buy chain:     supplier → purchase_orders → purchase_order_lines
               purchase_orders ──▶ goods_receipts → goods_receipt_lines
               purchase_orders ──▶ purchase_invoices → purchase_invoice_lines
               purchase orders & invoices ──▶ settlements (paid)
```

Four ideas carry the whole workspace:

- **Masters in, documents out.** `accounts`, `products`, and `suppliers` hold the external
  system's masters: every row carries the system's own key in `external_code`, and each arrives
  through its collection's `import` pipeline, which skips codes already on file so a re-imported
  export is a no-op. Committed documents go the other way: `quotes` and `purchase_orders` declare an
  `export` pipeline that serializes a confirmed document and its lines.
- **A document is a lifecycle, not a row.** Every document collection carries a status enum and a
  `+collection.ts` transform that enforces a transition map. `draft` is the only editable state — lines, prices, and
  terms lock the moment a document leaves draft — and the terminal states are the ones that export,
  which is what makes their figures safe to hand across the boundary.
- **History is snapshots.** Quote, order, and invoice lines snapshot the product code, name, unit,
  and price at creation, so a later catalogue edit never rewrites a historical document. Documents
  snapshot their account or supplier the same way.
- **Money is decided in one place.** Each line computes `net`, `tax`, and `line_total` once, from
  the parent document's currency and tax mode; a document total is the sum of already-rounded
  lines. Paid / partial / unpaid is never stored — it is derived at render from settlements against
  the document gross, and only for committed documents.

### Lifecycles

```
quote:            draft ──▶ sent ──▶ won ──▶ confirmed (terminal)
                  sent ──▶ draft = revision (revision_number+1, revision_of set)
                  draft/sent/won ──▶ lost ──▶ won (a lost deal may reopen)
                  draft/sent/won ──▶ cancelled (terminal, reason required)
purchase order:   draft ──▶ submitted ──▶ confirmed (terminal) · cancelled
sales invoice:    draft ──▶ issued (terminal) · cancelled
purchase invoice: draft ──▶ confirmed (terminal, the three-way match checkpoint) · cancelled
contract signing: unstamped ──▶ counterparty_stamped ──▶ acknowledged · voided (re-signing)
goods receipts:   no status — a receipt is an immutable event
```

Confirming is re-checked against the masters: the account or supplier must still be active, the
document must carry at least one line, and every line's product must still be active — a document
never confirms against stale master data. A quote under adverse credit (account on hold, or over its limit)
confirms only with an explicit `credit_acknowledged`, which lands in the audit trail. Cancelling
any document requires a reason. Sent quotes past `valid_until` are caught by the daily automation.

### Entities

| Collection               | Role                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `accounts`               | Customer companies — the ERP customer master, carrying the credit position.                                     |
| `contacts`               | People at accounts: decision-makers, buyers, day-to-day contacts.                                               |
| `quotes`                 | The sales pipeline document, with trade terms on the header and a revision lineage.                             |
| `quote_lines`            | Line items: product snapshot plus computed amounts. Editable only while draft.                                  |
| `sales_invoices`         | Billing raised against a confirmed quote; lines allocate quoted quantities.                                     |
| `sales_invoice_lines`    | One billed quantity per quote line, capped across live invoices.                                                |
| `contract_signings`      | The confirmed quote's contract lifecycle; `binding_hash` fingerprints the quote substance at generation.        |
| `activities`             | Polymorphic interaction log (call / meeting / email / task / note) linked by `regarding_type` + `regarding_id`. |
| `products`               | Sellable catalogue — the ERP item master. Sell prices and tax rate only; cost never lives here.                 |
| `settlements`            | Payments in or out against any committed document. Paid status derived at render.                               |
| `suppliers`              | Vendors — the ERP vendor master, with contact, category, and payment terms.                                     |
| `purchase_orders`        | The buying pipeline document, snapshotting the supplier and inheriting its currency.                            |
| `purchase_order_lines`   | Line items carrying the struck unit cost — a buy-side fact sales has no grant to read.                          |
| `goods_receipts`         | Received-against-order events; remaining-to-receive is derived, never stored.                                   |
| `goods_receipt_lines`    | Received quantities per order line, capped at the ordered quantity.                                             |
| `purchase_invoices`      | Supplier invoices booked against a confirmed order; `draft → confirmed` is the three-way match checkpoint.      |
| `purchase_invoice_lines` | Invoiced quantities and costs per order line, capped across live invoices.                                      |

## What ships

### Apps

| App            | What a user does                                                                                                                                                                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crm`          | Sales CRM. The account selector in the header scopes the page (defaults to the first active account). Pipeline kanban over the active quote statuses with a rep filter, then quotes, quote lines, contacts, activities, invoices, invoice lines, contracts, and payments for that account — plus the accounts and products catalogues. |
| `crm_purchase` | Purchasing workspace. A dashboard of PO counts per status, committed spend per currency, and top suppliers; then purchase orders, PO lines, suppliers, goods receipts, receipt lines, purchase invoices, invoice lines, and payments.                                                                                                  |

### Automation

`quote_expiry_watch` — daily at 06:00, a read-only sweep of sent quotes past `valid_until`, written
to an `expired-quotes.json` export attachment. It never mutates a quote.

### Pipelines and policies

- **Import — the ERP's masters.** `accounts`, `products`, and `suppliers` each declare an `import`
  pipeline (`lib/erp-feed.ts`) that decodes a delivered page of customers, items, or vendors and
  writes the returned rows. A malformed page fails the whole batch; a code already on file is
  skipped, so importing the same export twice changes nothing.
- **Export — confirmed documents.** `quotes` and `purchase_orders` declare an `export` pipeline
  that builds a versioned JSON attachment (`norbital.crm.confirmed_quote.v1`, …) from the document
  and its lines. It is field-enumerated, so cost and other internal facts can never serialize.

| Policy                | Apps           | What it owns                                                                                                 |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| `accounts_read`       | —              | The sole account-read grant, composed into Sales and the sales envoy.                                        |
| `products_read`       | —              | The sole product-read grant, composed into both desks and the sales envoy.                                   |
| `suppliers_manage`    | —              | The sole supplier read/mutate grant (new and existing), composed into Procurement.                           |
| `commercial_shared`   | —              | The settlement ledger (`settlements` read plus mutate for new records), shared by both desks and owned once. |
| `sales_rep`           | `crm`          | Requestor-scoped quotes, sales invoices, and contract signings, plus their lines, contacts, and activities.  |
| `procurement_officer` | `crm_purchase` | Purchase orders and lines, goods receipts, and purchase invoices and lines.                                  |

The sales/procurement split is drawn by **omission**, not masking. Bolt policies are
collection-scoped, so buy cost stays off the sales surface because sales has no grant for
`purchase_order_lines` (the only collection carrying a cost column) — and the buy side gets no
quote grant, so it never sees sell prices or margin. The shared catalogue grant exposes sell prices
only.

### Functions

| Function             | Purpose                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `purchase_matching`  | Ordered / received / invoiced per order line — the three-way match review. Cancelled invoices do not count. |
| `settlement_summary` | Paid-to-date per document for one regarding type — the input to derived paid / partial / unpaid badges.     |

Neither function is mounted on a default surface: `purchase_matching` is the review a tenant
wires into its own match screen, and `settlement_summary` powers payment-status columns wherever a
tenant wants them. Both are ready to call through `client.invoke`. The mounted sales and purchasing
dashboards read their collections directly and derive their presentation locally, so the sync engine
updates them without a remote live-query function or refresh control.

### Channel

`sales_desk` — a Telegram channel (`src/channels/+sales_desk.ts`) for customer-facing sales
enquiries, answered by the `sales_desk` envoy. The agent answers under the
same `accounts_read`, `products_read`, `commercial_shared`, and `sales_rep` policy set as the Sales
team, so a message from a customer cannot become a way around the permission model.

### Seed

None. A fresh tenant starts empty: masters arrive by importing the ERP's customer, item, and vendor
exports, and everything else is entered by operators through the apps. There is deliberately no
`+seed.ts` — this workspace's data enters either through an import or through the UI.

## Under the hood

```text
src/
├── collections/              17 collections, each in its own directory
│   ├── +relationship.ts      one-to-many and many-to-one relations; line collections cascade
│   └── <collection>/
│       ├── +model.ts         storage: columns, enums, indexes, recordLabel, icon
│       ├── +collection.ts    the write contract: what a caller may submit, and the transform that
│       │                     numbers, defaults, prices, caps and polices it
│       ├── +pipelines.ts     master imports and confirmed-document exports
│       └── +representation.svelte  create/edit form with human-readable relation labels
├── apps/                     the two app surfaces
├── automations/              quote_expiry_watch, and one line roll-up per line collection and event
├── functions/                the two on-demand query handlers above
├── access/policies/          narrow shared coordinate owners plus sales and procurement
├── channels/                 sales_desk, the Telegram channel
├── envoys/                   sales_desk, the agent on that channel
├── lib/
│   ├── pricing.ts            the only place rounding is decided
│   ├── document-lines.ts     document totals from lines; the allocation ledger behind every cap
│   ├── document-rollup.ts    the line-to-document roll-up the automations run
│   ├── document-numbers.ts   PREFIX-YYYY-NNNN document numbering
│   ├── lifecycle.ts          transition maps, batch pairing, and the small shared refusals
│   ├── erp-feed.ts           the import every master feed lands through
│   ├── desk-date.ts          calendar-day derivation in the desk's timezone
│   └── clock.ts              the injected workflow clock
└── i18n/                     messages.en.json + messages.zh.json, identical key sets
```

- **Collections** declare what a caller may submit — `doc_no`, snapshots and money columns are
  never in the selection, the transform derives them — and their transform runs once per batch:
  two read waves keyed by the inputs, then one decision per input. Transforms own the transition
  maps, document numbering, quantity caps (received and invoiced quantities can never pass the
  ordered or quoted quantity) and the credit gate. Lines are written on their own, so the
  line-to-document roll-up that keeps `net` / `tax` / `gross` equal to the sum of the printed lines
  is a change-triggered automation per line collection, acting under `document_rollup`, which may
  write nothing but those three columns.
- **Document numbering** (`lib/document-numbers.ts`) issues `QT-`, `PO-`, `SI-`, `PI-`, and `GRN-YYYY-NNNN`
  numbers by reading the highest number already issued in the series; the unique index on `doc_no`
  is what actually guarantees uniqueness, and the losing transaction fails and is retried.
- **Money** (`lib/pricing.ts`): `roundHalfUp` shifts the decimal exponent so `1.005` rounds to
  `1.01`, tax-inclusive lines take tax as the residual `gross − net`, and `documentTotals` sums
  already-rounded lines in minor units so a total always equals what a reader can add up.
- **Calendar days** (`lib/desk-date.ts`) resolve in `Asia/Singapore` — `new Date().toISOString()`
  would be the UTC day, a day behind for part of every day on a server west of Greenwich. Task
  `due_date` defaults and purchase-order `expected_date` (two weeks out) use it.
- **Apps** are declarative: `$state` for operator input (account selector, rep filter), `$derived`
  for everything downstream — label maps and queries. Collection surfaces bulk-resolve relation
  columns, while standalone relation pickers use the generic relationship renderer; authored code
  never queries platform-owned identity tables and never renders a UUID. The platform's user table
  remains internal and is not duplicated as a workspace collection.
- **Representations** are the collection-owned create/edit surfaces. Relation fields use the
  `RelationshipRenderer` with human labels (`doc_no: title`, `code · name`, `first last`), and the
  activities and settlements forms switch their target field by `regarding_type`.
- **i18n**: app and component copy lives in `messages.en.json` (source of truth) and
  `messages.zh.json` with the same key set; apps use `useI18n<TenantI18nKeys>()`. App metadata in
  `<svelte:head>` stays static English, and the sidebar label localizes through `app.<appId>.title`.

## Changing the template

Run from the template directory; `.norbital/` generated output is rebuilt and never hand-edited:

```bash
pnpm sync    # bolt sync — regenerates .norbital/, may add a migration
pnpm lint    # prettier --check + svelte-check
```

`sync` also emits the deployable portable artifact at `.norbital/artifact/bundle.mjs`; there is no
separate per-template build command. The templates repository provides the same loops across every
template (`pnpm --dir crm sync`, `pnpm --dir crm lint`, and repo-root `pnpm templates:verify`,
which proves each template installs, syncs, and lints from tracked files alone).

- `bolt sync` may create or update `.norbital/migrations/`. That directory is generated but
  **committed** — commit it with the authored change. `workspaceSchemaFingerprint` hashes the
  committed mutation-visible schema, so never edit the generated lineage by hand.
- There is no seed script, so deployed data evolves through committed migrations, not seeds: for a
  change that must apply to existing tenants, write the next lineage entry with
  `pnpm exec bolt migrate --name <name>`, edit its SQL, and run it through the update flow below.
- Publishing: pushing to `main` of the templates repository republishes
  `refs/heads/templates/crm` — a fast-forward-only subtree split of this directory. A tenant is
  forked from the exact advertised commit when Colony provisions it, so it shares ancestry but never
  moves merely because the ref advances. From the realm root, `pnpm run env -- link` tests
  local OSS packages inside this template; it does not link a template release into Colony or
  update a tenant. The templates repository README documents the full release and tenant lifecycle.
