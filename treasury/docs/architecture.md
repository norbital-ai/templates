# Treasury Architecture and Inner Mechanisms

Technical deep-dive into the `templates/treasury` Bolt workspace (`norbital-treasury`). Every symbol, constraint, formula, policy, and automation flow below is traced directly from `src/`.

## Table of Contents

1. [System Topology and Runtime Architecture](#1-system-topology-and-runtime-architecture)
2. [Data Model and Ownership ER Diagram](#2-data-model-and-ownership-er-diagram)
3. [Drawdown Lifecycle, Bill Conversion, and Sealing State Machine](#3-drawdown-lifecycle-bill-conversion-and-sealing-state-machine)
4. [Bank Advice Document Intelligence and Mandatory Approval Pipeline](#4-bank-advice-document-intelligence-and-mandatory-approval-pipeline)
5. [Purchasing, Invoice Cross-Check, and Financing Request PDF Pack Pipeline](#5-purchasing-invoice-cross-check-and-financing-request-pdf-pack-pipeline)
6. [Core Financial Calculation Engines](#6-core-financial-calculation-engines)
7. [Month-End Closing, Immutability Guards, and Dual-Mode Export Sync](#7-month-end-closing-immutability-guards-and-dual-mode-export-sync)
8. [FX Hedging Engine, MAS Rates Feed, and Bootstrap Simulation](#8-fx-hedging-engine-mas-rates-feed-and-bootstrap-simulation)
9. [Unified Attention Engine and Daily Alert Fan-Out](#9-unified-attention-engine-and-daily-alert-fan-out)
10. [Access Control, Isolation, and Authority Matrix](#10-access-control-isolation-and-authority-matrix)

---

## 1. System Topology and Runtime Architecture

The workspace runs on Singapore reporting time (`Asia/Singapore`, locale `en-SG`, bilingual `en`/`zh`, `convert: { to: ['pdf'] }`). Pages and automations share one set of pure `BigDecimal` calculation modules under `src/lib/` so live UI views, scheduled digests, month-end closing snapshots, and spreadsheet exports never drift.

```text
+--------------------------------------------------------------------------------------------+
|                               CLIENT SURFACES (Svelte 5 / Bolt UI)                         |
|                                                                                            |
|  +------------------+  +------------------+  +------------------+  +--------------------+  |
|  | treasury (6 pgs) |  | hedging (4 pgs)  |  | purchasing (3)   |  | configuration (3)  |  |
|  | - dashboard      |  | - overview       |  | - partners       |  | - banks            |  |
|  | - drawdowns      |  | - deals (2 tabs) |  | - purchase_orders|  | - facilities       |  |
|  | - advices        |  | - fixings (3 tab)|  | - facility_forms |  | - fx_rates         |  |
|  | - alerts         |  | - planning       |  +------------------+  +--------------------+  |
|  | - costs (3 tabs) |  +------------------+                                                |
|  | - month_end      |                                                                      |
|  +------------------+   +---------------------------------------------------------------+  |
|                         | 10 Custom Record Views (+representation.svelte)               |  |
|                         | bank | facility | business_partner | drawdown | bank_document |  |
|                         | purchase_order | facility_form | fx_deal | fx_document |      |  |
|                         | fx_proposal                                                   |  |
|                         +---------------------------------------------------------------+  |
|                                               |                                            |
|        ctx.query / ctx.act / ctx.run / ctx.sync_control / ctx.clock('day')                 |
+-----------------------------------------------|--------------------------------------------+
                                                v
+--------------------------------------------------------------------------------------------+
|                   SHARED PURE DOMAIN ENGINE (src/lib/* - BigDecimal & UTC dates)           |
|  calculations.ts | products.ts (37) | charges.ts | treasury.ts | purchasing.ts             |
|  fx.ts (11 structs, 3k-path bootstrap) | attention.ts (6 models) | documents.ts            |
+-----------------------------------------------|--------------------------------------------+
                                                v
+--------------------------------------------------------------------------------------------+
|                       BOLT SERVER RUNTIME & AUTHORITY BOUNDARY                             |
|                                                                                            |
|  +-----------------------------+   +----------------------------------------------------+  |
|  | 4 Teams -> 4 Human Policies |   | 7 Scoped Automation Policies                       |  |
|  | treasury | finance          |   | bank_advices (ALWAYS ctx.approve -> Treasury!)     |  |
|  | purchasing | viewers        |   | month_end_closing | facility_forms | po_earmarks   |  |
|  +-----------------------------+   | purchase_orders | fx_reader | fx_rates             |  |
|                                    +----------------------------------------------------+  |
|                                                                                            |
|  +-----------------------------+   +----------------------------------------------------+  |
|  | 26 Data Models (9 Roots)    |   | 17 Automations                                     |  |
|  | - Transforms & Write Guards |   | - 6 Drawdown lifecycle ops                         |  |
|  | - Native Locks & Transitions|   | - 5 AI doc readers (ctx.convert.ingest + sys_2)    |  |
|  | - Post-Commit Effects       |   | - 1 PDF pack builder (ctx.convert.record + pdf-lib)|  |
|  | - Computed & Roll-up Fields |   | - 2 Month-end close/reopen ops                     |  |
|  +--------------+--------------+   | - 2 Cron jobs (daily_alerts 08:00, fx_rates 13:30) |  |
|                 |                  | - 1 Advice submitter (bank_document_apply)         |  |
|                 v                  +--------------------------+-------------------------+  |
|  +-----------------------------+                              |                            |
|  | 1 File Sync                 |                              |                            |
|  | month_end_line/+sheet.sync  |                              |                            |
|  | (XLSX / CSV export only)    |                              |                            |
|  +-----------------------------+                              |                            |
+---------------------------------------------------------------|----------------------------+
                                                                v
+--------------------------------------------------------------------------------------------+
|                         EXTERNAL & HOST SERVICES                                           |
|  - mas_rates HTTP integration -> MAS Daily Exchange Rates API (auth header: keyid)         |
|  - Native Host AI (ctx.ai.sys_2.infer) + Native Document Ingest / PDF Record Converter     |
|  - Native Approval Engine (ctx.approve) & Team Notifications (ctx.notify)                  |
|  - Norbius Assistant (src/agent/+agent.md) inheriting caller's exact team policy           |
+--------------------------------------------------------------------------------------------+
```

### Key Architectural Invariants

1. **Single calculation authority:** Every interest, accrual, utilization, headroom, charge estimate, invoice check, FX outcome, and attention calculation lives in `src/lib/`. Pages evaluate live projections reactively from `ctx.query(...)` using `ctx.clock('day')`; automations (`month_end_lock`, `daily_alerts`, `drawdown_settle`) invoke the exact same functions.
2. **Incomplete-page guard on analytical pages:** Dashboard (`+dashboard.page.svelte`) and Costs (`+costs.page.svelte`) check whether any query page returned a non-null `next` cursor and refuse to render partial totals (`reports.incomplete`). Conversely, `month_end_lock` and `bank_document_read` explicitly paginate cursors so closing snapshots and advice matching never operate on truncated sets.
3. **Zero client-side privilege elevation:** Business operations that cross role boundaries (such as `drawdown_earmark_po`, `bank_document_apply`, `month_end_lock`, and AI readers) run as declared automations under minimal scoped policies rather than granting broad model writes to human teams.

---

## 2. Data Model and Ownership ER Diagram

All 26 models sit under 9 ownership roots in `src/data/model/`. A child model lives inside its owner's directory; only the leaf directory names the model.

```text
==============================================================================================
  ROOT 1: bank                    ROOT 2: facility                 ROOT 3: business_partner
==============================================================================================
  +----------------------+        +----------------------+         +------------------------+
  | bank                 |<--R----| facility             |         | business_partner       |
  | [U] code (import_key)|        | [U] (bank, name)     |         | (was: supplier)        |
  | json: contacts[]     |        | limit, margin_pct    |         | [U] name (import_key)  |
  | offered_products[]   |        | day_count_basis      |         | role: sup|cust|both    |
  +---+----+----+--------+        | interest_rounding    |         | aliases[] (text idx)   |
      |    |    |                 +---+--------------+---+         +---+--------+-----------+
      |    |    +--[C]--> watch_point |              |                 |        |
      |    |              (fac: SN)   +--[C]--> facility_fee (via fac) |        |
      |    |                          |         flat | % + min_curr    |        |
      |    +--[R]--> letter_of_offer  +--[C]--> sub_limit              |        |
      |              (fac: SN)                  (supplier: SN) --------+        |
      |              *tx: next_review_date -> facility.review_date              |
      |                                                                         |
      +------------[C]------------------> supplier_bank <----------[C]----------+
                                          [U] (supplier, bank)  (via partner)

==============================================================================================
  ROOT 4: drawdown                ROOT 5: month_end                ROOT 6: fx_rate
==============================================================================================
  +-----------------------------+     +-----------------------+    +------------------------+
  | drawdown                    |     | month_end             |    | fx_rate                |
  | facility (opt, R) -> fac    |     | [U] month (1st of mo) |    | [U] (currency,         |
  | supplier (opt, R) -> bp     |     | source: portal|excel  |    |      rate_date)        |
  | converted_from (SN)-> self  |     | is_locked, locked_at  |    | usd_per_unit (sc:12)   |
  | [C*] amount_usd             |     | 13 headline figures   |    | preliminary (bool)     |
  | [S*] invoiced_amount        |     +-----------+-----------+    +------------------------+
  | [LOCK] sealed_line          |                 |
  +---+-------------+-----------+            [C] (via month_end)
      |             |                             v
      |             +--[C]--> drawdown_charge   +---------------------------+
      |                       (via drawdown)    | month_end_line            |
      |                       [C*] amount_usd   | drawdown (opt, SN) -> dd  |
      |                                         | +sheet.sync.ts (XLSX/CSV) |
      +--[SN]<-- bank_document                  +---------------------------+
                 (bank: SN)
                 [LOCK] submitted_advice (read_status=='applied')

==============================================================================================
  ROOT 7: purchase_order
==============================================================================================
  +-------------------------------------+
  | purchase_order                      |---> supplier (opt, R) -> business_partner
  | [U] po_number                       |
  | [S*] amount, quantity, invoiced_amt |     *tx: payment_date must be Tue (urgent) or Fri
  | [K*] invoice_count                  |
  +--+-------+-------+--------+---------+
     |       |       |        |
     |       |       |        +--[C]--> po_financing <--[C]-- drawdown  [U] (po, drawdown)
     |       |       +--[C]--> po_document  (*fx: kind=='purchase_order' -> po_read)
     |       +--[C]--> po_line (via po) [S*] invoiced_quantity
     |                     ^
     |                    [R]
     +--[C]--> invoice (via po) [U] (po, invoice_number) ---(SN)---> drawdown
     |           |
     |           +--[C]--> invoice_line (via invoice) -> po_line
     |
     +--[SN]<-- facility_form  (*tx: facility_required=='lc' -> po.lc_requested=true)
                  |
                  +--[C]--> facility_attachment  (*fx: -> facility_form_read)

==============================================================================================
  ROOT 8: fx_deal                                          ROOT 9: fx_proposal
==============================================================================================
  +--------------------------------+                       +-----------------------------+
  | fx_deal                        |---(SN)--------------->| fx_proposal                 |
  | bank (opt, SN) -> bank         |                       | bank (opt, SN) -> bank      |
  | status: proposal->draft->live  |                       | text / file (1 required)    |
  | pair (6-char norm), strike, KO |                       | *fx: -> fx_proposal_read    |
  +------+----------------+--------+                       +-----------------------------+
         |                |
         +--[C]--> fx_fixing (via fx_deal, idx: fixing_date)
         +--[SN]<-- fx_document (bank: SN, *fx: -> fx_document_read)

Legend: [U] unique constraint | [C] on_delete: cascade | [R] restrict | [SN] set_null
        [C*] CEL computed | [S*] sum roll-up | [K*] count roll-up | *tx transform | *fx effect
```

### Cross-Model Side-Effect Transforms

Two model transforms synchronize cross-record business facts atomically inside the caller's write transaction:

- **`letter_of_offer` (`reviewDates` transform):** Creating or updating a letter of offer with a `facility` and `next_review_date` updates `facility.review_date` in the same transaction (`with: { facility: { update } }`), ensuring the 60-day facility review alert tracks the latest offer letter automatically.
- **`facility_form` (`askForLc` transform):** Creating or updating a financing request with `facility_required === 'lc'` and a linked `purchase_order` sets `purchase_order.lc_requested = true` (when currently `false`), immediately placing that order in the Attention queue's _LCs to open_ list.

---

## 3. Drawdown Lifecycle, Bill Conversion, and Sealing State Machine

A `drawdown` record tracks one financing obligation from planned payment through bank allocation, disbursement, and final settlement or cancellation. Native model transitions enforce forward-only progression; `sealed_line` freezes settled and cancelled records.

```text
                 [Finance / Treasury]              [Treasury: drawdown_allocate]
              (create or drawdown_earmark_po)       (sets facility, day_count_basis,
                          |                          optional product / manual rate)
                          v                                   +-----+
                   +-------------+                            |     |
                   |  earmarked  |<---------------------------+-----+
                   +--+---+---+--+       (stays earmarked; reduces planning headroom)
                      |   |   |
        +-------------+   |   +------------------------------------+
        | (direct edit    | (drawdown_record_advice                | (drawdown_cancel)
        |  by Treasury)   |  -> Treasury approval)                 |
        v                 |                                        v
  +-----------+           |                                 +-------------+
  |  applied  |           |                                 |  cancelled  |  [TERMINAL]
  +--+-----+--+           |                                 |  (SEALED)   |
     |     |              |                                 +-------------+
     |     +--------------+-------------------+                    ^
     | (drawdown_record_advice                | (direct cancel)    |
     |  or Treasury update)                   +--------------------+
     v                                        |                    |
  +-----------+                               |                    |
  |  active   |-------------------------------+--------------------+
  +--+-----+--+                                                    |
     |     |                                        +-----------+  |
     |     | (drawdown_settle -> Treasury approval) |  unclear  |--+ (cancel)
     |     | (settled_by='repaid', is_archived=true)| (imported |---> active / settled
     |     v                                        |  legacy)  |
     |  +-------------+                             +-----------+
     |  |   settled   |  [TERMINAL | SEALED]
     |  |  (archived) |  Only editable fields: is_archived, discrepancy_note, notes
     |  +-------------+
     |
     |  [drawdown_close_bill -- only for applied/active LC, import_bill, DA, TB]
     +---> how='cash'    ==> Old bill -> settled (settled_by='cash', interest=0, archived)
     |                       + settlement-stage charges saved on bill.
     |
     +---> how='convert' ==> ATOMIC TRANSACTION (zero double counting):
                             1. Old bill -> settled (settled_by='converted',
                                interest=0, archived, settlement charges cleared)
                             2. New drawdown -> active (status='active',
                                converted_from=old.id, product=if | if_after_lc_or_da,
                                preserves lc_number & bill_number, drawdown charges)
                             3. po_financing -> clones every PO link onto new drawdown
                             4. invoice -> repoints every invoice.drawdown from old
                                bill to new drawdown via purchase_order.update
```

### Write-Time Guards on `drawdown`

- **`due_after_start` check constraint:** Requires `due_date > start_date` whenever both dates are present.
- **`sealed_line` lock constraint:** Locks every row whose `status` is `settled` or `cancelled`, allowing edits only to `is_archived`, `discrepancy_note`, and `notes`.
- **Bill conversion eligibility (`CONVERTIBLE` in `src/lib/products.ts`):**
  - `lc`, `import_bill` -> `if` or `if_after_lc_or_da`
  - `da`, `tb` -> `if_after_lc_or_da`
  - Because `drawdown_close_bill` seals the old bill (no longer in `OPEN = ['applied', 'active']`) and creates the new active line in a single `ctx.act`, bank utilization never double-counts the principal while maintaining complete audit lineage via `converted_from`, `lc_number`, and `bill_number`.

---

## 4. Bank Advice Document Intelligence and Mandatory Approval Pipeline

Uploading a bank advice PDF never mutates a `drawdown` directly. Even when the AI reader finds a unique open financing line, the mutation runs under the `bank_advices` automation policy, whose `drawdown.update` verdict unconditionally requires native Treasury approval.

```text
  [Treasury uploads PDF] (bank_document.create, accept: application/pdf <= 10 MiB)
            |
            | create effect -> ctx.schedule('bank_document_read', key: read:<id>:<rev>)
            v
  +------------------------------------------------------------------------------------+
  | bank_document_read (policy: bank_advices)                                          |
  |  1. documentSource(): ctx.convert.ingest(file, pictures: true)                     |
  |     + for every page in index.no_text (scanned pages), renders page image          |
  |  2. ctx.ai.sys_2.infer(output: ADVICE + doc_type, bank_code, advice_date)          |
  |     - Copies printed figures only; never calculates; strips account numbers;       |
  |       lists uncertain fields; USD charges only.                                    |
  |  3. On failure -> read_status='failed', read_note=error (Retry button shown in UI) |
  |  4. Reference matching (only if doc.drawdown is null):                             |
  |     - Normalize [bank_reference, lc_number, bill_number] -> A-Z0-9, len >= 6       |
  |     - Paginate open drawdowns (earmarked|applied|active|unclear, 1000/page)        |
  |     - Match issuer bank (if known) + currency + ref match against                  |
  |       [d.bank_reference, d.lc_number, d.bill_number, ...d.invoices.bank_bill_no]   |
  |     - Stop once matches >= 2 (ambiguous). Link drawdown ONLY if matches === 1!     |
  |  5. bank_document.update: read_status='checked', extracted, bank, unique drawdown  |
  +-----------------------------------------+------------------------------------------+
                                            |
           +--------------------------------+-----------------------------+
           | (0 or >=2 matches, or 'other')                               | (Unique match +
           v                                                              |  drawdown_advice or
  [Stays 'checked' in Bank advices UI]                                    |  settlement_advice)
  Treasury inspects PDF side-by-side                                      v
  with live adviceChecks() arithmetic:               bank_document update effect fires
  - Days: due - start == interest_days?              key: submit:<id>:<rev>
  - Interest: expected(basis,round) == printed?                           |
  - Total debited == charges (DD) or                                      v
    principal+interest(+charges) (Settle)?           +---------------------------------------+
           |                                         | bank_document_apply (bank_advices)    |
           | (Treasury edits fields or links line)   | Validates required extracted fields   |
           +---------------------------------------->| Schedules key: advice:<id>:<rev>:     |
                                                     |  - drawdown_advice ->                 |
                                                     |      drawdown_record_advice           |
                                                     |  - settlement_advice ->               |
                                                     |      drawdown_settle                  |
                                                     +-------------------+-------------------+
                                                                         |
                                                                         v
  +------------------------------------------------------------------------------------+
  | drawdown_record_advice / drawdown_settle (policy: bank_advices)                    |
  |  - drawdown_record_advice: status->active, replaces 'drawdown' stage charges,      |
  |    writes discrepancy_note if advice rate != manual agreed rate.                   |
  |  - drawdown_settle: status->settled (repaid, archived), replaces 'settlement'      |
  |    stage charges, recomputes interest w/ facility rounding; writes discrepancy_note|
  |    if |expected - printed| >= 0.01.                                                |
  |  - Atomic ctx.act: updates drawdown + charges + sets bank_document='applied'       |
  +-----------------------------------------+------------------------------------------+
                                            |
                                            | bank_advices policy verdict on drawdown.update:
                                            | ALWAYS returns ctx.approve({
                                            |   steps: [{ name:'Treasury review',
                                            |             teams: <teams holding the
                                            |                     treasury policy> }] })
                                            | (refuses errors.no_treasury_team if none)
                                            v
                         +------------------------------------+
                         |   NATIVE APPROVAL HOLD (Pending)   |
                         +---------+----------------+---------+
                                   |                |
                     [Approve]     |                |     [Reject]
                                   v                v
                 +-------------------------+  +-----------------------------+
                 | COMMITTED ATOMICALLY:   |  | CHECKPOINT RESTORED:        |
                 | - drawdown updated      |  | - drawdown unchanged        |
                 | - stage charges replaced|  | - bank_document remains     |
                 | - bank_document locked  |  |   'checked' (unlocked) for  |
                 |   ('applied', no delete)|  |   correction & re-submit    |
                 +-------------------------+  +-----------------------------+
```

Note that even manual clicks on **Record drawdown advice** or **Settle** from a `drawdown` record sheet execute `drawdown_record_advice` / `drawdown_settle` under `bank_advices`, ensuring consistent Treasury approval governance and discrepancy checking on every advice entry.

---

## 5. Purchasing, Invoice Cross-Check, and Financing Request PDF Pack Pipeline

Purchasing operates along two connected tracks that keep commercial documents synchronized with financing without giving purchasers write access to Treasury records.

```text
  TRACK A: PURCHASE ORDER & INVOICE VERIFICATION
  ======================================================================================
  [Purchaser creates PO + attaches PO PDF (po_document.kind='purchase_order')]
        |
        | po_document effect (key: read:<po>:<doc>:<rev>)
        v
  purchase_order_read (policy: purchase_orders, AI sys_2)
        | - Fills ONLY blank fields: po_number (skip if duplicate), po_date, supplier
        |   (matched by normalized name/aliases), salesperson, ship_to_country, notes
        | - If order has 0 lines: sets currency + creates po_line items (qty kg, amount)
        | - Never picks bank or sets lc_requested
        v
  purchase_order (transform: payment_date must be Tue [urgent] or Fri, or null)
        |
        +---> [Finance / Treasury records supplier invoices via purchase_order.update]
        |     invoice + invoice_line -> triggers po_line.invoiced_quantity roll-up
        |     (once invoice_count > 0, Purchasing policy blocks further purchaser edits)
        |           |
        |           v
        |     invoiceFindings() live 5-point verification (src/lib/purchasing.ts):
        |       1. sum(invoice_lines.amount) == invoice.amount
        |       2. invoice.currency == po.currency
        |       3. |invoiced_unit_price - po_unit_price| <= 0.5% * po_unit_price
        |       4. po_line.invoiced_quantity - po_line.quantity <= 0.001 kg
        |       5. If linked to drawdown: same supplier AND drawdown.invoiced_amount
        |          <= drawdown.amount
        |
        +---> [Finance / Treasury clicks "Earmark it" -> drawdown_earmark_po]
              (policy: po_earmarks) Refuses if cancelled, no_financing, covered, no FX,
              or missing supplier/amount. Atomically creates earmarked drawdown
              (expected_draw_date = po.payment_date ?? latest form.pay_by_date)
              + po_financing link.

  TRACK B: FINANCING REQUEST (T/T OR LC) & COMBINED PDF PACK
  ======================================================================================
  [Purchaser creates facility_form + uploads attachments (PDF / JPEG / PNG <= 10 MiB)]
        |
        | facility_attachment effect (key: read:<form>:<att>:<rev>)
        v
  facility_form_read (policy: facility_forms, AI sys_2)
        | - Classifies attachments left as 'other' (purchase_order|proforma|customer_po|
        |   planning_detail|other) and sets title from filename if blank
        | - Reads latest attachment of each fill kind (purchase_order, proforma, customer_po)
        | - Fills blank fields only (never pay_by_date); infers T/T vs LC from payment_terms
        | - Cross-checks PO number, currency, T/T vs LC & proforma diff -> read_note
        | - Auto-links purchase_order by exact po_number match
        v
  facility_form.update (transform: askForLc)
        | - If facility_required == 'lc' & purchase_order linked -> po.lc_requested = true
        v
  [Any user clicks "Download PDF pack" -> facility_form_pack (policy: facility_forms)]
        | 1. ctx.convert.record('facility_form', id, { to: 'pdf' }) -> formatted cover sheet
        | 2. pdf-lib appends A4 sign-off page (Affirmed by / Approved by / Acknowledged)
        | 3. Appends every facility_attachment in created_at ASC order (copies PDF pages;
        |    embeds PNG/JPEG centered on A4). Enforces strict 4 MiB total cap (never silently
        |    drops an attachment; fails with errors.pack_failed or errors.pack_large).
        v
  [Returned FileRef: Facility form-<po_number|draft>-pack.pdf]
```

---

## 6. Core Financial Calculation Engines

All monetary math uses `effect` `BigDecimal` (`src/lib/calculations.ts` and `src/lib/treasury.ts`) to prevent IEEE-754 rounding drift. Every currency amount in portfolio reports is expressed in USD via dated `fx_rate` rows (`USD = original * usd_per_unit`).

```text
  +------------------------------------------------------------------------------------+
  | 1. INTEREST & ACCRUAL (src/lib/calculations.ts)                                    |
  |                                                                                    |
  |  tenor_days   = daysBetween(start_date, due_date)   [start inclusive, due excl.]   |
  |  accrued_days = min(daysBetween(start, as_of) + 1, tenor_days)   [0 if as_of<start]|
  |  raw_interest = principal * rate_pct * days / (100 * (365 if actual_365 else 360)) |
  |  interest     = round(raw_interest, scale: 2,                                      |
  |                       mode: 'to-zero' if down_to_cent else 'half-from-zero')       |
  +------------------------------------------------------------------------------------+

  +------------------------------------------------------------------------------------+
  | 2. CHARGES & STAGE-SUPPRESSION ENGINE (estimateCharges in src/lib/treasury.ts)     |
  |                                                                                    |
  |  For each stage in ['drawdown', 'settlement']:                                     |
  |    Has ANY drawdown_charge row at this stage (even amount = 0)?                    |
  |      YES --> Suppress ALL facility_fee estimates for this stage (actuals win).     |
  |      NO  --> Load facility_fee where include_in_estimates=true & (prod null|match) |
  |              - If line.charge_rate_pct != null: replaces commission rule at        |
  |                commissionStage with money(amount_usd * charge_rate_pct / 100)      |
  |              - method='flat'    -> money(fee.amount * usdPerUnit(fee.currency))    |
  |              - method='percent' -> money(max(amount_usd * rate_pct / 100,          |
  |                                              min_amt * usdPerUnit(min_currency)))  |
  |              (If any FX rate missing -> amount=null, flags missing_fx warning)     |
  +------------------------------------------------------------------------------------+

  +------------------------------------------------------------------------------------+
  | 3. UTILIZATION, HEADROOM & SUB-LIMITS                                              |
  |                                                                                    |
  |  usesLimit(l) = status in ['applied','active'] AND PRODUCTS[l.product].uses_limit  |
  |                 (excludes fx & cash; includes card + all borrowings/LC/TB/guar)    |
  |  used         = sum(amount_usd of usesLimit lines on active facilities)            |
  |  available    = active_limits - used                                               |
  |  free_after   = available - earmarked   (bank high-usage flag: used/limit >= 80%)  |
  |  sub_limit    = sum(usesLimit lines matching facility + optional product/supplier) |
  |                 (caps warn & filter cost rankings; never add credit limit)         |
  +------------------------------------------------------------------------------------+

  +------------------------------------------------------------------------------------+
  | 4. INVOICE COST RANKING (compareInvoice -- USD trade products only)                |
  |                                                                                    |
  |  Rate fallback waterfall per active facility (started <= as_of):                   |
  |    Tier 1: 90-day amount-weighted rate for product family (if + if_after_lc_or_da) |
  |    Tier 2: Latest historical rate for product family                               |
  |    Tier 3: 90-day amount-weighted rate across all trade products on facility       |
  |    Tier 4: Latest historical trade-product rate on facility                        |
  |                                                                                    |
  |  Eligibility checks (non-fatal notes; eligible facilities rank above ineligible):  |
  |    [supplier] bank in supplier's eligible_banks?                                   |
  |    [room]     amount <= facility headroom AND all matching sub_limits?             |
  |    [tenor]    tenor <= facility.max_tenor_days?                                    |
  |    [rate]     waterfall found a rate?      [fx] all fee rule currencies priced?    |
  |                                                                                    |
  |  All-in % p.a. = (interest + estimated_charges) * 100 * basis / (amount * tenor)   |
  +------------------------------------------------------------------------------------+

  +------------------------------------------------------------------------------------+
  | 5. PERIOD COST OF FUNDS (periodCost & costOfFundsTrend)                            |
  |                                                                                    |
  |  Line active span = [start ?? application ?? due, settlement ?? due)               |
  |  Overlap days in [period_start, period_end] -> weight = amount_usd * overlap_days  |
  |  Period weighted rate = sum(weight * rate_pct) / sum(weight of rated lines)        |
  |  Average balance      = sum(all amount_usd * overlap_days) / (days(start,end) + 1) |
  +------------------------------------------------------------------------------------+
```

---

## 7. Month-End Closing, Immutability Guards, and Dual-Mode Export Sync

Month-end reporting separates live preview from frozen closing snapshots and enforces immutability at the model layer—even workspace administrators cannot hand-type closing figures or manually toggle `is_locked`.

```text
  [Month-end Page selects YYYY-MM -> normalized to YYYY-MM-01 via monthStart()]
          |
          +--> Query month_end(month)
                     |
          +----------+------------------------+----------------------------+
          | No row, OR is_locked == false     | is_locked == true,         | source == 'excel'
          | (LIVE MODE)                       | source == 'portal'         | (IMPORTED SUMMARY)
          v                                   | (FROZEN SNAPSHOT)          v
  Live query: drawdowns + facilities + fx     v                      Display frozen header KPIs
  -> monthEndFrom(month, ...)          Query month_end_line rows     (no line-level snapshot).
                                       directly from DB (frozen).    Lock/Unlock/Export hidden.
          |                                   |                      [LOCK: imported_report
          | [Click "Lock month"]              | [Click "Unlock"]      except: notes]
          v                                   v
  +------------------------------------+  +----------------------------------+
  | month_end_lock                     |  | month_end_unlock                 |
  | (policy: month_end_closing)        |  | (policy: month_end_closing)      |
  | 1. Refuse if excel or locked       |  | 1. Refuse if source !== 'portal' |
  | 2. closingBook(): cursor-paginates |  | 2. Sets is_locked = false        |
  |    ALL drawdowns, facilities,      |  |    (snapshot lines stay dormant  |
  |    fx_rates, & prior lines (500/p) |  |     until next lock replaces)    |
  | 3. monthEndFrom(month):            |  +----------------------------------+
  |    - Cutoff: start <= monthEnd AND |
  |      (not settled OR repaid > end) |
  |    - FX: latest rate_date <= end   |  +----------------------------------+
  |      (fallback: line.fx_rate)      |  | MODEL-LEVEL WRITE GUARDS         |
  |    - Charges: drawdown-stage +     |  | (month_end/+model.ts)            |
  |      settlement-stage if <= end    |  | - one_report_per_month: [U]      |
  |    - Computes 13 headline figures  |  | - locked_month: locked except    |
  |      (borrowings/LC/TB/guar/avail/ |  |   ['is_locked', 'notes']         |
  |      accrued/min/max/simple/wt/ten)|  | - isCloser(ctx.actor): refuses   |
  | 4. Atomic create/update with       |  |   ANY actor except system runs   |
  |    is_locked=true, locked_at=now,  |  |   month_end_lock / unlock from   |
  |    and full month_end_line set     |  |   writing figures or is_locked   |
  +------------------------------------+  +----------------------------------+

  +------------------------------------------------------------------------------------+
  | FILE EXPORT SYNC: month_end_line/+sheet.sync.ts (XLSX / CSV, export-only)          |
  |  Input context: { month: date }                                                    |
  |  - If locked portal month_end exists -> maps stored month_end_line rows            |
  |  - Otherwise -> queries live book and maps monthEndFrom(month, ...).lines          |
  |  Both paths share monthEndExportRow() (19 columns incl. accrued_interest_usd,      |
  |  charges_usd, and total_payable = amount + interest_to_maturity + charges_in_ccy). |
  +------------------------------------------------------------------------------------+
```

---

## 8. FX Hedging Engine, MAS Rates Feed, and Bootstrap Simulation

The hedging subsystem combines automated official exchange-rate ingestion, multimodal document/proposal parsing, a deterministic sequential payoff engine across 11 derivative structures, and an in-browser 3,000-path historical bootstrap simulator.

```text
  A. OFFICIAL DAILY RATES FEED (fx_rates_fetch)
  ======================================================================================
  [Cron: 30 13 * * 1-5 (rest: 7d) OR manual run | policy: fx_rates]
        |
        v
  Find single active org-wide sys_integration('mas_rates', owner: null)
        | (if != 1 active account -> log warning, no-op)
        v
  businessDays(today - 16d, today) -> filter out dates with non-preliminary fx_rate
        |
        v  For each missing/preliminary weekday:
  GET mas_rates: .../exchange_rates_end_of_period_daily?end_of_day=<YYYY-MM-DD>
        |
        | Parse keys matching /^([a-z]{3})_sgd(_100)?$/ (divide _100 by 100; SGD=1)
        | Cross through USD: usd_per_unit(CCY) = sgd_per_unit(CCY) / sgd_per_unit(USD)
        | Scale: 12 decimal places | preliminary = (element.preliminary === '1')
        v
  Upsert fx_rate rows (skip USD=1; replace preliminary once final publishes)

  B. HEDGE DOCUMENT & PROPOSAL INGESTION (policy: fx_reader, AI sys_2)
  ======================================================================================
  [fx_document upload] -> fx_document_read
    1. documentSource() + sys_2 (FX_READ)
    2. Match bank + draft/live fx_deal by:
       - refKey(bank_reference / other_refs), else
       - same bank + pair + trade_date (when one lacks a reference)
    3. If unmatched term_sheet/confirmation -> create new 'draft' fx_deal + fixings
    4. If termination_date -> set deal.ended_on; mark doc 'filed' or 'checked'

  [fx_proposal text/file] -> fx_proposal_read
    1. documentSource() + sys_2 (FX_PROPOSAL_READ); delete prior untraded 'proposal' deals
    2. Per alternative: use printed fixings OR generate dates via schedule() (cap 60)
    3. Create 'proposal' fx_deal; UI promotes: "We traded this" (draft) -> "Confirm" (live)

  C. SEQUENTIAL FIXING PAYOFF ENGINE (fixingAt + workOut in src/lib/fx.ts)
  ======================================================================================
  Sort fixings by fixing_date ASC; state: used = 0, ended = false
  For each fixing f (manual f.outcome preserved; else evaluated at f.fixing_rate):
    1. Already ended OR f.fixing_date > deal.ended_on?
         -> outcome = 'ended', amount = 0
    2. structure === 'dci'?
         -> deposit=base: rate>strike -> 'converted' (else 'not_converted')
         -> deposit=quote: rate<strike -> 'converted' (else 'not_converted')
    3. knock_out hit? (ko>strike ? rate>=ko : rate<=ko)
         -> 'knocked_out' (ends = true if knock_out_type === 'continuous')
    4. Non-firm fixing (!f.firm):
         - TRF + knock_in (no KO): adverse & < KI -> 'not_exercised' (else lev/exercised)
         - condition_side/level or parseCondition() fails -> 'not_exercised'
    5. Gain per unit = sell ? (strike - rate) : (rate - strike)
         - gain < 0 AND leveraged_notional != null -> 'leveraged' (leveraged_notional)
         - gain > 0 AND target != null AND used + gain >= target:
             * target_rule='full'    -> 'exercised' (usual amount), ended=true
             * target_rule='none'    -> 'target_not_paid' (amount=0), ended=true
             * target_rule='prorata' -> 'exercised' (usual * left / gain), ended=true
         - Otherwise -> 'exercised' (usual amount), used += max(0, gain)
    Realized gain (quote ccy) = perUnitGain * baseUnits -> gainUsd() on settlement date.

  D. VALUATION, SCENARIOS & 3,000-PATH BOOTSTRAP ODDS (client-side in src/lib/fx.ts)
  ======================================================================================
  - position(): values open fixings at today's pairRate(); sums ONLY firm fixings into
    total_usd; computes ko_distance_pct, past_ko, and moneyness ('in' | 'out' | 'mixed').
  - scenarios(): play() across spot * {-6,-4,-2,0,+2,+4,+6}%, strike, KO, & custom rates.
  - odds(): deterministic mulberry32 PRNG seeded by deal.id + window + plain/view:
      * Windows: calm (63 biz days) & long (252 biz days); requires >= 40 valid moves
      * Empirical log returns ln(r_t / r_{t-1}), filter |m| >= 0.10, mean-centered
      * Drift: forward_reference over biz days (else 0), or tilted to view_rate/view_date
      * Simulates 3,000 daily paths (1,500 for view tilt) across businessDays(today, last):
          - Continuous KO checked on EVERY daily step between fixings
          - Plays open fixings via play() (or dciResult() for DCI)
      * Outputs: p_knock_out, p_target, p_pays, typical (p50), bad (p05), p_convert
      * pointsToWeigh() flags: KO>30%, pays>40%, bad<-10% rem, KO dist<3%, DCI conv>40%,
        leverage>1x, worse strike, conditional fixings, knock-in, term > 12 months.
```

---

## 9. Unified Attention Engine and Daily Alert Fan-Out

There is no separate alert or reminder table. Both the live **Attention** page (`+alerts.page.svelte`) and the morning cron job (`+daily_alerts.automation.ts`) evaluate the exact same query spec (`ATTENTION_READ`) and pure function (`attention()` in `src/lib/attention.ts`). Overlapping rules on the same record merge into one deduplicated item with multiple reason badges, sorted ascending by earliest action date.

```text
                       +-----------------------------------+
                       |  src/lib/attention.ts             |
                       |  ATTENTION_READ  +  attention()   |
                       +--------+-----------------+--------+
                                |                 |
        +-----------------------+                 +-------------------------+
        |                                                                   |
        v                                                                   v
  +---------------------------+                               +---------------------------+
  | +alerts.page.svelte       |                               | +daily_alerts.automation  |
  | Reactive ctx.query()      |                               | Cron: 0 8 * * * (rest 7d) |
  | Opens target record view  |                               | Policy: treasury          |
  +---------------------------+                               | If items.length > 0:      |
                                                              |   ctx.notify -> treasury  |
                                                              |   once: alerts:<today>    |
                                                              +---------------------------+

  6 SCANNED MODELS & 17 TRIGGER RULES (evaluated against `today`):
  +------------------+---------------------------------------------------------------------+
  | Model            | Condition -> Reason Key                                             |
  +------------------+---------------------------------------------------------------------+
  | drawdown         | status == 'unclear'                              -> unclear         |
  | (open/earmark/   | discrepancy_note != null                         -> check           |
  |  unclear)        | earmarked & expected_draw_date < today           -> stale           |
  |                  | open & due_date < today                          -> past_due        |
  |                  | open & today <= due_date <= today + 7d           -> due             |
  |                  | open lc|import_bill|da|tb & due_date <= today+14 -> bills           |
  |                  | open lc & lc_expiry_date <= today + 14d          -> lc_expiry       |
  |                  | due_date > earliest_invoice_date + max_tenor     -> late            |
  +------------------+---------------------------------------------------------------------+
  | facility         | bank utilization >= 80%                          -> high            |
  | (active)         | review_date == null                              -> no_review       |
  |                  | review_date <= today + 60d                       -> reviews         |
  +------------------+---------------------------------------------------------------------+
  | purchase_order   | lc_requested & no linked lc / lc_number          -> lcs             |
  | (not cancelled)  | !no_financing & no non-cancelled financing link:                    |
  |                  |   Tuesday payment_date -> to_earmark_urgent | else -> to_earmark    |
  +------------------+---------------------------------------------------------------------+
  | facility_form    | facility_required == 'tt' &                                         |
  |                  |   pay_by_date in [today - 7d, today + 14d]       -> tt              |
  +------------------+---------------------------------------------------------------------+
  | fx_deal          | status == 'draft'                                -> fx_confirm      |
  | (draft|live)     | any fixing_date < today with worked outcome=null -> fx_rate         |
  +------------------+---------------------------------------------------------------------+
  | fx_document      | read_status == 'failed'                          -> fx_failed       |
  |                  | read_status == 'checked' (unmatched)             -> fx_document     |
  +------------------+---------------------------------------------------------------------+
```

---

## 10. Access Control, Isolation, and Authority Matrix

Access control is strictly declarative across 4 seeded teams (`sys_team` rows, `seed/public/sys_team.json`, edited by an administrator afterwards) and 11 policies (`src/access_control/policy/`). Human teams never receive direct write authority for governed boundaries (bank advices and month-end closing figures); instead, they hold capability grants to trigger automations whose scoped policies enforce approvals and invariants.

```text
  HUMAN TEAMS & POLICIES (4)
  +------------+------------+----------------------------------------+----------------------+
  | Team       | Policy     | Apps Visible                           | Core Write Authority |
  +------------+------------+----------------------------------------+----------------------+
  | treasury   | treasury   | treasury, hedging, purchasing, config  | Full banking, limits,|
  |            |            |                                        | drawdowns, FX, PO    |
  |            |            |                                        | updates/invoices/    |
  |            |            |                                        | links, month notes   |
  +------------+------------+----------------------------------------+----------------------+
  | finance    | finance    | treasury, hedging, purchasing, config  | business_partner     |
  |            |            |                                        | (no eligible_banks), |
  |            |            |                                        | earmarked drawdowns  |
  |            |            |                                        | ONLY (verdict), PO   |
  |            |            |                                        | updates/invoices/docs|
  +------------+------------+----------------------------------------+----------------------+
  | purchasing | purchasing | purchasing ONLY                        | Own POs ONLY (where  |
  |            |            | (NO treasury/hedging/configuration)    | created_by=actor.id; |
  |            |            |                                        | blocked once         |
  |            |            |                                        | invoice_count > 0),  |
  |            |            |                                        | own PO docs (only    |
  |            |            |                                        | po/supporting/other),|
  |            |            |                                        | facility_form        |
  +------------+------------+----------------------------------------+----------------------+
  | viewers    | viewer     | treasury, hedging, purchasing, config  | Read-only across all |
  |            |            |                                        | 26 models; can run   |
  |            |            |                                        | facility_form_pack   |
  +------------+------------+----------------------------------------+----------------------+

  SCOPED AUTOMATION POLICIES (7) -- LEAST-PRIVILEGE SYSTEM AUTHORITY
  +-------------------+---------------------------------+-----------------------------------+
  | Policy            | Bound Automations               | Governance Boundary               |
  +-------------------+---------------------------------+-----------------------------------+
  | bank_advices      | bank_document_read,             | Reads bank/facility/partner/line; |
  |                   | bank_document_apply,            | updates bank_document metadata;   |
  |                   | drawdown_record_advice,         | drawdown.update ALWAYS triggers   |
  |                   | drawdown_settle                 | ctx.approve -> treasury holders   |
  +-------------------+---------------------------------+-----------------------------------+
  | month_end_closing | month_end_lock,                 | Sole writer allowed by month_end  |
  |                   | month_end_unlock                | transforms to write figures &     |
  |                   |                                 | toggle is_locked                  |
  +-------------------+---------------------------------+-----------------------------------+
  | po_earmarks       | drawdown_earmark_po             | Reads PO/partner/form/fx_rate;    |
  |                   |                                 | creates drawdown + po_financing   |
  +-------------------+---------------------------------+-----------------------------------+
  | purchase_orders   | purchase_order_read             | Reads PO/docs/partners; updates   |
  |                   |                                 | blank fields & initial lines      |
  +-------------------+---------------------------------+-----------------------------------+
  | facility_forms    | facility_form_read,             | Reads forms/attachments/POs;      |
  |                   | facility_form_pack              | updates forms & attachment labels |
  +-------------------+---------------------------------+-----------------------------------+
  | fx_reader         | fx_document_read,               | Reads bank; updates fx_document/  |
  |                   | fx_proposal_read                | fx_proposal; creates/deletes      |
  |                   |                                 | fx_deal & updates ended_on only   |
  +-------------------+---------------------------------+-----------------------------------+
  | fx_rates          | fx_rates_fetch                  | Reads sys_integration; creates/   |
  |                   |                                 | updates fx_rate                   |
  +-------------------+---------------------------------+-----------------------------------+
```

### Enforcement Layers Working Together

1. **Row-level isolation (`purchasing`):** `OWN = { created_by: { eq: { var: 'actor.id' } } }` filters `purchase_order`, `po_line`, `invoice`, `invoice_line`, `po_document`, and `po_financing` queries so buyers never see other buyers' orders. Write verdicts additionally verify `before.created_by === ctx.actor.id`, block PO edits once `invoice_count > 0`, restrict document uploads/edits to `['purchase_order', 'supporting', 'other']`, and restrict document deletions to the uploader.
2. **Stage-level authority (`finance`):** `drawdown` create and update verdicts allow writes only on `EARMARK_FIELDS` and only when `status === 'earmarked'`; Finance can also trigger `drawdown_cancel` and `drawdown_earmark_po`, but once Treasury allocates or draws a line, Finance has read-only access.
3. **Approval-enforced mutation (`bank_advices`):** Never grant direct allow on `drawdown.update` to `bank_advices`; doing so would bypass Treasury review of AI-extracted bank advices.
4. **Actor-checked closing figures (`month_end`):** Even an administrator cannot write closing figures or toggle `is_locked` directly because `month_end/+model.ts` checks `actor.kind === 'system'` and `actor.by.automation` against `'month_end_lock'` and `'month_end_unlock'`.
