# Inner mechanisms diagrams

Pure-ASCII reference diagrams for every runtime, data, integration, pricing, credit, document,
commission, reporting, and access-control mechanism in `templates/trade-operations`. Every symbol,
state, formula, error code, and constraint below is verified directly against `src/`.

| #   | Mechanism                                                | Primary source files                                                                           |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | System topology and runtime architecture                 | `src/+workspace.ts`, `src/app/**`, `src/integration/kingdee/**`, `src/automation/**`           |
| 2   | 26-model data ownership and ER graph                     | `src/data/model/**/+model.ts`                                                                  |
| 3   | Order lifecycle, header ownership and cascade re-pricing | `src/data/model/orders/+model.ts`, `src/data/model/orders/order_lines/+model.ts`               |
| 4   | Two-way Kingdee SO/PO sync, create and audited amendment | `src/integration/kingdee/orders.ts`, `submission.ts`, `amendment.ts`, `order-batch.ts`         |
| 5   | Kingdee polling patterns, account pinning and health     | `src/integration/kingdee/polling.ts`, `changed-snapshot.ts`, `reconciliation.ts`, `sql.ts`     |
| 6   | Pricing math, floor rules and price-book concurrency     | `src/lib/commercial.ts`, `src/lib/order-review.ts`, `src/data/model/products/pricing_floors/`  |
| 7   | Credit exposure, release approvals and `t_Log` check     | `src/integration/kingdee/credit-source.ts`, `credit-release-source.ts`, `credit_releases/`     |
| 8   | Stock availability, commitments and FIFO lot costing     | `src/lib/stock-availability.ts`, `src/lib/lot-cost.ts`, `src/lib/quotation.ts`                 |
| 9   | Bilingual document publishing and on-demand PDF pipeline | `src/data/model/commercial_settings/document_templates/`, `src/lib/order-document.ts`          |
| 10  | Commission rule lock, CEL evaluation and sign-off        | `src/lib/commission-expressions.ts`, `src/lib/monthly-commission.ts`, `commission_statements/` |
| 11  | Financial analysis, as-at AR/AP aging and expense split  | `src/lib/reports.ts`, `src/lib/receivables.ts`, `src/lib/payables.ts`, `purchase-listing.ts`   |
| 12  | Access control, output masking and separation of duties  | `seed/public/sys_team.json`, `src/access_control/policy/+*.policy.ts`                          |

---

## 1. System topology and runtime architecture

The workspace mounts two isolated capability surfaces (`operations` and `trade_configuration`),
26 models, 1 event-driven automation (`source_health`), 6 workbook syncs (XLSX/CSV), and 21
Kingdee KIS SQL Server syncs over TDS (`sqlserver`). No triggers, staging tables, or CDC jobs are
installed in Kingdee.

```text
+----------------------------------------------------------------------------------------------+
|                                   BROWSER / PAGE SDK CLIENT                                  |
|                                                                                              |
|  +----------------------------------------------------+  +--------------------------------+  |
|  | App group: operations  (default_child: dashboard)  |  | App: trade_configuration       |  |
|  |                                                    |  | (configurators & admins ONLY;  |  |
|  |  [dashboard]  Attention queue & inline drill-down  |  |  no access to orders/invoices) |  |
|  |  [trade]      Orders (SO/PO tabs, PDF preview/zip) |  |                                |  |
|  |  [partners]   Parties, contacts, credit snapshots  |  |  [templates]                   |  |
|  |  [warehouse]  Products, stock availability, whs    |  |   6 fixed (kind, locale) slots |  |
|  |  [analysis]   6 report tabs (XLSX exportable)      |  |  [pricing_floors]              |  |
|  |               Sales | Purchase | AR | AP |         |  |   Price book | History | Rules |  |
|  |               Commission | Credit exceptions       |  |                                |  |
|  +-------------------------+--------------------------+  +---------------+----------------+  |
+----------------------------|---------------------------------------------|-------------------+
                             | PageBolt.query / ctx.run / ctx.preview_pdf  |
                             v                                             v
+----------------------------------------------------------------------------------------------+
|                            NORBITAL BOLT WORKSPACE ENGINE (TENANT)                           |
|                                                                                              |
|  +-------------------------+  +-------------------------+  +------------------------------+  |
|  | Policy & Approval Gate  |  | 26 Record Models + DDL  |  | Host Services & Converters   |  |
|  | - 6 user policies       |  | - Transforms & effects  |  | - Native $approval holds     |  |
|  | - 2 system policies     |  | - Computed CEL columns  |  | - History & revision ledger  |  |
|  | - Output masking:       |  | - DB checks, uniques,   |  | - File store (20 MiB / 3 MiB)|  |
|  |   default | logistics | |  |   row locks             |  | - Chromium PDF (A4, offline, |  |
|  |   commercial            |  | - Sequence generators   |  |   no scripts, Noto CJK SC)   |  |
|  +------------+------------+  +------------+------------+  +---------------+--------------+  |
|               |                            |                               |                 |
|  +------------+----------------------------+-------------------------------+--------------+  |
|  | Background Execution Layer                                                             |  |
|  |                                                                                        |  |
|  |  [Automation: source_health]      [6 Sheet Syncs (XLSX/CSV)]   [21 Kingdee SQL Syncs]  |  |
|  |   on: sys_integration update       orders (sheet, lines)        4 two-way (orders,     |  |
|  |   policy: source_health            pricing_floors (price_book)   order_lines, parties, |  |
|  |   -> notifies active admins        commission_rules (sheet)      credit_releases) +    |  |
|  |      once per (id, revision)       parties, warehouses (out)    17 read-only mirrors   |  |
|  +----------------------------------------------------+-----------------------------------+  |
+-------------------------------------------------------|--------------------------------------+
                                                        | sqlserver (TDS, encrypted)
                                                        | per-ledger sys_integration rows
                                                        v
+----------------------------------------------------------------------------------------------+
|                       EXTERNAL KINGDEE KIS SQL SERVER LEDGER(S)                              |
|  - Dynamic runtime connections (Settings -> Integrations -> Connections, no seeded creds)    |
|  - Read-only projections on masters, stock, credit, DO/PO/invoices, payments, AR/AP, t_Log   |
|  - Transactional write path (SERIALIZABLE + sp_getapplock) for SEOrder/POOrder &             |
|    opt-in ICCreditObject limit updates / temporary one-time bumps                            |
+----------------------------------------------------------------------------------------------+
```

---

## 2. 27-model data ownership and ER graph

Models split cleanly into local commercial authority (orders, user profiles, configuration, approvals, statements)
and ERP mirrors populated under `kingdee_sync` (with workspace-owned profile fields on `parties`). Foreign keys are `restrict`
unless marked `owned` (cascade delete) or `opt` (optional reference).

```text
================================= COMMERCIAL GOVERNANCE & SETTINGS =============================

 +------------------------+   +---------------------------+   +------------------------------+
 | commercial_settings    |   | commission_rules          |   | document_templates           |
 | UK: code='default'     |   | UK: (code,currency,       |   | state: draft -> published    |
 | - freight_treatment    |   |      effective_on)        |   | DB LOCK when published       |
 | - floor_rule           |   | - eligibility_expression  |   | - kind x locale (6 slots)    |
 | - stock_fresh_minutes  |   | - amount_expression       |   | - version (auto-increment)   |
 +------------------------+   | - parameters[]            |   | - print_layout / letterhead  |
                              +---------------------------+   |   / contract_stamp           |
                                                              +------------------------------+

 +------------------------------+                 +------------------------------------------+
 | commission_statements        |                 | credit_releases                          |
 | seq: CS-{yyyy}-{0000}        |                 | UK: (source, external_code)              |
 | UK: (owner, period,          |                 | source_status: blocked -> released |     |
 |      currency, calc_hash)    |                 |   cleared | superseded | withdrawn |     |
 | - owner -> sys_user          |                 |   bypassed                               |
 | - snapshot[] (immutable)     |                 | approval_status: none -> approved        |
 +------------------------------+                 | computed status (CEL)                    |
                                                  | -> party, order (opt), delivery (opt)    |
                                                  +------------------------------------------+

================================= MASTER DATA & SNAPSHOTS (ERP) ================================

 +------------------------+       +------------------------+       +-------------------------+
 | parties                |       | products               |       | warehouses              |
 | UK:(source,ext_code)   |       | UK:(source,ext_code)   |       | UK:(source,ext_code)    |
 | local: related_party   |       | local: commission_*    |       | - group_code (region)   |
 +-----+------------+-----+       +-----+------------+-----+       +------------+------------+
       |1           |1                  |1           |1                         |1
       |N           |N                  |N           |N                         |N
 +-----+------+ +---+-------------+ +---+----------+ +--------------------------+------------+
 | contacts   | | credit_snapshots| |pricing_floors| | stock_snapshots                       |
 | primary    | | UK:(src,ext)    | |UK:(prod,grp, | | UK:(source, external_code)            |
 | (Kingdee)  | | computed:       | | cur,eff,minq)| | -> product, warehouse                 |
 | + local    | | credit_available| |computed:     | | - lot_number, on_hand, unit_cost      |
 | rows       | | = limit - used  | | floor_net    | +---------------------------------------+
 +------------+ +-----------------+ |CHECK:        |
                                    | floor>=0     |               +-------------------------+
                                    | import_rev   |               | settlements             |
                                    | IS NULL      |               | UK:(source,ext_code)    |
                                    +--------------+               +-------------------------+

================================= UNIFIED COMMERCIAL AGREEMENTS ================================

                               +-----------------------------------+
                               | orders   seq: TR-{yyyy}-{0000}    |
                               | UK: source_order_key              |
                               | state: draft -> confirmed         |
                               | -> party, warehouse(opt), ledger, |
                               |    owner, payment_terms(opt),     |
                               |    buyer_contact(opt), handler    |
                               | rollups: net, tax, total, count   |
                               +-+--+--+---------+-----------+---+-+
                                 |  |  |         |           |   |
       owned (cascade)           |  |  |         |           |   +-----------------+
       +-------------------------+  |  |         |           +----+                |
       |                   +--------+  |         |                |                |
       v (1:N)             v           |         v                v                v (1:N)
 +-----------------+ +--------------+  | +-------------+ +-----------------+ +-----------------+
 | order_lines     | | activities   |  | | order_files | | transactions    | | source_payments |
 | UK:(order,      | | - call/email |  | | confirmed   | | UK:(src,erp_id) | | UK:(src,ext_cd) |
 |     line_key)   | |   /note/task |  | | unarchived  | | invoice|deliv.  | | UK:(order, ref) |
 | CHECK:price>=0  | +--------------+  | | <= 20 MiB   | | draft|issd|void | | rcpt|pay|refund |
 | -> product      |                   | +-------------+ +-----------------+ +-----------------+
 +-----------------+                   | (0..1:N, optional ref for invoice_only)
                                       v
                         +-----------------------------+
                         | source_sales_lines          |
                         | UK: (source, external_code) |
                         | shipment | return | invoice |
                         | invoice_only                |
                         +-----------------------------+

================================= ERP REPORTING MIRRORS (READ-ONLY) ============================

 +-----------------------+ +------------------------+ +--------------------+ +-----------------+
 | source_lot_costs      | |source_stock_commitments| | source_receivables | | source_payables |
 | UK: (source)          | | UK: (source)           | | UK: (source,shard) | | UK:(src,shard)  |
 | JSON lots[]           | | JSON commitments[]     | | shards 0..7        | | shards 0..7 +   |
 +-----------------------+ +------------------------+ +--------------------+ | GL 2202.03      |
                                                                             +-----------------+
 +-----------------------+ +------------------------+
 | source_purchase_orders| | source_purchase_lines  |
 | UK: (source, period)  | | UK: (source, ext_code) |
 | YYYY-MM PO progress   | | kind: receipt|invoice  |
 +-----------------------+ +------------------------+
```

---

## 3. Order lifecycle, header ownership and cascade re-pricing

Quotations, sales orders, and purchase orders share `orders` + `order_lines`. Confirmation is a
one-way gate (`draft -> confirmed`); archiving (`archived: true`) is reversible and freezes all
other edits and line deletes until unarchived.

```text
  [NEW DRAFT ORDER]  (orders create.transform)
   - Must start status='draft'; cannot inject write_target / kingdee / ledger / party_name
   - Require payment_terms, valid_until >= valid_from, valid print_values, active handler
   - admitParty: active party, direction matches customer|supplier|both, same warehouse ledger
   - Auto-fill: ledger=party.source, party_name=party.name, source_order_key=UUID,
     defaultPlaces (delivery_place / place_of_loading / place_of_delivery / delivery_address),
     buyer_contact = primary contact of party
                                |
                                v
               +---------------------------------+       archived=true
               |        STATUS = 'draft'         | <-----------------------+
               |  (Quotation / Draft SO or PO)   |                         |
               +----------------+----------------+                         v
                                |                                 +-----------------+
        +-----------------------+-----------------------+         | archived = true |
        |                       |                       |         | All edits & line|
        v                       v                       v         | deletes refused |
  [Header edit]          [Line CRUD]             [Draft delete]   | (order_archived)|
  - pricingBasis moved?  - order_lines.priced()  - Sales: held    | except unarchive|
    (party, warehouse,     fills price/tax/unit    by policy for  +--------+--------+
     currency, tax_incl,   & computes net/tax/     commercial              |
     ordered_on)           total + floor_net       manager review          | archived=false
    --> re-prices ALL    - Sales below floor +   - Manager: direct         |
        existing lines     floor_rule='approve'    delete (cascade)        +--> back to status
        via nested layer   --> held ($approval)  - Confirmed: refused
                                |                  (order_sealed)
                                |
                                | Confirm & sync (status: draft -> confirmed)
                                | Pre-confirm transform gates (orders/+model.ts):
                                |   1. No unsaved header term changes (save_before_confirm)
                                |   2. commercial_settings row exists (configuration_missing)
                                |   3. line_count > 0 (lines_required)
                                |   4. No line has pending $approval (lines_pending)
                                |   5. Active warehouse (if set) & active products on all lines
                                |   6. payment_terms present (errors.payment_terms)
                                |   7. If sales & floor_rule=='refuse': re-check ALL lines
                                |      against LIVE pricing_floors (errors.floor_below)
                                | Stamp once:
                                |   - source_order_key (preserve or UUID)
                                |   - party_name, freight_treatment (from commercial_settings)
                                |   - write_target (kingdeeWriteTarget of ledger)
                                |   - commission (active commissionRule for currency+ordered_on)
                                v
               +---------------------------------+
               |       STATUS = 'confirmed'      |  (Terminal status; never reverts to draft)
               +----------------+----------------+
                                |
        +-----------------------+-----------------------------------+
        |                       |                                   |
        v                       v                                   v
  [Local edits]         [order_files upload]           [Two-way Kingdee sync]
  - kingdeeHeader LOCK  - Allowed ONLY when            - Outbox pushes create/edit/amend
    (party, currency,     status=='confirmed'          - Read-back mirrors Kingdee header
     ordered_on, owner,   AND !archived                  changes & version/status/closed
     payment_terms)     - PDF/JPEG/PNG <= 20 MiB       - Local delete refused (order_sealed)
    -> kingdee_header
  - Lines & trade terms editable (re-prices if pricingBasis moves, pushes amend to Kingdee)
```

---

## 4. Two-way Kingdee SO/PO sync, create and audited amendment

`orders/+kingdee.sync.ts` and `order_lines/+kingdee.sync.ts` run on a `1min` cadence plus immediate
outbox pushes. Every SQL batch checks `writeAccount` (`database_guid/recovery_fork_guid`), runs
under `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` with `SET LOCK_TIMEOUT 5000`, and acquires an
exclusive transaction `sp_getapplock` keyed by the deterministic `FUUID`.

```text
  OUTBOUND WRITE PATH (pushOrder -> submitOrder)
  ==============================================
  Confirmed order or line mutation in Bolt
       |
       v
  Compute deterministic FUUID:
   - Native Kingdee order: preserve UUID from source_order_key (kingdee:<acct>:<branch>:<uuid>)
   - Local order: UUIDv8 from SHA-256(['norbital-kingdee-order-v1', order.id, source_order_key])
       |
       v
  Validate pre-flight:
   - writeTarget matches ledger's configured writeAccount & writeBranch
   - Resolve Kingdee FItemIDs (party, products, warehouse, settlement, emp/dept)
   - Line count 1..200; verify writeAccount GUID inside SQL via sys.database_recovery_status
       |
       v
  Acquire tx lock: sp_getapplock('norbital:trade:order:<FUUID>', 'Exclusive', 'Transaction')
  Lookup @remote = FInterID in SEOrder (FTranType=81) or POOrder (FTranType=71) by FUUID
       |
       +----------------------------+-----------------------------+
       |                            |                             |
       v (@remote IS NULL)          v (Unaudited:                 v (Audited: FCheckerID>0)
  +--------------------------+        FCheckerID=0, FStatus=0,    |
  | BRANCH 1: CREATE         |        FCancellation=0, FClosed=0) +-------------------+
  | - Allocate FInterID via  |      +--------------------------+  |                   |
  |   ICMaxNum (UPDLOCK,     |      | BRANCH 2: UNAUDITED EDIT |  v (Sales Order;     v (PO)
  |   ROWLOCK)               |      | - Compare live lines vs  |  FCheckDate >=     +----------+
  | - INSERT SEOrder or      |      |   expected lineBasis XML |  '19010102')       | BRANCH 4 |
  |   POOrder (FStatus=0, or |      |   (FEntryID,Item,Qty,Amt)| +----------------+ | REFUSED  |
  |   FStatus=1+FCheckerID if|      | - Mismatch -> 'moved'    | | BRANCH 3:      | | PO lines |
  |   directApproveOrders)   |      |   (retry after read)     | | AUDITED SO     | | editable |
  | - Return $id             |      | - Match -> DELETE old    | | AMENDMENT      | | pre-audit|
  +--------------------------+      |   *Entry & INSERT new    | | (sourceAmend-  | | ONLY     |
                                    +--------------------------+ |  mentSql)      | +----------+
                                                                 | - FVersionNo   |
                                                                 |   000..998 ->+1|
                                                                 | - @previous XML|
                                                                 |   exact match  |
                                                                 | - Guard: qty >=|
                                                                 |   FStockQty &  |
                                                                 |   SEOutStock   |
                                                                 | - No delete of |
                                                                 |   shipped/linkd|
                                                                 |   (StockBill21,|
                                                                 |   SEOut,ICSale)|
                                                                 | - Archive old  |
                                                                 |   FInterID     |
                                                                 |   (Cancel=1,   |
                                                                 |   ChangeMark=1,|
                                                                 |   FUUID=NEWID) |
                                                                 | - Update live  |
                                                                 |   SEOrderEntry |
                                                                 |   & AwaitQty   |
                                                                 | - Bump version |
                                                                 | - INSERT       |
                                                                 |   ICOrderAlter |
                                                                 |   [hash16]     |
                                                                 +----------------+

  INBOUND READ-BACK & IMPORT PATH (readKingdeeOrders / readKingdeeOrderLines)
  ===========================================================================
  Rowversion [bookmark, upper) over SEOrder.FOperDate & POOrder.FOperDate (checks POOrder.FUUID)
       |
       +---> Matched existing local order (by FUUID / source_order_key):
       |       - Overwrites Kingdee header fields (party, currency, ordered_on, owner, terms)
       |       - Updates kingdee JSON { fid, reference, version, status, closed, exchange_rate }
       |       - Syncs order_lines entries; removes local orphans & re-versions refused lines
       |
       +---> Unmatched live open order created in Kingdee:
       |       - Pass 1: stage draft row (source_order_key='kingdee:...', user-edit locked)
       |       - Pass 2: promote draft -> confirmed & stamp commission + freight_treatment
       |
       +---> Order waiting on missing master (party/product/settlement):
               - Queued in cursor waiting list (up to 500 UUIDs); retried on token change
```

---

## 5. Kingdee polling patterns, account pinning and health

The 21 Kingdee syncs use four bounded SQL patterns selected to match each table's mutability and
size. Ten optional `<database_guid>/<recovery_fork_guid>` configuration pins prevent cross-ledger
contamination when multiple Kingdee account sets are connected.

```text
+----------------------------------------------------------------------------------------------+
| PATTERN A: ROWVERSION [bookmark, upper) KEYSET PAGING (readSource, polling.ts)               |
|  Syncs: parties(1m), products(1m), warehouses(1m), contacts(1m), orders(1m), order_lines(1m),|
|         source_purchase_lines (receipts/invoices 5m), source_sales_lines (invoice_only)      |
|                                                                                              |
|  1. Hourly SCHEMA_CHECK_MS (1h): verify rowversion columns have SQL system_type_id = 189     |
|  2. Freeze upper = MIN_ACTIVE_ROWVERSION(); page 999 rows (+1 lookahead) in                  |
|     Latin1_General_BIN2 order; commit rows + cursor atomically                               |
|  3. Master feeds run preserveSource 2-phase absence check (sourceKeys) -> active=false       |
|  4. If window duration > maxWindowMinutes (default 15m) -> set health { state:'attention',   |
|     code:'windowLag' } on sys_integration                                                    |
+----------------------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------------------+
| PATTERN B: SERVER-SIDE SHA-256 FINGERPRINTED SNAPSHOTS (readChangedSnapshot)                 |
|  Syncs: settlements(1m), stock_snapshots, credit_snapshots(1m), source_lot_costs,            |
|         source_stock_commitments(5m), credit_releases(1m, + incremental t_Log.FLogID seek)   |
|                                                                                              |
|  SQL computes HASHBYTES('SHA2_256', @data) over canonical JSON/rows on SQL Server            |
|   +-- Hash == cursor.hash --> return 0 rows (zero payload transfer, zero tenant wake)        |
|   +-- Hash != cursor.hash --> fetch full snapshot (1 MiB transfer bound) & update cursor     |
+----------------------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------------------+
| PATTERN C: ORDER-GRAPH DOCUMENT WINDOW (readOrderGraph, kingdee-owned-v1)                    |
|  Syncs: transactions(5m), source_payments(5m), source_sales_lines[kingdee]                   |
|                                                                                              |
|  1. Poll FOperDate on ICStockBill / ICSale / ICPurchase + t_RP_Contact.FModifyTime +         |
|     watched draft DOs -> collect affected confirmed order FIDs                               |
|  2. readSourceOrderFamilies: double-read coherence check (before/after version stability)    |
|  3. readSalesDocuments: trace blue/red return & invoice lineage per order                    |
|  4. Ambiguous / unstable order -> per-order `held` quarantine + `documentReview` health note |
+----------------------------------------------------------------------------------------------+

+----------------------------------------------------------------------------------------------+
| PATTERN D: 64-BUCKET CHECKSUM + SHARDED / PERIOD DIGESTS (1h cadence)                        |
|  Syncs: source_receivables (kingdee-ar-v2), source_payables (kingdee-ap-v1 + GL 2202.03),    |
|         source_purchase_orders (kingdee-purchase-listing-v1)                                 |
|                                                                                              |
|  AR/AP: 64 buckets (FID % 64) of (n, ids, due, remaining, sn, days, amount)                  |
|         -> merge rowversion delta (<=5000 rows) -> self-heal only disagreeing buckets        |
|         -> split into 8 shards (0..7) when contacts > SHARD_THRESHOLD (5,000), 5 MiB/shard   |
|  PO Listing: 12-table single-pass CROSS JOIN digest -> 4-way concurrent fetch (PO lines      |
|         across invoice paths 1/71/75, invoice nos, ICExpenses 005/002, ICHookRelations)      |
|         -> verify before/after digest -> publish changed YYYY-MM period rows                 |
+----------------------------------------------------------------------------------------------+

  ACCOUNT PINNING & HEALTH ALERTING
  =================================
  10 optional pins (<database_guid>/<recovery_fork_guid>):
   writeAccount | creditAccount | purchaseAccount | purchaseListingAccount | receivablesAccount
   payablesAccount | stockAvailabilityAccount | stockLotCostAccount | deliveryCostAccount |
   invoiceAnalysisAccount  (account-wide feeds enforce 1 ledger per account set)

  sys_integration updated with status.health.state == 'attention'
       |
       v (event trigger: [{ model: 'sys_integration', verbs: ['update'] }])
  Automation: source_health  (policy: source_health)
       |
       +--> Query active admin sys_user rows
       +--> ctx.notify({ to: admins, title: '<ledger> needs attention',
                         once: '<sys_integration.id>:<revision>' })
```

---

## 6. Pricing math, floor rules and price-book concurrency

All monetary and floor arithmetic uses Effect `BigDecimal` without IEEE-754 floating-point
rounding drift. Floor rules operate across both policy verdicts (for `approve`) and model
transforms (for `refuse`).

```text
  LINE PRICING PIPELINE (price() in src/lib/commercial.ts)
  ========================================================
  Inputs: quantity, unit_price, discount_pct (0..100), tax_rate (0..100), tax_inclusive, ccy
       |
       v
  base   = round(quantity * unit_price * (100 - discount_pct) / 100, scale=12)
  factor = 1 + round(tax_rate / 100, scale=6)
  gross  = round(base, currencyDigits)
       |
       +-- tax_inclusive == true  --> net = round(gross / factor, currencyDigits)
       |                              tax = gross - net
       |                              total = net + tax  (= gross)
       |
       +-- tax_inclusive == false --> net = gross
                                      tax = round(net * tax_rate / 100, currencyDigits)
                                      total = net + tax

  FLOOR LOOKUP & UNIT CONVERSION (floorFor / floorNetInUnit / quoteBelowFloor)
  ============================================================================
  Sales lines only; requires warehouse.group_code (region)
       |
       v
  Filter pricing_floors:
   product == line.product  AND  currency == order.currency  AND  group_code == wh.group_code
   AND effective_on <= order.ordered_on
       |
       v
  Rank candidates: latest effective_on DESC (one row per product/group_code/currency/day)
       |
       v
  Convert winner.floor_net (computed: round(tax_incl ? price/(1+tax_rate/100) : price, 8))
  into line.unit via floorNetInUnit (scale=8); incompatible unit -> refuse errors.unit_mismatch
       |
       v
  netUnit = round(unit_price * (100 - discount_pct) / (tax_inclusive ? 100+tax_rate : 100),
                  floor_net.scale)
  belowFloor = (floor == null) OR (netUnit < floor_net)

  THREE FLOOR_RULE MODES (commercial_settings.floor_rule)
  =======================================================
                    +---> 'warn'    --> Write allowed directly; UI displays floor-warning banner
                    |                   alongside weighted-average & FIFO inventory cost checks
  Sales write on    |
  orders /          +---> 'approve' --> Sales policy runs floorReview():
  order_lines ------+                    - belowFloor -> ctx.approve(commercialReview)
                    |                      (1-step hold: commercial_managers)
                    |                    - Confirming order while any line has $approval
                    |                      -> refuse errors.lines_pending
                    |                    - Commercial Managers bypass directly
                    |
                    +---> 'refuse'  --> order_lines transform refuses non-system writes:
                                         - missing floor -> errors.floor_missing
                                         - below floor   -> errors.floor_below
                                        AND orders draft->confirmed re-checks LIVE floors
                                         (catches floors raised after draft creation)

  PRICE-BOOK XLSX/CSV OPTIMISTIC CONCURRENCY (+price_book.sync.ts & pricing_floors/+model.ts)
  ===========================================================================================
  Export workbook: writes current row.revision into hidden column `import_revision`
  Import workbook:
   - Create row: import_revision must be null or 0        (else refuse errors.price_book_stale)
   - Update row: unit must equal before.unit AND
                 (values unchanged OR import_revision == before.revision)
                                                          (else refuse errors.price_book_stale)
   - Transform strips import_revision before write; DB CHECK enforces import_revision IS NULL
```

---

## 7. Credit exposure, release approvals and `t_Log` check

Kingdee credit control runs under two supported KIS policies (`kis-sales-out-v1` and
`kis-org-credit-v1`). On `kis-sales-out-v1`, unaudited blue delivery orders blocked by credit
control enter `credit_releases` for dual-party sign-off verified against Kingdee's `t_Log`.

```text
  CREDIT EXPOSURE FORMULA (computeCreditExposure, src/integration/kingdee/credit-source.ts)
  =========================================================================================
  kis-sales-out-v1: reads ICCreditOption (FGroupID=2, FCreditControl=2, FRangeCustom in {1,2,3})
                    + decodes FMainAmtCustom bitmask against 8 ICCreditField catalogue items
                    + loads per-customer limits & overdue days from ICCreditObject
  kis-org-credit-v1: reads t_Organization.FIsCreditMgr / FCreditLimit + fixed 7-term exposure

  exposure = + invoices_audited     - invoices_paid
             + refunds_unsettled    - receipts_unsettled    - advances_unsettled
             + stock_out_audited    - stock_out_hooked     [+ current_bill when testing a DO]

  credit_snapshots: computed credit_available = credit_limit - credit_used

  CREDIT RELEASE STATE MACHINE & SEPARATION OF DUTIES (credit_releases/+model.ts)
  ===============================================================================
  Sync detects blocked unaudited blue DO (ICStockBill type 21, FStatus=0, FROB<>-1)
  Computes content_hash = SHA-256(total + sorted [item_id, qty, amount])
  Creates row: external_code = 'do:<fid>:<oper_date>', source_status='blocked', approval='none'
  Effect notifies: commercial_managers + finance + order.owner  (once: cr:blocked:<id>)
       |
       v
  +-------------------------------------------------------------------+
  |  source_status = 'blocked', approval_status = 'none'              |
  |  computed status = 'blocked'                                      |
  +--+-----------------------------------+----------------------------+
     |                                   |
     | Member requests release           | Kingdee state changes before approval:
     | (sets route: one_time|permanent,  |  - DO deleted/cancelled   --> 'withdrawn' (terminal)
     |  reason, proposed_limit > limit   |  - Customer pays & audits --> 'cleared'   (terminal)
     |  when permanent)                  |  - Audited WITH XS100016  --> 'bypassed'  (terminal)
     |                                   |    log (no approval!)         Effect alerts Managers
     | Initiator-dependent SoD gate:     |                               & Finance (cr:bypass)
     |  - Sales    -> CM -> Finance      |
     |  - Manager  -> Finance            |
     |  - Finance  -> Commercial Mgr     |
     | (No single role can self-approve) |
     v
  +-------------------------------------------------------------------+
  |  source_status = 'blocked', approval_status = 'approved'          |
  |  computed status = 'approved'                                     |
  |  Transform locks: approved_content_hash = before.content_hash     |
  |  Effect notifies: finance + logistics + order.owner               |
  |   - permanent -> raise limit in Kingdee (or auto-write if         |
  |                  directWriteCreditLimit=true) & audit DO          |
  |   - one_time  -> release DO in Kingdee with credit-mgr password   |
  |                  OR (directWriteCreditLimit=true) temp-bump       |
  |                  ICCreditObject (+over_limit/+overdue_days),      |
  |                  mark temp_bump_status='active' while unaudited,  |
  |                  and auto-deduct back to baseline on DO audit     |
  +--+---------------------------+-----------------------+------------+
     |                           |                       |
     v                           v                       v
  [DO edited in Kingdee      [DO audited WITH        [DO audited WITHOUT
   before audit: oper_date    t_Log FFxn='XS100016'   XS100016 log yet]
   or content_hash drifts]    regex match]                |
     |                           |                        v
     v                           +-- hash matches    Wait 1 poll tick grace
  source_status='superseded'     |   approved_hash   (sets audit_seen_at,
  Effect warns finance +         |   --> 'released'   grace_pending=true)
  logistics + owner NOT to       |       (terminal)       |
  release under old approval;    |                        +-- Log appears --> 'released'
  opens NEW 'blocked' row if     +-- hash mismatch        +-- Still no log -> 'cleared'
  edited DO is still blocked         --> 'bypassed'           (customer became eligible)
```

---

## 8. Stock availability, commitments and FIFO lot costing

Warehouse stock availability combines on-hand lot balances (`stock_snapshots`) with open ERP
commitments (`source_stock_commitments`), while draft order cost warnings use exact uniform-cost
receipt lots (`source_lot_costs`) with fail-closed freshness and unit guards.

```text
  PER-REGION STOCK AVAILABILITY (stockAvailability, src/lib/stock-availability.ts)
  ================================================================================
  +------------------------+          +-------------------------------+
  | stock_snapshots        |          | source_stock_commitments      |
  | (SKU, warehouse, lot,  |          | (SKU, region, promised_out,   |
  |  on_hand, unit, as_of) |          |  promised_in, unit)           |
  +-----------+------------+          +---------------+---------------+
              |                                       |
              | map warehouse -> region =             |
              |   warehouse.group_code || name        |
              +-------------------+-------------------+
                                  v
              Group by (product, region) [or null if unassigned]:
                projected = on_hand + promised_in - promised_out
                short     = (projected < 0)     [rendered as red 'Short' badge]
                                  |
                                  v
              Freshness & unit gate:
                - Units must match after normalization (exact unit equality)
                - confirmedAt = now when ledger is connected & feed not in status.failing
                  (avoids false staleness during quiet zero-change ticks)
                - Fresh iff |now - confirmedAt| < commercial_settings.stock_fresh_minutes (30m)

  FIFO & WEIGHTED-AVERAGE LOT COSTING (estimateFifoCost / averageLotCost, src/lib/lot-cost.ts)
  ===========================================================================================
  source_lot_costs (Kingdee receipt SQL: requires MIN(unit_cost) == MAX(unit_cost) per lot)
       |
       v
  Select positive stock_snapshots for (product, warehouse)
  Check guards (FAIL CLOSED -> return null if ANY guard fails):
   1. Feeds fresh (< stock_fresh_minutes) & same currency as order
   2. Every snapshot lot exists in source_lot_costs with uniform unit cost
   3. Sum(on_hand) for each lot <= total received_qty in source_lot_costs
   4. Lot unit convertible to order line unit (exact or SI kg <-> tonne)
       |
       v
  Sort warehouse lots by (received_on ASC, lot_number ASC)  [oldest first]
  Consume requested order_line.quantity across oldest lots:
   - Sufficient lots -> weighted FIFO unit cost across consumed tranches
   - Insufficient qty -> return null (UI falls back to weighted-average lot cost warning)
```

---

## 9. Bilingual document publishing and on-demand PDF pipeline

Six fixed document slots (`{quotation, sales_contract, purchase_contract}` x `{en, zh}`) live in
`document_templates`. Published versions are DB-locked as historical evidence; PDFs render on
demand in memory without creating stored file rows unless a user files a signed copy in
`order_files`.

```text
  SLOT & LANGUAGE RESOLUTION (src/data/model/orders/order-pdf.ts)
  ===============================================================
  Order { direction, status, currency }
       |
       +--> kind:   direction=='sales' && status!='confirmed'  --> 'quotation'
       |            direction=='sales' && status=='confirmed'  --> 'sales_contract'
       |            direction=='purchasing'                    --> 'purchase_contract'
       |
       +--> locale: currency == 'CNY'                          --> 'zh'
       |            all other currencies                       --> 'en'
       |
       +--> select NEWEST document_templates row where
            (kind, locale, status == 'published')

  TEMPLATE VERSION LIFECYCLE (document_templates/+model.ts)
  =========================================================
  [draft (v1)] --edit/validate--> [published (v1)]  (sets published_at; DB constraint LOCKED)
                                        |
                                        +--- "Revise" clones fields ---> [draft (v2)] -> ...

  RENDERING & STAMP PIPELINE
  ==========================
  Resolved template + Order + Lines + Party + Buyer Contact + Logistics Handler + print_values
       |
       +--> Seller contract_stamp gate:
       |      - sales (quotation / sales_contract): optional in preview, ON in batch .zip
       |      - purchasing (purchase_contract):     ALWAYS null (never stamps a supplier PO)
       |
       +--> Render mode dispatch:
              |
              +-- 1. print_layout attached (HTML <= 3 MiB, UTF-8)
              |       Replace {{field}}, {{#lines}}...{{/lines}}, {{detail_<key>}},
              |       {{letterhead}} & {{stamp}} (PNG <= 512 KiB data URIs),
              |       cnyInWords, kg->tonne & KGS/MT helpers (all values HTML-escaped)
              |       --> { layout_html }
              |
              +-- 2. layout == 'table_v1' (built-in structured A4 HTML table)
              |       commercialDocument() + letterhead/stamp injection --> { html }
              |
              +-- 3. layout == 'text' (built-in structured paragraphs)
                      renderOrderDocument() --> { html }
       |
       v
  ctx.preview_pdf(source, { page: 'A4' })
   - Chromium headless converter: scripts BLOCKED, external network BLOCKED, Noto Sans CJK SC
   - Single order: displayed in browser PDF preview modal (in-memory only)
   - Multi-order:  bundled client-side into .zip archive (src/lib/xlsx.ts zip())
   - Signed copy returned by customer/supplier: manually uploaded to order_files
     (confirmed, unarchived orders only; PDF/JPEG/PNG <= 20 MiB)
```

---

## 10. Commission rule lock, CEL evaluation and sign-off

Commission rules are never applied retroactively to confirmed orders: confirming an order stamps
the active rule and freight treatment permanently onto `orders.commission`. Monthly sign-off uses
optimistic content hashing so managers cannot acknowledge stale numbers.

```text
  1. ORDER CONFIRMATION SNAPSHOT (orders/+model.ts)
  =================================================
  orders (draft -> confirmed) [local confirm OR Kingdee Pass-2 import]
       |
       +--> commissionRule(active 'default' rules, order.currency, order.ordered_on)
       |      picks newest effective_on <= ordered_on
       +--> stamps orders.commission { rule_id, engine_version, eligibility_expression,
       |      amount_expression, parameters[], basis_unit, fixed_rate, spread_pct }
       +--> stamps orders.freight_treatment from commercial_settings ('deduct' | 'include')

  2. MONTHLY COMMISSION EVALUATION (monthly-commission.ts & commission-expressions.ts)
  ====================================================================================
  Query active source_sales_lines (kind in ['shipment', 'return']) in [period, period + 1 month)
  joined to confirmed sales orders + order_lines + pricing_floors
       |
       v
  For each fact line, build CEL context (engine: cel-decimal-v1, exact BigDecimal, min/max):
   - quantity       = abs(fact.quantity)
   - net            = abs(booked_net)   [adjusted by order.freight_treatment]
   - ratio          = unitRatio(line.unit, rule.basis_unit)  (SI mass: kg <-> t)
   - basis_quantity = quantity * ratio
   - spread         = (net / quantity - floor_net) / ratio    (scale=18)
   - Default amount_expression:
       basis_quantity * (rule.fixed_rate + max(spread, 0) * rule.spread_pct / 100)
   - If fact.kind == 'return' --> BigDecimal.negate(amount)
       |
       v
  Line status classification:
   - resolved | ineligible (0)
   - Unresolved blockers: rule_missing | floor_missing |
                          unit_mismatch | expression_error
       |
       v
  Aggregate per (owner, currency):
   - Any unresolved line --> row.amount = null, state = 'unresolved' (blocks acknowledgement)
   - Pending line $approval --> state = 'awaiting_approval'
   - Hash = SHA-256({ owner, period, currency, snapshot })
   - Compare against latest commission_statements row:
       none -> 'unacknowledged' | same hash -> 'current' | newer hash -> 'changed'

  3. OPTIMISTIC HASH ACKNOWLEDGEMENT (commission_statements/+model.ts)
  ====================================================================
  Manager or Finance submits { owner, period (YYYY-MM-01), currency, calculation_hash }
       |
       v
  create.transform (server-side re-verification):
   1. Actor must be member (commission_member); period day == '01' (commission_month)
   2. Re-read ALL pages via reportPages() -> catch ReportRowsChanged (commission_incomplete)
   3. Re-run calculateBoard() from scratch on server
   4. Assert: row exists (commission_nothing), amount != null (commission_unresolved),
              recomputed hash == input.calculation_hash (commission_changed),
              not already acknowledged with same hash (commission_unchanged)
   5. Insert immutable CS-{yyyy}-{0000} row (UK: owner, period, currency, calculation_hash)
      Prior statements remain intact; later shipment/return edits produce a new superseding row
```

---

## 11. Financial analysis, as-at AR/AP aging and expense split

All financial reports keep every currency separate (no fabricated FX rollups). The sole FX
conversion in the workspace converts foreign sales net to inventory cost currency using the order's
Kingdee `exchange_rate` so Sales Analysis can compute margin accurately.

```text
  A. SALES ANALYSIS (sales-analysis.svelte + src/lib/reports.ts)
  ==============================================================
  Basis selector:
   - Invoice basis  --> source_sales_lines (kind='invoice' + deduplicated 'invoice_only')
   - Delivery basis --> source_sales_lines (kind in ['shipment', 'return'])
       |
       +--- Backward lot join (product_code, lot_number) ---> source_purchase_lines
       |      surfaces PO ref, supplier, purchase unit price, invoices, AP payment state
       |
       +--- Forward order join -----------------------------> transactions & source_payments
       |      surfaces sales invoices, due date, AR collection state (salesCollection)
       |
       +--- Margin math:
              booked_net  = freight_treatment=='deduct' ? net - freight : net
              cost        = booked_cost (preferred; masked in 'commercial' output) ?? lot_cost
              net_in_cost = currency==cost_ccy ? booked_net : booked_net * kingdee.exchange_rate
              margin      = net_in_cost - cost ;  margin_rate = margin / net_in_cost

  B. AS-AT AR / AP AGING ROLLBACK (src/lib/receivables.ts & payables.ts)
  ======================================================================
  Inputs: as_of (min cutoff 2024-12-31, default last month-end), basis ('gross' | 'estimated')
       |
       v
  Load source_receivables / source_payables shards (fallback: transactions + source_payments
  for ledgers without account-wide snapshots)
       |
       v
  As-at balance reconstruction:
   remaining(as_of) = current_remaining + SUM(settlements.amount WHERE settlement.on > as_of)
       |
       +-- basis == 'gross':
       |     Bucket open invoices directly by (as_of - due_on):
       |       not_due | 1_30 | 31_60 | 61_90 | over_90
       |     Keep unapplied / credit / overpaid separate (never invents settlements)
       |
       +-- basis == 'estimated' (estimateAging):
             Per (ledger, party, currency), pool positive (unapplied + credit)
             Apply FIFO against oldest due_on invoices to estimate aged buckets
             (net total stays unchanged; unapplied/credit remainder shown separately)
       |
       +-- AP additions: related_party vs third-party filter & split + GL 2202.03 accrued-not-
           invoiced period note from shard 0

  C. PURCHASE LISTING & EXPENSE ALLOCATION (src/lib/purchase-listing.ts)
  ======================================================================
  Primary source: source_purchase_orders (YYYY-MM) + fallback to uncovered local confirmed POs
  Expenses from Kingdee ICExpenses: code '005' (customs duty), code '002' (import VAT)
       |
       v
  allocateExpenses(): weight by ICHookRelations (fallback: quantity)
   - Round each line share half-up to currency digits
   - Assign rounding remainder to the LAST line so SUM(allocated) == exact expense invoice total
   - Expenses without matching PO or dated before start surface as explicit side notices
```

---

## 12. Access control, output masking and separation of duties

Six seeded teams hold one user policy each (`seed/public/sys_team.json`); source names policies,
never teams, and an approval step goes to the teams holding its policy. Two reserved system
policies (`kingdee_sync` and `source_health`) execute background syncs and health alerts.

```text
+-------------------+--------------------+-----------------------------------------------------+
| Team -> Policy    | App capability     | Read scope, output masking & write / approval gates |
+-------------------+--------------------+-----------------------------------------------------+
| Sales             | operations         | READ: own sales orders + children (direction='sales'|
| -> sales          |                    |   & owner==actor.id); own user_profiles row;        |
|                   |                    |   source_sales_lines via 'commercial' output; own   |
|                   |                    |   commission_statements & credit_releases;          |
|                   |                    |   published document_templates; masters/stock;      |
|                   |                    |   sys_user limited to self + logistics team.        |
|                   |                    | WRITE: own user_profiles; own SOs & lines           |
|                   |                    |   (floor_rule=='approve' holds below-floor lines);  |
|                   |                    |   draft SO delete -> ALWAYS commercial_managers;    |
|                   |                    |   credit_releases.update -> 2-step CM -> Finance;   |
|                   |                    |   non-primary contacts CRUD; own order_files/acts.  |
+-------------------+--------------------+-----------------------------------------------------+
| Procurement       | operations         | READ: ALL purchasing orders (direction='purchasing')|
| -> procurement    |                    |   + children; own user_profiles; source_purchase_*; |
|                   |                    |   source_sales_lines via 'commercial' output;       |
|                   |                    |   published templates; masters/stock/credit/floors. |
|                   |                    | WRITE: own user_profiles; direct PO create/update/  |
|                   |                    |   confirm (no PO delete, no floor approval);        |
|                   |                    |   order_files; activities; non-primary contacts.    |
+-------------------+--------------------+-----------------------------------------------------+
| Commercial Mgrs   | operations         | READ: ALL sales & purchasing orders + ALL ERP       |
| -> manager        |                    |   mirrors + ALL user_profiles; published templates. |
|                   |                    | WRITE: own user_profiles; partner extra profile     |
|                   |                    |   fields; parties.credit_limit_target / days_target |
|                   |                    |   -> requires Finance sign-off; direct SO/PO CRUD;  |
|                   |                    |   approves Sales floor & draft-delete holds;        |
|                   |                    |   creates commission_statements; non-primary contacts|
|                   |                    |   credit_releases.update -> requires Finance signoff|
+-------------------+--------------------+-----------------------------------------------------+
| Finance           | operations         | READ: ALL orders, lines, files (read-only) + ALL    |
| -> finance        |                    |   financial & ERP mirrors + ALL user_profiles.      |
|                   |                    | WRITE: own user_profiles; commission_statements;    |
|                   |                    |   parties.related_party & extra profile fields;     |
|                   |                    |   parties.credit_limit_target / days_target ->      |
|                   |                    |   requires Commercial Manager sign-off; activities; |
|                   |                    |   non-primary contacts; credit_releases.update ->   |
|                   |                    |   requires Commercial Manager sign-off.             |
+-------------------+--------------------+-----------------------------------------------------+
| Logistics         | operations         | READ: 'logistics' output on orders, order_lines,    |
| -> logistics      |                    |   transactions, credit_releases, products,          |
|                   |                    |   stock_snapshots, commercial_settings (STRIPS ALL  |
|                   |                    |   unit prices, totals, floors, costs, margins,      |
|                   |                    |   credit amounts, proposed limits); parties, whs,   |
|                   |                    |   contacts, source_stock_commitments, sys_user.     |
|                   |                    | WRITE: activities create/update ONLY.               |
+-------------------+--------------------+-----------------------------------------------------+
| Configurators     | trade_configuration| READ: document_templates (all drafts+published),    |
| -> configuration  | ONLY               |   commercial_settings, pricing_floors,              |
|                   | (NO orders/AP/AR)  |   commission_rules, masters/stock/lot costs/credit. |
|                   |                    | WRITE: document_templates create/edit/publish;      |
|                   |                    |   pricing_floors & commission_rules create/update;  |
|                   |                    |   commercial_settings (freight_treatment,floor_rule)|
+-------------------+--------------------+-----------------------------------------------------+
| (System)          | (none - syncs)     | kingdee_sync: writes all 19 ERP mirrors + orders    |
| -> kingdee_sync   |                    |   (draft->confirmed) + order_lines; on              |
|                   |                    |   credit_releases can write ONLY syncFields (cannot |
|                   |                    |   modify approval_status/route/proposed_limit/hash).|
+-------------------+--------------------+-----------------------------------------------------+
| (System)          | (none - auto)      | source_health: reads sys_integration (kingdee) &    |
| -> source_health  |                    |   active admin sys_user rows to dispatch alerts.    |
+-------------------+--------------------+-----------------------------------------------------+
```

---

Back to [Documentation index](README.md) · Previous: [Manual probe matrix](0008-manual-probe-matrix.md)
