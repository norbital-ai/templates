# Kingdee SQL integration

Kingdee-specific bindings belong to this template. `+integration.ts` declares the SQL Server
driver, sealed credentials, account-set configuration and connection test. Bolt owns the shared
SQL Server pairing gate, the read scheduler and the outbox. The template issues
fixed SQL through the driver's existing `call` operation and SQL Server's built-in
`sys.sp_executesql`; business data is bound as parameters. Settings never accept SQL text.
Trade Operations opens its own TDS session to the on-premises Kingdee SQL Server account set
over the Alibaba link. Bolt schedules and executes SQL reads and authorized writes in that session.
The Alibaba path carries TCP traffic. The SalesBridge Windows service, API, files and work queues
are historical references. Deployment uses the SQL endpoint provided by the network operator.
Operators create orders, approve terms, revise agreements and manage tasks in Trade Operations.
The order form, approvals, documents and reports use the Trade Operations database. The link
carries background replication of mapped table rows, including incoming fulfillment and
accounting evidence. A work action completes against the local database, and an outbound write
is a separate job. Staff can keep revising and approving orders while the link is unavailable.
The outbox retains pending source writes for retry. The verified source writer creates a saved
SO. Replicating the locally approved state as an audited SO still requires native Kingdee
validation on a restored account set.

```text
Kingdee SQL Server 2017  <-- TDS over the Alibaba network path -->  Trade Operations runtime
      SELECT current rows and rowversions  ----------------------->  ledger and sync state
      initial SO and guarded amendments    <-----------------------  sealed agreement outbox
```

Colony currently uses Bolt’s public-destination TCP guard for database integrations. It rejects a
private IP literal or a DNS name with any private address before opening a socket. Alibaba routing
alone does not change that check. A deployment using the guard can reach a restricted TCP endpoint
with a permitted address that forwards to the Kingdee host over Alibaba. An endpoint that resolves
only to private addresses requires a host-level policy for that destination. The network operator
must verify the chosen endpoint from the deployed runtime. Bolt verifies the SQL TLS endpoint’s
name and certificate. The local Docker probe uses a loopback adapter and does not verify either
the Alibaba path or the deployed TLS handshake.

## What moves between the systems

The SalesBridge reference is source revision `60e5d253`. Its README describes the earlier
Kingdee gateway API route. The later EPG runbook and shipped Windows writer also implement
direct SQL on the local network; the reader and writer use separate credentials.

| Direction | SalesBridge | Trade Operations |
| --- | --- | --- |
| Kingdee → app | An on-premises read-only job queries KIS and posts results to SalesBridge over HTTPS. It publishes master changes, order audit/status, sales-order history, shipment and return evidence, stock by warehouse and lot, open commitments and enabled finance feeds. Receivables aging and sales analysis are published as completed snapshots. | Bolt connects to SQL Server through the private route and reads masters, stock and commitments, its owned SO lineage, deliveries, invoices, returns and attributable receipts. Verified optional account bindings enable inventory cost, booked delivery cost, invoice-only facts and receivables. Reports and user actions read the local copy. |
| App → Kingdee | The SQL writer leases approved work from SalesBridge, inserts the SO header and lines as unapproved, and reports the Kingdee ID or a refusal. Optional guarded write lanes apply approved amendments and void/close requests. Customer returns gate initial export of orders classified as sales contracts; the company chop is supplier artwork. | A locally sealed sales agreement queues an idempotent SO write. It creates an unapproved SO and stores the source ID. Supported amendments keep that live ID and archive the previous source version. The application keeps its own approved revision and holds conflicts for review. |
| Boundaries | The original SQL reader never writes. Third-document export is listed as blocked in the README; it is not evidence of a native DO or invoice write. | No SalesBridge Windows process or gateway is used. Trade Operations does not create Kingdee DOs or invoices, silently adopt a Kingdee-first order, or remotely delete an SO when it is archived locally. Native Kingdee audit remains distinct from local approval. |

Source: SalesBridge `scripts/epg-connector.ts`, `scripts/epg-so-write.ts`,
`docs/reference/epg-connector-runbook.md` and `lib/services/export.ts`.

## Credentials and repeat deployment

Pair each Kingdee integration instance with its own SQL connection string in the native credential
fields. Use the approved network endpoint and the database and login for the on-premises account set.
Bolt tests the account-set bindings before displaying Connected. For parties, products, warehouses
and stock it checks the required tables and markers, then executes the sync projection with
`TOP 0`. SQL Server validates the columns and SELECT permissions without returning business rows.
Unpaired, paused and failed-test
instances do not run source reads or deliver queued changes. Administrators see the ledger state in
Settings → Integrations → Connections. Use Test connection on previously paired
instances to run the stronger check. The order, finance and source-write probes have their own
acceptance criteria.
Bolt seals the credentials on the host. The SalesBridge connector used `salesbridge_ro`, a
`db_datareader` login that is never `sa` and cannot write. Mirror that: a read login with
`db_datareader` or explicit SELECT on the mapped tables, and a separate `salesbridge_wr`-style
writer with only the object and column grants its enabled operations need. Never `db_datawriter`
or `db_owner`; the read login's inability to write is a load-bearing control, not a convenience.
Initial creation inserts the SO and lines and updates the allocator. Amendments also need DELETE on
SO lines to remove an unfulfilled, unlinked entry and SELECT and INSERT on the change log.
Use a separate restricted login for fixture and deployment testing.

The local Docker SQL Server 2017 probe creates a fresh `db_datareader` login and proves it can
SELECT the mapped tables but cannot UPDATE or INSERT them or create a table. The same fixture pairs
the integration as read-only and exercises the writer through its own restricted login. The
throughput probe runs the same reads through a loopback shaper at 5 Mbps per direction and 150 ms
round-trip delay; the measured product run moved 152,081 bytes to SQL and 370,053 bytes back across
five pooled connections, including setup, 1,002 products, reconciliation and retry. The connector
account adds no requests or bytes to that shape. The 5–7 Mbps Alibaba link and its real loss and
TLS handshake remain a deployment measurement.

Each instance has its own credentials, configuration, model scope, bookmark and outbox. A new China
counterpart uses the same template deployment and another configured instance and SQL endpoint.
The template adds no objects, CDC jobs, progress tables or scripts to Kingdee.

Read settings:

- `baseCurrency`: verified account-set base currency; the default is CNY for the reference ledger.
- `branchNo`: source branch; the reference value is `0`.
- `fullSnapshotMinutes`: master full-reconciliation interval, default 1440.
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

For account-wide Aging, set **Verified SQL account for receivables aging** and test the enabled
connection. Use one ledger per account set and set its verified base currency. Apply **Verified
legacy AR contact exclusions** only to entries approved by that account's finance team.
SalesBridge's four reference exclusions (604, 605, 21556 and 21557) belong to its original
account. Other account sets start with an empty list. Finance and Commercial Managers can read
the account snapshot. Sales and Procurement keep their existing order scope.

Newly confirmed sales orders retain the configured account and branch with their delivery evidence.
A sale first sealed without a write account stays local across revisions. Staff can revise and
approve its terms with sync off. Adding an account later does not export the order. A write
authorized for a different account or branch cannot run against the new destination. Clear the field to stop outbound writes. Review old or unpinned queued
orders individually before enabling writes. Both the lookup and the final SQL transaction check
the destination identity before reading commercial bindings or mutating anything. A restored
database or changed recovery fork requires review.

Writes additionally require `billerId`, `salespersonBindings` (owner ID to employee/department IDs),
`currencyBindings` (ISO currency to source ID and base flag) and `settlementRules` (source settlement
number to credit days/month-end rule). `packagingId` is optional. IDs and business rules must be
verified for each account set; there are no guessed exchange, employee or payment-term mappings.
`fromMonthEnd: true` selects the reference EPG rule: zero days means current month-end, and any
positive term means next month-end (including both 30 and 60). It does not add days to month-end.
A counterpart using a different rule needs its own verified rule binding.

## Reads without CDC

Parties, products and warehouses use the native `FModifyTime` markers on their actual master and
joined detail rows. The effective marker is the greatest dependency marker. SQL's type metadata
must confirm each declared marker is a native eight-byte rowversion, including a marker exposed
through a view. `FNumber` is a display number; stable master identities use `FItemID`.

Each window captures `U = MIN_ACTIVE_ROWVERSION()` before fetching data and selects
`bookmark <= effective_marker < U`. The ceiling remains fixed across keyset pages. The engine
commits each page and its continuation together; only completion advances the saved bookmark to U.
An in-flight transaction cannot be skipped by advancing past its uncommitted marker. Failed reads,
invalid rows or failed model writes leave the last committed page position unchanged.

One SQL request returns the account identity, checked marker metadata and ceiling. If a versioned
feed has no unfinished window, no full listing is due, and its ceiling equals its bookmark, the
worker stops before querying business rows. A changed page needs the checkpoint and data requests.
The combined request preserves the existing checkpoint fingerprint. [SQL Server rowversion boundary](https://learn.microsoft.com/en-us/sql/t-sql/functions/min-active-rowversion-transact-sql)

This copies current state. It does not retain every intermediate edit as a transaction log would.
Periodic complete master listings repair missed dependency changes. After a successful complete
listing, bounded checks of existing local identities deactivate rows that have disappeared; no
partial scan triggers absence reconciliation. Master records and local product settings remain.

The SQL Server 2017 concurrency probe uses read-committed snapshot isolation in its disposable
account set so a poll can complete while an update is open. On an account set using locking read
committed, a read can wait for the source writer. Include that account set’s isolation setting
and lock behavior in deployment acceptance. [SQL Server locking and row versioning](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-transaction-locking-and-row-versioning-guide?view=sql-server-2017)

Stock is an aggregate complete read of ICInventory by item, warehouse and batch. Unknown cost,
commitments and source position remain null. Unknown product prices, tax and units are not
invented; order entry requires the missing commercial values before sealing.

Owned orders are anchored by their original `SEOrder.FUUID` and retained source binding. Archive
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
An invoice may merge multiple deliveries of the same sealed line/lot; its local items aggregate
quantity and net amount while financial facts retain exact upstream lineage.

Financial reads discover distinct settlement IDs before loading the complete allocations, use verified invoice-to-receipt settlement links, and preserve missing facts as
inactive. Ambiguous allocations, unsupported reversals and unverified currency interpretations
fail visibly. A remaining balance of zero is never treated as proof of payment.
Owned feeds obtain account identity and source time in one request and finish on the last data page.
The committed cursor retains the database, recovery fork and branch after completion, so a later
poll against a different destination stops before reading document or order details.

Invoice-only Sales Analysis has a separate bookmark on the native `ICSale.FOperDate` header
rowversion. It copies issued sales-invoice and accrual lines from January 2025 with verified
standalone or invoice-source codes. The local row key uses `ICSaleEntry.FDetailID`. The same
row keeps its identity when the source audit or data changes. Periodic reconciliation handles
disappeared lines and line changes that do not advance the header marker. Dates come from the
invoice. A later red line retains its signed values in its own month. Rows without a shipment
remain report facts with no local order, lot cost, booked freight or commission basis.
The displayed amounts use the invoice denomination. SalesBridge's base-currency voucher
reconciliation and the linked portion of mixed-source invoices still need separate verification.

For Delivery date, opt in to `deliveryCostAccount` with the verified database and recovery-fork
identity and the account-set base currency. The connection test validates the projection with
an empty ID set. The linked sales-analysis feed reads `ICStockBillEntry.FAmount` on the same
bounded page as each issued delivery line. It stores the precise amount and its currency once
on the shipment fact. An invoice fact carries the same amount prorated to its billed quantity, so
Invoice date shows the cost in the invoice's month without counting the delivery twice. A source
null stays unknown. Sales Analysis and its CSV present delivery cost in that currency. Margin
requires compatible currency, billed net and any freight that the sealed terms deduct. Finance
and Commercial Managers read booked cost through Bolt's full output. The scoped Sales and
Procurement output excludes the booked amount and denomination. The delivery document, receipts
and quote floor use their existing fields.

Account-wide Aging uses `t_RP_Contact.FRemainAmount` in the verified base currency. It keeps the
AR contact ID, customer and business date, and restores past balances by adding signed
`t_RP_NewCheckInfo` movements dated after the selected cutoff. Cutoffs start on 31 December 2024. Open and recently settled invoice and receipt positions include opening invoices, credit
notes and unapplied cash. For the due date, the reader chooses the earliest open plan date,
then the last plan date, then the AR contact date.

The worker reads a compact ledger fingerprint first. An unchanged hourly check sends no
business rows. On a change, bounded pages carry one contact and its settlement days per row.
The worker checks the fingerprint again and publishes one complete local snapshot. A ledger
change mid-read, undated settlement, unclassified balance or failed account pin retains the
previous snapshot. The current atomic publish limit is 5 MiB. Changes confined to due plans
or display names are refreshed by periodic full reconciliation. Test volume and elapsed time
on the deployed route.

Aging uses the local account snapshot for enabled ledgers once it has been published. Linked
transaction and payment rows remain the evidence on their orders. Other ledgers and order-scoped
users use the linked calculation. For an account snapshot, the report can show the original
open-invoice buckets or estimate allocation using unapplied cash and credits. The estimate
allocates to the oldest due invoice first, puts invoices with no due date last and breaks ties
by numeric Kingdee contact ID. The separate no-due-date bucket remains visible. Both views show
the actual signed net receivable, and the estimate leaves invoice and payment facts intact.

### Stock availability

Stock → Availability uses the local lot balances and a read-only open-order snapshot. It sums
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

Product totals include open orders without a known warehouse. The warehouse view shows assigned
quantities and holds back availability for products with unattributed commitments. Both views show
the stock and order observation times and leave availability unknown after 30 minutes, when a feed
is missing or the units disagree. The physical lot list remains separate. The two feeds publish on
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

This is a purchase-cost estimate from on-hand batches. SalesBridge's finance study found outbound
`FAmount` can differ from receipt price. The booked delivery cost remains the realized source
amount. Kingdee's transfer chronology, valuation layers and eligible warehouse scope still need a
restored account-set tie-out before treating the estimate as a statement of source FIFO valuation.

### Link budget and geographic latency

5–7 Mbps gives a raw ceiling of about 0.625–0.875 MB/s in the applicable direction. Incremental
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

[Alibaba VPN traffic monitoring](https://www.alibabacloud.com/help/en/vpn/sub-product-ipsec-vpn/monitor-an-ipsec-vpn-connection)

## Writes

The order is the stable container for customer, ownership, remarks, Kingdee linkage and filing.
Archive / Unarchive is reversible and local. It does not void the source SO, release stock,
remove financial facts or stop incoming synchronization. There is one Remarks field; archiving
does not require a separate reason.

Each contract version retains its commercial snapshot, supporting files, published layout reference
and seal. The document is generated from that version on demand. Sealing freezes that version. Order title and operational remarks can change
without rewriting a sealed contract. A replacement draft copies the current terms into a new
editor and keeps the previous sealed version. Local approval makes the new revision current in
the order list, default PDF and commercial progress. The source SO has its own version and
status. Pending replication, a source conflict or a source closure leaves staff free to revise
and approve local terms. The worker waits for a verified source basis before changing the source
SO. A change confined to local terms, such as delivery instructions or print details, needs no
SQL amendment. Earlier versions remain available for their original documents.
An interrupted draft setup is resumable. Editing and approval become available once its lines
are fully copied. Copied lines retain explicit Kingdee entry identities when available.

If several local revisions accumulate before the worker takes the queued write, Bolt delivers
the latest approved terms. Earlier approvals remain sealed in Trade Operations. If the source
SO has yet to be created, the worker uses the original approval and its stable UUID to establish
the source identity before sending an amendment. A receipt for an earlier write can arrive after
another approval. The worker waits for that receipt's source evidence before building on it.
Closing or changing the SO independently in Kingdee leaves its evidence visible and prevents
an automatic overwrite. The upgrade restores the latest locally approved terms on orders that
earlier versions had switched to a Kingdee snapshot. The repair preserves the existing seals,
source links and queued jobs. An in-progress draft setup keeps its original copy basis.

An initial sealed sales agreement creates an **unapproved** SEOrder and its SEOrderEntry rows.
One serializable SQL batch takes a transaction-owned application lock, allocates the numeric
FInterID through ICMaxNum, and writes the complete header/line set. Existing FUUID provenance
makes retry identity independent of the nonunique bill number. A retry verifies the immutable
source header, line cardinality and financial values before acknowledging the existing order.
A lost response therefore retries the same order rather than creating a duplicate.

Amendments use the existing Kingdee SO lineage. The source batch verifies the expected previous
version and terms under lock, preserves the previous source header/lines as an amendment archive,
increments FVersionNo and updates the permitted live terms. Unsupported header changes and
quantities below existing fulfillment are refused before committing. A newer source version is
a conflict, never permission to overwrite a direct Kingdee edit. To attach a Kingdee amendment
to the locally sealed revision, the reader requires the expected live ID and source version,
that revision’s exact `ICOrderAlter.FChangeCauses` entry and matching source terms. An
independent Kingdee revision is retained separately and raises a conflict even when its mapped
terms match an awaiting local amendment. It does not displace the locally approved revision. The proof query returns only matching seals and runs only when a candidate source
version exists. Delivery and invoice matching wait for that source version to be bound.

Contract tracking is version-specific. It retains source account/branch, live and archive
identifiers, Kingdee version, content fingerprint, available source change metadata and observed
status events. A formal Kingdee amendment imports a new immutable version; known archive rows
can backfill prior versions. A non-versioned change to sealed terms needs attention. Rowversion
does not reconstruct overwritten intermediate edits, and missing source archives are recorded
as unavailable history rather than invented versions or proof that the entire SO was voided.
Source change timestamps are retained as the source's raw local value; observation timestamps
are UTC instants. The connector does not invent a timezone or historical approval time.

Previously accepted DOs and invoices keep their original contract linkage when the live SO is
amended. Source dates alone do not establish a contract version. An ambiguous first import or an
invoice spanning contract versions needs attention; it must not be assigned to the newest terms.
SQL imports create source term snapshots, not fabricated signed contract files.

Supporting files remain readable through their original native upload ownership. A draft selects
its own attachments while every sealed version retains its exact file list. The native form's
current limit is 20 retained supporting files across an order; history is never trimmed to make
room for a later upload.

A failed delivery preserves the sealed local SO and its lines. Bolt keeps the frozen payload and
idempotency key queued across a temporary SQL failure and retries roughly every minute while the
verified connection is active. Inbound SQL reads retry on their usual schedule after a temporary
failure. Restoring the network is sufficient for these failures. A rejected SQL write or invalid
source mapping needs review. After fixing a source prerequisite for the same approved payload,
use **Replay dead letters** in Settings → Integrations → Kingdee → Sync. Replay sends the
original frozen payload again. For an invalid payload, approve corrected terms, then **Retire
write** for the rejected entry. This retains its original payload, error, operator and retirement
time, marks it skipped and releases later writes. It neither cancels an in-flight SQL request nor
undoes an accepted remote write.

An independent Kingdee amendment is a permanent conflict, not an endlessly retried prerequisite.
Managers can **Adopt Kingdee terms**, making the observed open, audited source version Current
without duplicating it or exporting a replacement; or **Revise from Kingdee**, copying those terms
and stable entry IDs into a draft. The existing contract stays Current until the replacement is
approved. The replacement retains its exact source basis. A stale selection is refused; a later
native edit is checked again under the SQL writer's source-version guard. Retire the old rejected
write after resolving it. Original seals, filed documents and transaction links remain intact.
See the [manual probe matrix](0008-manual-probe-matrix.md) for both cases.

Bolt persists each inbound cursor in the workspace database. It commits the page, identity map and
cursor in one transaction. The sales transaction feed records a fingerprint after a consistent
sweep and skips reapplying an unchanged listing when the rows are still present locally. A changed
listing during a paginated sweep forces another complete check. The feed keeps reading the scoped
Kingdee tables because these documents have no single verified change marker across their joins.

If a document poll runs before the SO approval mirror catches up, it reports `parentPending`
and preserves the cursor and existing evidence. The next poll resumes after that counterpart is
issued; it does not attempt an invalid document upsert or reconcile rows as absent while waiting.

The reader observes subsequent Kingdee approval; the template does not call a fictional approval
procedure. Purchase-order creation, red-document reversals and a verified credit
hold/limit mapping remain unavailable and fail explicitly. They must not fall back to normalized
simulation tables or fabricate empty successful results.

## Local validation boundary

Focused template tests cover SQL calls, mappings, fixed rowversion windows, continuation validation,
immutable submissions, source lineage and financial ambiguity guards.

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
verified that an unaudited SO refuses a new amendment. The read-back proof accepted the matching
change log and rejected an incorrect seal, source version or live ID. The physical probe calls the template
requests through a local TDS adapter. The application outbox and Alibaba route have separate
acceptance checks. The joined Bolt probe covers the delivery, invoice and receipt projections on the same SQL Server 2017 fixture. Native Kingdee audit still requires a restored account set with desktop access.
The probe also substituted a different write destination between lookup and submission. SQL
rejected it before either the allocator or the order changed.

The 27 October 2026 standalone acceptance run used a restricted login with neither `sysadmin`
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
customer's Kingdee customization or the Alibaba network path.

Next: [Kingdee order lifecycle](0005-kingdee-order-lifecycle.md)
