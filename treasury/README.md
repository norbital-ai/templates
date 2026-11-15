# Treasury

![Treasury application](docs/screenshots/application.webp)

A treasury and purchasing workspace for a business that finances its purchases through bank
facilities. Treasury keeps its bank lines, limits and terms, and moves each financing line from
earmark to settlement with the bank's advices; purchasing raises purchase orders, records the
invoices that come back and prepares the facility requisition for each PO paid by T/T or LC.

## Apps and roles

| App            | Pages                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| **Treasury**   | Dashboard, Drawdowns, Alerts, Bank advices, Limits & terms, Banks, Suppliers, Costs, Charges, Month-end |
| **Purchasing** | Purchase orders, Facility forms                                                                         |

| Team           | May do                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Treasury**   | Change banks, facilities, fee rules, lines (allocate, advices, settle, cash or convert), suppliers and the banks that finance them, month-end locks, FX rates; key invoices; link POs to lines |
| **Finance**    | Read everything; add, change and cancel earmarks; keep the supplier list; key invoices against POs; keep PO documents                                                                          |
| **Purchasing** | Raise purchase orders (each purchaser sees their own) and change one until it is invoiced; prepare facility forms                                                                              |
| **View**       | Read every page                                                                                                                                                                                |

Administrators see and change everything. Each record's history is the audit trail.

## How a line moves

1. **Earmark**: Finance plans a supplier payment (supplier, requested date, amount, earliest invoice date).
2. **Allocate**: Treasury picks the bank line and product and any agreed rate and charge rate; the line's
   Figures tab shows the room left on every bank line and the latest date the bank finances to.
3. **Record drawdown advice**: the bank's number, dates, rate and charges; the line becomes active.
4. **Settle**, or for an LC, import bill or DA bill **Pay cash or convert**: a conversion closes the bill
   and opens new financing that keeps its POs and invoices. A settled or cancelled line is sealed.

Bank advices can be dropped in, read into their figures, checked against the workspace's own
arithmetic (days, interest with the bank's rounding, total debited) and applied to their line.

## Terms used in the workspace

| Term                                   | Meaning here                                                                                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bank                                   | The lender, with contacts, cut-off time, offered products and watch points. A bank can have several facilities.                                                                                                                                 |
| Facility / credit line                 | One agreement's limit, entity, pricing, day-count basis, rounding and maximum tenor. Limit and headroom reports use USD.                                                                                                                        |
| Letter of offer                        | The attached bank agreement and its review date; the actual terms remain the bank document's.                                                                                                                                                   |
| Sub-limit                              | A product or supplier cap within a facility. It is a warning against allocation, rather than a second pot of credit added to the limit.                                                                                                         |
| Drawdown / line                        | One financing obligation or planned payment. The product says what kind; the status says where it is in its life.                                                                                                                               |
| Earmark                                | A planned payment. It does not count as bank borrowing; allocated earmarks reduce the planning headroom. An unallocated earmark belongs to no bank yet.                                                                                         |
| Applied / active                       | Applied means requested from the bank; active means drawn. Both use the limit when the product uses a limit.                                                                                                                                    |
| Settled / cancelled / unclear          | Settled closes an obligation; cancelled abandons it; unclear is an imported line requiring review. Settled and cancelled lines are sealed except for archive, review and notes.                                                                 |
| Principal / amount                     | The financing amount in the line's currency, separate from interest and fees.                                                                                                                                                                   |
| USD per unit                           | USD bought by one unit of the original currency. USD amount = original amount × this rate. Enter the agreed conversion on a foreign line or charge.                                                                                             |
| Tenor                                  | Due date minus start date in calendar days. It includes the start day and excludes the due day.                                                                                                                                                 |
| Day-count basis                        | The annual denominator, Actual/360 or Actual/365, rather than the number of days in the loan.                                                                                                                                                   |
| Rate / margin / charge rate            | Rate is the full annual interest percentage. Margin is the offer's pricing margin, shown for comparison; it is not added a second time to a line's full rate. Charge rate is an agreed commission percentage replacing the commission fee rule. |
| Accrued / to maturity                  | Accrued interest runs through the report date, capped at the tenor. Interest to maturity covers the whole tenor. Missing rate or date is unknown, not an assumed zero rate.                                                                     |
| Used / available / free after earmarks | Used is applied plus active obligations that consume a limit; available = active limits − used; free after earmarks also subtracts planned earmarks.                                                                                            |
| Cost of funds                          | The amount-weighted annual interest rate. For a period it is weighted by amount × days outstanding; it is not an unweighted average of banks.                                                                                                   |
| Recorded / estimated charge            | Recorded means an actual advice or manually keyed charge. Estimates are live calculations from fee rules and are never saved as charges.                                                                                                        |
| Drawdown / settlement stage            | When a fee is collected. Any recorded charge at a stage, including a zero charge, suppresses the whole stage's estimate.                                                                                                                        |
| Minimum currency                       | The currency of a percentage fee's minimum; it can differ from the currency of a flat fee. Missing FX makes the estimate unknown.                                                                                                               |
| All-in cost                            | Estimated interest plus applicable fees, annualised over the proposed tenor. It is a comparison based on stored history and rules, not a bank quote.                                                                                            |
| Basis points (bps)                     | One percentage point is 100 bps. The spread compares a bank's recent rate with the group's recent rate.                                                                                                                                         |
| Bank advice                            | A bank's drawdown, rate-revision or repayment notice. Uploading or reading it does not settle or change a financing line.                                                                                                                       |
| Checked / applied advice               | Checked means extraction finished; a person still checks it. Applied means the downstream line operation committed.                                                                                                                             |
| PO / proforma / commercial invoice     | A purchase order is the order; a proforma proposes supply and payment terms; a commercial invoice records what was supplied and billed. They have distinct roles.                                                                               |
| Facility form / T/T / pay by LC        | The purchasing requisition; T/T is a bank transfer request, LC requests a letter of credit. Saving an LC form linked to a PO marks that PO as requesting an LC.                                                                                 |
| Month-end lock                         | A portal report's frozen lines and headlines. An imported Excel headline marked locked does not contain frozen portal lines; locking it creates the full snapshot.                                                                              |

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
  earmarks, maturity buckets, due-month ladder, currency/product/status exposure, actual charges,
  and the latest closed-month headline. The date picker drives maturities, the historical trend
  and the cost-of-funds period; it does not restore past versions of the live book. Use Month-end
  for a frozen historical position.
- **Costs:** USD trade financing with a recorded rate, started by the comparison date. A proposed
  invoice uses the bank's 90-day weighted product rate, then its last product rate, then its
  90-day trade rate, then its last trade rate. Supplier eligibility, remaining room and maximum
  tenor are checked separately. Missing rate or fee FX prevents an eligible recommendation.
  All-in % = (interest + fees) / principal × day basis / tenor × 100.
- **Charges:** recorded charges on USD trade lines started in the last twelve calendar months
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
  Live reports and exports share the same calculation; a locked portal report reads its copied
  rows. Unlocking returns it to live data; relocking replaces the previous snapshot.
- **Invoice checks:** compare each line's unit price with a 0.5% relative tolerance; flag total
  invoiced quantity more than 0.001 kg above ordered quantity; compare currency, invoice total
  with line totals, financing supplier and total invoiced against financing principal. Findings
  explain differences; they do not silently rewrite a supplier's invoice.

Decimal strings and `BigDecimal` arithmetic preserve money through calculations. Charts convert
the final display values to numbers. Bank cut-off times, maximum tenor and eligibility are
planning warnings; the application does not submit instructions to a bank or execute payments.

## Uploads and document reading

1. In **Bank advices**, create a record and attach its PDF (up to 10 MiB). Pick its type and bank;
   link its financing line if known.
2. **Read** uses native document ingest for text and pictures. Pages without text are rendered
   as images for the configured multimodal model. Structured extraction copies printed facts;
   uncertain fields remain for review and account numbers are excluded.
3. The reader matches references after removing punctuation and case, requiring at least six
   characters. Review the match, extracted fields and **Checks** beside the original PDF. Checks
   compare tenor, interest under the bank's day basis and rounding, and total debited against
   principal + interest + charges.
4. Correct extracted values through the native record editor. **Apply to line** schedules the
   appropriate guarded drawdown/settlement operation. A failed or incomplete application remains
   a visible run failure; it is not a successful settlement. The line changes only on that
   operation's commit.

Facility forms keep each attachment's role: supplier PO supplies order/vendor/shipping fields;
proforma supplies payment remarks and a currency/amount cross-check; customer PO supplies its
number and purpose. **Fill from attachments** reads the newest attachment of each kind separately,
fills empty fields and links a saved PO with the form's PO number. It preserves entered values,
including currency, T/T versus LC and pay-by date; mismatches are written in the read note for
the purchaser to resolve. Planning-detail and other attachments remain supporting evidence.

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

## OPS portal coverage and native platform mechanisms

This is a port of the portal's business book and calculations into Bolt records and apps. It
does not embed the Django portal, its database, account system, provider keys or customer-specific
company-name mappings.

| Portal function                                                         | Implementation here                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Facilities, terms, contacts, offers, supplier acceptance and sub-limits | Business records, native relations and record editors; Limits & terms, Banks and Suppliers pages.                   |
| Earmark, allocation, advice, repayment, cash close and conversion       | Guarded business automations and native state transitions; sealed closed lines.                                     |
| Usage, maturity, cost of funds, invoice ranking and bank comparisons    | Shared pure decimal calculations called by the pages; no copied dashboard totals.                                   |
| Actual fees, missing-stage estimates and fee minimums                   | Owned charge rows, product/stage rules and explicit FX; estimates remain computed.                                  |
| Month close, unlock and spreadsheet export                              | Native owned snapshot rows, a lock constraint, automations and the XLSX/CSV file sync.                              |
| Advice upload, AI extraction, matching and arithmetic checks            | Native files, ingest and AI plus Treasury's extraction schema, matching and checks.                                 |
| Purchasing orders, invoices, item checks and financing links            | Business records, native roll-ups, scoped purchaser reads and invoice checks.                                       |
| Facility requisition, attachment roles, LC request and T/T due list     | Facility form with owned files, a role-aware reader and the Alerts page.                                            |
| PO spreadsheet/document entry                                           | Native form/import and Norbius record tools; the form filler links an existing PO.                                  |
| Form printing and supporting documents                                  | Native record printing supplies the form; a business automation appends the sign-off page and original attachments. |
| Upload storage, row history, search, filters and bulk import/export     | Native platform features; no Treasury-owned attachment server, audit table or generic import-run model.             |
| Users, sign-in, roles, agent tools and job execution/history            | Native identity, teams/policies, Norbius and durable runs; no copied portal login, AI-cost ledger or worker queue.  |

Operational parity depends on the configured host capabilities and the recorded business data.
The native form/import/print flows replace the portal's generic administration pages. Provider
configuration and release deployment belong to the host, not the template's business records.

## Automations

| Automation               | Does                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `drawdown_allocate`      | Puts an earmark on a bank line                                  |
| `drawdown_cancel`        | Cancels an earmark                                              |
| `drawdown_record_advice` | Records the drawdown advice; the line becomes active            |
| `drawdown_settle`        | Records the settlement advice; flags a differing interest       |
| `drawdown_close_bill`    | Pays a bill in cash or converts it into financing               |
| `bank_document_read`     | Reads advices into their figures for checking                   |
| `bank_document_apply`    | Applies a checked advice to its line                            |
| `month_end_lock`         | Freezes a month's lines and figures                             |
| `month_end_unlock`       | Lets a month follow live data again                             |
| `facility_form_read`     | Fills a facility form from its PO, proforma and customer PO     |
| `facility_form_pack`     | Downloads the printed form, sign-off and attachments as one PDF |
| `daily_alerts`           | Every morning, tells Treasury what the Alerts page holds        |

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
