# Treasury

![Treasury application](docs/screenshots/application.webp)

A corporate treasury, trade-financing and FX-hedging workspace for businesses that fund purchases through
bank credit facilities. Treasury tracks bank limits, sublimits and fee rules, moves financing lines from
earmark to settlement with AI-read bank advices, manages FX hedges and fixings, and coordinates purchase
orders, supplier invoices and facility requisitions with Purchasing and Finance.

## Industry & Bolt capabilities

- **Industry:** Finance
- **Bolt capabilities:** `data_modeling`, `complex_business_logic`, `workflow_approvals`, `document_intelligence`, `third_party_saas`, `scheduled_automations`

## How it works

1. **Facility hierarchy & drawdown ledger:** Banks, facilities, sublimits and fee rules define available
   headroom and day-count accrual rules (`Actual/360`, `Actual/365`). Purchasing raises `purchase_order`
   rows and facility packs (`facility_form_pack` via `pdf-lib`); Finance earmarks and tracks `drawdown`
   obligations from `earmark → applied → active → settled`.
2. **Document intelligence & native approval:** Uploading bank advices, supplier POs, facility forms or
   FX term sheets runs OCR/AI extraction automations (`bank_document_read`, `purchase_order_read`,
   `fx_document_read`), verifies interest and debit arithmetic, and submits advice updates through native
   `ctx.approve` Treasury review.
3. **Daily FX feed, alerts & month-end close:** `fx_rates_fetch` pulls weekday official rates via
   `mas_rates`, `daily_alerts` runs at 08:00 for maturities and headroom breaches, and `month_end_lock`
   freezes historical snapshots so closed periods never drift.

## Key capabilities

- **Bank facilities & drawdown lifecycle:** Manage multi-bank credit limits, sublimits, fee rules,
  day-count bases (`Actual/360` or `Actual/365`) and rounding. Move financing obligations from
  `earmark → applied → active → settled / cancelled`, including LC and term-bill conversions that preserve
  linked POs and invoices without double counting.
- **AI bank-advice reading & approval:** Upload a bank drawdown or settlement PDF to automatically
  extract figures, check tenor/interest/debit math, match the open line, and submit the update and actual
  charges together for native Treasury approval.
- **Purchasing & invoice cross-checks:** Raise POs from supplier PDFs, prepare T/T and LC financing
  requests with combined downloadable PDF packs, and verify supplier invoices against ordered quantities,
  unit prices and financed principals.
- **Cost of funds, attention & locked month-ends:** Compare all-in borrowing costs across banks, review
  live maturity/headroom/LC alerts (with daily 08:00 Treasury reminders), and lock month-end snapshots so
  closed historical positions cannot drift when FX rates or rules change.
- **FX hedging & scenario planning:** Track forwards, TRFs, knock-out forwards and DCIs with automatic
  term-sheet extraction, daily official FX rates (MAS feed), watch-list alerts, ±2/4/6% scenarios and
  bootstrapped odds.

## Apps and roles

| App               | Pages                                                          | Audience                                       |
| ----------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| **Treasury**      | Overview, Financing, Bank advices, Attention, Costs, Month-end | `Treasury` (manage), `Finance` / `View` (read) |
| **Hedging**       | Overview, Structures, Fixings, Planning                        | `Treasury` (manage), `Finance` / `View` (read) |
| **Purchasing**    | Business partners, Purchase orders, Financing requests         | `Purchasing` (own POs), `Finance` / `Treasury` |
| **Configuration** | Banks, Facilities, Exchange rates                              | `Treasury` (manage), `Finance` / `View` (read) |

- **Treasury** owns banks, facilities, fee rules, financing operations, hedges, FX rates and month-end
  locks; **Finance** adds/cancels earmarks and manages supplier invoices; **Purchasing** raises own POs
  and prepares financing requests; **View** has read-only access across every page.

## Data model

26 models across nine ownership roots:

- **Banking & limits:** `bank` (`letter_of_offer`, `watch_point`), `facility` (`facility_fee`,
  `sub_limit`), `fx_rate`.
- **Financing & close:** `drawdown` (`bank_document`, `drawdown_charge`), `month_end` (`month_end_line`).
- **Purchasing:** `business_partner` (`supplier_bank`), `purchase_order` (`po_line`, `po_document`,
  `po_financing`, `invoice` → `invoice_line`, `facility_form` → `facility_attachment`).
- **FX hedging:** `fx_deal` (`fx_document`, `fx_fixing`), `fx_proposal`.

## Automations and integrations

| Area                    | Automations / integrations                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Financing lifecycle** | `drawdown_allocate`, `drawdown_cancel`, `drawdown_record_advice`, `drawdown_settle`, `drawdown_close_bill`, `drawdown_earmark_po`                      |
| **Document extraction** | `bank_document_read`, `bank_document_apply`, `facility_form_read`, `purchase_order_read`, `facility_form_pack`, `fx_document_read`, `fx_proposal_read` |
| **Close & monitoring**  | `month_end_lock`, `month_end_unlock`, `daily_alerts` (08:00), `fx_rates_fetch` (weekday official FX rates via `mas_rates` integration)                 |

## Getting started

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
bunx bolt build
```

A fresh workspace starts empty; configure banks, facilities and exchange rates under **Configuration**,
and connect the `mas_rates` feed in **Settings → Connections** for automated weekday FX rates.

- [Documentation index](docs/README.md)
- [Domain and calculation reference](docs/reference.md) (glossary, product codes, formulas, hedging & attention rules)
- [Source reference](docs/source-reference.md)
