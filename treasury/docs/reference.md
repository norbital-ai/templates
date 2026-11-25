# Treasury domain and calculation reference

Detailed reference for Treasury's financing lifecycle, product catalogue, calculation rules, bank-advice
extraction, purchasing packs, FX hedging and attention rules.

## How records connect

| Record                     | Responsibility                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bank and facility          | Lender and credit line terms (limit, pricing basis, day-count basis, rounding, maximum tenor). Active limits drive utilisation, available credit and month-end headlines.        |
| Fee rules                  | Product- and stage-specific estimated charges (flat or percentage with minimum currency). Recorded charges at a stage suppress that stage's estimate.                            |
| Sublimits                  | Product, supplier, or product × supplier caps inside one facility. Triggers allocation warnings and excludes breaching proposals from cost comparisons; never adds credit limit. |
| FX rates                   | Dated USD-per-unit conversions for foreign fee estimates and month-end revaluation. Never overwrites agreed rates saved on drawdowns or actual charges.                          |
| PO items and invoice items | PO items compute ordered quantity and amount; invoice items accumulate invoiced quantities and drive unit-price (0.5% tolerance), quantity (> 0.001 kg) and principal checks.    |
| PO financing link          | Connects orders to financing lines, including LC-to-financing conversions without double counting.                                                                               |
| Financing request          | Purchasing requisition (T/T or LC) with supporting attachments and combined PDF pack export. Does not create a facility or execute a payment.                                    |
| Bank advice                | Original PDF, AI-extracted figures and arithmetic checks. A unique open-line match submits the drawdown/settlement update and charges together for native Treasury approval.     |
| Month-end                  | Closing position snapshot. Locking freezes converted values and detail lines so later FX, fee or facility edits cannot alter a closed month.                                     |

## Terms glossary

| Term                                   | Meaning                                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bank                                   | Lender with contacts, cut-off time, offered products and watch points. May hold multiple facilities.                                                        |
| Facility / credit line                 | Agreed limit, pricing, day-count basis (`Actual/360` or `Actual/365`), rounding and maximum tenor (limit/headroom reports use USD).                         |
| Letter of offer                        | Attached bank agreement and review date; bank document remains authoritative.                                                                               |
| Sub-limit                              | Product or supplier cap inside a facility (warning/filter, not extra credit).                                                                               |
| Drawdown / line                        | Single financing obligation or planned payment moving `earmark → applied → active → settled / cancelled` (settled/cancelled sealed except archive & notes). |
| Earmark                                | Planned payment; reduces planning headroom without counting as drawn bank borrowing.                                                                        |
| USD per unit                           | USD bought per 1 unit of foreign currency (`USD amount = original × rate`).                                                                                 |
| Tenor                                  | `due_date − start_date` in calendar days (includes start day, excludes due day).                                                                            |
| Rate / margin / charge rate            | Full annual interest rate vs offer pricing margin (shown for comparison, never added twice) vs agreed commission rate overriding the commission fee rule.   |
| Used / available / free after earmarks | `used = applied + active` limit-consuming lines; `available = active limits − used`; `free = available − earmarks`.                                         |
| Cost of funds                          | USD amount-weighted (and `amount × days` weighted over a period) annual interest rate.                                                                      |
| All-in cost                            | `(interest + applicable fees) / principal × day_basis / tenor × 100` (comparison from history/rules, not a bank quote).                                     |
| Basis points (bps)                     | 1 percentage point = 100 bps.                                                                                                                               |

## Product codes

Defined once in [`src/lib/products.ts`](../src/lib/products.ts). LCs and import bills may convert to
`if`; DA and term bills may convert to `if_after_lc_or_da` while preserving PO/invoice links.

| Code                      | Product                                                       | Report bucket / trade comparison                           |
| ------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| `lc`                      | Letter of credit                                              | LC; documentary exposure                                   |
| `import_bill`             | Import bill under an LC                                       | LC; documentary                                            |
| `da`                      | Documents against acceptance                                  | Term bill; documentary                                     |
| `dp`                      | Documents against payment                                     | Term bill; documentary                                     |
| `tb`                      | Term bill                                                     | Term bill; documentary                                     |
| `ba`, `bad`               | Banker's acceptance; bank acceptance draft                    | Term bill; trade comparison                                |
| `if`                      | Invoice financing                                             | Borrowing; trade comparison                                |
| `if_after_lc_or_da`       | Invoice financing after an LC or DA bill                      | Borrowing; trade comparison; keeps bill link on conversion |
| `pif`                     | Purchase invoice financing                                    | Borrowing; trade comparison                                |
| `twc`                     | Trade working capital                                         | Borrowing; trade comparison                                |
| `oaf`                     | Open account financing                                        | Borrowing; trade comparison                                |
| `apf`                     | Account payable finance                                       | Borrowing; trade comparison                                |
| `psil`, `psbl`            | Pre-shipment import loan; post-shipment buyer loan            | Borrowing; trade comparison                                |
| `ofcl`, `mctf`            | Onshore foreign currency loan; multi-currency trade financing | Borrowing; trade comparison                                |
| `tradepay`, `packing`     | TradePay; packing loan                                        | Borrowing; trade comparison                                |
| `fbep`, `dbep`            | Foreign / domestic bills purchase                             | Borrowing; outside trade comparison                        |
| `ecr`, `badd`             | Export credit refinancing; acceptance draft discounting       | Borrowing; outside trade comparison                        |
| `stl`, `term`             | Short-term loan; term loan                                    | Borrowing; outside trade comparison                        |
| `efs`, `tbl`              | Enterprise financing loan; temporary bridging loan            | Borrowing; outside trade comparison                        |
| `lis`                     | Loan insurance trade loan                                     | Borrowing; trade comparison                                |
| `ma`, `property`          | M&A loan; property loan                                       | Borrowing; outside trade comparison                        |
| `bg`, `sg`, `awb`, `sblc` | Banker's, shipping, air waybill and standby-LC guarantees     | Guarantee; documentary                                     |
| `fx`                      | FX contract line                                              | Other; does not consume a financing limit                  |
| `card`                    | Corporate card                                                | Other; consumes its limit                                  |
| `cash`                    | Paid in cash                                                  | Other; does not consume a financing limit                  |

## Calculations and reports

Shared `BigDecimal` calculations live in `src/lib/calculations.ts`, `src/lib/treasury.ts` and
`src/lib/purchasing.ts`:

- **Interest & accrual:** `amount × rate% × days ÷ day_basis` rounded per facility (nearest cent or down
  to cent); accrued interest runs through the report date capped at the tenor.
- **Dashboard:** Active facilities, open obligations, horizontal bank utilisation (≥ 80% flagged),
  unallocated earmarks, maturities and period cost of funds.
- **Costs & Charges:** Ranks eligible banks by 90-day / latest product rate (respecting supplier
  eligibility, headroom, sublimits and max tenor) and compares 12-month recorded + estimated charges
  annualised on a 360-day basis.
- **Month-end:** Captures all applied, active and subsequently settled lines open at month-end, revalued
  at the latest dated FX rate on or before month-end. Locking copies frozen detail lines and totals;
  imported historical summaries remain immutable.

## Document uploads, extraction and PDF packs

1. **Bank advices (≤ 10 MiB PDF):** Uploading triggers `bank_document_read` (multimodal text/image
   extraction, excluding account numbers, listing uncertain fields). Matching requires ≥ 6 alphanumeric
   reference characters and exactly one open financing line; unique matches submit drawdown/settlement
   updates and charges together for native Treasury approval alongside tenor/interest/debit checks.
2. **Financing requests & POs:** Attaching supplier PO, proforma or customer PO PDFs runs
   `facility_form_read` / `purchase_order_read` to populate empty fields without overwriting entered data.
   **Download PDF pack** (`facility_form_pack`, 4 MiB combined cap) combines the printed form, a sign-off
   page and all attachments in upload order without omitting unreadable files.

## FX hedging

Supports forwards, target redemption forwards (TRFs), knock-out forwards, dual currency investments
(DCIs) and custom structures with child `fx_fixing` rows:

- **Documents (`fx_document_read`):** Auto-classifies uploaded term sheets, confirmations, notices and
  letters and links them to matching deals (or drafts a deal to confirm).
- **Valuation & watch list:** Uses official daily rates (`fx_rates_fetch`, MAS feed) to value open
  fixings and flag knock-outs within 3%, targets ≥ 75% used, out-of-the-money deals and last fixings
  within 30 days.
- **Scenarios & planning (`fx_proposal_read`):** Stress-tests open fixings across ±2/4/6%, strike and
  knock-out rates, runs 3,000-path bootstrapped probability estimates (3- and 12-month windows), and lets
  Treasury compare banker proposals side by side before promoting a traded deal.

## Attention and daily reminders

Attention items are computed live (no duplicate reminder table) and sent to the Treasury team at 08:00
workspace time (`daily_alerts`) whenever non-empty:

- Applied/active financing overdue or due within 7 days (14 days for LC/import/DA/term bills and LC
  expiries).
- Earmarks past expected draw date or exceeding maximum financing tenor.
- Active facilities at ≥ 80% bank utilisation or with review dates within 60 days.
- Purchase orders requesting LC without a linked LC; T/T requests due within −7 to +14 days.
