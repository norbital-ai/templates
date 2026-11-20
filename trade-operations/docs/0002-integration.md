# Integration

Status: normative. [The architecture](0001-architecture.md) owns the workspace shape; this document owns the
Kingdee boundary: what is copied, where it lands, why a dropped connection does not duplicate or lose rows, and
why the loop stays cheap. The source tree and [the integration runbook](0004-kingdee-implementation.md) remain
the final authority for SQL details.

## 1. What Kingdee is

Kingdee KIS is the accounting and stock system of record. Trade Operations reads it over SQL Server through the
host's `sqlserver` driver. It is not a REST integration and not an event stream: every observation is a bounded
SQL read or a verified SQL write.

One **ledger** is one `sys_integration` row with `integration = 'kingdee'`, a display name, an `active` flag, a
safe `configuration`, and a sealed connection string in `bolt_credential`. The workspace declares no connection
slot; an administrator adds each ledger at run time. A source row always carries its ledger (`source`), and an
order belongs to its party's ledger (`ledger`).

The source system owns:

- which sales or purchase order, delivery, receipt, invoice, payment, credit position or stock lot exists;
- the source document number, identity, status, audit/void state and modification marker;
- credit enforcement and the statutory accounting result.

Trade Operations owns:

- the agreement, its floors and commission basis;
- what staff may see, approve, change and archive;
- the local projections needed to work and report.

## 2. Two directions

```text
READ (poll)                                      WRITE (outbox)
Kingdee tables -> verified page -> local table    local change   -> sys_outbox -> verified SQL -> Kingdee
     ^                                                        |
     |                                                        v
     +------------- the SO or PO read back onto the order ------+
```

Reads are the normal path. Writes are narrow: syncing an order creates its SO or PO; a later saved change to the
order or its lines replaces the lines in place while the SO or PO is unaudited, as KIS's own 修改 does, and amends
an audited SO into a new version, as KIS's 订单变更 does. An audited PO refuses the change. Each line carries the
domestic delivery date or the last day of the foreign shipment window. Kingdee keeps the header (party, currency, order
date, salesperson, settlement); a local change to it is refused. Purchase
orders take part once the ledger's **Verified SQL account for purchase documents** is set (`directionsOf`);
until then a PO stays local. The [README](../README.md#two-way-kingdee-sync) walks the four paths.

## 3. How a read works

Every model sync is one declared read. A read:

1. captures the source ceiling and a fingerprint of the tables/columns it is allowed to see;
2. reads a page of source rows in a stable order, normally **999** rows at a time;
3. normalizes values through typed readers (`text`, `bool`, `decimal`, `date`, `instant`, `currency`);
4. writes the page by the model's import key (its `import_key` constraint);
5. writes the page's continuation cursor in the **same transaction**;
6. only on the final page advances the completed-window bookmark.

The native engine commits a page and its continuation together. That is the unit of progress. A crash, a
timeout, a lost socket or a host restart either commits the whole page and its cursor, or commits neither.

### Rowversion windows

Feeds with a native SQL Server rowversion use `[bookmark, upper)` windows: only rows changed since the last
completed window are read. The bookmark is the native marker, not a local timestamp. A joined field (for
example a product's unit or brand) changes its own marker, so a joined edit is not missed.

KIS stamps document headers, never their lines. The order feeds follow `SEOrder.FOperDate` and `POOrder.FOperDate`;
the delivery, invoice and receipt feeds follow `ICStockBill.FOperDate`, `ICSale.FOperDate` or `ICPurchase.FOperDate`
and the invoice's open item `t_RP_Contact.FModifyTime` from the header that moved to the SO or PO its lines name,
and read only those orders' documents. An entry edited without
its header being saved again would not be seen; KIS saves a bill whole.

A row that cannot be applied yet (an SO whose customer or settlement method is not synchronized, a document whose
SO is not audited) does not hold the bookmark. Its SO is kept by identity in the cursor, at most 500, and read
again when what it waits on changes here. `ICInventory` and `t_Settle` carry no marker: stock and settlements list their tables, each
only when its fingerprint moved.

An SO or PO created in Kingdee arrives through the same order window: the read that first sees it creates a
draft, the next confirms it under the commission rule and freight treatment in force, and its lines follow.

## 4. Why a network blip is safe

A network blip is an interrupted page, not a lost business fact. The design handles it in five places:

1. **Page + cursor are atomic.** A partial page never lands, and a cursor never runs ahead of its rows. After a
   reconnect the sync re-reads the same window.
2. **Upserts are keyed by source identity.** A page can be replayed without creating a second row: the key is
   `source` + `external_code`, `external_id`, `erp_id`, or the model's declared natural key. A repeat updates
   the same record.
3. **The source remains the idempotency authority.** A source order family is discovered by its owned `FUUID`
   before a bill number is trusted. A repeated observation updates source evidence; it does not create a second
   local agreement.
4. **Parents gate children.** A delivery or invoice waits for the issued source order counterpart; a payment
   waits for its owned invoice. The sync answers `attention`/`parentPending` and writes nothing until the parent
   is present. It does not invent a missing link.
5. **Outbox, not fire-and-forget.** A write-back is queued in the transaction that changed the local record. The
   outbox freezes the committed image, retries, preserves order per record, records a dead letter, and only
   acknowledges after the source answers. A retry after an unknown outcome can therefore be resolved by source
   identity instead of guessing.

Kingdee voids, closes and archives audited documents in place, so they arrive as a moved row. KIS deletes an
unaudited bill outright, and a delete moves no rowversion: that order keeps its last read state here, and a later
local change to it is refused, never recreated. Removed rows are not searched for (no full listing).

### What is not guaranteed

- A sync page is **not** a source-wide transaction snapshot. Different feeds can be minutes apart.
- The local mirror is **not** an audit log of every source change; the source system remains that log.
- A failed feed stays visible through `sys_integration.status` and `source_health`; it is not retried forever
  in the background without surfacing.
- Credit requires the explicit native KIS policy below; other native credit policies and some legacy AR cases
  refuse rather than fabricate a result.
- A source write is only as safe as its verification block. The SQL writer checks the source version, document
  family, line identities, quantities and audit/void state before it commits.

## 5. Local tables the sync writes

These are real tenant tables, not a hidden schema. "Hidden" here means **no standalone app page**: the row is
read through an order, party, product, stock or report surface. The table name is the model name.

| Local table                | Source read (SQL Server)                                                                                                                                                         | Cadence / gate                                                      | Surfaced as                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `parties`                  | `t_Item`, `t_Organization`, `t_Supplier`                                                                                                                                         | 1 min                                                               | Partners list/record, order party picker                              |
| `products`                 | `t_Item`, `t_ICItem`, unit and brand `t_Item`                                                                                                                                    | 1 min                                                               | Warehouse products, order line picker, price book                     |
| `warehouses`               | `t_Item`, `t_Stock`, parent `t_Item`                                                                                                                                             | 1 min                                                               | Warehouse tab, order warehouse picker, price group                    |
| `stock_snapshots`          | `ICInventory`, `t_ICItem`, unit `t_Item`                                                                                                                                         | scheduled                                                           | Warehouse → Stock; availability                                       |
| `credit_snapshots`         | `ICCreditOption` / `ICCreditField` / `ICCreditObject`, `t_RP_Contact`, `ICSale`, `t_RP_NewReceiveBill`, `ICStockBill` / entries                                                  | 1 min, opt-in `creditPolicy` + `creditAccount`                      | Partner limit, used, available, hold and observation time             |
| `source_lot_costs`         | `ICStockBill`, `ICStockBillEntry`, `t_ICItem`, `t_Item`                                                                                                                          | opt-in `stockLotCostAccount`                                        | Quote FIFO estimate, stock cost evidence                              |
| `source_stock_commitments` | `SEOrder`, `SEOrderEntry`, `POOrder`, `POOrderEntry`, `t_ICItem`, `t_Item`                                                                                                       | 5 min, opt-in `stockAvailabilityAccount`                            | Warehouse → Stock: promised out, promised in and projected per region |
| `source_receivables`       | `t_RP_Contact`, `t_RP_NewCheckInfo`, `t_RP_Plan_Ar`, `ICSale`/`ICSaleEntry`, `ICStockBill`, `t_Settle`, `t_Organization`                                                         | 1 h, opt-in `receivablesAccount`                                    | Analysis → AR aging                                                   |
| `source_sales_lines`       | deliveries `ICStockBill`/`ICStockBillEntry`; invoices `ICSale`/`ICSaleEntry`; linked to owned orders                                                                             | scheduled, two syncs (`kingdee`, `invoice_only`)                    | Sales analysis, partner agreement fulfilment, reports                 |
| `source_payments`          | `t_rp_CheckEntry`, `t_RP_NewCheckInfo`, `t_RP_Contact`, `t_RP_NewReceiveBill`, `ICSale`, `ICPurchase`                                                                            | 5 min; AR receipts and AP payments; invoice must exist first        | Order payments, AR aging                                              |
| `source_purchase_lines`    | receipts `ICStockBill`/`ICStockBillEntry` type 1; `ICPurchase`/`ICPurchaseEntry`; payable `t_RP_Contact` FRP 0 type 4, `t_RP_NewCheckInfo`; `t_Supplier`, `t_Item`, `t_Currency` | 5 min, two syncs (`receipts`, `invoices`), opt-in `purchaseAccount` | Sales analysis purchase chain                                         |
| `transactions`             | deliveries and receipts `ICStockBill`/`ICStockBillEntry`, invoices `ICSale`/`ICSaleEntry` and `ICPurchase`/`ICPurchaseEntry`, parent `SEOrder` or `POOrder`                      | 5 min; parent SO or PO must be issued                               | Order Transactions, AR aging, reports                                 |
| `contacts`                 | `t_Item`, `t_Organization` / `t_Supplier` (`FContact`, `FMobilePhone` or `FPhone`, `FEmail`)                                                                                     | 1 min                                                               | Partner Contacts (the party's primary contact), order buyer contact   |
| `settlements`              | `t_Settle`                                                                                                                                                                       | 1 min; listed when its fingerprint moved                            | Order payment terms, printed settlement name                          |
| `orders`                   | `SEOrder`/`POOrder` and entries, `ICOrderAlter`, `ICMaxNum`, `t_User`, `t_Item`, `t_ICItem`, `t_Organization`, `t_Supplier`, `t_Settle`, `t_Emp`, `t_Department`, `t_Currency`   | 1 min read + outbox write                                           | Orders list, order record (SO or PO header)                           |

`order_lines` is the SO's or PO's lines: its `kingdee` sync reads `SEOrderEntry` and `POOrderEntry` every minute,
and a line change writes the order's SO or PO.

Local-only tables (never written by Kingdee): `order_files`, `activities`, `commercial_settings`,
`document_templates`, `pricing_floors`, `commission_rules`, `commission_statements`. A party's other contacts
are local too; only its primary contact comes from Kingdee.

The platform tables beside them carry the sync machinery, not business rows:

| Platform table                                                                 | Owns                                                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `sys_integration`                                                              | Each ledger account: definition, name, active flag, safe configuration, status               |
| `sys_sync`                                                                     | Per sync/instance/partition: cursor, cycle, phase, health, digest, version, last read/change |
| `sys_sync_row`                                                                 | Remote identity ↔ local record, remote version, cycle and acknowledged revision              |
| `sys_outbox`                                                                   | Queued write-backs: committed image, attempts, status, retry time, dead letter               |
| `sys_run`                                                                      | Run history and outcome for syncs, automations and writes                                    |
| `bolt_credential`                                                              | The sealed connection secret; never a readable model field                                   |
| `bolt_history`, `bolt_audit`, `bolt_approvals`, `sys_file`, `sys_notification` | Native Bolt history, audit, approvals, files and notices (not integration-specific)          |

## 6. Why the loop is efficient

Opening or navigating a page reads the local materialized records; it does not start an ERP sync.
Integration workers advance their durable cursors on their declared schedule, through a verified webhook,
or after an explicit operator request. A refresh of the browser never resets a cursor.

- **Pages, not per-row calls.** One SQL page returns up to 999 rows; one page is one local set-based upsert and
  one cursor compare-and-set. Work grows with changed pages, not with the number of rows in the local table.
- **Changes only.** A rowversion window reads just what moved since the last completed bookmark. A feed lists
  its table once, when it begins, and never again. Orders, their lines, deliveries, invoices and receipts are
  all read this way; an idle minute costs each feed one small request for the account and ceiling, and each
  order or document feed a second for its empty window. A master feed verifies its tables' marker columns
  hourly, not on every poll.
- **One connection, kept.** The host keeps one logged-in, TLS-encrypted SQL connection pool per connection
  string while it is used and for 150 seconds after, so a request costs its statement and reply, not two
  logins and a TLS handshake (about 19 KB). A transaction returns its session at the default isolation level.
- **Measured.** On SQL Server 2017 over TLS, an idle minute of one sales ledger with no opt-in feeds costs
  about 8 requests and 18.5 KB (statement and reply bytes, both directions): about 27 MB a day, against about
  186 KB a minute with a new connection per request. Stock lists only lots with stock (the customer's account
  set had 212 of 3,265 `ICInventory` rows with stock), and only when the listing's SQL fingerprint moved:
  otherwise its 15-minute poll is one small request.
- **SQL does the aggregation.** Stock availability, open commitments, lot costs and AR aging are grouped and
  summed in SQL (`SUM`, `GROUP BY`, `TOP (10001)` guards); the local side maps typed rows, it does not scan
  history.
- **No duplicate ledger.** Source facts land in one projection per fact; reports read the projection instead of
  calling the source again. A missing feed stays missing.
- **No per-row reads inside sync bodies.** A sync read is one request per page. Taxonomies, mappings and prior
  local rows are read up front, not inside the row loop.
- **Kingdee is the only poll.** Pages follow the workspace over one live stream of changes. A health change
  commits a `sys_integration` update, which `source_health` listens to (deduped per instance revision); nothing
  sweeps. A paused or unpaired ledger simply waits.
- **A quiet poll leaves the workspace asleep.** The engine keeps each feed's instances, cursor and the
  workspace's write count in memory. When nothing was written here since a feed's last read, its first page is
  told so (`local_unchanged`), and an order, line, document or AR feed whose Kingdee window is empty answers at
  once: no workspace query, no commit, no run record. The database (billed while awake) sleeps through an idle
  ledger. Snapshot feeds (stock; opt-in credit, commitments and lot cost) compare a SHA-256 of their payload in
  SQL and write only when it moves.
- **Freshness is the feed's health, not a stamp.** A quiet read writes nothing, so a row's `as_of` or
  `observed_at` is when it last changed. Bolt lists each failing sync on the ledger with when it began failing
  (`sys_integration.status.failing`, written only when that set changes). Figures are current while the ledger is
  connected and verified and their feed is absent there; once listed, they are as old as the failure, and **Max
  age of stock data** (and the 30-minute lot-cost limit) count from it. A paused or
  unverified ledger confirms nothing.
- **Bounded windows.** `maxWindowMinutes` (default 15) surfaces a window that is taking too long; a slow source
  becomes visible instead of silently falling behind.
- **Opt-in feeds.** Purchase documents, stock availability, lot cost, booked delivery cost, receivables and
  invoice-only analysis need their own verified SQL account. A tenant that does not use them runs no query for
  them.

## 7. Failure states an operator will see

| State                         | Meaning                                                                          | Recovery                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `attention` / `parentPending` | A child feed arrived before its issued source order or invoice                   | Wait for the parent sync; no local row is written                                                                                            |
| `attention` / `windowLag`     | A source window is older than `maxWindowMinutes`                                 | Check the SQL route, locks and source load; the cursor is kept                                                                               |
| Connection error              | The SQL login, route or account set failed                                       | Fix the connection in Settings → Integrations. Queued writes wait.                                                                           |
| `dead` outbox row             | A write-back was refused by source verification (a SQL refusal is never retried) | The next read returns a refused line to the order's Kingdee terms and removes a line Kingdee never took; read the dead letter for the reason |
| SO removed outright from SQL  | KIS deleted an unaudited order; the order stays as last read                     | No write recreates the SO; the refused write names it                                                                                        |
| Stale cursor/account          | The verified account or source identity changed                                  | Review the snapshot before resetting; do not guess                                                                                           |

`source_health` notifies workspace administrators once per instance revision. The record's status is the source of
truth; a notification is a prompt, not a second state.

## 8. Adding a feed

1. Add a model or a model sync under `src/data/model/`, with an `import_key` constraint and only the fields the business
   reads.
2. Put the SQL projection under `src/integration/kingdee/` and declare its tables, joins, rowversions, filters
   and typed columns. Fake nothing: a missing column is a refusal.
3. Decide whether it is a change feed or a complete listing; if it can be deleted in source, add reconciliation.
4. Add the model read/output and policy grants. Source mirrors stay read-only to members.
5. Add a test that decodes a changed page, a replay and a missing parent, plus the SQL integration test when the
   source shape is verified.
6. Document the new local table and source table here and in [the source reference](0003-source-reference.md).

Next: [source reference](0003-source-reference.md) · [Kingdee implementation runbook](0004-kingdee-implementation.md)

## Native KIS sales-out credit

Set `creditPolicy=kis-sales-out-v1` and `creditAccount=<database GUID>/<recovery fork GUID>` on one ledger per account, with `baseCurrency=CNY`. The login needs SELECT on the native credit, customer/currency, invoice, receivable, receipt and DO tables, plus the existing account-identity metadata permissions. No custom view, simulator schema, database name, or SQL write is required. Repointing to another account also requires its new verified account pin and mapped masters; an old pin is intentionally refused.

Use a fresh ledger or workspace for a different account. Existing ledgers retain account-bound cursors, source records and pending writes; changing only their connection and pins intentionally refuses a read across accounts. Keep the simulator ledger paused when retiring it.

`ICCreditOption` group 2 must contain one blocking option (`FCreditControl=2`). `FMainAmtCustom` selects `ICCreditField` bits by their measured names and signs. Known combinations are supported; missing/duplicate bits, unknown names and contradictory signs refuse the entire page. `ICCreditObject` supplies one CNY limit and credit days per customer. `t_Currency` confirms CNY/RMB. The current-document item is excluded from a customer snapshot: no proposed DO is being audited.

The selected terms read audited invoice amounts minus allocated payments from `t_RP_Contact` joined to `ICSale`, unsettled refunds/receipts/advances joined to audited `t_RP_NewReceiveBill`, and audited DO amounts minus fully matched DO amounts from `ICStockBill` / `ICStockBillEntry`. `FHookStatus=2` is matched; other values retain shipment exposure. Saved/cancelled documents do not post. An unmatched audited DO can count alongside its invoice.

**Credit blocked** mirrors the configured amount/term controls (`FRangeCustom` 1/2/3). Amount control blocks when used exceeds the limit. Term control checks positive outstanding audited invoices using `COALESCE(ICSale.FSettleDate,ICSale.FDate)` plus `ICCreditObject.FCreditDays`, against the SQL Server's local date. Exactly at the limit or credit-day boundary is not blocked. This is a derived native credit result, not a manual hold flag; `FIsCreditMgr` is not read. Simulator-only manual holds still affect its own approval controls but do not enter this adapter.

The feed reads one serializable position, validates the complete bounded payload (1,000 customers, 64 catalogue rows, 1 MB) and requires an active synchronized CNY customer for each native limit. Unknown settings, malformed values, missing mappings, changed account or failed reads publish nothing. An unchanged payload writes nothing; its freshness is the feed's health on the ledger, so `as_of` is when the
position last changed. Removing a native limit clears the prior local limit/used/blocked values. Available credit is limit minus used and stays unknown when no limit is set.

The predicates follow the SalesBridge connector contract for the mapped KIS schema. `FStatus<>0` audit predicates and receipt `FType=5` / `FPre=-1,0,1` classifications remain installation-verification requirements; connecting to a different Kingdee product or customized account does not establish those semantics automatically. The connection test checks required tables/columns, permissions, account identity and supported configuration before enabling the feed.
