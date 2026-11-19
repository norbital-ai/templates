# Kingdee SQL integration

Kingdee-specific bindings belong to this template. `+integration.ts` declares the SQL Server
driver, sealed credentials, account-set configuration and connection test. Bolt owns the shared
SQL Server pairing gate, the read scheduler and the outbox. The template issues
fixed SQL through the driver's existing `call` operation and SQL Server's built-in
`sys.sp_executesql`; business data is bound as parameters. Settings never accept SQL text.
Trade Operations opens its own TDS session to the on-premises Kingdee SQL Server account set
over an authorized network connection. Bolt schedules and executes SQL reads and authorized writes in that session.
Deployment uses the SQL endpoint provided by the network operator; the transport carries TCP traffic.
Operators create orders, approve and change terms, and manage tasks in Trade Operations.
The order form, approvals, documents and reports use the Trade Operations database. The link
carries background replication of mapped table rows, including incoming fulfillment and
accounting evidence. A work action completes against the local database, and an outbound write
is a separate job. Staff can keep changing and approving orders while the link is unavailable.
The outbox retains pending source writes for retry. The verified source writer creates a saved
SO or PO. Replicating the synced order as an audited SO still requires native Kingdee
validation on a restored account set.

The customer's account set ran SQL Server 2008 R2 at compatibility level 80 when SalesBridge measured it; it now
runs SQL Server 2017. An account set upgraded that way stays at compatibility level 100 unless raised, so every
statement here is valid at 100: no `TRY_CONVERT`/`TRY_CAST` (110) or `OPENJSON` (130). `FOR JSON`, `JSON_QUERY` and
`APPLY` need only the 2017 engine. A test guards the source and the live SQL tests run at level 100. Confirm the
level with `SELECT @@VERSION, compatibility_level FROM sys.databases WHERE name = DB_NAME()`.

```text
Kingdee SQL Server 2017  <-- TDS over the configured network path -->  Trade Operations runtime
      SELECT current rows and rowversions  ----------------------->  ledger and sync state
      initial SO/PO and guarded changes    <-----------------------  confirmed order outbox
```

Colony currently uses Bolt’s public-destination TCP guard for database integrations. It rejects a
private IP literal or a DNS name with any private address before opening a socket. Network routing
alone does not change that check. A deployment using the guard can reach a restricted TCP endpoint
with a permitted address that forwards to the Kingdee host over the configured network. An endpoint that resolves
only to private addresses requires a host-level policy for that destination. The network operator
must verify the chosen endpoint from the deployed runtime. Bolt verifies the SQL TLS endpoint’s
name and certificate. The local Docker probe uses a loopback adapter and does not verify either
the deployed network path or the deployed TLS handshake.

## What moves between the systems

| Direction           | Supported behavior                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kingdee → workspace | Read-only projections synchronize mapped masters, order state, fulfillment evidence, stock, receivables and sales facts.                                   |
| Workspace → Kingdee | A confirmed sales or purchase agreement queues an idempotent SO or PO write. The writer creates a saved, unapproved order and retains its source identity. |
| Ownership           | Local approval and ERP approval remain separate. Read mirrors stay read-only; local archive does not silently delete an ERP order.                         |

## Credentials and repeat deployment

Pair each Kingdee integration instance with its own SQL connection string in the native credential
fields. Use the approved network endpoint and the database and login for the on-premises account set.
Bolt tests the account-set bindings before displaying Connected. For parties, contacts, products,
warehouses, stock and settlement methods it checks the required tables and markers, then executes the
sync projection with `TOP 0`. SQL Server validates the columns and SELECT permissions without returning business rows.
Unpaired, paused and failed-test
instances do not run source reads or deliver queued changes. Administrators see the ledger state in
Settings → Integrations → Connections. Use Test connection on previously paired
instances to run the stronger check. The order, finance and source-write probes have their own
acceptance criteria.
Bolt seals credentials on the host. Use a read login with `db_datareader` or explicit SELECT
on the mapped tables, and a separate writer with only the object and column grants its enabled
operations need. Choose account names for the adopting organization. Never `db_datawriter`
or `db_owner`; the read login's inability to write is a load-bearing control, not a convenience.
Initial creation inserts the SO or PO and its lines and updates the allocator. SO amendments also need
DELETE on SO lines to remove an unfulfilled, unlinked entry and SELECT and INSERT on the change log; a PO
line change needs DELETE and INSERT on PO lines.
Use a separate restricted login for fixture and deployment testing.

The local Docker SQL Server 2017 probe creates a fresh `db_datareader` login and proves it can
SELECT the mapped tables but cannot UPDATE or INSERT them or create a table. The same fixture pairs
the integration as read-only and exercises the writer through its own restricted login. The
throughput probe runs the same reads through a loopback shaper at 5 Mbps per direction and 150 ms
round-trip delay; the measured product run moved 152,081 bytes to SQL and 370,053 bytes back across
five pooled connections, including setup, 1,002 products, reconciliation and retry. The connector
account adds no requests or bytes to that shape. The deployment’s bandwidth, loss and TLS handshake require separate measurement.

Each instance has its own credentials, configuration, model scope, bookmark and outbox. A new
counterpart uses the same template deployment and another configured instance and SQL endpoint.
The template adds no objects, CDC jobs, progress tables or scripts to Kingdee.

Read settings:

- `baseCurrency`: verified account-set base currency; the default is CNY for the reference ledger.
- `branchNo`: source branch; the reference value is `0`.
- `maxWindowMinutes`: unfinished-window age alert, default 15.

Connected ledgers start read-only. To authorize order writes, obtain the database and recovery
fork identity directly from the verified account set and enter the result in **Verified SQL account
for order writes**. Run **Test connection** after saving it.

```sql
SELECT CONCAT(database_guid, '/', recovery_fork_guid)
FROM sys.database_recovery_status WHERE database_id = DB_ID();
```

For invoice-only Sales Analysis, enter the same form of identity in **Verified SQL account for
invoice-only sales analysis** on one ledger per account set. Enable sync and run **Test
connection**. This enables an account-wide read because `ICSale` has no branch column. Use it only on a ledger whose Finance and Commercial Manager roles may see the account's
invoice-only activity. A blank value stops that feed and retains the cached report facts.

Purchase orders are orders. Set **Verified SQL account for purchase documents** on one ledger per account
set and test the connection: the `kingdee` syncs on `orders`, `order_lines`, `transactions` and
`source_payments` then treat a PO (`POOrder`, 71) as they treat an SO, in the same rowversion windows, with
receipts (`ICStockBill` 1) as its deliveries, purchase invoices (`ICPurchase`) as its invoices and AP
payments (`t_RP_Contact` FRP 0 type 4) as its receipts. Until then a confirmed PO stays local; like a sales
order, it is written only while **Verified SQL account for order writes** is also set. For lot
analysis, two more syncs read receipt lines
(with lot, warehouse and the order each received) and purchase invoice lines (with the receipt each bills
and the invoice's payable and its last `t_RP_NewCheckInfo` settlement) into `source_purchase_lines`, each
by its header rowversion; a payment moves the payable's own rowversion, so its invoice is read again. Amounts keep their currency's
minor units and quantities three decimals. A blank value stops the feeds and keeps what was read.

For account-wide Aging, set **Verified SQL account for receivables aging** and test the enabled
connection. Use one ledger per account set and set its verified base currency. Apply **Verified
legacy AR contact exclusions** only to entries approved by that account's finance team.
Exclusion identifiers belong to the selected account set; start with an empty list and configure
only the entries that its finance team has verified. Finance and Commercial Managers can read
the account snapshot. Sales and Procurement keep their existing order scope.

Newly confirmed orders retain the configured account and branch (`write_target`).
An order first confirmed without a write account stays local. Staff can change and approve its terms
with sync off. Adding an account later does not export the order. A write
authorized for a different account or branch cannot run against the new destination. Clear the field to stop outbound writes. Review old or unpinned queued
orders individually before enabling writes. Both the lookup and the final SQL transaction check
the destination identity before reading commercial bindings or mutating anything. A restored
database or changed recovery fork requires review.

Writes additionally require `billerId`, `salespersonBindings` (owner ID to employee/department IDs),
`currencyBindings` (ISO currency to source ID and base flag) and `settlementRules` (source settlement
number to credit days/month-end rule). An order's payment terms name a `settlements` row and the writer
sends its code. `packagingId` is optional. IDs and business rules must be
verified for each account set; there are no guessed exchange, employee or payment-term mappings.
`fromMonthEnd: true` selects the configured month-end rule: zero days means current month-end, and any
positive term means next month-end (including both 30 and 60). It does not add days to month-end.
A counterpart using a different rule needs its own verified rule binding.

## Reads without CDC

Parties, products and warehouses use the native `FModifyTime` markers on their actual master and
joined detail rows. The effective marker is the greatest dependency marker. SQL's type metadata
must confirm each declared marker is a native eight-byte rowversion, including a marker exposed
through a view. `FNumber` is a display number; stable master identities use `FItemID`.

Contacts follow the same markers on `t_Item`, `t_Organization` and `t_Supplier`. The one contact on a
customer or supplier master (`FContact` → name, `FMobilePhone`, else `FPhone` → phone, `FEmail` → email) is
its party's primary contact; a blank `FContact` removes it. Settlement methods mirror `t_Settle`
(`FItemID` → `external_code`, `FNumber` → `code`, `FName` → `name`, `FDeleted` → inactive). The table has no
marker: one request first fingerprints it, and the feed lists it only when that moved. A Kingdee order whose
settlement code is not mirrored yet waits for it.

Each window captures `U = MIN_ACTIVE_ROWVERSION()` before fetching data and selects
`bookmark <= effective_marker < U`. The ceiling remains fixed across keyset pages. The engine
commits each page and its continuation together; only completion advances the saved bookmark to U.
An in-flight transaction cannot be skipped by advancing past its uncommitted marker. Failed reads,
invalid rows or failed model writes leave the last committed page position unchanged.

One SQL request returns the account identity and ceiling. Hourly, and on a feed's first poll, the same
request also returns the declared marker columns' metadata, which the cursor fingerprints; in between the
cursor keeps the fingerprint it last verified, and an account or fork that changed is still refused at once.
If a versioned feed has no unfinished window, no full listing is due, and its ceiling equals its bookmark,
the worker stops before querying business rows. A changed page needs the checkpoint and data requests. [SQL Server rowversion boundary](https://learn.microsoft.com/en-us/sql/t-sql/functions/min-active-rowversion-transact-sql)

This copies current state. It does not retain every intermediate edit as a transaction log would.
A master feed lists its tables once, when it begins; after that only rows whose marker moved are
read, and no periodic listing runs (the link is metered). A joined row's own marker is part of the
effective marker, so a joined edit is not missed. Kingdee's audited records are deleted softly and
arrive as moved rows; a row removed outright stays as last read. Master records and local product
settings remain.

The SQL Server 2017 concurrency probe uses read-committed snapshot isolation in its disposable
account set so a poll can complete while an update is open. On an account set using locking read
committed, a read can wait for the source writer. Include that account set’s isolation setting
and lock behavior in deployment acceptance. [SQL Server locking and row versioning](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide?view=sql-server-2017)

Stock is an aggregate complete read of ICInventory by item, warehouse and batch, of rows with a non-zero
quantity: a spent lot leaves the listing. A product the listing leaves out has no stock as of that listing,
so Available shows its shortfall. Unknown cost,
commitments and source position remain null. Unknown product prices, tax and units are not
invented; order entry requires the missing commercial values before confirming.

Owned orders are anchored by the `SEOrder.FUUID` derived from the order and its `source_order_key`. Archive
families are verified within the account set and branch; bill number alone is never ownership.
Lines are fetched by captured `FInterID`, and complete owned-order reads also observe
changes that do not bump the header. Delivery and invoice lineage follows the physical source
order/entry references. Missing source orders or archives raise attention while local proofs
remain intact. Missing downstream documents may be marked void only after a complete, verified
listing; they remain retained locally.
No document links or PDFs are fabricated from SQL rows. Unapproved new DOs/invoices wait for
approval; unauditing already retained evidence fails visibly instead of silently withdrawing it.
Discovery returns only distinct document IDs. The reader then verifies headers and loads the
complete lines of issued documents. A header missing after discovery fails that observation.
An invoice may merge multiple deliveries of the same order line/lot; its local items aggregate
quantity and net amount while financial facts retain exact upstream lineage.

Financial reads discover distinct settlement IDs before loading the complete allocations, use verified invoice-to-receipt settlement links, read only the invoice side of each link (KIS stores every link twice, invoice→receipt and its mirror), and preserve missing facts as
inactive. Ambiguous allocations, unsupported reversals and unverified currency interpretations
fail visibly. A remaining balance of zero is never treated as proof of payment.
Owned feeds obtain account identity and source time in one request and finish on the last data page.
The committed cursor retains the database, recovery fork and branch after completion, so a later
poll against a different destination stops before reading document or order details.

Invoice-only Sales Analysis has a separate bookmark on the native `ICSale.FOperDate` header
rowversion. It copies issued sales-invoice and accrual lines from January 2025 with verified
standalone or invoice-source codes. The local row key uses `ICSaleEntry.FDetailID`. The same
row keeps its identity when the source audit or data changes. KIS saves an invoice whole, so a line
change moves its header; no periodic reconciliation runs. Dates come from the
invoice. A later red line retains its signed values in its own month. Rows without a shipment
remain report facts with no local order, lot cost, booked freight or commission basis.
Displayed amounts use the invoice denomination. Verify base-currency reconciliation and the
linked portion of mixed-source invoices against the connected account set.

For Delivery date, opt in to `deliveryCostAccount` with the verified database and recovery-fork
identity and the account-set base currency. The connection test validates the projection with
an empty ID set. The linked sales-analysis feed reads `ICStockBillEntry.FAmount` on the same
bounded page as each issued delivery line. Switching the account on, or to another account, reads every
owned order's documents once more, as the feed's first read did, so deliveries already read gain their cost. It stores the precise amount and its currency once
on the shipment fact. An invoice fact carries the same amount prorated to its billed quantity, so
Invoice date shows the cost in the invoice's month without counting the delivery twice. A source
null stays unknown. Sales Analysis and its CSV present delivery cost in that currency. Margin
is in the cost's currency: a sale in another currency converts its booked net at the exchange rate on
its Kingdee order, and stays unknown without one. It also needs billed net and any freight that the
order's freight treatment deducts. Finance
and Commercial Managers read booked cost through Bolt's full output. The scoped Sales and
Procurement output excludes the booked amount and denomination. The delivery document, receipts
and quote floor use their existing fields.

Account-wide Aging uses `t_RP_Contact.FRemainAmount` in the verified base currency. It keeps the
AR contact ID, customer and business date, and for an invoice its settlement method (`t_Settle`)
and first delivery date, which the entries view shows. It restores past balances by adding signed
`t_RP_NewCheckInfo` movements dated after the selected cutoff. Cutoffs start on 31 December 2024. Open and recently settled invoice and receipt positions include opening invoices, credit
notes and unapplied cash. For the due date, the reader chooses the earliest open plan date,
then the last plan date, then the AR contact date.

The first read, and one after the account, base currency or exclusions change, lists the kept ledger
whole in bounded pages and publishes it only if a second checkpoint matches the first. After that the
ledger is kept current an open item at a time. Each hourly run asks one checkpoint: the rowversion
ceiling, the guards, and for 64 buckets of open items (by id) their count, id and due-date sums and
remaining balance, and the count, date sum and amount of their dated settlements, all computed in SQL.
Then:

- open items whose own row, invoice (`ICSale.FOperDate`), customer (`t_Organization.FModifyTime`) or a
  delivery the invoice bills (`ICStockBill.FOperDate`) moved since the bookmark are read by id and merged;
  one that no longer counts (paid before 2025, deleted) leaves the report;
- a bucket whose sums still disagree with the merged entries is read again whole: this catches what moves
  no rowversion, such as an edited due plan, a settlement's date or an open item deleted outright;
- when nothing moved and every bucket agrees, the run reads and writes nothing.

More than 5,000 moved items in one hour read the ledger whole instead. An undated settlement, an
unclassified balance or a failed account pin retains the previous snapshot. The atomic publish limit is
5 MiB. A renamed settlement method shows on an invoice when that invoice next moves.

Aging uses the local account snapshot for enabled ledgers once it has been published. Linked
transaction and payment rows remain the evidence on their orders. Other ledgers and order-scoped
users use the linked calculation. For an account snapshot, the report can show the original
open-invoice buckets or estimate allocation using unapplied cash and credits. The estimate
allocates to the oldest due invoice first, puts invoices with no due date last and breaks ties
by numeric Kingdee contact ID. An invoice with no due date ages as not due. Both views show the
actual signed net receivable (owed, or in credit), and the estimate leaves invoice and payment facts intact.

### Stock availability

The Stock tab's awaiting and available columns use the local lot balances and a read-only open-order
snapshot, per product and warehouse, shown on each lot. It sums
Kingdee base-unit quantity less shipped quantity for live, non-cancelled, open sales lines. Saved
orders count before Kingdee audit. The report subtracts each source commitment once. Local orders
waiting for delivery to Kingdee become part of availability after the source sees them.

Set `stockAvailabilityAccount` to the verified database and recovery-fork identity on one ledger
per account set. The connection test checks the open-order projection and account without loading
business rows. The five-minute reader groups source lines by branch, order and item before transfer.
SQL Server hashes that exact result and sends the groups only when the result or local warehouse
attribution changes. Each transfer is bounded to 10,000 groups and 1 MB of source JSON. The local
snapshot stores product and warehouse quantities without customer, order or price details. A failed
poll keeps the previous snapshot.

Each lot shows its product's figures for its warehouse. A product with an open order that names no
warehouse leaves Available blank, as do a feed failing for longer than **Max age of stock data** (Data
freshness on the Kingdee connection, default 30 minutes), a paused or unverified ledger, a missing feed and
disagreeing units. The two feeds publish on
their own schedules. They provide an inventory estimate for planning and can differ while Kingdee
posts a shipment and the next reads catch up. Brand aggregation still needs a verified product binding.

### FIFO purchase cost guidance

`stockLotCostAccount` opts one verified ledger per account set into a read of audited, non-cancelled
purchase receipts. The query groups `ICStockBillEntry` type 1 receipts by item and batch and limits
the payload to lots that have positive on-hand rows. Each costed batch needs a positive received
quantity and amount, a valid business date and one purchase unit price across its receipts. A red
receipt or mixed purchase prices leave that batch unpriced. The first purchase receipt supplies the
batch date. The source sends the complete bounded result only when its fingerprint changes.

Quote guidance combines matching SKU lines before picking batches from the selected warehouse.
A positive price-floor tier estimates the quantity across the chosen warehouse group. Both consume
the oldest batch date first, with batch number as a deterministic same-date tie-breaker. Missing or
stale evidence, insufficient physical stock, unit mismatch and incompatible currency withhold the
estimate. Configuration, Finance and Commercial Managers can read the purchase basis. Sales still
uses published floors. The calculation remains advisory and leaves stock, approvals and agreement
documents independent of the estimate.

This is a purchase-cost estimate from on-hand batches. An outbound booked amount can differ
from receipt price. The booked delivery cost remains the realized source
amount. Kingdee's transfer chronology, valuation layers and eligible warehouse scope still need a
restored account-set tie-out before treating the estimate as a statement of source FIFO valuation.

### Link budget and geographic latency

For example, 5–7 Mbps gives a raw ceiling of about 0.625–0.875 MB/s in the applicable direction. Incremental
reads are a reasonable fit when measured change volume and competing traffic leave headroom.
Sequential SQL requests and TLS setup add round trips even with small responses. Measure the
actual path’s p95 latency and loss alongside payload bytes and reconciliation duration.

The Docker product probe passed through a loopback TCP shaper at 5 Mbps per direction with
150 ms added round-trip delay. Its complete run moved about 0.52 MB across both directions and
took about 21 seconds, including fixture setup, page failure, replay and reconciliation. It used
five pooled test connections. The route itself, production connection overhead, loss, bulk stock
and order/finance volume are separate deployment measurements. The stock feed still reads a full
lot aggregate. The order and finance feeds still read verified families and their linked evidence.
The 20–50 Mbps SQL Server 2017 lab also converged after interrupted reads and a lost write
acknowledgement. Discovery now joins each document's header in SQL, and payment discovery reads
the full settlement in the same request. The small linked inbound fixture dropped from 40 to 33
requests. The SQL still reads all lines, including unrelated lines on a matched document, so a
mixed document cannot look complete. Parent lookups deduplicate IDs before committing a replay page.
See [the WAN probes](0008-manual-probe-matrix.md#kingdee-wan-probe).

Use the network provider’s traffic metrics to validate the actual connection budget.

## Writes

The order is the stable container for customer, ownership, remarks, Kingdee linkage and filing.
Archive / Unarchive is reversible and local. It does not void the source SO, release stock,
remove financial facts or stop incoming synchronization. There is one Remarks field; archiving
does not require a separate reason.

The order and its lines hold the terms; there are no contract versions. Native record history is
the audit trail. A confirmed sales order is the two-way shadow of its Kingdee SO: the `orders`
`kingdee` sync mirrors the SO header (`kingdee`: FInterID, bill number, version, audit/void and
closed state, exchange rate; and currency, settlement and date), and the `order_lines` `kingdee`
sync mirrors its entries (quantity, price, tax and amounts, bound by `source_entry_id`). Each read
row carries a content hash as its `$version`; an unchanged SO is skipped. A write acknowledges only
the SO identity (`$id`), so the next read brings back what Kingdee holds (identity, version, audit
state, entry ids) as the same values, never as a change that bounces back. A Kingdee change applies
to the order directly; a local saved change writes the SO.

The lines are ours and the header is Kingdee's. A line whose own write is still pending
(`$sync.kingdee`) keeps its local terms through every read, including a Kingdee edit of the same
entry; the write then amends the SO to the local terms, and Kingdee's `ICOrderAlter` keeps the
value it replaced. A write Kingdee refused for good (`failed`: the SO is void or closed, or the
quantity is below what shipped) ends there: the next read returns the line to the SO's terms and
removes a line the SO never took. A customer or salesperson changed on the SO moves the order to
that customer and to the one user bound to that employee. An SO removed outright from Kingdee's SQL is not recreated by a later write. A synced order refuses a local change to Kingdee's header (customer,
currency, date, owner, settlement; `errors.kingdee_header`); Kingdee's header changes arrive by
read, and a line write that meets a header the read has not brought in yet waits for it.

A write reads the live SO first. With no SO, it creates one; with an SO whose lines differ, it
amends them against the lines just read. The SO must be audited and open before its lines change;
until then the write waits and retries. Several local changes before the write runs are sent as one
amendment of the latest terms, and each line's write sends the whole order, so an amendment lands
whole or not at all. A failed or unreachable Kingdee leaves the writes queued (the order and lines
show `pending`) and retries them; a lost receipt is retried against the FUUID and the amendment's
own version check, never a second SO or a second version.

A purchase order follows the same path with Kingdee's PO rule: a PO's lines change only while it is
unaudited and open, so a line change after audit is refused (unaudit the PO in Kingdee first) and a line
change before audit replaces the PO's entries, provided they are still the entries last read. A PO keeps
one live row; it has no amendment versions.

A synced sales order creates an **unapproved** SEOrder and its SEOrderEntry rows; a purchase order an
unapproved POOrder and its POOrderEntry rows. Each line's delivery date (`SEOrderEntry.FDate` and
`FAdviceConsignDate`; `POOrderEntry.FDate`) is the last day of the order's shipment window, or its order date
without one; it is sent with the order and with every later line change.
One serializable SQL batch takes a transaction-owned application lock, allocates the numeric
FInterID through ICMaxNum, and writes the complete header/line set. Existing FUUID provenance
makes retry identity independent of the nonunique bill number. A retry verifies the written
source header, line cardinality and financial values before acknowledging the existing order.
A lost response therefore retries the same order rather than creating a duplicate.

Amendments use the existing Kingdee SO lineage. The source batch verifies the expected current
version and lines under lock, preserves the previous source header/lines as an amendment archive,
increments FVersionNo and updates the permitted live lines. Unsupported header changes and
quantities below existing fulfillment are refused before committing. A newer source version than
the one just read is a conflict, never permission to overwrite a direct Kingdee edit. Each
amendment records a change cause naming the order and its target lines, so a replay after a lost
response recognises its own amendment.

Deliveries and invoices attach to the order whose SO they reference and to the order line bound to
their SO entry. Source change timestamps are retained as the source's raw local value; observation
timestamps are UTC instants. The connector does not invent a timezone or historical approval time.

A failed delivery preserves the local order and its lines. Bolt keeps the queued payload and
idempotency key across a temporary SQL failure and retries roughly every minute while the
verified connection is active. Inbound SQL reads retry on their usual schedule after a temporary
failure. Restoring the network is sufficient for these failures. A refused SQL write rolls the
local change back and names the reason on the record. Use **Replay dead letters** in Settings →
Integrations → Kingdee → Sync after fixing a source prerequisite, or **Retire write** for a write
that should not run. Retiring retains its original payload, error, operator and retirement time,
marks it skipped and releases later writes. It neither cancels an in-flight SQL request nor undoes
an accepted remote write.

Bolt persists each inbound cursor in the workspace database. It commits the page, identity map and
cursor in one transaction. The sales transaction feed records a fingerprint after a consistent
sweep and skips reapplying an unchanged listing when the rows are still present locally. A changed
listing during a paginated sweep forces another complete check. The feed keeps reading the scoped
Kingdee tables because these documents have no single verified change marker across their joins.

If a document poll runs before the order's SO read catches up, it reports `parentPending`
and preserves the cursor and existing evidence. The next poll resumes after that counterpart is
issued; it does not attempt an invalid document upsert or reconcile rows as absent while waiting.

The reader observes subsequent Kingdee approval; the template does not call a fictional approval
procedure. Unsupported source documents and credit settings fail explicitly. They must not fall back
to normalized simulation tables or fabricate empty successful results.

## Before connecting a customer account set

The simulator and the SQL Server 2017 probes follow what SalesBridge measured on the customer's account set.
These facts were not measured; read each on the target account set (read login) before enabling the feed or
write that depends on it.

| Check                          | Query or step                                                                                                                                                                                                        | Why                                                                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine and level               | `SELECT @@VERSION, compatibility_level FROM sys.databases WHERE name = DB_NAME()`                                                                                                                                    | SalesBridge measured SQL Server 2008 R2 at level 80. On 2008 R2 `FOR JSON`, `HASHBYTES` over 8,000 bytes and `TOP (@n)` fail, so every read and the credit, AR and snapshot feeds stop.                          |
| `SEOrder` defaults and `FUUID` | `sys.columns` (nullability, default) for `FVersionNo`, `FUUID`, `FChangeMark`, `FCancellation`, `FClosed`, `FStatus`; `SELECT COUNT(*) FROM dbo.SEOrder WHERE FUUID IS NULL`                                         | The writer sends `FVersionNo='000'`. A header without `FUUID` is neither an owned nor an importable order and is skipped.                                                                                        |
| `ICOrderAlter` widths          | `sys.columns` for `ICOrderAlter`                                                                                                                                                                                     | The change cause is cut to `FChangeCauses` keeping its tag; a column under 19 characters refuses amendments.                                                                                                     |
| Purchase columns               | `sys.columns` for `POOrder`, `POOrderEntry`, `ICPurchase`, `ICPurchaseEntry`: `FUUID`, `FDeptID`, `FBillerID`, `FSettleID`, `FSettleDate`, `FCESS` or `FTaxRate`, `FTaxAmt` or `FTaxAmount`, `FAuxTaxPrice`, `FBrNO` | Only row counts were measured. On SO lines KIS keeps the rate in `FCESS`; if a PO does too, the PO price map in `bills.ts` changes. Rehearse one PO through audit and 下推 外购入库 on a test account set first. |
| Audited PO changes             | Make one 订单变更 on an audited PO in a test account set; read its `POOrder` rows and `ICOrderAlter`                                                                                                                 | KIS logged 303 PO line changes, so audited POs change; the archive shape is unknown. Until it is measured an audited PO refuses a local change.                                                                  |
| Settlement placement           | `SELECT k.FType, ce.FType, ce.FType_SRC, COUNT(*) FROM dbo.t_rp_CheckEntry ce JOIN dbo.t_RP_NewCheckInfo k ON k.FInterID=ce.FInterID GROUP BY k.FType, ce.FType, ce.FType_SRC`                                       | The payment feed reads the invoice side of each link under an `FType` 3 header naming the invoice's open item; another placement holds receipts for review.                                                      |
| Order-line units               | `SELECT e.FUnitID, d.FUnitID AS base_unit, COUNT(*) FROM dbo.SEOrderEntry e JOIN dbo.t_ICItem d ON d.FItemID=e.FItemID GROUP BY e.FUnitID, d.FUnitID`                                                                | Lines read `FQty` in the base unit. A Kingdee line entered in a pack unit (25kg/包) would carry the pack's name and price beside a base quantity.                                                                |
| Credit control                 | `SELECT FCreditControl, FMainAmtCustom, FRangeCustom FROM dbo.ICCreditOption`; `SELECT COUNT(*) FROM dbo.ICCreditObject`                                                                                             | SalesBridge found credit control off and no limits in production; the credit feed then reports itself unavailable.                                                                                               |
| Rowversion indexes             | `sys.indexes` on `SEOrder.FOperDate`, `ICStockBill.FOperDate`, `ICSale.FOperDate`, `t_RP_Contact.FModifyTime`                                                                                                        | Without them each window scans its table on the server. It costs ERP CPU, not link bytes; adding an index is the customer's decision.                                                                            |
| Supplier contact columns       | `sys.columns` for `t_Supplier`: `FContact`, `FMobilePhone`, `FPhone`, `FEmail`                                                                                                                                       | Standard KIS, not yet measured on the customer's account set. The contacts feed reads them and Test connection probes them, so a missing column fails the test.                                                  |
| Collation                      | `SELECT DATABASEPROPERTYEX(DB_NAME(), 'Collation')`                                                                                                                                                                  | Measured `Chinese_PRC_CI_AS`; some text columns are `varchar` in GBK. The simulator uses the server default and `nvarchar`.                                                                                      |

## Local validation boundary

Focused template tests cover SQL calls, mappings, fixed rowversion windows, continuation validation,
verified submissions, source lineage and financial ambiguity guards.

### Disposable Docker probe for SQL Server 2017

Run the [2017 Developer image](https://learn.microsoft.com/en-us/sql/linux/quickstart-install-connect-docker?view=sql-server-linux-2017)
with a locally chosen strong `MSSQL_SA_PASSWORD`, `ACCEPT_EULA=Y`, and a loopback-only port.
Microsoft supports Linux x86-64. On Apple Silicon, the observed local run used a separate
Rosetta-enabled Colima Docker profile.

```sh
docker run --platform linux/amd64 --name trade-kingdee-2017 -d \
  -p 127.0.0.1:11434:1433 -e ACCEPT_EULA=Y -e MSSQL_PID=Developer \
  -e MSSQL_SA_PASSWORD mcr.microsoft.com/mssql/server:2017-latest
docker exec -i trade-kingdee-2017 sh -c \
  'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" /opt/mssql-tools/bin/sqlcmd -b -S localhost -U sa' \
  < tests/fixtures/kingdee-2017.sql
```

The fixture creates `TradeOperationsProbe` at compatibility level 140, with CDC disabled. Create a
separate probe login mapped to this database with `SELECT ON SCHEMA::dbo`. Use the disposable
host's loopback-only SQL transport for the local self-signed server. Keep normal TLS verification and
public destination checks on the deployed host. Pair in Settings → Integrations → Connections → Kingdee using the test login,
then run probes K1–K4 from the [manual probe matrix](0008-manual-probe-matrix.md).
For K4, set `TRADE_SQL2017_PROBE_PASSWORD` to the disposable container’s SQL administrator
password and run `bunx --no-install bolt test . tests/kingdee-live-polling.test.ts` from the
template directory. The probes use loopback port 11434 and create and remove isolated fixture
databases. The product probe checks the held-transaction boundary, failed continuation, replay
and full reconciliation. The order probe runs the Bolt outbox and read projections against the
same SQL Server 2017 SO before and after amendment. It verifies original delivery, invoice and
receipt links, cross-month sales net and aging before and after a receipt. An unaudit refuses the
incomplete source read and retains the prior evidence until the audit is restored.
Set `TRADE_SQL2017_PROBE_PORT` to the local shaper’s listening port for a repeat of K12.
The base fixture covers masters and on-hand stock. Extend this disposable database for the SO probe
and run the template's direct SQL requests against it.

```sh
docker exec -i trade-kingdee-2017 sh -c \
  'SQLCMDPASSWORD="$MSSQL_SA_PASSWORD" /opt/mssql-tools/bin/sqlcmd -b -S localhost -U sa' \
  < tests/fixtures/kingdee-2017-orders.sql
bun tests/fixtures/probe-kingdee-orders.ts
```

Run the probe with the Docker instance's `MSSQL_SA_PASSWORD` in the environment. It uses `sa` to
inspect the disposable database and seed an audit. The template's requests execute with the
permissions of the synthetic `trade_order_probe` database user. On SQL Server 2017 CU31 GDR,
the probe verified one initial SO after a lost reply and parallel retries, a refusal on a
foreign bill number or mismatching frozen line, direct read-back of the source family, and
one in-place amendment plus one archive and change log after a second lost reply. It also
verified that an unaudited SO refuses a new amendment. The physical probe calls the template
requests through a local TDS adapter. The application outbox and deployment network route have separate
acceptance checks. The joined Bolt probe covers the delivery, invoice and receipt projections on the same SQL Server 2017 fixture. Native Kingdee audit still requires a restored account set with desktop access.
The probe also substituted a different write destination between lookup and submission. SQL
rejected it before either the allocator or the order changed.

Under the earlier versioned-contract model, the 27 October 2026 standalone acceptance run used a restricted login with neither `sysadmin`
nor `db_owner`. Application credential pairing, initial SO creation and a same-SO amendment were
exercised against SQL Server 2019 with CDC disabled:

| Local contract | Kingdee version | Quantity × net price | Gross CNY | Result                                                                        |
| -------------- | --------------- | -------------------- | --------- | ----------------------------------------------------------------------------- |
| v1             | `000`           | 10 × 2               | 22.60     | Application-created SO; later retained as SQL archive.                        |
| v2             | `001`           | 12 × 3               | 40.68     | Formal source amendment imported as a new immutable contract.                 |
| v3             | `002`           | 14 × 4               | 63.28     | Application amendment updated the same live SO and retained v2's SQL archive. |

The live `FInterID` remained `9002`; archive rows `9003` and `9004` retained the earlier terms,
and `ICOrderAlter` retained the amendment log. The original delivery and CNY 4.52 invoice kept
their original local IDs and v1 seal. Direct edits to sealed terms and lines were refused, while
operational Remarks remained editable. A later Kingdee closure reached v3's tracker while the
order was archived. Unarchiving retained all three versions and still refused sealed-term edits.
These are synthetic fixture results, not validation of a
customer's Kingdee customization or the configured network path.

Next: [Kingdee order lifecycle](0005-kingdee-order-lifecycle.md)
