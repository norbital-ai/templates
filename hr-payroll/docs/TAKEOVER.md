# HR payroll takeover

Living plan for `templates/hr-payroll`. One file. The session history that used to live here was deleted on
2026-10-06 with the rest of the stale documentation; it described purged models and is not restored.

## Binding directives

1. **Delete-first.** Stale files, configuration and seed data are purged, never brought back from git, builds or
   backups. An import of something deleted is fixed by purging or refactoring its consumer.
2. **Logic lives in records.** Law is data: `jurisdiction_settings` versions, their catalogue rows, `rule_set` rows and
   `behaviours`, with CEL for every rate, band, eligibility, price, due date and condition. `src/lib/payroll_engine/` is a
   generic evaluator — no jurisdiction codes, scheme names, rates, divisors or currency defaults in source.
3. **Effect-TS** across the template (`Effect`, `Schema`, `Data.TaggedError`); no ad-hoc throws in new code.
4. **Automations are taps.** `behaviour_taps` applies the governing version's behaviour rules on row events; its effects
   are the writes. Transports keep their own names (`late_arrival_notice`, `statutory_drift`, `statutory_lineage`).
5. **Files.** `src/lib` holds exactly `ui/` and `payroll_engine/`; snake_case; folders express hierarchy.
6. **Two input schemas per version** — `employee_input_schema` (`contract_terms`, `exit_facts`,
   `employment_statutory_facts`, `facts`) and `entity_input_schema` (`entity.facts` keys) — declare every fact the CEL
   reads. Profile and entity columns are model fields, not schema keys.
7. **UTC server; the client owns time zone and locale.**
8. **No git** unless the owner asks. Scratch only in the realm `.tmp/`, emptied when done.
9. **Seed.** The public seed is the jurisdiction law only. The private bank tree `seed_bank/norbital_hr` holds raw customer
   files (`raw/`) and nothing mapped; sample records are re-mapped from `raw/` against the rewritten collections.

## Shape

- Lineages: `seed/jurisdiction/<CODE>/version_<n>/` for SG, MY, PH, ID, VN, TW, CN, JP, TH. A change of law is a new
  version; a transcription error is fixed in every version carrying it. Settings ranges are inclusive date periods, each
  closed version ending the day before its successor.
- Duties: `rule_set` rows of two families, raised by the canonical behaviour rules (identical in every version) that
  `behaviour_taps` runs on row events.
  - `OBLIGATIONS` — a money liability to an authority. `rules` holds `description`, `authority`, `schemes` (scheme
    codes), optional `months` and `applies_when`, and `due`. `raise-obligations` (payroll_run created) raises one
    `obligation` per row and run, with `amount_due` = the named schemes' employee + employer lines across the run's
    payslips (`run.totals`); a zero liability is not raised. Idempotent on `occurrence_key` = `CODE:<run id>`.
  - `TASKS` — a filing, registration, notice, certificate or report. `rules` holds `description`, `authority`,
    `trigger` (`collection`, `event` created, updated or daily, optional `fields`), optional `when`, `months` and
    `applies_when`, and `due`. The one collection-generic `raise-tasks` rule (no `target_collection`: it answers every
    collection the taps fire for, and `calendar`) raises one `regulatory_task` per matching row, idempotent on
    `occurrence_key` = `CODE:<company>:<run period, row id, or contract id:day for calendar>`. Its `fields` are the union
    the trigger rows need; the tap reads those the trigger collection's model carries. `fields` documents the changes
    that fire it; Bolt hands the tap no changed-field list, so `when` is the real guard. The old `PAYROLL_RUN`, `HIRE` and
    `EXIT` became payroll_run created, employment_contract created, and employment_contract updated with a `when` that
    the exit is set.
  - Date duties: the `calendar_tick` automation (`@daily`) runs the governing version's rules as the row event
    `calendar`/`daily` for every employment in force today (its contract the row, today the day). An entity whose
    version holds no `TASKS` row with that trigger is skipped after one read.
  - `VALIDATIONS` — a check on writes and builds. `rules` holds `site` (`contract` | `payslip`), `kind` (`refuse` |
    `warn` | `hold`), the CEL `when` that trips it, `message` and optional `description`. `contract`: every new or
    changed term of an employment_contract write, on the version governing the term's first day, refuses (only
    `refuse` acts there: a write carries no warnings). `payslip`: each slip of a build, in code order — `refuse` fails
    the run, `warn` adds `<person>: <message>` to the run's `warnings`, `hold` also lists the slip in the run's `holds`
    and the canonical `hold-payslips` rule moves it DRAFT → ON_HOLD (as `payslip_hold_automation`, which may make only
    that move). A statutory row's `configuration.warn_when` (`[{ when, message }]`, beside `refuse_when`) warns the same
    way.
  - The tap's subject: a row's `company_id`; an entity is its own; a person is one subject per approved contract; a row of
    an employment (roster day, payslip, entries) reaches the entity through its contract. The governing version is
    `services.governingVersion` on the row's own day: a run's period start, a contract's start (created) or end
    (updated), an entry's `occurred_on` / a roster day's `work_date`, else today.
- Rule contexts — every root a record's CEL can read, by site:
  - Subject (`subjectContext`, every site below): `employee`, `company` (incl. `headcount` — the entity's contracts in
    force on the day), `terms` (incl. `base_salary`, `monthly_wage`, `facts`), `employment` (`classification`,
    `service_months`, `start_date`, `exit_date`, `exit_ground`, `exit_facts`), `person`.
  - Settlement periods: a run's `period` is `YYYY-MM` for a `MONTHLY` / `INTEGER_MONTHS` entity and `YYYY-MM-<part>`
    for a sub-monthly one (`SEMI_MONTHLY` 1–15 / 16–end, `TEN_DAY` 1–10 / 11–20 / 21–end; `WEEKLY` is refused). The
    salary window is the part; a cutoff day moves the month's attendance window and each part by the same offset, the
    last part ending at the month's cutoff. Month-to-date (`earned`, statutory) stays per calendar month, so a later part
    charges the month's liability less the earlier parts'. A part-month rate is the record's: e.g. PH prices
    `terms.base_salary / period.parts`.
  - Payslip (work, allowance and entry lines; `allowance`, `entry`, `earlier` are added at their sites): `rules`,
    `period` (`key`, `from`, `to`, `days` of the settlement period, `paid_days`, `covered_days` = days of the period
    inside the employment, `working_days` = WORK days of the period per the planned shifts, `covered_working_days` =
    those inside the employment, `part` / `parts` = its place in the month (1 / 1 monthly), `month_key`, `month_from`,
    `month_to`, `month_days` = its calendar month, `unpaid_working_days` = WORK days of the period inside the employment
    that a leave row with `is_npl` or `pay_fraction` 0 covers, from its `from` to its `to`), `work` (`overtime_hours`, `incentive_hours`, `dates`, `holidays`,
    `holiday_dates`, and `days[]` — one per employed day of the attendance window: `date`, `day_type` (WORK, REST, OFF or
    blank), `shift_code`, `holiday_kind` (`PUBLIC_HOLIDAY`, `SPECIAL_HOLIDAY`, `SUBSTITUTE`, `DOUBLE_HOLIDAY`,
    `DOUBLE_SPECIAL`, `MAKEUP_WORKDAY` — a weekend declared a working day), `holiday_name`, `holiday_name`, `scheduled_hours`, `worked_hours`, `overtime_hours`, `incentive_hours`,
    `intervals` (each `start`/`end` local `YYYY-MM-DDTHH:MM` in `entity.time_zone`); `holidays[]` carry `date`, `name`,
    `kind`), `earned`, `hours`, and `leave.rows[]` —
    `code`, `activity`, `days`, `from`, `to`, `is_npl`, `can_encash`, `event_id`, `month_index`, `facts`,
    `pay_fraction`. `earlier` (entry lines and entry writes): the employment's entries of the same class code before
    this one (by day, then id) — `rows[]` (each its columns and open facts, `amount`, `occurred_on`, `activity`) and the
    signed sums `calendar_year`, `lifetime`; a per-key cap filters `rows` (e.g. `r.child_id == entry.child_id`).
    Payslip validations add `payslip` (`gross`, `net`, `total_deductions`, `statutory_employee`, `statutory_employer`,
    `net_additions`, `net_deductions`, `lines.<CODE>`) and `statutory.<SCHEME>.{employee, employer}`. Contract
    validations add `term` (the term written; also `terms`) and `day` (the term's own first day, which also picks the
    version and the subject's day). A day's shift is the roster
    entry's `shift_definition_id`, else the cycle day of `terms.shift_pattern_id` anchored at the pattern's effective
    start, else none; `shift_definition.variant.day_type` is its day type. `pay_fraction` is the class's CEL evaluated per
    row on the payslip context with `entry` and `leave` = that row (blank = 1); `month_index` is the 1-based month of the
    row's absence event (`facts.event_id`), counted from the event's first movement.
  - `earned` (payslip, statutory, leave entitlement): `month` (earlier slips of this period), `year` (earlier periods of
    the calendar year), `previous_month` (the previous period's salary-run slips, plus `base_salary` of the terms then in
    force). Each holds `<CODE>` (summed line amounts by component or catalogue code), `gross`, `net` and `statutory.<SCHEME>`
    (`employee`, `employer`); an absent code is absent (use `has()`).
  - `hours` (payslip, statutory, payslip validations): the employment's approved roster days, paid or not, summed over
    `month` (the period's calendar month), `previous_month`, `year` (1 January through this month) and `rolling` (this
    month and the two before; fixed). Each holds `worked_hours` (from the recorded intervals), `overtime_hours`
    (approved), `incentive_hours`, and the same three by planned `day_type.<TYPE>` and by `holiday_kind.<KIND>` (a
    published holiday on the day); an absent key is absent (use `has()`). Night hours are the record's
    (`hours_between` on `work.days[].intervals`), not a root. E.g. an annual cap: a `warn` validation on
    `hours.year.overtime_hours > 360.0`.
  - Statutory: the subject, `headcount`, `work`, `earned`, `hours`, `wage`, `month`, `year`, `period` (`key`, `from`, `to`, `days`
    of the settlement period, `month` = its month of the year, `salary_paid`, `covered_days`, `working_days`,
    `covered_working_days`, `unpaid_working_days`, `part`, `parts`, `month_key`, `month_from`, `month_to`,
    `month_days`), `rules`, `charged`,
    `elections`, `scheme` (`code`, `standing`, `since` — the standing's start day, `elections`), `person`, `base`. No `run.totals` here: slips are assessed one at a time, so a run total would
    need a second pass.
  - Leave entitlement (`leave_catalog.entitlement.days`): `service_months`, `bands`, `as_of` (the day read), the subject
    roots, `earned`, `entry` (on a write) and `taken = { calendar_year, service_year, lifetime, event }` — days of the
    same class code, approved and held. `entitlement.window` (`CALENDAR_YEAR`, `SERVICE_YEAR`, `LIFETIME` by default, or
    `EVENT`) is the span the balance meters; `EVENT` groups movements by `entitlement.window_key` (CEL over `entry` = the
    movement's columns and facts, e.g. `entry.facts.child_id` for a per-child cap across births), else by
    `facts.event_id` (an entry without one is its own event). A balance listing (`leave_balances`, the exit encashment's
    `event.leave_balances`) gives a class with a `window_key` one view per key its movements carry (`window_key` = the
    key), read with `entry` = that key's first movement (its facts and columns) — so a per-birth grant
    (`entry.facts.twins`) holds on reads as on writes — beside the class's own view (`window_key` blank, `entry` =
    `{ facts: {} }`, the next event). Other classes list one view, as before.
    `entitlement.carry_forward` (CEL on the previous window's context) caps the unused days of the previous
    `CALENDAR_YEAR` or `SERVICE_YEAR` window carried in: balance = entitlement + min(cap, unused) − taken − held;
    carried days carry once. Balances, previews, write refusals and the exit encashment all read `services.leaveState`.
  - Duties (`due`, `applies_when`, `when`): obligations get `period`, `company`, `run` (`totals.gross`, `.net`,
    `.employer_cost`, `.schemes.<CODE>.{employee, employer}`), `holidays`; tasks get `row` (the trigger row), `period`
    (its day's month), `company`, `contract`, `employee`, `hired_on`, `exit_on`, `holidays`, `today` (the trigger day)
    and `headcount`. `holidays` = the entity's published holiday dates from 31 days before to 400 days after the
    trigger day; `holidays_named` = those from the trigger day to 12 months after as `{ date, name, kind }` (e.g. a
    festive allowance due `add_days(first(holidays_named.filter(h, h.name == "…")).date, -7)`). The holiday row has no
    religion or other facts; a record maps names. Both are built by the canonical `raise-*` behaviour rules. An entry
    trigger's `row` carries `catalog_code` and its class row as `catalog`; a payslip's carries `line_codes` (its base
    and adjustment component codes) and `paid_on` (the UTC day of `paid_at`), which is also its day; a `calendar` row
    is the contract.
  - Behaviour effects: `event` (`collection`, `action`, `row`, `settings_id`, `day`, `period`, `company_id`,
    `employment_id`, `employee_id`, `headcount`, `leave_balances` — on a contract event, every class's balance on its
    day, which `encash-leave-on-exit` pays), `run` on payroll_run events, plus each declared read by name; every
    `entity` row a rule reads carries `headcount`. `services.ts` and the `behaviour_runner` (shared by the row taps and
    the daily tick) build them.
  - CEL helpers beyond the calendar and number set: `hours_between(intervals, "HH:MM", "HH:MM")` (overlap with a daily
    clock window; an end not after the start crosses midnight), `next_working_day(date, holidays?)`,
    `add_working_days(date, n, holidays?)` (working day = not Saturday/Sunday and not a listed date or holiday row).
- Paid periods lock the terms: the employment_contract transform refuses a `facts.contract_terms` change that alters the
  term in force on any day of a period the employment has a payslip for (any run kind); a change starts after the last
  paid day, and deleting the run releases it. Off-cycle runs settle month-to-date, so totals are order-independent.
- Gaps: one tracker per jurisdiction, `docs/inventory/<CODE>.csv` (format in `docs/inventory/README.md`).
- Owner rulings: MY prices a day at monthly ÷ 26; no TW 2027 version until the tables are published.

## Open

- Customer data the bank does not carry (each tracker names the rows): opsph dates of birth; KDIT dependants (source says
  0, its tax implies category B), its February "Compensation" class and overtime reconciliation; Nihon R5D/R6D patterns
  with no shift days; SG entities have no roster/leave/claim history.
- Engine roots still missing (per tracker): a run-level statutory total. `unpaid_working_days` reads only the leave rows
  the slip prices (those starting in the period), so a no-pay span begun in an earlier, paid period is not counted.
- Unverifiable official sources (per tracker, STILL UNVERIFIABLE): e.g. MY KWSP/HRD Corp pages, CN Kunming medical and 2026
  unemployment, TH Social Security age-at-entry text, ID PMK 168 annex body.
- Calendar: TW 2027 version once the 116年 tables publish; review every lineage each January and July for new rates.
- Obligations are per run: an off-cycle run raises its own remittance; deleting a run leaves its obligations.
- `src/lib/payroll_engine/export.ts` keeps the OCBC FAST layout in source; move it to a record-held template if a second
  bank format is needed.
- The template's Bolt is a manual overlay of the local oss build (`rsync` of `oss/packages/bolt/build` plus the
  `@cfworker/json-schema` link) because `pnpm run env -- link` fails on Colony's tenant substrate; publish the oss nested
  discovery change and re-pin before any `pnpm install` here.
- Gates: `pnpm lint`, `pnpm check`, `pnpm build`, `pnpm test`, and from `templates/`
  `node --experimental-strip-types scripts/ci.ts check --filter=hr-payroll`.
