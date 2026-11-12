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
safe `configuration`, and a sealed connection string in `bolt_credential`. The named `kingdee` connection in
`src/+workspace.ts` is the first ledger; more can be added at run time. A source row always carries its ledger
(`source`), and an order belongs to its party's ledger (`ledger`).

The source system owns:

- which sales order, delivery, invoice, receipt, credit position or stock lot exists;
- the source document number, identity, status, audit/void state and modification marker;
- credit enforcement and the statutory accounting result.

Trade Operations owns:

- the locally approved agreement, its versions, floors and commission basis;
- what staff may see, approve, revise and archive;
- the local projections needed to work and report.

## 2. Two directions

```text
READ (poll)                                      WRITE (outbox)
Kingdee tables -> verified page -> local table    local approval -> sys_outbox -> verified SQL -> Kingdee
     ^                                                        |
     |                                                        v
     +------------------- observed source versions -----------+
```

Reads are the normal path. Writes are narrow: a confirmed sales order may be submitted, and a revision may be
sent as an amendment. Supplier commitments are local and are never written to Kingdee by this starter.

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

Feeds without a reliable marker use a complete listing. A periodic full listing also reconciles physical source
deletions: rows absent from the source are marked inactive on the local mirror; they are not deleted. This keeps
history, links and audit evidence.

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

A full reconciliation catches a source delete that no rowversion window could report. Until that pass, the local
row remains; it is not silently dropped.

### What is not guaranteed

- A sync page is **not** a source-wide transaction snapshot. Different feeds can be minutes apart.
- The local mirror is **not** an audit log of every source change; the source system remains that log.
- A failed feed stays visible through `sys_integration.status` and `source_health`; it is not retried forever
  in the background without surfacing.
- Credit, purchase payments and some legacy AR cases have no verified binding and refuse rather than fabricate a
  result.
- A source write is only as safe as its verification block. The SQL writer checks the source version, document
  family, line identities, quantities and audit/void state before it commits.

## 5. Local tables the sync writes

These are real tenant tables, not a hidden schema. "Hidden" here means **no standalone app page**: the row is
read through an order, party, product, stock or report surface. The table name is the model name.

| Local table                | Source read (SQL Server)                                                                                                                                   | Cadence / gate                                   | Surfaced as                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| `parties`                  | `t_Item`, `t_Organization`, `t_Supplier`                                                                                                                   | 1 min                                            | Partners list/record, order party picker               |
| `products`                 | `t_Item`, `t_ICItem`, unit and brand `t_Item`                                                                                                              | 1 min                                            | Warehouse products, order line picker, price book      |
| `warehouses`               | `t_Item`, `t_Stock`, parent `t_Item`                                                                                                                       | 1 min                                            | Warehouse tab, order warehouse picker, price group     |
| `stock_snapshots`          | `ICInventory`, `t_ICItem`, unit `t_Item`                                                                                                                   | scheduled                                        | Warehouse → Stock; availability                        |
| `credit_snapshots`         | no verified source binding yet                                                                                                                             | refuses                                          | Partner credit evidence; never invents a limit or hold |
| `source_lot_costs`         | `ICStockBill`, `ICStockBillEntry`, `t_ICItem`, `t_Item`                                                                                                    | opt-in `stockLotCostAccount`                     | Quote FIFO estimate, stock cost evidence               |
| `source_stock_commitments` | `SEOrder`, `SEOrderEntry`, `t_ICItem`, `t_Item`                                                                                                            | 5 min, opt-in `stockAvailabilityAccount`         | Warehouse → Availability; open sales quantities        |
| `source_receivables`       | `t_RP_Contact`, `t_RP_NewCheckInfo`, `t_RP_Plan_Ar`, `ICSale`, `t_Organization`                                                                            | 1 h, opt-in `receivablesAccount`                 | Analysis → AR aging                                    |
| `source_sales_lines`       | deliveries `ICStockBill`/`ICStockBillEntry`; invoices `ICSale`/`ICSaleEntry`; linked to owned orders                                                       | scheduled, two syncs (`kingdee`, `invoice_only`) | Sales analysis, partner agreement fulfilment, reports  |
| `source_payments`          | `t_rp_CheckEntry`, `t_RP_NewCheckInfo`, `t_RP_Contact`, `t_RP_NewReceiveBill`, `ICSale`                                                                    | 5 min; invoice must exist first                  | Order payments, AR aging                               |
| `ext_sales_orders`         | `SEOrder` (owned families)                                                                                                                                 | 5 min                                            | Order General/Transactions source confirmation         |
| `ext_purchase_orders`      | none — local supplier commitment                                                                                                                           | no sync                                          | Purchase order source confirmation                     |
| `transactions`             | `ICStockBill`/`ICStockBillEntry` (deliveries), `ICSale`/`ICSaleEntry` (invoices), parent `SEOrder`                                                         | 5 min; parent order must be issued               | Order Transactions, AR aging, reports                  |
| `orders`                   | `SEOrder`, `SEOrderEntry`, `ICOrderAlter`, `ICMaxNum`, `t_User`, `t_Item`, `t_ICItem`, `t_Organization`, `t_Settle`, `t_Emp`, `t_Department`, `t_Currency` | 1 min read + outbox write                        | Orders list, order record, revisions                   |

Local-only tables (never written by Kingdee): `order_lines`, `order_files`, `activities`, `contacts`,
`salesperson_signatures`, `commercial_settings`, `document_templates`, `pricing_floors`,
`commission_rules`, `commission_statements`.

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

- **Pages, not per-row calls.** One SQL page returns up to 999 rows; one page is one local set-based upsert and
  one cursor compare-and-set. Work grows with changed pages, not with the number of rows in the local table.
- **Changes only.** A rowversion window reads just what moved since the last completed bookmark. A daily full
  listing (`fullSnapshotMinutes`, default 1440 minutes) reconciles deletes and joined-field drift.
- **SQL does the aggregation.** Stock availability, open commitments, lot costs and AR aging are grouped and
  summed in SQL (`SUM`, `GROUP BY`, `TOP (10001)` guards); the local side maps typed rows, it does not scan
  history.
- **No duplicate ledger.** Source facts land in one projection per fact; reports read the projection instead of
  calling the source again. A missing feed stays missing.
- **No per-row reads inside sync bodies.** A sync read is one request per page. Taxonomies, mappings and prior
  local rows are read up front, not inside the row loop.
- **Health is cheap.** `sys_sync` carries the cursor, phase and health; `source_health` sweeps instances every
  five minutes and dedupes per instance revision. A paused or unpaired ledger simply waits.
- **Bounded windows.** `maxWindowMinutes` (default 15) surfaces a window that is taking too long; a slow source
  becomes visible instead of silently falling behind.
- **Opt-in heavy feeds.** Stock availability, lot cost, receivables and invoice-only analysis need their own
  verified SQL account. A tenant that does not use them runs no query for them.

## 7. Failure states an operator will see

| State                         | Meaning                                                              | Recovery                                                           |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `attention` / `parentPending` | A child feed arrived before its issued source order or invoice       | Wait for the parent sync; no local row is written                  |
| `attention` / `windowLag`     | A source window is older than `maxWindowMinutes`                     | Check the SQL route, locks and source load; the cursor is kept     |
| Connection error              | The SQL login, route or account set failed                           | Fix the connection in Settings → Integrations. Queued writes wait. |
| `dead` outbox row             | A write-back exhausted retries or was refused by source verification | Read the dead letter, correct the cause, retry deliberately        |
| Stale cursor/account          | The verified account or source identity changed                      | Review the snapshot before resetting; do not guess                 |

`source_health` notifies configuration holders once per instance revision. The record's status is the source of
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
