# CRM

![CRM workspace thumbnail](assets/thumbnail.svg)

A two-sided B2B trade workspace: the **sales side** qualifies accounts and contacts, quotes from a
product catalogue, runs the pipeline to won, and confirms the deal; the **purchase side** raises
purchase orders against suppliers and confirms the buy. Both sides mirror master data in from the
company's external system of record — an ERP or accounting system that owns customers, items, and
vendors — and hand their committed documents back out across the boundary. One entry, no re-keying.

This is an executable Pod template, not a production-operations manual. It demonstrates
server-enforced document lifecycles, revision-safe quoting, snapshot line items, money arithmetic
that holds up to reconciliation, a cost-secrecy boundary drawn by policy omission, and a sync
registry that keeps the workspace in step with an external system.

## The mental model

```
external system of record (owns customers, items, vendors)
        ▲                                           │ hourly pull of changed masters
        │           confirmed quote / confirmed PO  ▼
        │              booked across the boundary   accounts · products · suppliers
        │                                           (the mirrors — edited in place)

sales chain:   contact → quote → quote_lines →(confirm)→ sales_invoices → sales_invoice_lines
               quote ──▶ contract_signings · quote ──▶ settlements (received)
buy chain:     supplier → purchase_orders → purchase_order_lines
               purchase_orders ──▶ goods_receipts → goods_receipt_lines
               purchase_orders ──▶ purchase_invoices → purchase_invoice_lines
               purchase orders & invoices ──▶ settlements (paid)
```

Four ideas carry the whole workspace:

- **Mirrors in, documents out.** `accounts`, `products`, and `suppliers` _are_ the external
  system's tables: every row carries the system's own key in `external_code`, and a scheduled pull
  keeps them in step. The workspace never invents a customer, item, or vendor. Committed documents
  go the other way: confirming a quote or a purchase order hands it across the boundary, where the
  system of record books it.
- **A document is a lifecycle, not a row.** Every document collection carries a status enum and a
  hook that enforces a transition map. `draft` is the only editable state — lines, prices, and
  terms lock the moment a document leaves draft — and the terminal states are the ones the external
  system books, which is what makes their figures safe to hand across the boundary.
- **History is snapshots.** Quote, order, and invoice lines snapshot the product code, name, unit,
  and price at creation, so a later catalogue edit never rewrites a historical document. Documents
  snapshot their account or supplier the same way.
- **Money is decided in one place.** Each line computes `net`, `tax`, and `line_total` once, from
  the parent document's currency and tax mode; a document total is the sum of already-rounded
  lines. Paid / partial / unpaid is never stored — it is derived at render from settlements against
  the document gross, and only for committed documents.

### Lifecycles

```
quote:            draft ──▶ sent ──▶ won ──▶ confirmed (terminal, books into the ERP)
                  sent ──▶ draft = revision (revision_number+1, revision_of set)
                  draft/sent/won ──▶ lost ──▶ won (a lost deal may reopen)
                  draft/sent/won ──▶ cancelled (terminal, reason required)
purchase order:   draft ──▶ submitted ──▶ confirmed (terminal, books into the ERP) · cancelled
sales invoice:    draft ──▶ issued (terminal) · cancelled
purchase invoice: draft ──▶ confirmed (terminal, the three-way match checkpoint) · cancelled
contract signing: unstamped ──▶ counterparty_stamped ──▶ acknowledged · voided (re-signing)
goods receipts:   no status — a receipt is an immutable event
```

Confirming is re-checked against the masters: the account or supplier must still be active, the
document must carry at least one line, and every line's product must still be active — stale master
data never books into the ERP. A quote under adverse credit (account on hold, or over its limit)
confirms only with an explicit `credit_acknowledged`, which lands in the audit trail. Cancelling
any document requires a reason. Sent quotes past `valid_until` are caught by the daily automation.

### Entities

| Collection               | Role                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `accounts`               | Customer companies — the ERP customer mirror, carrying the credit position.                                     |
| `contacts`               | People at accounts: decision-makers, buyers, day-to-day contacts.                                               |
| `quotes`                 | The sales pipeline document, with trade terms on the header and a revision lineage.                             |
| `quote_lines`            | Line items: product snapshot plus computed amounts. Editable only while draft.                                  |
| `sales_invoices`         | Billing raised against a confirmed quote; lines allocate quoted quantities.                                     |
| `sales_invoice_lines`    | One billed quantity per quote line, capped across live invoices.                                                |
| `contract_signings`      | The confirmed quote's contract lifecycle; `binding_hash` fingerprints the quote substance at generation.        |
| `activities`             | Polymorphic interaction log (call / meeting / email / task / note) linked by `regarding_type` + `regarding_id`. |
| `products`               | Sellable catalogue — the ERP item mirror. Sell prices and tax rate only; cost never lives here.                 |
| `settlements`            | Payments in or out against any committed document. Paid status derived at render.                               |
| `suppliers`              | Vendors — the ERP vendor mirror, with contact, category, and payment terms.                                     |
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

### Integrations and policies

One `erp` connection (a placeholder `baseUrl`, and a bearer token referenced by name from
`src/+env.ts` — never a secret value in the workspace):

- **Inbound — the ERP syncs its masters over.** `accounts`, `products`, and `suppliers` declare a
  scheduled pull (`customers_changed`, `items_changed`, `vendors_changed`, hourly at minute 15).
  The host fetches with the connection's credential, parses the body against the binding's schema,
  hands it to the collection's `import` pipeline, and writes the returned rows into the mirror.
  The resume point is the platform's cursor, so a missed window resumes where it stopped; codes
  already on file are skipped.
- **Outbound — confirmed documents are handed over.** `quotes` and `purchase_orders` declare a send
  binding on the `draft → confirmed` transition. The mutation writes the record to the platform's
  transactional outbox in the same transaction — a delivery is never queued for a write that rolled
  back. The host drains the outbox: the collection's `export` pipeline builds the payload
  (field-enumerated, so cost and other internal facts can never serialize), the binding's
  `transform` shapes it into the request body (`POST /docs/confirmed`), and delivery retries with
  capped backoff and dead-letters after ten attempts.

| Policy                | Apps           | What it owns                                                                                                                                                        |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sales_rep`           | `crm`          | Its own quotes, sales invoices, and contract signings (scoped to the requestor), their lines, settlements, activities; reads accounts, contacts, and the catalogue. |
| `procurement_officer` | `crm_purchase` | Suppliers, purchase orders and lines, goods receipts, purchase invoices and lines, settlements; reads the catalogue.                                                |

The sales/procurement split is drawn by **omission**, not masking. Pod policies are
collection-scoped, so buy cost stays off the sales surface because sales has no grant for
`purchase_order_lines` (the only collection carrying a cost column) — and the buy side gets no
quote grant, so it never sees sell prices or margin. The shared catalogue exposes sell prices only.

### Remotes

| Remote                  | Purpose                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pipeline_dashboard`    | Pipeline cards enriched with account names; optional `owner_id` / `account_id` scope. Mounted on the pipeline tab. |
| `procurement_dashboard` | PO counts per status, committed spend per currency, top suppliers. Mounted on the purchase dashboard.              |
| `purchase_matching`     | Ordered / received / invoiced per order line — the three-way match review. Cancelled invoices do not count.        |
| `settlement_summary`    | Paid-to-date per document for one regarding type — the input to derived paid / partial / unpaid badges.            |

The last two are not mounted on any default surface: `purchase_matching` is the review a tenant
wires into its own match screen, and `settlement_summary` powers payment-status columns wherever a
tenant wants them. Both are ready to call through `client.invoke`.

### Channel

`sales_desk` — a Telegram channel for customer-facing sales enquiries. The agent answers under the
`sales_rep` policy, so a message from a customer cannot become a way around the permission model.

### Seed

None. A fresh tenant starts empty: masters arrive through the ERP pull once the tenant's connection
is provisioned (`baseUrl` + `EXTERNAL_SYSTEM_TOKEN`), and everything else is entered by operators
through the apps. There is deliberately no `+seed.ts` — this workspace's data enters either through
the integration or through the UI.

## Under the hood

```text
src/
├── collections/              17 collections, each in its own directory
│   ├── +relationship.ts      one-to-many and many-to-one relations; line collections cascade
│   └── <collection>/
│       ├── +model.ts         storage: columns, enums, indexes, recordLabel, icon
│       ├── +hooks.ts         lifecycle enforcement: transitions, defaults, caps, rollups
│       ├── +pipelines.ts     canonical import/export shaping for the integration
│       ├── +integrations.ts  the erp connection: pull bindings, outbox send bindings
│       └── +representation.svelte  create/edit form with human-readable relation labels
├── apps/                     the two app surfaces
├── automation/               quote_expiry_watch
├── remotes/                  the four query handlers above
├── policies/                 sales_rep, procurement_officer
├── channels/                 sales_desk
├── lib/
│   ├── pricing.ts            the only place rounding is decided
│   ├── numbering.ts          PREFIX-YYYY-NNNN document numbering
│   └── calendar.ts           calendar-day derivation in the desk's timezone
├── i18n/                     messages.en.json + messages.zh.json, identical key sets
└── +env.ts                   EXTERNAL_SYSTEM_TOKEN, declared by name only
```

- **Hooks** validate and return the accepted input, then make same-transaction reads. They own the
  transition maps, document numbering, quantity caps (received and invoiced quantities can never
  pass the ordered or quoted quantity), the credit gate, and the line-to-document rollup that keeps
  `net` / `tax` / `gross` on every document equal to the sum of its printed lines.
- **Document numbering** (`lib/numbering.ts`) issues `QT-`, `PO-`, `SI-`, `PI-`, and `GRN-YYYY-NNNN`
  numbers by reading the highest number already issued in the series; the unique index on `doc_no`
  is what actually guarantees uniqueness, and the losing transaction fails and is retried.
- **Money** (`lib/pricing.ts`): `roundHalfUp` shifts the decimal exponent so `1.005` rounds to
  `1.01`, tax-inclusive lines take tax as the residual `gross − net`, and `documentTotals` sums
  already-rounded lines in minor units so a total always equals what a reader can add up.
- **Calendar days** (`lib/calendar.ts`) resolve in `Asia/Singapore` — `new Date().toISOString()`
  would be the UTC day, a day behind for part of every day on a server west of Greenwich. Task
  `due_date` defaults and purchase-order `expected_date` (two weeks out) use it.
- **Apps** are declarative: `$state` for operator input (account selector, rep filter), `$derived`
  for everything downstream — label maps and queries. Every relation column renders through a
  label map from one page-level query (`client.db.user`, the scoped quote/invoice lists), never a
  query per row, and never a UUID. Owner names come from `client.db.user`; the platform's user
  table is not duplicated.
- **Representations** are the collection-owned create/edit surfaces. Relation fields use the
  `RelationshipRenderer` with human labels (`doc_no: title`, `code · name`, `first last`), and the
  activities and settlements forms switch their target field by `regarding_type`.
- **i18n**: app and component copy lives in `messages.en.json` (source of truth) and
  `messages.zh.json` with the same key set; apps use `useI18n<TenantI18nKeys>()`. App metadata in
  `<svelte:head>` stays static English, and the sidebar label localizes through `app.<appId>.title`.

## Changing the template

Run from the template directory; `.norbital/` generated output is rebuilt and never hand-edited:

```bash
pnpm sync    # pod sync — regenerates .norbital/, may add a migration
pnpm lint    # prettier --check + svelte-check
pnpm build   # vite build
```

The templates repository provides the same loops across every template (`pnpm templates:sync`,
`templates:lint`, `templates:build`, and `templates:verify`, which proves each template installs,
syncs, lints, and builds from its tracked files alone).

- `pod sync` may create or update `.norbital/migrations/`. That directory is generated but
  **committed** — commit it with the authored change. `migrationFingerprint` hashes its raw bytes,
  so never reformat it by hand.
- There is no seed script, so deployed data evolves through committed migrations, not seeds: for a
  change that must apply to existing tenants, create a custom migration with
  `pnpm exec pod migration create <name> --custom` and run it through the update flow below.
- Publishing: pushing to `main` of the templates repository republishes
  `refs/heads/templates/crm` — a fast-forward-only subtree split of this directory. A tenant is
  forked from that commit, so it shares ancestry and adopts updates by rebase; it never moves on
  its own. After publishing, consume the release in Core and redeploy:
  `pnpm tenant:update --org=<org-slug> --template=crm`, then hard-refresh the iframe. Use
  `pnpm env:reset --target dev --template crm` only for a deliberate reseed. The templates
  repository README documents the full release and tenant lifecycle.
