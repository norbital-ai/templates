# HRMS calculation architecture

[How this HRMS works](0000-hrms-principles.md) is the plain-language version, for HR professionals.

Status: normative. Section 0 is the owner's fixed design. The recurring second-owner smell and the owner's ownership rules are formalised in [0006](0006-configuration-ownership-and-smells.md). [The model contract](0002-model-specification.md) defines the models, [the seed contract](0003-jurisdiction-seed-specification.md) the seed and [verification](0004-verification-gates.md) the gates. The source tree is the final authority; these documents describe it and never create a second implementation plan.

## 0. The design is fixed

The owner's design. Every agent reads it first and wires around it; only the owner's words change it, and where anything else here disagrees, it wins.

### How to work with it

- A requirement that seems not to fit is a misreading, not a gap; a limit of your code is not a limit of the design. "It doesn't fit" and "this needs a new field" are not findings.
- Add no model field, engine concept, context root, run input or helper module unless told to; ship no approximation. If a requirement has no home, stop and ask the owner.
- Brief every subagent with this section.

### Catalogues, entries and corrections

- A **catalogue** row holds a family's behaviour: eligibility, conversion, target subtotal and lookup, plus its role fields. Allowance, overtime and statutory are definitions only; leave, claim, adhoc, loan, work event and workplace case take entries.
- A **catalogue entry** is one dated event against a catalogue item: what happened, never how it is priced.
- A **reversal entry** undoes a mistake: a new entry on the same item, linked through `reverses` to the sealed entry it reverses, created only by the HR controller from the Events tab. The link makes it a reversal; no second flag, nothing automatic. Leave, claim, adhoc and loan repayment carry it. Nothing posted is edited or deleted: the movement is the inverse and the pay line flips direction. The next run repays it at the original month's value; HR does not pick the period (owner, 2026-11-09). Until a run consumes it, HR cancels it by deleting it: movement undone, original sealed.
- A correction is a reversal or an adjustment entry against a catalogue item. A statutory row may refund: where its statute has the employer repay, a result below zero pays a refund line and the balance falls; otherwise it stops at zero and the next run nets it. No payslip line and no ledger amount is negative.
- A leave row says two things (owner, 2026-11-10). **`paid_share`**: the share of a normal day a day of this leave pays — empty 1, no pay 0, half pay 0.5, or an expression per half-day slot. It is 0 to 1 and the run refuses anything outside; more than a normal day is a `payout` or overtime, never leave. **`payout`**: what a cash-out entry pays (days × the statute's day value, so a prorated exit year works), only on cashable rows; its presence makes a row encashable. Leave never prices a day off in money: the run factors the salary's unpaid part `(1 − paid_share)` by the jurisdiction's divisor and rest-day rules, and `NPL` posts that unpaid part as a catalog line at `PAID_BASIC`. Company policy goes on the row's `paid_share` or `payout`.
- A **work event** is a dated real-world condition affecting work, owned by no employee: heat, hurricane, earthquake, epidemic, suspension. It is the non-person variant of an incident; a workplace case stays employee-specific. `work_event_catalog` is configuration under Settings → Catalog: the row is the event type, with no category enum or suspension catalogue. `work_event` records period, entity, optional employment, location, description and evidence. It pays nothing: allowance, adhoc and leave rules read events through `ctx.work_events` and remain the rows that post. The run and leave sync expose entity-wide plus employment-specific events.

### Owed, used, exits and company methods (owner amendment, 2026-11-09)

- **Owed** is a catalogue rule plus contract facts; sync posts the difference per source and never wipes a balance. **Used or paid** comes from entries. **HR adjusts a balance by hand** on the employee profile: a manual ledger row, `source` `manual:<id>`, adding or removing signed days on a leave row's `entitled` (or money on a claim row's `limit`) for the window holding its date, with a `note` and no entry behind it ("it's how we are able to edit the ledger"). It is immutable; a mistake is an opposite row. Sync never touches it; carry and settlement count it like any entitled day.
- `PUBLIC_HOLIDAY_IN_LIEU` is its own leave row: 0 by default, a yearly grant only if its rule says so, plus HR's manual adjustments. A public holiday on a rest day is a calendar row that `replaces` it, given only to those off on the replaced date; never a leave entry.
- A closing period settles once on its last day; a share by completed months counts that day as served, and a service band is the one the period started in.
- Service comes from the contracts. `employee_profile.cumulative_service` (default false; owner, 2026-11-09): on, every stint counts, rehires included; off, the current unbroken stint (statutory continuous service). `service_started_on` only credits service from elsewhere.
- An **exit** is a sealed contract version ending with no same-jurisdiction successor; no record copies it. The contract's write raises `exit`; encashment and exit duties listen. A moved or cancelled exit waives its open duties; its held encashment is rejected by HR by hand (owner, 2026-11-09).
- The employer's method applies where it pays at least the law, otherwise the law. Methods are `entity_profile_version.pay_methods` — `overtime_hour_basis`, `rest_day_hourly_multiplier`, `night_differential_basis` `CLOCK_SPAN` (night premium on every clocked hour in the window at the ordinary hour rate, breaks included) — each floored at the statute per day or shift (owner: "keep it to the company's calculated rates UNLESS it is not compliant"). Company leave policy goes on the row's `paid_share` or `payout`; an employee-borne income-tax share is a contract term. Rounding follows `manual-probe-matrix.md` §8.1a. A one-off month is a recorded difference, not a method.

### Owner directives, 2026-11-10 — attendance, basic checkpoints and incentive (OT)

- **Roster mapping is seed, not engine.** Every employee with attendance gets a roster; the shift pattern supplies the plan, and a paid work day without a clock gets one. Office staff are not exempt. The roster is the cycle's source of truth: a planned shift or OT pays only when the clock covers it. `ABS` is not a shift code and not a roster row: the engine reads a planned work day the roster leaves out (with no leave and no published holiday), or a planned `WORK` day with no clock, as an absence. A `PH` or a leave slot is not an absence. The engine does not infer the worker class; the presence of the person's roster for the cycle declares the roster the source of truth.
- **Basic checkpoints.** `BASIC` is the contract salary. `PRORATED` is `BASIC` less joiner/leaver proration and `ABS`. `PAID_BASIC` is `PRORATED` less the `NPL` catalog lines. Everything else — allowances, overtime, claims, adhoc, loans — points after `PAID_BASIC`. `ORDINARY_WAGES` and every statutory base read the reduced amount. `NPL` is a catalog line at `PAID_BASIC`, never a `NET` deduction; `ABS` and contract-date proration are system adjustments with no catalog.
- **NPL.** The leave row is `NPL` across every jurisdiction; `paid_share` 0 declares it, and the engine posts its unpaid amount as a catalog line. It is not folded into `BASIC`.
- **Day rate.** Malaysia uses `YEAR` (monthly × 12 ÷ (52 × contract days/week)); the fixed 26 divisor remains only where a jurisdiction names it. Contract hours and days come from the employee data file, not from the shift.
- **Incentive (OT).** Every `INCENTIVE (OT)` in a salary listing is a seed adhoc entry on the `INCENTIVE_OT` catalog; it is EPF, SOCSO and EIS wages, and PCB taxes it in the month as additional remuneration (owner, 2026-11-11: as the listing does). Attendance OT excludes incentive hours; the roster's planned OT is cleared on those days.
- **Export.** The salary listing carries contract basic, paid basic, proration, `ABS`, `NPL`, allowances, gross, statutory and net as separate columns.
- **Jurisdiction snapshots.** A snapshot is a change batch: one copy of the whole jurisdiction, created when a change event is applied on its effective date. Seed only the live window **December 2025 – November 2026**; a later change is a future change, applied by creating the next snapshot when it takes effect, never a pre-seeded snapshot.
- **Holiday.** Contract normal hours come from the employee data; for Company A [amount] h/day is normal, so a [amount] h shift has [amount] h beyond normal. Holiday work is two days within normal hours plus [amount]× the hourly rate beyond; a listing that pays [amount]× on all hours is below the law on the excess.

### Ledger and balance

- The ledger moves two ways only: **posting**, when a record is written (a leave, claim or adhoc entry declaring accounts, or a payslip), and **sync**, when an entitlement may have changed (a contract or fact, an entity, a new law, a period ending). One service writes it. Loans stay out — a loan and its repayments are their own record. Workplace cases never move a balance.
- Append-only; an amount is never negative.
- `employee_balance` is one row per person, the ledger's projection keyed by family, code, period and measure: accumulated values and entitlements only — no notes, flags, dates or guards.
- Earlier runs come from the balance; there is no payroll history read (`ctx.history`, statutory history, payslips). The period is in the key: a new year is a new key, nothing closes, and old periods leave through dated entries.

### Linear computation and subtotals

- One chain per settings version: no stages, phases or branches. The first subtotal opens with base pay; each later one is the previous plus its lines; statutory schemes run in `depends_on` order; checkpoints rebuild with the statutory lines and the last is net pay.
- A subtotal is a checkpoint used by catalogues and may be any figure. Separate pay with subtotals, never by inspecting lines.

### Jurisdiction settings and lookup

- Jurisdiction settings capture behaviour for the jurisdiction; a change of law is a new sealed version.
- `lookup` holds only shared tables and constants, each with a declared shape; a row's local lookup wins. A value read by one row lives on that row.
- One typed `conversions` block declares `day`, `hour`, `proration` and `rounding`. The engine computes the day and hour rates once per run; a row never derives its own. `proration` is `CALENDAR_DAYS`, `WORKING_DAYS` or `DAY_RATE`; `DAY_RATE` prices each missed day at `ctx.day_rate` (PH 313/261, TW/TH ÷ 30, ID ÷ 173 h, CN ÷ 21.75), not a share of the period's days.

### Registered rules and effects

- A rule validates on an event; an effect is a side effect of one, and a check on a finished payslip is an effect that raises an obligation.
- Reads happen once, up front, for the whole batch, never per payslip.

### Payroll run

- Two kinds, and these are their names: **on-cycle payroll** and **off-cycle payroll**. `payroll_run` is thin: on-cycle takes the cycle, the entity from page scope; off-cycle takes who and what it is for.
- **Pay groups (owner, 2026-11-11).** A company's people are not all paid on one schedule: a `pay_group` is one payroll of a company (its name and its schedule: frequency, pay days, cutoff). Every schedule is a group; the company carries none. A contract names its group (a move is a new version from the first of a month), and a run is for one group: company, group, cycle. Its attendance window, pay date and "a later cycle has run" are that group's. A company with one group needs none named.
- Off-cycle pays adjustment entries and bonus runs, with one-off lump sums such as severance. Recurring items are on-cycle only: a tax instalment, zakat, rent, benefit in kind, allowance or overtime never runs off-cycle. Only leave and adhoc carry `off_cycle_eligible`; claims and statutory schemes always apply.
- **A holiday for one person (owner, 2026-11-11).** A `holiday` is the company's day. With `employee_id` set it is that person's alone: the day they keep the holiday when their shift put it on another date (a night guard whose holiday shift starts as the holiday ends). The run reads it for that person only; company calendars leave it out.
- **Work pass expiry (owner, 2026-11-11).** `terms.work_authorisation_expires_on` is the day a foreign worker's pass ends, an extension included. A law that ties a contribution to the pass reads it: Malaysia's provident fund carries no contribution in a wage month that touches the pass's last two months.
- Everything else derives from the pay group's schedule, cutoff day and the law in force; none of it is typed. `pay_date` is the day the schedule pays, and the calculation reads it. The date people see is the moment the run moved to `PAID`; it shows only then and is never typed.
- A run is `UNPAID` or `PAID`, payment is per run, and a payslip has no status and is read-only forever.
- An unpaid run can be deleted: its payslips go, every entry it sealed keeps its row with `payroll_run_id` null, and the balance returns through inverse ledger entries. A paid run is locked.
- Year-to-date only moves forward. A run a later run counted cannot be deleted for anyone paid in both, so runs come off newest first; a skipped on-cycle period cannot run behind a later one.
- Attendance stays as recorded; pay with no attendance behind it is flagged, never invented.

### Configuration ownership (owner directives, 2026-11-08)

- Every value has one owner: read by one row, it lives on that row; settings hold shared rate tables only.
- No variable allowances: an allowance is the agreed flat amount on the contract or a catalog rule that computes it, never typed per payslip. The row declares `include_in_rate` when the law counts it in the wage a day or hour rate divides.
- No constant hoisting: `no_part_xii_categories` is inlined in Malaysia's overtime eligibility; `wage_floor_factor` sits on Indonesia's overtime row; `daily_hours` and part-time maxima on the roster rule; `months_per_year`, `full_year_min_months` and `compensation_max_years` are literals in their reader.
- A catalog row keeps its program with a declared boundary: per-family typed params, one input root set, one output type; the build checks the roots and the run decodes the output. `format: 'cel'` is gone; expressions are JavaScript with one checker. `reads` values are explicit `{ var: ... }` or literals, never bare `ctx.` strings.
- Extension schemas are flat: no `facts`, `term_facts`, `exit_facts` or `elections`; `statutory.<SCHEME>` and `events[]` stay nested. A field exists only because a formula reads it or the salary listing shows it.
- The ledger period is a typed template and the measure a typed union; the write boundary refuses an unknown code.

### Owner amendments, 2026-11-09

- **Allowances compute, or state an agreed amount.** `conversion` and `eligibility` are the pricing rule. A conversion reading `terms.allowances.<CODE>.amount` is a flat agreed amount, and the contract editor offers only those rows; a row that computes its amount (a monthly heat allowance over declared months) is not stated on the contract. The run prices every row through eligibility; no flag.
- **A versioned catalog is chosen inside its version.** Pickers list only rows of the sealed version in force on the day; the row written is that version's, not a duplicate code.
- **A version-scoped representation does not repeat its version.** Catalog rows omit the Settings field; identity is `code` plus `description`.
- **All top-level settings sections are tabs** — version, lookup, calculation overview, catalog, registered rules, registered behaviour, compare — with `More` only for overflow; the sidebar highlights the active child, never the group.
- **A leave entry shows its slots**: employment, catalog, reversal link and every `leave_catalog_entry_day` slot with its sealed state. A reversal is created only from the HR Controller Events tab, from a row action that opens the form with the original's captured slots preselected; self-service has no reversal path. A reversal returns exactly the captured slots it names; only those are reversible.
- **The profile is one screen with vertical sections.** Face enrolment sits inside Profile; two columns where width allows; a nested vertical tab rail.
- **Seals belong to the split part.** A leave seal is the slot's `payroll_run_id`, a loan seal the repayment's. The catalog entry carries no seal badge or column; the leave entry keeps its run roll-up only for attachment and filtering.
- **Descriptions and references are different fields.** A rule or effect states what it does in a human `description`; `references` stays the law, article, quote. The calculation overview leads with the description; code, expression, eligibility and references sit behind its info control.
- **The paid-run lock is an invariant.** A no-pay entry cannot be dated in a period an on-cycle run covered; the correction is a reversal dated in the next period to run. It belongs to the leave write path, not jurisdiction rules.
- **Selection is visible.** A leave half-day is filled when selected, dimmed and blocked when unavailable; the reversal form preselects only the original's captured slots on their own month.

### Simplicity

- Thin and light: delete before adding, prefer the existing mechanism. About 80 people stay under 2 s of CPU, on the fewest round trips.
- A run reads once, at admit: everything its window needs, in one request, before any payslip. Every entry family is read by the run's own window only (owner, 2026-11-09) — roster days, leave slots, claims, adhoc entries and loan repayments dated in its attendance window, never earlier history. Each payslip is one linear computation that reads and evaluates nothing twice.
- What no run has paid is read as unpaid, not by date: claims and adhoc entries (late, or a statutory adjustment dated in the month it corrects), and unsealed reversals and cash-outs. A roster day or instalment dated in attendance a run already priced is refused at write; missed attendance is paid by an arrears adhoc entry in the next run.
- Consumed entries are sealed in one write: leave, claim, adhoc, roster and loan repayment (the repayment, not its loan). Effects work in bulk: one read per batch, one write per effect.
- Seed expressions are read by customers: statute citations, never working notes.

## 1. Ownership

Every fact has one owner. A value is read from its owner; it is not copied into a second model or JSON bag.

| Owner                               | Owns                                                                                                                       | Does not own                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `jurisdiction_settings`             | Sealed legal definitions, statutory schemes, statutory conversion constants, rounding                                      | Employer operating hours, agreed pay |
| `entity`, `entity_profile_version`  | Legal identity, registrations, payment schedule, non-working weekdays, disbursement, time zone                             | Employee pay terms                   |
| `employee_contract`                 | Agreed rate and its unit, normal hours per day, normal hours and days per week, agreed allowances, exit terms, dated facts | Statutory law                        |
| `contract_change`                   | A dated change filed ahead of its day                                                                                      | Anything payroll or the ledger reads |
| Catalogue definitions               | Eligibility, conversion, target subtotal, lookup and the role fields its family declares                                   | Employee-specific amounts            |
| Catalogue entries                   | Dated employee activity and its evidence                                                                                   | Pay calculation results              |
| `ledger_entry` + `employee_balance` | Posted movements and their cumulative projection                                                                           | Calculation inputs                   |
| `payroll_run` + `payslip`           | Run state, coverage, source capture, per-employee totals, the breakdown as calculated                                      | Figures a later run reads            |

### Ordinary hours and statutory conversion

Ordinary hours are employment terms: `employee_contract.terms.normal_hours_per_day`, `normal_hours_per_week` and `normal_days_per_week`, with the entity's `payment_schedule.non_working_weekdays` defining the working week.

Every jurisdiction's settings declare its conversions in one typed `conversions` block, and only these:

- `conversions.day`: how one day's pay derives from the month's wage. `CALENDAR_DAYS` (the calendar days of the month), `WORKING_DAYS` (its ordinary working days), `YEAR` (monthly wage × 12 ÷ (52 × contract days/week)), `YEAR_REST_DAYS` (× 12 ÷ (365 − 52 × rest days)), `HOUR` (the hour rate × contract hours/day), or `FIXED` with its `days` (a statutory monthly divisor where a jurisdiction names one). Malaysia uses `YEAR` (owner, 2026-11-10). `days` exists only on the FIXED arm.
- `conversions.hour`: `CONTRACT_HOURS` (day ÷ contract normal hours), `CONTRACT_WEEKLY` (monthly wage × 12 ÷ (52 × contract hours/week)), or `FIXED` with its `hours`. `hours` exists only on the FIXED arm.
- `conversions.proration`: how a salary shrinks for a part period. `CALENDAR_DAYS`, `WORKING_DAYS` or `DAY_RATE`, whichever the statute names. `DAY_RATE` prices each missed day at `ctx.day_rate`, so a day off costs the statute's day rate whether it is leave, `ABS`, a joiner's missing day or a leaver's.
- `allowance_catalog.include_in_rate`: whether that allowance is part of the wage a day or hour rate divides. The property lives on the allowance row, not on a global settings switch. Every allowance amount is fixed; there is no variable allowance.
- `conversions.rounding`: `{ mode, scale }`, the mode one of `HALF_UP`, `HALF_EVEN`, `UP`, `DOWN`, `TRUNCATE` and the scale an integer 0–12, defaulting to `HALF_UP` at 2.
- `ledger.ytd_scope`: `JURISDICTION` or `EMPLOYER`, choosing the account scope for pay and statutory totals where each employer withholds alone.

The engine computes `month_wage`, `day_rate`, `hour_rate`, `calendar_days` and `working_days` once per run and puts them on every expression context. On an overtime row, `hour_rate` is the higher of that and the employer's `pay_methods.overtime_hour_basis` hour (`CONTRACT_WEEKLY`: a monthly wage × 12 ÷ (52 × contract hours/week)). Every payroll expression reads those figures, so a jurisdiction prices overtime, leave and deductions from one conversion. A jurisdiction never carries a day-rate expression: the arithmetic is shared, and only the basis is law. A statute with its own formula for one purpose, such as Singapore's hourly overtime rate, keeps it on that row.

A contract states its rate as `MONTHLY`, `DAILY` or `HOURLY`. A daily or hourly contract's own rate already is its day or hour; the monthly divisor applies to a monthly wage, and the engine derives the monthly equivalent only where a rule asks for one.

A choice is a typed enum or union; a shared table has a declared row shape and a shared constant a declared scalar shape. `lookup` holds only shared values. A definition read by one rule, effect or catalog row belongs to that row, never to settings. A value the contract states is never repeated in settings.

Rounding is part of `conversions`: the same typed object, not a loose pair of settings keys.

## 2. One ledger, two ways in

```text
POSTING                                    SYNC
a record was written                       an entitlement may have changed
leave · claim · adhoc · payslip            contract · entity · new law · a period ended
        │                                          │
        └──────────────────┬───────────────────────┘
                           ▼
                settle(what should stand)
                           │  one write
                           ▼
         ledger_entry (append-only) + employee_balance.account
```

`src/lib/ledger/` is the only writer. A record that posts carries its ledger rows and balance moves in its own write (`onApproved`): at once, or in the approving decision's commit when an approval holds it, and never when it is rejected. The ledger and the balance refuse every other writer but sync, which runs one at a time under the `payroll_execution` policy, and HR's manual adjustment: a ledger row the `hr_controller` writes on the employee profile, whose window and `source` (`manual:<id>`) the service works out and whose balance move rides in the same write. Sync never touches a manual row; carry and the closing settlement count it. A source says what it should have posted, and `postings` carries the difference, so repeating any of this posts nothing.

| Source              | Movement                                                                         |
| ------------------- | -------------------------------------------------------------------------------- |
| Leave entry         | `leave/<code>/<period>/used`, per day of its window                              |
| Claim entry         | `claim/<code>/<period>/used`                                                     |
| Adhoc with accounts | What `lookup.accounts` names                                                     |
| Payslip             | `pay/<checkpoint>/<period>/total` and `statutory/<scheme>.<party>/<period>/paid` |
| Entitlement         | `leave/<code>/<period>/entitled`, `carried`                                      |
| Claim limit         | `claim/<code>/<period>/limit`                                                    |
| Manual adjustment   | `leave/<code>/<period>/entitled` or `claim/<code>/<period>/limit`, by HR         |

A reversal is its own entry, posted in the period of the entry it `reverses`. It undoes one entry a run has sealed, of the same person and catalog item, once, for no more than that entry held; an entry no run has sealed is deleted instead. Loans stay out: a loan and its repayments are their own record. Workplace cases never move a balance.

Run effects look for their own task before raising it: raising one twice would fail every effect after it, so a second run in a period finds the first's task and raises nothing.

A run effect reads only its own task: its exact key where the key is known up front, or the tasks at its own level, entity or person. A read covering every task of the entity would change whenever anything raised one, and the write after it would fail, so a contract sealing beside a run could cost that run its reminders. A run cannot be marked paid until every payslip's balance has it.

Creating an entry posts it in the same write: its transform carries the ledger rows and the balance move, so an entry held for approval posts when it is approved and never if rejected. A claim reversal gives back no more than its original drew.

## 3. Payroll chain

### 3.1 Intake

A run is created through `payroll_run.create`; its `transform` is the calculation entry point and produces the run's payslip children. It reads one sealed settings version, its `subtotal` chain, catalogues, statutory schemes and registered rules; the employee profile and balance map; the contract and the entity profile version covering the period; the period's entries. The balance holds everything a formula needs from earlier runs.

A captured source is immutable until the run releases it, even when the run is unpaid. Only deleting the run releases it.

### 3.2 First subtotal — base pay

The first subtotal has `previous_id = null`. With no `calculation`, it is the default base pay from contract terms; a `calculation` reads that figure as `ctx.base_pay`:

- `MONTHLY`: the agreed monthly salary.
- `DAILY`: daily rate × ordinary working days in the salary coverage.
- `HOURLY`: hourly rate × ordinary hours in the salary coverage.

`BASIC` is the contract salary. `PRORATED` subtracts joiner/leaver days and `ABS`; `PAID_BASIC` subtracts the `NPL` catalog line. A salary follows `proration_basis`; a day or hour rate pays the working days. On `WORKING_DAYS` the share is the person's own working days from their shift pattern. On `CALENDAR_DAYS` it is calendar days, and only the days actually absent are deducted: a rest day inside a stretch stays paid (owner amendment, 2026-11-10). On `DAY_RATE` each missed day takes `ctx.day_rate` off the salary and off what reads `ctx.paid_share`; missing days count over the day rate's own days (calendar for a 30-day divisor, working days otherwise), and a rest day is never added. A leave slot is half a day; its unpaid part, `1 − paid_share`, posts as the `NPL` line at `PAID_BASIC`. Paid leave (`paid_share` 1) creates no line. Joiner/leaver days and `ABS` post at `PRORATED`. A reversal gives back the original month's net, priced through the entry it `reverses`, on its own refund line.

An allowance takes the same share when its conversion reads `ctx.paid_share` (the share of the period paid); no flag says so. A fixed recurring cash allowance prorates; a claim, overtime, a bonus, a benefit in kind, an attendance bonus, a per-event payment and an allowance tied to the person rather than to the days do not.

A no-pay leave (`paid_share` 0) posts an `NPL` line at `PAID_BASIC`; allowances that read `ctx.paid_share` still move with the unpaid share. `ABS` and contract-date proration post at `PRORATED`. A correction after payment is then a reversal entry the HR controller enters in Events, on the same catalog item, dated in the next period to run. It is priced on the month it reverses, so it gives back what was taken. The `NO_PAY_OPEN_PERIOD` rule refuses a no-pay entry dated in a period that has run, and a reversal of a day not yet paid: that entry is deleted instead.

A no-pay row has no grant figure, so nothing limits it. The days taken still post to `used`. See section 4.1.

There is no base-pay producer model and no implicit BASE stage. Base pay is readable by every payroll expression.

### 3.3 Later subtotals

Each later subtotal's value is the previous subtotal plus every employee line whose `subtotal_id` points at it. Producers:

| Producer         | Payroll line                                 | Ledger                                            |
| ---------------- | -------------------------------------------- | ------------------------------------------------- |
| allowance        | cash to the employee                         | none                                              |
| overtime         | cash, employee                               | none                                              |
| leave encashment | cash from `payout`                           | posted when an HR controller approves the entry   |
| leave taken      | `NPL` line at `PAID_BASIC`; `1 − paid_share` | the entry posted its days when it was created     |
| leave reversal   | the original month's unpaid part             | the reversal posted its days when it was created  |
| claim            | reimbursement                                | the entry posted when it was created              |
| adhoc            | cash `ADD` or `DEDUCT`                       | posted when created, if the row declares accounts |
| loan repayment   | recovery                                     | none; loans stay out of the ledger                |
| statutory scheme | employee and employer amounts                | posted from the payslip                           |

Exit encashment: when a sealed contract ends with no same-jurisdiction successor, the `encashment` automation raises one
encashment request for every leave row with a `payout`, for the days the person has
left. The HR grant holds every encashment request for HR controller approval, whoever ended the contract, so its days
post to the ledger only when approved.

An adhoc row's `party EMPLOYEE` enters the running subtotal and net; `party EMPLOYER` is employer cost and never enters net. Every other producer pays the employee.

A catalogue whose definition creates no payroll line has a null `subtotal_id` — a taken-leave catalogue, for example. Interruption and workplace-case catalogues leave it null: the engine prices neither, and a run only seals their entries.

Only adhoc rows opt into an `OFF_CYCLE` run through `off_cycle_eligible`; a bonus or severance is the one-off case. Statutory schemes always apply. Claims, leave, allowance, overtime and loan recovery are on-cycle only.

### 3.4 Statutory

Schemes evaluate in topological `depends_on` order and see only earlier finalised schemes; a cycle is refused. Each scheme evaluates `eligibility`, `employee_amount` and an optional `employer_amount`.

A row's result decides what happens. Above zero it is a deduction. Below zero, a row with `lookup.below_zero: 'REFUND'` pays a refund line on that run and the statutory balance falls with it, because its statute has the employer repay. Any other row stops at zero, and the next run nets what is left. No line and no ledger amount is ever negative.

### 3.5 Creation is finalisation

Creating a run computes and writes one payload: payslip totals and an `UNPAID` run. There is no preparing or separate finalise step. Payslips carry `basic_earnings`, `gross_earnings`, `net_pay`, `total_deductions`, `employer_cost`, `ordinary_wages`, `additional_wages`, `employee_statutory`, `employer_statutory`, `tax_withheld` and `breakdown`; the breakdown carries the `BASIC`, `PRORATED`, `PAID_BASIC` and later checkpoints, the `NPL`/`ABS`/proration lines and the statutory amounts as calculated. The run owns `salary_coverage`.

The payslip is the run's entry. `payroll_run.create` posts its checkpoints and statutory rows in its own write, once, in the period of its pay date, with the balance. A deleted run's movements are inverted exactly, in the delete.

### 3.6 Ledger rows

| Account     | Code                | Measure | Posts                                           |
| ----------- | ------------------- | ------- | ----------------------------------------------- |
| `pay`       | `<subtotal code>`   | `total` | `ADD` the checkpoint's value, when above zero   |
| `statutory` | `<scheme>.employee` | `paid`  | The employee amount; a refund posts as `DEDUCT` |
| `statutory` | `<scheme>.employer` | `paid`  | The employer amount                             |

Each posts to the tax year's period, and also to the month's where the subtotal or statutory row declares `balance_window: MONTH`. The column defaults to `YEAR`.

A wrong payment corrects itself through later cycles, with no automatic entry. HR corrects the pay, and the next run's statutory rows count the total paid: a row with a band, ceiling or threshold computes on the pay month's total and charges the difference from what the month has charged. Below zero on the employee side, a row with `lookup.below_zero: 'REFUND'` pays a refund line and any other row stops at zero; neither pays a negative line. The employer side stops at zero. A row on a base fixed for a period does not move with the month's pay, and a cumulative tax settles itself.

Singapore's AW ceiling works the same way across the year. `CPF_AW` records the additional wages that attracted CPF, and the ceiling counts each month's OW at that month's ceiling, so a raise past the ceiling stops counting the excess. The last month of the year or of the employment settles on the actual OW: AW the estimate left out attracts CPF, and an excess comes off that month's CPF.

A subtotal or statutory row declaring `balance_window: MONTH` posts to the month's period as well as the year's. `ctx.balances.month` holds those as `<pay month>.<code>`, so a formula reads what this month has paid, what last month paid, or a year that runs April to March.

Where a statute fixes an amount on the month's total, a month's runs are one month: the formula reads what earlier runs of the month paid and charges the rest, so a bonus owes the same inside the on-cycle run or off-cycle, before or after it. Contributions follow the wage month, so a whole-month salary already in the pay month is another wage month's or another employer's and the run stands alone; tax follows the pay month and combines them. An off-cycle run in a transfer month reads both companies' month, so a bonus that month goes on-cycle, where each company stands alone. A scheme charged on salary alone charges nothing on an off-cycle run. A tax that projects the year stands an off-cycle run on the salary to come, and withholds only what the run adds.

Year to date lives in the balance and nowhere else. A formula that needs earlier runs reads `ctx.balances.ytd`, `ctx.balances.statutory_contribution`, `ctx.balances.month` or `ctx.balances.years`; there is no payroll history read.

### 3.7 The tax year

The year is in the key, so nothing closes it. `ctx.balances.ytd` and `ctx.balances.statutory_contribution` hold the totals of the tax year the pay date falls in, so the first run of a new year reads an empty year. `jurisdiction_settings.tax_year_start_month` sets the year; the pay date decides which year a run falls in. A new jurisdiction is a new scope in the key and reads empty too, as does a new employer where `ledger.ytd_scope` is `EMPLOYER`. A same-jurisdiction transfer keeps its keys; the comparison is by jurisdiction code, never by entity ([transfer semantics](transfer-semantics.md)). Sync takes old periods off the balance through dated movements: a month over a year old, and a year or service window that began more than three years back. The ledger keeps them.

## 4. Balances and ledger

`employee_balance` is one row per employee: `employee_id` (unique) and a JSON `account` map. `ledger_entry` is immutable: `balance_id`, `operation` (`CREATE`, `REMOVE`, `ADD`, `DEDUCT`), `account`, `code`, `period`, `measure`, `amount`, `unit`, `effective_on`, `source` and an optional `note` (a manual adjustment's cause). `period` is the typed template `<scope>.<Y|M|D|S|B|L|E>.<window start>`; `measure` is one of `total`, `used`, `entitled`, `carried`, `limit`, `paid`. The ledger refuses a malformed period, an unknown measure, and a payslip code its sealed version does not declare.

The map is keyed by family, code, period and measure:

```json
{
	"leave": { "ANNUAL_LEAVE": { "MY.S.2026-03-05": { "entitled": 14, "carried": 3, "used": 6 } } },
	"claim": { "MEDICAL_CLAIM": { "MY.Y.2026-01-01": { "limit": 576, "used": 400 } } },
	"pay": { "GROSS": { "MY.Y.2026-01-01": { "total": 12000 } } },
	"statutory": { "EPF.employee": { "MY.Y.2026-01-01": { "paid": 1320 } } }
}
```

The projection is rebuildable from `ledger_entry` and is written only by the ledger service. A correction appends an inverse or a new movement; it never edits history.

A movement and the balance it moves commit as one write, so they cannot disagree. No effect touches the ledger or the balance. `source` is plain text, so a movement outlives what caused it, and a deleted record's movements are still found and inverted.

A sync can run again after a crash, and `postings` compares with the ledger, so a repeat posts nothing. Two writers cannot lose an update: every balance move is guarded by its revision.

### 4.1 Leave entitlement

Everyone's leave is computed by default from the catalog row. The balance is never recalculated from scratch: it moves by the difference between the entitlement last applied and the new one, so days already taken stay taken.

```text
entitled = catalog row + the person     what they should have this window
carried  = from the window before
left     = entitled + carried − used    derived, never stored
```

The row's `lookup` holds the figure: `grant_days`, or `service_bands` by completed months of service, for its `window`. Eligibility, part-time bands, a first-year share by completed months and carry-forward come from the same lookup. A row with no figure has no cap to hold.

The `ledger` automation computes this, and `src/lib/ledger/entitlement.ts` holds the rule. One service, scoped by what it is given:

```text
WHEN                     CALLED BY              INPUT        WHO        WHAT MOVES
───────────────────────  ─────────────────────  ───────────  ─────────  ─────────────────────────
A contract is created    contract effect        employees    them       new − 0
or seals                                                                new − applied
HR runs it               employee profile       employees    them       whatever is due
A catalog change         sealed version effect  none         everyone   new − applied
An employer version      sealed version effect  none         everyone   new − applied
seals
A run marked paid        run effect             none         everyone   a service band
A window's first day     the automation itself  none         everyone   a new window: reset, carry
1 January                yearly cron            none         everyone   a new window: reset, carry
```

It is idempotent. Each run compares what is owed with what was applied and writes only the difference, so a run with nothing to do writes nothing, and a repeat changes nothing. A person's movements and their balance commit together, and a lost race reads again, so what already landed is never repeated.

```text
  newcomer, or catalog change
              │
              ▼
  compute new entitlement from the catalog row
              │
              ▼
       diff = new − applied
              │
     ┌────────┼────────┐
     ▼        ▼        ▼
   diff=0   diff>0   diff<0
   nothing  ledger   ledger
            ADD      DEDUCT
              │        │
              └───┬────┘
                  ▼
     balance moves by diff
     applied = new
```

```text
EVENT                         APPLIED   DIFF   TAKEN   BALANCE
───────────────────────────   ───────   ────   ─────   ───────
Joins, entitled to 14            14     +14      0       14
Takes 3 days                     14       –      3       11
Catalog raises it to 18          18      +4      3       15
Catalog lowers it to 16          16      −2      3       13
```

A new sealed version is the catalog change. In force now, its diff applies straight away; dated later, it applies on the day it starts. A cut stops the balance at zero: days already taken are never clawed back.

A new window starts the balance again rather than moving it by a diff, because days used come back. A calendar year turns on 1 January and a service year on its anniversary: each full sync schedules itself for the next day anyone's window turns, and the first paid run on or after that day picks it up too. A row opened by a fact has no window: only a fact on the contract gives or takes its days (section 4.2).

```text
NEW WINDOW, RULE ON THE ROW        NEXT BALANCE
─────────────────────────────────  ───────────────────────────────────────
no carry                           new entitlement; unused days lapse
carry: { windows: 1 }              new + the smaller of held and applied
carry: { windows: 1, max_days: n } as above, the carried part at most n
per_months                         held + new; nothing lapses
```

Carry reaches one window back: taking the smaller of held and applied means days carried last time lapse if they are still unused.

The window that closed settles first, once, as the next opens: its rule as of its last day, under the law and contract of that day. A share by completed months counts that day as served; the service band stays the one the day itself reaches. Carry reads the settled figure.

A row can also say:

```text
KEY                                 EFFECT
─────────────────────────────────   ──────────────────────────────────────────────
part_time_pro_rata                  a part-timer takes hours ÷ full_time_weekly_hours
grant_days_by_normal_days_per_week  few weekly days and hours take the statute's table
extra_days                          a class of work or a contract fact adds days
rolling_months                      a window of several years opens once in the span
first_year_days                     the full first-year figure a share by months prorates
first_year_proration_days           the first year counts the calendar days left
state_owned_employer                only a state-owned employer's staff qualify
accounts                            the entry draws on another row's account instead
```

A contract's `annual_leave_carry_limit_days` caps what it carries. A limit that spans rows or years is a registered rule: Singapore's sick and hospitalisation days share 60, and Taiwan's hospitalised days total a year within any two. A write may make 10 reads, so a new check joins an existing rule's reads where it can.

Each window is its own key, so nothing closes or resets. A balance seeded before a sync opens with its entitlement under the sync's own source, so sync finds it posted.

### 4.2 Dated facts open leave

A birth, a marriage, a bereavement or a long illness is a fact about a person, so it lives on the sealed contract, in `employee_extension_data.events`. Each country's `employee_extension_schema` declares the kinds. Documents are uploaded on the employee profile, by HR or the employee.

```text
HR adds to the contract: CHILD_BIRTH, 2 March, and seals it
        |
Sealing triggers sync
        |
Each leave row whose lookup.opened_by names CHILD_BIRTH opens for that event
        |
ADD leave/MATERNITY_LEAVE/MY.E.2026-03-02/entitled 98
```

| Row                    | Holds                                                        |
| ---------------------- | ------------------------------------------------------------ |
| Contract               | `events`: `kind`, `on`, `opened_on`, `ended_on`, `document`  |
| `leave_catalog.lookup` | `opened_by`: the kinds that open it, with `days` to override |
| `leave_catalog.lookup` | `grant_days`, `eligibility`, `pay_steps`                     |

A change known ahead of its day is filed as a `contract_change`; nothing reads it until the `contract_materialize` automation seals it into a new version on that day. An employer fact works the same way through `entity_change` and `entity_materialize`.

Each event is its own period, so days left from one birth do not stack onto the next. A complication is another event on the same date, so it adds to the same period and keeps its pay count.

Pay that steps down is one row. `pay_steps` on the leave row says what share each month of the event loses, and its `paid_share` reads, for each slot, the event that opened the row (`ctx.event`) and the slot's date (`ctx.as_of`).

```text
MEDICAL_LEAVE, Indonesia (PP 36/2021 art.41(1))
  no event covers the day          full pay
  LONG_ILLNESS from 2 Feb          the count starts
    month 1-4    100%
    month 5-8     75%    the salary loses the other 25% of each working day
    month 9-12    50%
    month 13+     25%
  event ended                      the next sick day is at full pay
```

Workplace cases file incidents, requests and notices. If one changes pay, HR makes the entry.

## 5. Catalogue contract

Catalogues live under `jurisdiction_settings/catalog/`.

- `static/` holds configured definitions with no employee rows: `allowance_catalog`, `overtime_catalog`, `statutory_contribution_catalog`.
- `non_static/` holds a definition with an entry subfolder: `leave_catalog`, `claim_catalog`, `adhoc_catalog`, `loan_catalog`, `work_event_catalog`, `workplace_case_catalog`.

Every definition carries `code`, `name`, `settings_id`, a `lookup`, `references` and an optional `subtotal_id`. Pay-producing definitions add `eligibility`, `conversion` and an optional `incurred_on`. Only adhoc carries `direction` and `party` (an adjustment may add or deduct, for the employee or the employer); overtime keeps `direction`. A leave, claim or allowance has neither (owner): a leave pays its `paid_share` of a day and cashes out at its `payout`, a claim pays the employee what it reimburses and draws down its limit, an allowance pays the employee, and a reversal flips its entry's line. Leave carries `paid_share` and `payout` instead of a conversion; adhoc adds `off_cycle_eligible`. Statutory adds `kind`, `depends_on`, `employee_amount`, `employer_amount` and an optional `employer_cost_subtotal_id`.

`references` records the research and legal provenance of the definition. Entries never carry a `reference`.

Leave, claim, adhoc and loan entries carry `entity_id`, `employment_id`, `catalog_id`, optional `payroll_run_id` and evidence. `payroll_run_id` locks the row once a run captures it; the lock is never a payslip. Family fields:

| Entry          | Fields                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| leave          | `days` — non-empty `{ date, part: AM \| PM }[]`; quantity is `days.length / 2`; `encashment`, `reverses` |
| claim          | `quantity`, `unit`, `incurred_on`, `reverses`                                                            |
| adhoc          | `description`, `quantity`, `unit`, `incurred_on`, `reverses`                                             |
| loan           | `quantity` (principal), `repayment_period`; no reversal flag                                             |
| loan repayment | `loan_id`, `amount`, `paid_on`, `payment_reference`, `reverses`                                          |

There is no `quantity`, `unit` or session object on leave, no advance date/reference or repayment plan on loans, and no principal/interest/fee allocation on repayments.

## 6. Work, calendar and validation

`shift_definition` declares one day variant: day type (`WORK`, `REST`, `OFF` or `ABS`), start/end time, next-day rollover, breaks and optional untimed hours. `shift_pattern` lists them by slot, counted from its `anchor_date`: anchored on a Monday, slot 1 is Monday and slot 7 Sunday. `holiday` and the interruption/case catalogues supply dated source data.

The contract's pattern is the default. A day with no `roster_entry` is a day worked as planned: salary stands and no overtime is paid. This is the office-worker case. A manual worker's supplied roster is the cycle's source of truth; a planned shift or OT pays only when the clock covers it. `ABS` is not a shift code or a roster row: a planned work day the roster leaves out (no leave, no published holiday) or a planned `WORK` day with no clock is the absence. Leave and PH are not absences. The seed decides who has roster days; the engine does not infer office/manual. `roster_entry` changes a day: `work_date`, `shift_definition_id`, `planned_overtime_intervals` and `actual_worked_intervals`. `ABS` is a day type like `REST`: the person did not come, and it is not leave.

Overtime is paid only from planned intervals. The clock verifies them and never creates them, and no overtime is projected. A person who clocks at least the entity's `overtime_full_award_percent` of the plan is paid the whole plan; below it they are paid the clocked hours inside the plan, rounded down to the half hour. A day whose planned overtime is marked `overtime_as_time_off` prices none of it (`overtime_hours` and `worked_hours` leave it out, `time_off_hours` holds it): the payslip posts those hours to the law's leave row with `overtime_as_time_off: true`, an hour-unit row.

A law's roster warnings (`roster_warnings` on its roster rule) cap daily hours, daily and monthly overtime, consecutive days and weekly rest. The monthly overtime cap is hours counted on every day, or `{ hours, day_types }` counted only on the day types it names (Malaysia's EA s.60A(4)(a) leaves rest-day work out).

`registered_rule` validates a target collection: events, declared reads, condition and validation expression, evaluated inside the target model's write transform or delete check. `registered_effect` registers a post-commit expression; the source model's effect queries the registry and writes the records the expression returns through its `target_action`. Every seeded effect raises an `obligation`.

```text
write ──► registered_rule (target_collection, events) ──► commit
                                                           │
commit ──► registered_effect (source_collection, events) ──┴──► target_action write
```

## 7. Obligations

`obligation` is a free-form task or reminder raised by an event: `entity_id`, optional employee/employment, `title`, optional `due_on` and `fulfilled_on`, `occurrence_key`, optional evidence and waiver reason, and the state `OPEN → FULFILLED | WAIVED`. It stores no financial fields and posts no ledger movement.

A registered effect on an entry reaches its version through the catalog row the entry was raised on, which the entry's model passes on; sealing an entry into a run is not an edit and fires nothing. A check with a deadline ahead, a permit or a retirement date, sits on `payslip` and runs at every run: nothing wakes a tenant database on a timer, and its `occurrence_key` keeps it to one obligation.

An off-cycle run pays the contracts in its period, so a leaver's goes on the period of their last day, and a run that would seal an entry with no payslip refuses.

## 8. Expression context

Expressions are deterministic JavaScript function bodies with explicit returns, run by the bounded interpreter. Missing values are unknown, never zero. No database access, ambient clock or undeclared calls.

| Evaluation          | Context                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `ctx.subject`       | employee, employment, employer data                                   |
| `ctx.entry`         | catalogue entry and its admitted quantity/unit                        |
| `ctx.lookup`        | the jurisdiction's global lookup under the row's own                  |
| `ctx.balances`      | `ytd`, `statutory_contribution`, `month`, `years`                     |
| `ctx.base_pay`      | the running checkpoint; default base pay at the first                 |
| `ctx.day_rate`      | the jurisdiction's day rate for this person                           |
| `ctx.hour_rate`     | the jurisdiction's hour rate for this person                          |
| `ctx.month_wage`    | the person's monthly wage, included allowances with it                |
| `ctx.calendar_days` | calendar days of the salary coverage                                  |
| `ctx.working_days`  | ordinary working days of the salary coverage                          |
| `ctx.paid_share`    | allowance: the share of the period paid, the salary's own             |
| `ctx.subtotals`     | completed earlier subtotal results only                               |
| `ctx.statutory`     | completed earlier statutory results by scheme code                    |
| `ctx.overtime`      | the run's overtime pay, in statutory evaluation                       |
| `ctx.work`          | the period's roster days and their priced minutes                     |
| `ctx.run`           | payroll frame during a run                                            |
| `ctx.reads`         | declared reads for validation and registered effects                  |
| `ctx.event`         | the write a rule or effect answers to; the fact an entitlement counts |
| `ctx.used`          | leave `paid_share`: days of the row its window used before the slot   |
| `ctx.as_of`         | the date the expression is evaluated for                              |

In a run and in sync the employment in `ctx.subject` carries `service_started_on` (the service start
`cumulative_service` decides) and `employment_started_on` (the current unbroken stint's start, for statutes that count
employment in the year); a registered rule or effect gets both on a contract read that names either field.

## 9. Governing constraints

1. The source tree in the [model contract](0002-model-specification.md) is the final model set. Deleted concepts are not reintroduced behind wrappers, aliases or JSON bags.
2. Values are not duplicated: no employment or payroll lock on a roster day, and no payroll history alongside the balance.
3. Statutory evaluation persists only as ledger rows and the payslip.
4. One linear, cycle-free subtotal chain per settings version. No `phase`, `channel`, `order` or implicit stage.
5. A payroll run, never a payslip, owns source capture and row locks.
6. Formula simplification means moving orchestration to the engine, not minifying legal distinctions.

## 10. Changing a formula

The ledger service owns balance admission and posting; the engine owns dependency resolution and rounding. A formula selects its evidenced base and legal values and assesses the amount. Preserve legal distinctions and dated versions. A changed result requires an explained correction, not a silently updated expected value.
