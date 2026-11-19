# Treasury

![Treasury application](docs/screenshots/application.webp)

A treasury and purchasing workspace for a business that finances its purchases through bank
facilities. Treasury keeps its bank lines, limits and terms, and moves each financing line from
earmark to settlement with the bank's advices; purchasing raises purchase orders, records the
invoices that come back and prepares the facility requisition for each PO paid by T/T or LC.
Hedging keeps the FX hedges the company trades with its banks, from the banker's proposal to the
last fixing.

## Apps and roles

| App               | Pages                                                          |
| ----------------- | -------------------------------------------------------------- |
| **Treasury**      | Overview, Financing, Bank advices, Attention, Costs, Month-end |
| **Hedging**       | Overview, Structures, Fixings, Planning                        |
| **Purchasing**    | Business partners, Purchase orders, Financing requests         |
| **Configuration** | Banks, Facilities, Exchange rates                              |

Open a record for its supporting evidence and actions. The lists use native table filters, rather than nested copies of the same view. The overview groups total facilities, horizontal bank utilisation, period funding cost, maturities, month-end and Attention. It uses the same financial helpers as the detailed records.

The workspace uses a blue-accented theme with navy surfaces in dark mode and light surfaces in light mode. Its shared colour tokens are declared once in `src/+workspace.ts` under `theme.light` and `theme.dark`; they apply to navigation, controls, record sheets and charts. Change those tokens through the normal workspace preview and release flow to customize the theme without changing the calculations.

| Team           | May do                                                                                                                                                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Treasury**   | Change banks, facilities, fee rules, lines (allocate, advices, settle, cash or convert), suppliers and the banks that finance them, month-end locks, FX rates; upload and remove unsubmitted bank advices; link POs to lines; as Accounts, edit, cancel or reopen any PO, key its invoices and file or remove any PO document |
| **Finance**    | Read everything; add, change and cancel earmarks; keep the supplier list; as Accounts, edit, cancel or reopen any PO, key its invoices and file or remove any PO document                                                                                                                                                     |
| **Purchasing** | Raise purchase orders (each purchaser sees their own, starting from the PO PDF) and change one until it is invoiced; file the PO, supporting and other documents and remove their own; prepare financing requests                                                                                                             |
| **View**       | Read every page                                                                                                                                                                                                                                                                                                               |

Administrators have workspace-wide access; record locks and native approval holds still apply.
Each record's history is the audit trail.

## How the records connect

| Record                     | What it controls                                                                                                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bank and facility          | The lender and its agreed credit line. Active limits feed utilisation, available credit and the month-end headline. Allocation copies the facility's day-count basis; rounding and maximum tenor drive interest and warnings.                                                                       |
| Fee rules                  | Product/stage-specific estimated charges, including flat or percentage charges and their minimum currency. Recorded charges replace that stage's estimates.                                                                                                                                         |
| Sublimits                  | Caps on a product, a supplier, or their intersection within one facility. The line warns on a breach; the cost calculator excludes a proposal that exceeds a matching cap. They never increase the facility limit.                                                                                  |
| FX rates                   | Dated USD-per-unit conversions for foreign fee estimates and month-end revaluation. The month-end checkbox labels a rate; selection uses its date. They do not overwrite the conversion saved on a drawdown or actual charge.                                                                       |
| PO items and invoice items | PO items calculate ordered quantity and amount. Invoice items link to those items, accumulate invoiced quantities and drive price/quantity/total checks. Financing checks total **all invoices linked to the drawdown across POs**, using a native sum rather than downloading the invoice book.    |
| PO financing link          | Links an order to the line paying it, including the LC-to-financing conversion chain. An LC request remains in Attention until a linked LC exists.                                                                                                                                                  |
| Financing request          | The purchasing application and source-document evidence. An LC request linked to a PO marks it as requesting an LC; T/T requests feed payment-date Attention. Its reader fills empty facts, and its PDF pack includes the supporting documents. It does not create an approved facility or payment. |
| Bank advice                | The original PDF, extracted facts and proposed drawdown/settlement changes. A unique match submits the changes and actual charges together to native Treasury approval.                                                                                                                             |
| Month-end                  | A calculated closing position. Locking freezes the source facts, converted values and totals; later FX, fee or facility edits cannot rewrite the locked month.                                                                                                                                      |

The facility's margin, pricing basis, security, deposits and documented tenor-start rule describe the agreement. The bank's actual all-in rate and dates belong to the drawdown; the documented margin is not automatically added to that rate. The latest invoice-financing deadline is the earliest invoice date plus the maximum tenor. An `fx` **product** is an FX-contract record, separate from the FX-rate table; it does not consume borrowing limits or execute a currency trade.

## How a line moves

1. **Earmark**: Finance plans a supplier payment (supplier, requested date, amount, earliest invoice date).
2. **Allocate**: Treasury picks the bank line and product and any agreed rate and charge rate; the line's
   Figures tab shows the room left on every bank line and the latest date the bank finances to.
3. **Record drawdown advice**: the bank's number, dates, rate and charges; the line becomes active.
4. **Settle**, or for an LC, import bill or DA bill **Pay cash or convert**: a conversion closes the bill
   and opens new financing that keeps its POs and invoices. A settled or cancelled line is sealed.

Uploading a bank advice starts extraction automatically. A unique financing match submits its figures
for Treasury approval, alongside checks of days, interest with the bank's rounding and total debited.

## Terms used in the workspace

| Term                                   | Meaning here                                                                                                                                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bank                                   | The lender, with contacts, cut-off time, offered products and watch points. A bank can have several facilities.                                                                                                                                                 |
| Facility / credit line                 | One agreement's limit, pricing, day-count basis, rounding and maximum tenor. Limit and headroom reports use USD.                                                                                                                                                |
| Letter of offer                        | The attached bank agreement and its review date; the actual terms remain the bank document's.                                                                                                                                                                   |
| Sub-limit                              | A product or supplier cap within a facility. It is a warning against allocation, rather than a second pot of credit added to the limit.                                                                                                                         |
| Drawdown / line                        | One financing obligation or planned payment. The product says what kind; the status says where it is in its life.                                                                                                                                               |
| Earmark                                | A planned payment. It does not count as bank borrowing; allocated earmarks reduce the planning headroom. An unallocated earmark belongs to no bank yet.                                                                                                         |
| Applied / active                       | Applied means requested from the bank; active means drawn. Both use the limit when the product uses a limit.                                                                                                                                                    |
| Settled / cancelled / unclear          | Settled closes an obligation; cancelled abandons it; unclear is an imported line requiring review. Settled and cancelled lines are sealed except for archive, discrepancy notes and notes.                                                                      |
| Principal / amount                     | The financing amount in the line's currency, separate from interest and fees.                                                                                                                                                                                   |
| USD per unit                           | USD bought by one unit of the original currency. USD amount = original amount × this rate. Enter the agreed conversion on a foreign line or charge.                                                                                                             |
| Tenor                                  | Due date minus start date in calendar days. It includes the start day and excludes the due day.                                                                                                                                                                 |
| Day-count basis                        | The annual denominator, Actual/360 or Actual/365, rather than the number of days in the loan.                                                                                                                                                                   |
| Rate / margin / charge rate            | Rate is the full annual interest percentage. Margin is the offer's pricing margin, shown for comparison; it is not added a second time to a line's full rate. Charge rate is an agreed commission percentage replacing the commission fee rule.                 |
| Accrued / to maturity                  | Accrued interest runs through the report date, capped at the tenor. Interest to maturity covers the whole tenor. Missing rate or date is unknown, not an assumed zero rate.                                                                                     |
| Used / available / free after earmarks | Used is applied plus active obligations that consume a limit; available = active limits − used; free after earmarks also subtracts planned earmarks.                                                                                                            |
| Cost of funds                          | The amount-weighted annual interest rate. For a period it is weighted by amount × days outstanding; it is not an unweighted average of banks.                                                                                                                   |
| Recorded / estimated charge            | Recorded means an actual advice or manually keyed charge. Estimates are live calculations from fee rules and are never saved as charges.                                                                                                                        |
| Drawdown / settlement stage            | When a fee is collected. Any recorded charge at a stage, including a zero charge, suppresses the whole stage's estimate.                                                                                                                                        |
| Minimum currency                       | The currency of a percentage fee's minimum; it can differ from the currency of a flat fee. Missing FX makes the estimate unknown.                                                                                                                               |
| All-in cost                            | Estimated interest plus applicable fees, annualised over the proposed tenor. It is a comparison based on stored history and rules, not a bank quote.                                                                                                            |
| Basis points (bps)                     | One percentage point is 100 bps. The spread compares a bank's recent rate with the group's recent rate.                                                                                                                                                         |
| Bank advice                            | A bank's drawdown or repayment notice. Uploading starts extraction and submits a uniquely matched line update through Treasury approval.                                                                                                                        |
| Extracted / submitted advice           | Extracted means extraction finished. Submitted means the line operation was written; its native approval state distinguishes pending review from approved changes.                                                                                              |
| PO / proforma / commercial invoice     | A purchase order is the order; a proforma proposes supply and payment terms; a commercial invoice records what was supplied and billed. They have distinct roles.                                                                                               |
| Financing request / T/T / pay by LC    | The purchasing requisition; T/T is a bank transfer request, LC requests a letter of credit. Saving an LC form linked to a PO marks that PO as requesting an LC.                                                                                                 |
| Month-end lock                         | A locked report keeps frozen detail lines and headline totals. Imported historical summaries retain their original figures and cannot be rebuilt from today’s book. Unlocking a closed report resumes live calculation; closing it again replaces its snapshot. |

### Product codes

These names describe the catalogue this template uses. A bank's agreement determines its actual
terms. In the reports, **borrowing**, **LC**, **term bill**, **guarantee** and **other** are separate
buckets; “trade comparison” identifies the USD products eligible for Costs and Charges comparisons.

| Code                      | Product                                                       | Report bucket / trade comparison                               |
| ------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| `lc`                      | Letter of credit                                              | LC; documentary exposure                                       |
| `import_bill`             | Import bill under an LC                                       | LC; documentary                                                |
| `da`                      | Documents against acceptance                                  | Term bill; documentary                                         |
| `dp`                      | Documents against payment                                     | Term bill; documentary                                         |
| `tb`                      | Term bill                                                     | Term bill; documentary                                         |
| `ba`, `bad`               | Banker's acceptance; bank acceptance draft                    | Term bill; trade comparison                                    |
| `if`                      | Invoice financing                                             | Borrowing; trade comparison                                    |
| `if_after_lc_or_da`       | Invoice financing after an LC or DA bill                      | Borrowing; trade comparison; keeps the bill link on conversion |
| `pif`                     | Purchase invoice financing                                    | Borrowing; trade comparison                                    |
| `twc`                     | Trade working capital                                         | Borrowing; trade comparison                                    |
| `oaf`                     | Open account financing                                        | Borrowing; trade comparison                                    |
| `apf`                     | Account payable finance                                       | Borrowing; trade comparison                                    |
| `psil`, `psbl`            | Pre-shipment import loan; post-shipment buyer loan            | Borrowing; trade comparison                                    |
| `ofcl`, `mctf`            | Onshore foreign currency loan; multi-currency trade financing | Borrowing; trade comparison                                    |
| `tradepay`, `packing`     | TradePay; packing loan                                        | Borrowing; trade comparison                                    |
| `fbep`, `dbep`            | Foreign / domestic bills purchase                             | Borrowing; outside the trade comparison set                    |
| `ecr`, `badd`             | Export credit refinancing; acceptance draft discounting       | Borrowing; outside the trade comparison set                    |
| `stl`, `term`             | Short-term loan; term loan                                    | Borrowing; outside the trade comparison set                    |
| `efs`, `tbl`              | Enterprise financing loan; temporary bridging loan            | Borrowing; outside the trade comparison set                    |
| `lis`                     | Loan insurance trade loan                                     | Borrowing; trade comparison                                    |
| `ma`, `property`          | M&A loan; property loan                                       | Borrowing; outside the trade comparison set                    |
| `bg`, `sg`, `awb`, `sblc` | Banker's, shipping, air waybill and standby-LC guarantees     | Guarantee; documentary                                         |
| `fx`                      | FX contract line                                              | Other; does not consume a financing limit                      |
| `card`                    | Corporate card                                                | Other; consumes its limit                                      |
| `cash`                    | Paid in cash                                                  | Other; does not consume a financing limit                      |

The catalogue and conversion choices are defined once in [`products.ts`](src/lib/products.ts).
LCs and import bills may convert to IF; DA and term bills may convert to IF after a bill. Paying
cash closes the bill without creating a new financing line. Conversion preserves the PO/invoice
links and records the old line on the new one, so both obligations can be traced without double counting.

## Calculations

`src/lib/calculations.ts`, `src/lib/treasury.ts` and `src/lib/purchasing.ts` hold every figure, shared
by pages, automations and write callbacks:

- interest = amount × rate % × days ÷ day basis (360 or 365 per facility); days = due − start (start
  counts, due does not); rounding per facility (nearest cent or down to the cent);
- accrued interest to a day counts that day, never past the tenor;
- used = applied + active lines in USD; earmarks show apart; banks at 80% are flagged;
- cost of funds is weighted by USD amount (and by amount × days over a period);
- charges are the advice's (or typed in) per stage; a stage without one is estimated from the fee
  rules, an agreed charge rate replacing the commission;
- the month-end report takes every line owed at the close, revalued at the month-end FX rate;
  locking it copies the lines and headline figures so later edits never change it;
- an invoice is checked against its PO: price per kg, kg over the order, currency, total, and the
  financing's supplier and amount.

### What each report calculates

- **Dashboard:** current active facilities and open obligations; bank utilisation, unallocated
  earmarks, maturities and funding cost, with a link to the latest closed month. The date picker drives maturities, the historical trend
  and the cost-of-funds period; it does not restore past versions of the live book. Use Month-end
  for a frozen historical position.
- **Costs:** USD trade financing with a recorded rate, started by the comparison date. A proposed
  invoice uses the bank's 90-day weighted product rate, then its last product rate, then its
  90-day trade rate, then its last trade rate. Supplier eligibility, facility headroom, matching product/supplier sublimits and maximum
  tenor are checked separately. Missing rate or fee FX prevents an eligible recommendation.
  All-in % = (interest + fees) / principal × day basis / tenor × 100.
- **Costs → Charges:** recorded charges on USD trade lines started in the last twelve calendar months
  to today, plus estimates for stages not recorded yet, including on settled lines. The table
  separates recorded, estimated, total, per-line, % of financed amount and % p.a.; the annualised
  figure uses a USD-amount-weighted tenor and 360 days. Recorded charge-type breakdowns and an
  all-banks row are provided. Lines without any recorded charges are outside this historical
  sample; the line's Figures tab still estimates their applicable fees.
- **FX:** a report takes the latest dated rate on or before its date, otherwise the latest known
  rate. A month-end foreign principal falls back to the line's stored rate when none is available.
  Actual charges retain their own recorded FX and are not revalued when the FX table changes.
- **Month-end:** includes applied, active and subsequently settled lines started by month-end,
  excluding those repaid by then. An unsettled overdue line remains owed. It uses the facility's
  rounding per line, converts each accrued-interest amount to USD and rounds it before summing.
  Live reports and exports share the same calculation; a locked report reads its copied
  rows. Unlocking returns it to live data; relocking replaces the previous snapshot.
- **Invoice checks:** compare each line's unit price with a 0.5% relative tolerance; flag total
  invoiced quantity more than 0.001 kg above ordered quantity; compare currency, invoice total
  with line totals, financing supplier and total invoiced against financing principal. Findings
  explain differences; they do not silently rewrite a supplier's invoice.

Decimal strings and `BigDecimal` arithmetic preserve money through calculations. Charts convert
the final display values to numbers. Bank cut-off times, maximum tenor and eligibility are
planning warnings; the application does not submit instructions to a bank or execute payments.

## Uploads and document reading

1. In **Bank advices**, upload the PDF (up to 10 MiB); the upload asks for nothing else. Saving starts the
   reader, which fills the advice type, issuing bank, advice date and financing line; there is no separate Read or
   Apply step. A demo reset reads its seeded unread advices the same way.
2. Native document ingest supplies text and pictures; scanned pages become images for the configured multimodal
   model. Extraction copies printed facts, excludes account numbers and lists uncertain fields. The original PDF
   and the extracted figures appear side by side; narrow screens switch between the two panes.
3. Matching ignores punctuation and case and requires at least six reference characters. It uses a bank or
   currency when available and accepts exactly one open financing line. Ambiguous or unmatched advice stays
   available for manual matching. Saving a match or corrected figures automatically submits the update.
4. The existing drawdown or settlement operation submits one native Treasury approval, carrying the advice,
   financing line and charges together. Bolt shows provisional values with a **Pending** hold; approval unlocks
   them, rejection restores the checkpoint. Pending values can appear in reports, so check the native approval
   state before treating the change as final. The original PDF is retained as evidence.
5. Review the figures and arithmetic checks against the PDF, then approve or reject in Bolt's native approval
   controls. Checks compare tenor, bank-basis interest and rounding, and principal + interest + charges against
   the debit total (the charges alone on a drawdown advice). A failed extraction or incomplete operation remains
   visible in the run history. **Read again** appears only on a failed advice and retries it; replacing the PDF clears old figures before rereading it. After rejection, correct and save
   the figures to submit a new proposal. Submitted figures and their PDF stay locked together;
   use a new advice for a later bank notice.

A new financing request asks only for its attachments. Each attachment is read as it is attached or
replaced: one left as other is first given its kind (supplier PO, proforma, customer PO, planning detail)
and its file name as title. Supplier PO supplies the PO number, order/vendor/shipping fields, currency,
amount and T/T versus LC; proforma supplies payment remarks and a currency/amount cross-check; customer PO
supplies its number and purpose. The reader takes the newest attachment of each kind, fills empty fields
and links a saved PO with the form's PO number. It preserves entered values and never sets the pay-by
date; mismatches are written in the read note for the purchaser to resolve. Planning-detail and other
attachments remain supporting evidence.

Use the native PO form or import to create orders and item lines. Norbius's native document
reading and guarded record tools can assist with that task; the facility-form filler does not
create a second order-import subsystem or silently create a supplier. Read jobs require the
host's ingest and AI capabilities. Their native run status records progress or failure; uploads
remain available for manual entry when a provider is unavailable.

**Download PDF pack** prints the saved form through the native record renderer, adds a sign-off
page (affirmation, approval and Treasury acknowledgement), then appends every supporting file
in upload order. PDFs retain all their pages; PNG/JPEG images fit onto A4 pages. These signature
spaces are for signing the exported document; they do not record a platform approval. Readers
can download a pack without changing the form. The combined input and output each have a 4 MiB
limit. An unreadable attachment fails the whole job with its title; files are never silently
omitted, and the original uploads remain unchanged.

## Workspace mechanisms

Treasury records own financing terms, lifecycle transitions, calculations and document checks.
Bolt supplies identity, permissions, files, record history, search, approvals, imports, printing
and durable runs. Pages use shared decimal calculations rather than storing duplicate dashboard
totals. Configure provider connections and host capabilities separately from business records.

## Automations

| Automation               | Does                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `drawdown_allocate`      | Puts an earmark on a bank line                                  |
| `drawdown_cancel`        | Cancels an earmark                                              |
| `drawdown_record_advice` | Records the drawdown advice; the line becomes active            |
| `drawdown_settle`        | Records the settlement advice; flags a differing interest       |
| `drawdown_close_bill`    | Pays a bill in cash or converts it into financing               |
| `bank_document_read`     | Automatically extracts and matches uploaded bank advices        |
| `bank_document_apply`    | Submits advice figures through Treasury approval                |
| `month_end_lock`         | Freezes a month's lines and figures                             |
| `month_end_unlock`       | Lets a month follow live data again                             |
| `facility_form_read`     | Fills a facility form from its PO, proforma and customer PO     |
| `purchase_order_read`    | Fills a purchase order from its PO PDF                          |
| `facility_form_pack`     | Downloads the printed form, sign-off and attachments as one PDF |
| `daily_alerts`           | Every morning, tells Treasury what the Alerts page holds        |
| `drawdown_earmark_po`    | Earmarks a purchase order no line covers yet, linked to it      |
| `fx_document_read`       | Reads a hedge document and files it with its deal               |
| `fx_proposal_read`       | Turns a banker's proposal into alternatives to weigh            |
| `fx_rates_fetch`         | Fetches the official daily exchange rates on weekdays           |

## FX hedging

A deal is a forward, target redemption forward (TRF), knock-out forward, dual currency investment
(DCI) or another structure, on a pair where the company sells or buys the first currency. Its
fixings are child rows; the bank's fixing rate is the one fact a person records on each.

- **Documents.** Upload a term sheet, confirmation, notice or letter; nothing else is asked. The
  reader fills its kind, bank, reference and trade date and files it with its deal (same bank and
  reference, else the same pair and trade date). An unmatched term sheet or confirmation becomes a
  deal to confirm; a termination notice ends its deal from its effective date.
- **Results.** Each fixing is worked out from the bank's rate: knock-outs at expiry or any time,
  a knock-in on a TRF, conditions read from their wording, leverage on a fixing against the
  company, and the fixing that reaches a TRF target paid pro rata, in full or not at all. A result
  a person chooses is kept. Whether a deal has ended is worked out, never typed.
- **Today.** Positions use the official daily rate (the Monetary Authority of Singapore's feed,
  connected under Settings → Connections; rates can also be keyed in). Every open fixing is valued
  at today's rate, and the watch list flags a knock-out within 3%, a target 75% used, a deal out
  of the money and a last fixing within 30 days.
- **Scenarios and how likely.** Every open fixing played at today's rate ±2/4/6%, the strike, the
  knock-out or any rate typed in. The odds bootstrap the pair's own past daily moves (last 3 and 12
  months, trend removed), 3,000 paths each, centred on the bank's quoted forward when there is one,
  and play each path through the same rules. A person's view tilts a second run.
- **Planning.** Paste a banker's message or attach it; each alternative becomes a proposal deal
  with its listed dates or a worked-out schedule. Compare them side by side; "We traded this"
  makes one a deal to confirm, and confirming makes it live.

Treasury changes hedges; Finance and View read them. Knock-ins are not yet in the scenarios or odds,
and figures at the official rate are a guide, not the banks' valuations.

## Seed

The template ships no rows: a new workspace starts with an empty book. Tests create their own
synthetic rows.

## Checks

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
```

`tests/calculations.test.ts` proves interest, rounding, accrual, usage, the cost of funds, FX, fee
estimates, the month-end report and the invoice and advice checks on synthetic figures;
`tests/operations.test.ts` drives a line from earmark to settlement, an LC conversion and a month
lock and frozen/live CSV exports through the engine; `tests/treasury.test.ts` covers access and
the basics. `tests/documents.test.ts` checks scanned advice ingestion and attachment roles;
`tests/pdf-pack.test.ts` checks page order, original-file preservation and failed attachments.

See [the source reference](docs/source-reference.md) for every model, page, automation and policy.

Closing reads every source page and is the sole writer of closing snapshot figures. Native model rules reject manual closes, manual reopen attempts and hand-entered ledger figures even for administrators. Imported historical summaries are immutable.

## Forms and record responsibilities

Long forms are grouped into native sections for the financing, dates, terms and evidence. Optional notes and supporting material collapse without losing unsaved changes. The analysis date uses the shared calendar; the cost report offers an inclusive month range and Month-end selects a single month.

**Facilities** are the bank’s agreed credit limits and reusable terms. **Financing requests** are purchasing applications with supporting documents and an optional link to a saved purchase order. They do not create a second credit limit or financing ledger. Purchase orders own current commercial items, financing lines own financial facts, bank advices retain source evidence, fee rules estimate charges, and actual charges record what was charged. A closed month-end freezes a snapshot; live financing remains the source for a new close. Native Bolt approval, files and audit remain the shared platform mechanisms.

App banners are locally stored stock photographs; [photo credits](assets/app-media/CREDITS.md) list their sources.

## Attention and daily reminders

Attention is derived from current records, not a second reminder ledger. Each record appears once with all matching reasons:

- Applied or active financing: overdue or due within 7 days; LC/import/DA/term bills due within 14 days; LCs expiring within 14 days.
- Earmarks: the expected draw date has passed. A due date beyond the bank’s maximum financing date also raises attention.
- Active facilities: their bank is at least 80% used, or their review date is within 60 days (including overdue reviews).
- Purchase orders: payment by LC was requested but no LC is linked.
- TT financing requests: payment is due from 7 days ago through 14 days ahead.

The morning automation uses the same rules at 08:00 in the workspace’s time zone. When the list is non-empty, it sends the Treasury team one in-app notification per day. Opening an item opens its source record; corrected or closed records drop out when the rules no longer apply.

Business partners have one role: Supplier, Customer, or Supplier and customer. Eligibility belongs to the partner’s bank links, independently of its role.

Members can ask Norbius to change their own display name. Administrators can also change the workspace display name; the workspace address and sign-in stay the same. Personal appearance and language use the account menu; the shared workspace theme uses reviewed source changes.
