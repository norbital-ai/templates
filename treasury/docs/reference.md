# Treasury domain and calculation reference

Detailed reference for Treasury's financing lifecycle, 37-product catalogue, calculation rules, bank-advice
extraction, purchasing cross-checks and PDF packs, FX hedging engine, and attention rules. For system
topology, ER diagrams, state machines, and authority flows, see [architecture.md](architecture.md).

## How records connect

| Record                     | Responsibility                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bank and facility          | Lender and credit line terms (limit, pricing basis, day-count basis, rounding, maximum tenor). Active limits drive utilisation, available credit, and month-end headlines.       |
| Letter of offer            | Attached bank agreement (`<= 10 MiB` PDF) and review date. Saving `next_review_date` automatically synchronises `facility.review_date` in the same transaction.                  |
| Fee rules                  | Product- and stage-specific estimated charges (flat or percentage with minimum-currency floor). Any recorded charge at a stage—even `0`—suppresses that stage's estimates.       |
| Sublimits                  | Product, supplier, or product × supplier caps inside one facility. Triggers allocation warnings and marks breaching facilities ineligible in cost rankings; never adds credit.   |
| FX rates                   | Dated USD-per-unit conversions (12-decimal scale) for foreign fee estimates, month-end revaluation, and FX hedging. Never overwrites agreed rates saved on drawdowns or charges. |
| PO items and invoice items | PO items roll up ordered quantity and amount; invoice items roll up `po_line.invoiced_quantity` and drive 5-point invoice cross-checks (total, currency, price, qty, financing). |
| PO financing link          | Many-to-many link (`po_financing`) connecting orders to financing lines, cloned automatically during LC/DA bill conversion without double counting.                              |
| Financing request          | Purchasing requisition (`facility_form`, T/T or LC) with attachments and downloadable PDF pack. Saving an LC request automatically ticks `purchase_order.lc_requested`.          |
| Bank advice                | Original PDF (`<= 10 MiB`), AI-extracted figures, and live arithmetic checks. Unique open-line matches route drawdown/settlement updates and charges through Treasury approval.  |
| Month-end                  | Closing position snapshot (`month_end` + `month_end_line`). Locking freezes converted values and detail lines; imported `excel` summaries remain permanently immutable.          |

## Terms glossary

| Term                                   | Meaning                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bank                                   | Lender with contacts, cut-off time, offered products, letters of offer, and watch points. May hold multiple facilities.                                                         |
| Facility / credit line                 | Agreed USD limit, offer margin, pricing basis, day-count basis (`actual_360` or `actual_365`), rounding (`nearest_cent` or `down_to_cent`), and maximum tenor.                  |
| Letter of offer                        | Attached bank agreement and review date; the bank's signed document remains legally authoritative.                                                                              |
| Sub-limit                              | Product and/or supplier cap inside a facility (warning and cost-comparison eligibility filter; never adds extra credit limit).                                                  |
| Drawdown / line                        | Single financing obligation moving `earmarked → applied → active → settled / cancelled` (plus `unclear` for legacy items); settled and cancelled lines are sealed.              |
| Earmark                                | Planned payment (`status = 'earmarked'`); reduces planning headroom (`free_after_earmarks`) without counting as drawn bank borrowing.                                           |
| USD per unit                           | USD bought per 1 unit of foreign currency (`amount_usd = round(amount × usd_per_unit, 2)`).                                                                                     |
| Tenor                                  | `due_date − start_date` in calendar days (includes start day, excludes due day).                                                                                                |
| Rate / margin / charge rate            | Full annual interest rate (`interest_rate_pct`) vs. offer pricing margin (`margin_pct`, comparison only, never added twice) vs. agreed commission override (`charge_rate_pct`). |
| Used / available / free after earmarks | `used = applied + active` limit-consuming lines; `available = active limits − used`; `free_after_earmarks = available − earmarks`.                                              |
| Cost of funds                          | USD amount-weighted (and `amount × days` weighted over a chosen period) annual interest rate across rated lines.                                                                |
| All-in cost                            | `(interest + applicable fees) × 100 × day_basis ÷ (principal × tenor)` (% p.a., computed from recent history and fee rules; not a binding bank quote).                          |
| Basis points (bps)                     | 1 percentage point = 100 bps.                                                                                                                                                   |

## Product codes (37 products)

Defined once in [`src/lib/products.ts`](../src/lib/products.ts). Convertible bills (`CONVERTIBLE`): `lc` and
`import_bill` convert to `if` or `if_after_lc_or_da`; `da` and `tb` convert to `if_after_lc_or_da` while
cloning PO links and repointing invoices atomically.

| Code                      | Product                                                       | Report bucket | Consumes limit | Trade cost comparison |
| ------------------------- | ------------------------------------------------------------- | ------------- | -------------- | --------------------- |
| `lc`                      | Letter of credit (LC)                                         | `lc`          | Yes            | No (convertible)      |
| `import_bill`             | Import bill under LC                                          | `lc`          | Yes            | No (convertible)      |
| `da`                      | Documents against acceptance (DA)                             | `tb`          | Yes            | No (convertible)      |
| `dp`                      | Documents against payment (DP)                                | `tb`          | Yes            | No                    |
| `tb`                      | Term bill                                                     | `tb`          | Yes            | No (convertible)      |
| `ba`, `bad`               | Banker's acceptance; bank acceptance draft                    | `tb`          | Yes            | Yes                   |
| `if`                      | Invoice financing (IF)                                        | `borrowings`  | Yes            | Yes (`if` family)     |
| `if_after_lc_or_da`       | IF – after an LC or DA bill                                   | `borrowings`  | Yes            | Yes (`if` family)     |
| `pif`                     | Purchase invoice financing                                    | `borrowings`  | Yes            | Yes                   |
| `twc`                     | Trade working capital                                         | `borrowings`  | Yes            | Yes                   |
| `oaf`                     | Open account financing                                        | `borrowings`  | Yes            | Yes                   |
| `apf`                     | Account payable finance                                       | `borrowings`  | Yes            | Yes                   |
| `psil`, `psbl`            | Pre-shipment import loan; post-shipment buyer loan            | `borrowings`  | Yes            | Yes                   |
| `ofcl`, `mctf`            | Onshore foreign currency loan; multi-currency trade financing | `borrowings`  | Yes            | Yes                   |
| `tradepay`, `packing`     | TradePay; packing loan                                        | `borrowings`  | Yes            | Yes                   |
| `lis`                     | Loan insurance trade loan                                     | `borrowings`  | Yes            | Yes                   |
| `fbep`, `dbep`            | Foreign / domestic bills purchase                             | `borrowings`  | Yes            | No                    |
| `ecr`, `badd`             | Export credit refinancing; acceptance draft discounting       | `borrowings`  | Yes            | No                    |
| `stl`, `term`             | Short-term loan; term loan                                    | `borrowings`  | Yes            | No                    |
| `efs`, `tbl`              | Enterprise financing loan; temporary bridging loan            | `borrowings`  | Yes            | No                    |
| `ma`, `property`          | M&A loan; property loan                                       | `borrowings`  | Yes            | No                    |
| `bg`, `sg`, `awb`, `sblc` | Banker's, shipping, air waybill, and standby-LC guarantees    | `guarantee`   | Yes            | No                    |
| `card`                    | Corporate card                                                | `other`       | Yes            | No                    |
| `fx`                      | FX contract line                                              | `other`       | No             | No                    |
| `cash`                    | Paid in cash                                                  | `other`       | No             | No                    |

## Calculations and reports

Shared `BigDecimal` helpers live in [`src/lib/calculations.ts`](../src/lib/calculations.ts),
[`src/lib/treasury.ts`](../src/lib/treasury.ts), and [`src/lib/purchasing.ts`](../src/lib/purchasing.ts):

- **Interest & accrual:** `amount × rate_pct × days ÷ (100 × day_basis)` rounded per facility
  (`half-from-zero` for `nearest_cent`, `to-zero` for `down_to_cent`). Accrued days through `as_of` count
  `as_of` inclusively and cap at full tenor (`min(daysBetween(start, as_of) + 1, tenor_days)`), returning
  `0` before `start_date`.
- **Stage charges & estimates:** Actual `drawdown_charge` rows keep their recorded `fx_rate_to_usd`. For
  any stage (`drawdown` or `settlement`) without an actual charge row, `estimateCharges` applies matching
  active `facility_fee` rules (flat fees converted at `usdPerUnit`; percent fees floored by
  `minimum_amount` in `minimum_currency`). An agreed `drawdown.charge_rate_pct` replaces the commission rule
  at the commission rule's stage.
- **Dashboard (`Overview`):** Active facilities, open obligations, horizontal bank utilisation (`≥ 80%`
  flagged), unallocated earmarks, maturity buckets (past due, 30, 60, 90 days) and 12-month maturity ladder,
  24-month month-end cost-of-funds trend, and `amount × days` weighted period cost of funds (default presets
  include financial year starting 1 April, plus custom month range).
- **Costs (`Invoice calculator`, `Bank comparison`, `Rates by month`):** Evaluates USD trade products only.
  Rate fallback per active facility: 90-day weighted product-family rate → latest product-family rate →
  90-day weighted trade rate → latest trade rate. Flags ineligibility for supplier acceptance, facility or
  sub-limit headroom, maximum tenor, missing rate history, or missing fee FX rate. Annualised charge %
  (`chargesSummary`) covers 12 complete calendar months on a 360-day basis (`pct_of_amount × 360 ÷ avg_tenor`).
- **Month-end & export sync:** Captures every `applied`, `active`, or subsequently `settled` line open at
  month-end (`start <= monthEnd` and not repaid on or before `monthEnd`), revalued at the latest `fx_rate`
  on or before `monthEnd` (falling back to the line's saved rate). Includes drawdown-stage charges plus
  settlement-stage charges settled on or before `monthEnd`. Locking (`month_end_lock`) freezes 13 headline
  figures and all `month_end_line` rows; `month_end_line/+sheet.sync.ts` exports 19 columns to XLSX or CSV
  from locked rows or live calculation. Imported `excel` summaries are permanently immutable.

## Document uploads, extraction, cross-checks, and PDF packs

1. **Bank advices (`bank_document_read` / `bank_document_apply`, `≤ 10 MiB` PDF):**
   - `documentSource` ingests text/HTML and renders scanned pages (`index.no_text`) as images before calling
     `ctx.ai.sys_2.infer`. Strips account numbers and lists uncertain fields.
   - Matching requires `≥ 6` normalized alphanumeric characters across `bank_reference`, `lc_number`, and
     `bill_number` matched against open drawdowns and linked `invoice.bank_bill_number` (scoped by issuer
     bank and currency). Only a unique match links `drawdown` and schedules `bank_document_apply`, which
     routes `drawdown_record_advice` or `drawdown_settle` through native Treasury approval (`bank_advices`).
   - Live `adviceChecks` verifies tenor days (`due − start`), expected interest (under the line's day basis
     and facility rounding), and `total_debited` (`charges` on drawdown advices; `principal + interest` or
     `principal + interest + charges` on settlement advices).
2. **Purchase orders & invoice cross-checks (`purchase_order_read`, `src/lib/purchasing.ts`):**
   - Filing a `po_document` with `kind = 'purchase_order'` populates empty PO header fields, matches supplier
     by normalized name/aliases, and creates `po_line` rows when the PO has no lines yet.
   - `payment_date` must fall on a Tuesday (urgent) or Friday (or remain empty).
   - `invoiceFindings` checks five conditions: invoice total equals sum of lines; invoice currency equals PO
     currency; unit price within `0.5%` of PO line unit price; cumulative `invoiced_quantity` within
     `0.001 kg` of ordered quantity; and linked drawdown matches supplier and is not over-invoiced.
3. **Financing requests & PDF packs (`facility_form_read`, `facility_form_pack`):**
   - Uploading attachments classifies `other` attachments, reads the newest `purchase_order`, `proforma`, and
     `customer_po`, fills blank fields only (never `pay_by_date`), infers `lc` vs. `tt` from payment terms,
     flags PO/proforma mismatches in `read_note`, and links the matching `purchase_order`.
   - `facility_form_pack` (`4 MiB` hard cap) combines the printed cover record (`ctx.convert.record` to PDF),
     an A4 paper sign-off page (_Affirmed by_, _Approved by_, _Acknowledged by Treasury_), and every PDF/PNG/JPEG
     attachment in upload order without silently dropping unreadable files.

## FX hedging

Shared engine in [`src/lib/fx.ts`](../src/lib/fx.ts) supports 11 structures (`fwd`, `trf`, `dci`, `exko`,
`eko`, `eko_eki`, `enh`, `enh_spot`, `pivot`, `acc`, `other`) and 8 fixing outcomes (`exercised`,
`leveraged`, `not_exercised`, `knocked_out`, `converted`, `not_converted`, `ended`, `target_not_paid`):

- **Official daily FX feed (`fx_rates_fetch` via `mas_rates`):** Runs Monday–Friday at 13:30 (`Asia/Singapore`),
  queries missing or preliminary weekdays over the prior 15 days from the Monetary Authority of Singapore
  daily end-of-period endpoint, divides `_sgd_100` quotes by 100, and crosses through USD (`usd_per_unit`).
- **Documents & proposals (`fx_document_read`, `fx_proposal_read`):** Auto-classifies uploaded term sheets,
  confirmations, notices, and letters; links to matching draft/live deals (by normalized reference or
  bank + pair + trade date); creates a `draft` deal for unmatched term sheets/confirmations; applies
  `termination_date` to `ended_on`. Parses pasted/attached banker proposals into `proposal` deals (with
  listed dates or generated `weekly`/`fortnightly`/`monthly`/`quarterly` schedules up to 60 fixings) for
  side-by-side comparison before promoting (`proposal → draft → live`).
- **Valuation & watch list:** Values open firm fixings at today's official `pairRate` and flags knock-outs
  within `3%` or breached, TRF targets `≥ 75%` consumed, out-of-the-money deals, DCIs within `1%` of strike,
  and last fixings within `30` days.
- **Scenarios & bootstrap simulation:** Stress-tests open fixings across spot `±2/4/6%`, strike, knock-out,
  and custom rates; runs 3,000-path deterministic (`mulberry32`) historical bootstraps over 63-day (`calm`)
  and 252-day (`long`) windows (requiring `≥ 40` daily log returns with `|m| < 0.10`, centered on bank
  `forward_reference` or tilted to user's `view_rate` over 1,500 paths) to report probabilities, median,
  5th-percentile bad case, and `pointsToWeigh` risk flags.

## Attention and daily reminders

Attention items are computed live from [`src/lib/attention.ts`](../src/lib/attention.ts) (no duplicate
reminder table) and delivered to team `treasury` at 08:00 workspace time (`daily_alerts`, once per day via
`once: alerts:<today>`) whenever non-empty:

- **Drawdowns:** `unclear` status; non-null `discrepancy_note`; earmarked past `expected_draw_date`; open
  lines overdue or due within 7 days (14 days for `lc`, `import_bill`, `da`, `tb`, plus `lc_expiry_date`
  within 14 days); due date past `earliest_invoice_date + max_tenor_days`.
- **Facilities (active):** Bank utilisation `≥ 80%`; missing `review_date`; `review_date` within 60 days.
- **Purchase orders (not cancelled):** `lc_requested` with no linked LC; orders needing financing with no
  active/non-cancelled financing link (flagged urgent on Tuesday payment dates).
- **Financing requests:** T/T requests with `pay_by_date` between `−7` and `+14` days of today.
- **FX deals & documents:** `draft` FX deals awaiting confirmation; past fixings (`< today`) with no worked
  outcome; `fx_document` rows still `checked` (unmatched) or `failed`.
