# Source reference

Verified directly against `templates/treasury/src/` on 25 November 2026.

**Totals:** 26 models (9 ownership roots), 4 applications (16 pages), 10 custom record views,
17 automations, 11 policies (4 teams), 1 integration, 1 file sync, 8 shared library modules,
2 message catalogs (`en`, `zh`), 4 SQL migrations (`0001_initial.sql`–`0004_schema.sql`).

## Workspace configuration

- **`src/+workspace.ts`:** `tz: 'Asia/Singapore'`, `locale: 'en-SG'`, `languages: ['en', 'zh']`,
  `apps: ['treasury', 'hedging', 'purchasing', 'configuration']`, `convert: { to: ['pdf'] }`, custom
  `theme.light` and `theme.dark` token sets.
- **`src/agent/+agent.md`:** Norbius workspace brief (confirms before running line operations or
  `month_end_lock`, preserves native bank-advice approval, enforces record boundaries).
- **`src/i18n/`:** `+messages.ts` (English), `+zh.messages.ts` (Simplified Chinese).

## Applications, pages, and custom record views

### Applications and pages (4 apps, 16 pages)

| Application     | Pages (route key → title)                                                                                                                        | Banner                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `treasury`      | `dashboard` (Overview), `drawdowns` (Financing), `advices` (Bank advices), `alerts` (Attention), `costs` (Costs), `month_end` (Month-end)        | `app-media/treasury.webp`      |
| `hedging`       | `overview` (Overview), `deals` (Structures: Deals / Documents tabs), `fixings` (Fixings: Needing a rate / Next 30d / All), `planning` (Planning) | —                              |
| `purchasing`    | `partners` (Business partners), `purchase_orders` (Purchase orders), `facility_forms` (Financing requests)                                       | `app-media/purchasing.webp`    |
| `configuration` | `banks` (Banks), `facilities` (Facilities), `fx_rates` (Exchange rates)                                                                          | `app-media/configuration.webp` |

### Custom record representations (10)

| Model              | File                                                                 | Highlights                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bank`             | `src/data/model/bank/+representation.svelte`                         | Grouped sections for Bank, Contacts & cut-off, Terms (watch points & letters of offer), Facilities                                                                   |
| `facility`         | `src/data/model/facility/+representation.svelte`                     | Grouped sections for Facility & limit, Pricing & fee rules, Terms, Dates, Sub-limits, Notes                                                                          |
| `business_partner` | `src/data/model/business_partner/+representation.svelte`             | Partner details, aliases, payment terms, products, Treasury-controlled `eligible_banks`                                                                              |
| `drawdown`         | `src/data/model/drawdown/+representation.svelte`                     | Tabs: Figures (live warnings, tenor, interest, actual/est. charges), Headroom (earmarks), POs; action sheets for allocate, cancel, record advice, settle, close bill |
| `bank_document`    | `src/data/model/drawdown/bank_document/+representation.svelte`       | Split PDF iframe + extracted form, live `adviceChecks`, `RunsFor` history, Read again on `failed`                                                                    |
| `purchase_order`   | `src/data/model/purchase_order/+representation.svelte`               | Starts with PO PDF upload; tabs: Invoice checks (`invoiceFindings`), LC / financing + link form; Earmark it action                                                   |
| `facility_form`    | `src/data/model/purchase_order/facility_form/+representation.svelte` | Starts with attachments upload; grouped request/shipment/credit/planning sections; `read_note` banner                                                                |
| `fx_deal`          | `src/data/model/fx_deal/+representation.svelte`                      | Tabs: Today (live valuation & watch list), Results, Scenarios, How likely (3k-path bootstrap); promote buttons (`proposal → draft → live`)                           |
| `fx_document`      | `src/data/model/fx_deal/fx_document/+representation.svelte`          | Split PDF iframe + extracted reading form; Read again button on `failed`                                                                                             |
| `fx_proposal`      | `src/data/model/fx_proposal/+representation.svelte`                  | Paste text or attach file; Alternatives tab + on-demand side-by-side odds & spot-scenario matrix                                                                     |

## Models (26 across 9 ownership roots)

| Root / Model                             | Writes                     | Constraints, roll-ups, transforms & effects                                                                                                                                                                          |
| ---------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`bank`**                               | create, update             | Unique `code` (`import_key`); JSON `contacts[]`; nested writes for `watch_points`, `letters_of_offer`                                                                                                                |
| └ `letter_of_offer`                      | create, update             | `reviewDates` transform syncs `next_review_date` → `facility.review_date`; PDF `<= 10 MiB`                                                                                                                           |
| └ `watch_point`                          | create, update             | Cascades on `bank`; `set_null` on `facility`                                                                                                                                                                         |
| **`facility`**                           | create, update             | Unique `(bank, name)`; nested writes for `sub_limits` and `fees`                                                                                                                                                     |
| └ `facility_fee`                         | through `facility`         | Cascades on `facility`; `percent` (with `minimum_amount`/`minimum_currency`) or `flat`                                                                                                                               |
| └ `sub_limit`                            | create, update             | Cascades on `facility`; optional `product`, `supplier` (`set_null`)                                                                                                                                                  |
| **`business_partner`** (`was: supplier`) | create, update             | Unique `name` (`import_key`); text index `(name, aliases)`; nested writes for `eligible_banks`                                                                                                                       |
| └ `supplier_bank`                        | through `business_partner` | Unique `(supplier, bank)`; cascades on both `business_partner` and `bank`                                                                                                                                            |
| **`drawdown`**                           | create, update             | Status transitions; `due_after_start` check; `sealed_line` lock (`settled`/`cancelled` except `is_archived`, `discrepancy_note`, `notes`); computed `amount_usd`; sum `invoiced_amount`; nested writes for `charges` |
| └ `drawdown_charge`                      | through `drawdown`         | Cascades on `drawdown`; computed `amount_usd`; actual charges suppress stage fee estimates                                                                                                                           |
| └ `bank_document`                        | create, update, delete     | `submitted_advice` lock (`read_status == 'applied'`); delete refused if `applied`; transform resets on file/re-read; effects schedule `bank_document_read` & `bank_document_apply`                                   |
| **`month_end`**                          | create, update             | Unique `month` (normalized via `monthStart`); `imported_report` & `locked_month` locks; transforms enforce `isCloser` actor guard (`month_end_lock`/`month_end_unlock` only); nested writes for `lines`              |
| └ `month_end_line`                       | through `month_end`        | Cascades on `month_end`; `set_null` on `drawdown`; export sync `sheet` (`+sheet.sync.ts`)                                                                                                                            |
| **`fx_rate`**                            | create, update             | Unique `(currency, rate_date)`; 12-scale `usd_per_unit`; `preliminary` flag                                                                                                                                          |
| **`purchase_order`**                     | create, update             | Unique `po_number`; sums `amount`, `quantity`, `invoiced_amount`; count `invoice_count`; transform enforces Tuesday/Friday `payment_date`; nested writes for `lines`, `documents` (create), `invoices` (update)      |
| └ `po_line`                              | through `purchase_order`   | Cascades on `purchase_order`; sum `invoiced_quantity` from `invoice_lines`                                                                                                                                           |
| └ `invoice`                              | through `purchase_order`   | Unique `(po, invoice_number)`; cascades on `purchase_order`; `set_null` on `drawdown`; nested writes for `lines`                                                                                                     |
| &nbsp;&nbsp;└ `invoice_line`             | through `invoice`          | Cascades on `invoice`; `restrict` on `po_line`                                                                                                                                                                       |
| └ `po_document`                          | create, update, delete     | Cascades on `purchase_order`; create/update effect schedules `purchase_order_read` when `kind == 'purchase_order'`                                                                                                   |
| └ `po_financing`                         | create, delete             | Unique `(purchase_order, drawdown)`; cascades on both                                                                                                                                                                |
| └ `facility_form`                        | create, update             | `set_null` on `purchase_order`; text index `(po_number, vendor, customer_po_number)`; `askForLc` transform sets `purchase_order.lc_requested = true`; nested writes for `attachments`                                |
| &nbsp;&nbsp;└ `facility_attachment`      | create, update             | Cascades on `facility_form`; create/update effect schedules `facility_form_read`                                                                                                                                     |
| **`fx_deal`**                            | create, update, delete     | Status transitions `proposal → draft → live`; transform normalizes `pair` to 6 uppercase letters; nested writes for `fixings`                                                                                        |
| └ `fx_fixing`                            | through `fx_deal`          | Cascades on `fx_deal`; indexed on `fixing_date`                                                                                                                                                                      |
| └ `fx_document`                          | create, update, delete     | `set_null` on `bank` and `deal`; create/update effect schedules `fx_document_read`                                                                                                                                   |
| **`fx_proposal`**                        | create, update, delete     | `set_null` on `bank`; create transform refuses when both `text` and `file` are null; effects schedule `fx_proposal_read`                                                                                             |

### File syncs (1)

| Model            | Sync    | File                                                     | Behavior                                                                                           |
| ---------------- | ------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `month_end_line` | `sheet` | `src/data/model/month_end/month_end_line/+sheet.sync.ts` | Export-only (`xlsx`, `csv`), context `{ month: date }`; serves locked lines or live `monthEndFrom` |

## Automations (17)

| Automation               | Trigger(s)                                                          | Policy              | Summary                                                                                                   |
| ------------------------ | ------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| `drawdown_allocate`      | Manual (`treasury`)                                                 | `treasury`          | Assigns an earmarked line to an active facility, copies `day_count_basis`, sets optional product/rates    |
| `drawdown_cancel`        | Manual (`treasury`, `finance`)                                      | `finance`           | Transitions earmarked line(s) to `cancelled` (sealed), freeing headroom                                   |
| `drawdown_earmark_po`    | Manual (`treasury`, `finance`)                                      | `po_earmarks`       | Creates an earmarked `drawdown` + `po_financing` link for an uncovered active PO                          |
| `drawdown_record_advice` | Manual (`treasury`) + scheduled by `bank_document_apply`            | `bank_advices`      | Moves open line to `active`, replaces drawdown charges, notes rate diffs (**held for Treasury approval**) |
| `drawdown_settle`        | Manual (`treasury`) + scheduled by `bank_document_apply`            | `bank_advices`      | Moves open line to `settled` (`repaid`, archived), checks interest math (**held for Treasury approval**)  |
| `drawdown_close_bill`    | Manual (`treasury`)                                                 | `treasury`          | Closes open `lc`/`import_bill`/`da`/`tb` via `cash` or atomic `convert` (new line + cloned POs/invoices)  |
| `bank_document_read`     | `bank_document` effect + seeder + manual (`treasury`)               | `bank_advices`      | Multimodal AI extraction (`sys_2`) + unique open-line reference matching                                  |
| `bank_document_apply`    | `bank_document` effect + manual (`treasury`)                        | `bank_advices`      | Schedules `drawdown_record_advice` or `drawdown_settle` from checked matched advice                       |
| `purchase_order_read`    | `po_document` effect + manual (`treasury`, `finance`, `purchasing`) | `purchase_orders`   | Multimodal AI extraction (`sys_2`) filling empty PO header fields & initial item lines                    |
| `facility_form_read`     | `facility_attachment` effect + manual (`purchasing`)                | `facility_forms`    | Classifies attachments, extracts PO/proforma/customer PO into blank form fields, links PO                 |
| `facility_form_pack`     | Manual (all 4 teams)                                                | `facility_forms`    | Renders form PDF + A4 sign-off page + ordered attachments via `pdf-lib` (`<= 4 MiB`)                      |
| `fx_document_read`       | `fx_document` effect + seeder + manual (`treasury`)                 | `fx_reader`         | Extracts FX term sheets/confirmations/notices, matches or creates `draft` deal, sets `ended_on`           |
| `fx_proposal_read`       | `fx_proposal` effect + seeder + manual (`treasury`)                 | `fx_reader`         | Extracts banker proposal alternatives & schedules into `proposal` `fx_deal` records                       |
| `month_end_lock`         | Manual (`treasury`)                                                 | `month_end_closing` | Cursor-paginates full book, computes `monthEndFrom`, freezes `month_end` + `month_end_line`               |
| `month_end_unlock`       | Manual (`treasury`)                                                 | `month_end_closing` | Unlocks a portal-closed `month_end` (refuses `excel` imports)                                             |
| `daily_alerts`           | Cron `0 8 * * *` (`rest: '7d'`)                                     | `treasury`          | Evaluates `attention()` and notifies team `treasury` once per day if non-empty                            |
| `fx_rates_fetch`         | Cron `30 13 * * 1-5` (`rest: '7d'`) + manual (`treasury`)           | `fx_rates`          | Queries `mas_rates` for missing/preliminary weekdays in prior 15 days and upserts `fx_rate`               |

## Teams (4) and policies (11)

| Policy              | Bound to                                                                                 | Key scope & rules                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `treasury`          | Team `treasury` (Treasury)                                                               | All 4 apps, 15 automations; full operational writes; `month_end` notes only                                                                              |
| `finance`           | Team `finance` (Finance)                                                                 | All 4 apps, 4 automations; partner metadata, earmarked-only `drawdown` verdict, PO updates/invoices/docs                                                 |
| `purchasing`        | Team `purchasing` (Purchasing)                                                           | `purchasing` app only, 3 automations; own POs only (`created_by == actor.id`, locked after 1st invoice), own PO docs (restricted kinds), `facility_form` |
| `viewer`            | Team `viewers` (View)                                                                    | All 4 apps read-only across all 26 models + `facility_form_pack`                                                                                         |
| `bank_advices`      | `bank_document_read`, `bank_document_apply`, `drawdown_record_advice`, `drawdown_settle` | `drawdown.update` verdict **always** requires `ctx.approve` by team `treasury` (`Treasury review`)                                                       |
| `month_end_closing` | `month_end_lock`, `month_end_unlock`                                                     | Sole policy permitted by `month_end` write transforms to write closing figures and toggle `is_locked`                                                    |
| `po_earmarks`       | `drawdown_earmark_po`                                                                    | Creates `drawdown` + `po_financing` from uncovered `purchase_order`                                                                                      |
| `purchase_orders`   | `purchase_order_read`                                                                    | Updates blank fields & initial lines on `purchase_order`                                                                                                 |
| `facility_forms`    | `facility_form_read`, `facility_form_pack`                                               | Reads/updates `facility_form` & `facility_attachment`, links `purchase_order`                                                                            |
| `fx_reader`         | `fx_document_read`, `fx_proposal_read`                                                   | Updates `fx_document`/`fx_proposal`, creates/deletes `fx_deal`, updates `fx_deal.ended_on` only                                                          |
| `fx_rates`          | `fx_rates_fetch`                                                                         | Reads `sys_integration`, creates/updates `fx_rate`                                                                                                       |

## Integrations (1)

| Handle      | Driver | Endpoint & auth                                                                                                                |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `mas_rates` | `http` | `https://eservices.mas.gov.sg/apimg-gw/server/`, credential `api_key` sent in header `keyid` (tenant-configured, never seeded) |

## Shared libraries (`src/lib/`)

| Module            | Responsibility                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `calculations.ts` | `BigDecimal` wrappers, UTC date arithmetic, `tenorDays`, `accruedDays`, `interest` with facility rounding                                                                                                                                                                                                                                        |
| `products.ts`     | 37 `PRODUCT_CODES`, `PRODUCTS` metadata (`uses_limit`, `bucket`, `trade`), `CONVERTIBLE`, `family`                                                                                                                                                                                                                                               |
| `charges.ts`      | 8 `CHARGE_TYPES`, `ADVICE` & `CHARGES_INPUT` schemas, `replaceStage`, `documentApplied`                                                                                                                                                                                                                                                          |
| `treasury.ts`     | `lineFigures`, `utilisation`, `headroom`, `subLimitUsage`, `maturities`, `maturityLadder`, `costOfFundsTrend`, `periodCost`, `usdPerUnit`, `chargesUsd`, `feeAmount`, `estimateCharges`, `monthEndReport`, `monthEndFrom`, `rateByMonth`, `compareInvoice`, `bankSummary`, `chargesSummary`, `monthEndExportRow`, `lineWarnings`, `adviceChecks` |
| `purchasing.ts`   | `paymentDay` (Tue/Fri), `urgentPayment` (Tue), `invoiceFindings` (5 checks), `poStatus`, `facilityFor`                                                                                                                                                                                                                                           |
| `fx.ts`           | 11 `FX_STRUCTURES`, 8 `FX_OUTCOMES`, `FX_READ`/`FX_PROPOSAL_READ`, `pairRate`, `pairHistory`, `fixingAt`, `workOut`, `gainUsd`, `fxState`, `play`, `dciResult`, `scenarios`, `position`, `schedule`, `odds` (3k-path mulberry32 bootstrap), `pointsToWeigh`, `dealFrom`, `dealView`, `watch`                                                     |
| `attention.ts`    | Shared `ATTENTION_READ` query spec and `attention()` evaluator across 6 models (17 triggers)                                                                                                                                                                                                                                                     |
| `documents.ts`    | `blank()` helper and `documentSource()` (native `ctx.convert.ingest` + scanned page rendering)                                                                                                                                                                                                                                                   |
