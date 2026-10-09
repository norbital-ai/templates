# HR payroll takeover

Living plan for `templates/hr-payroll`. One file. The session history that used to live here was deleted on
2026-10-06 with the rest of the stale documentation; it described purged models and is not restored.

## Binding directives

1. **Delete-first.** Stale files, configuration and seed data are purged, never brought back from git, builds or
   backups. An import of something deleted is fixed by purging or refactoring its consumer.
2. **Logic lives in records.** Law is data: `jurisdiction_settings` versions, their catalogue rows, `rule_set` rows and
   `behaviours`, with CEL for every rate, band, eligibility, price, due date and condition. `src/lib/payroll_engine/` is a
   generic evaluator — no jurisdiction codes, scheme names, rates, divisors or currency defaults in source
   (`tests/source-is-generic.test.ts` fails on a quoted lineage or scheme code in `src/`). New behaviour is always a
   record change; the engine only gains generic roots.
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
    payslips (`run.totals`), or `rules.amount` (CEL over `total`, `run`, `period`, `company` — its facts — and
    `headcount_months[]` = `{ month, headcount }` at each of the 12 month ends through the run's month: a yearly levy
    per month with ≥ N employed); a zero liability is not raised. Idempotent on `occurrence_key` = `CODE:<run id>`.
  - `TASKS` — a filing, registration, notice, certificate or report. `rules` holds `description`, `authority`,
    `trigger` (`collection`, `event` created, updated or daily, optional `fields`), optional `when`, `months`,
    `applies_when`, `repeat_key` and `occurrence`, and `due`. The one collection-generic `raise-tasks` rule (no `target_collection`:
    it answers every collection the taps fire for, and `calendar`) raises one `regulatory_task` per matching row,
    idempotent on `occurrence_key` = `CODE:<company>:<run period, row id, or contract id:day for calendar>` — or, with
    `repeat_key` (CEL on the task context), `CODE:<company>:<row id>:<key>` — a duty repeats per key (each change,
    `string(size(employee.children))`; each month on leave, `period.key`) instead of once per row — or, with
    `occurrence` (CEL), `CODE:<company>:<key>` across rows: keyed to the condition window
    (`first(separations).exit_date`), a later edit to another contract meets the same crossing and raises nothing. An occurrence raised for the same subject row on any day, or by the entity in the
    last 400 days, is not raised again. Its `fields` are the union
    the trigger rows need; the tap reads those the trigger collection's model carries. `fields` documents the changes
    that fire it; Bolt hands the tap no changed-field list, so `when` is the real guard. The old `PAYROLL_RUN`, `HIRE` and
    `EXIT` became payroll_run created, employment_contract created, and employment_contract updated with a `when` that
    the exit is set.
  - Entity date duties: the tick also runs every entity as the row event `entity`/`calendar` (its row, today the
    day), which the canonical `raise-tasks` answers, so a yearly or periodic entity duty (a registration renewal) is a
    `TASKS` row with `trigger: { collection: 'entity', event: 'calendar' }`, a `when` on `today` and a `repeat_key`
    (`today.substring(0, 4)`, `period.key`) that raises it once per year or period.
  - Date duties: the `calendar_tick` automation (`@daily`) runs the governing version's rules as the row event
    `calendar`/`daily` for every employment in force today (its contract the row, today the day). A version with a
    `calendar`/`after_exit` task also runs every ended employment as `calendar`/`after_exit` (a certificate or a
    disposal N days after `exit_on`). An entity whose version holds no `TASKS` row with those triggers is skipped
    after one read.
  - `VALIDATIONS` — a check on writes and builds. `rules` holds `site` (`contract` | `payslip` | `roster`), `kind` (`refuse` |
    `warn` | `hold`), the CEL `when` that trips it, `message` and optional `description`. `contract`: every new or
    changed term of an employment_contract write, on the version governing the term's first day, refuses (only
    `refuse` acts there: a write carries no warnings). `payslip`: each slip of a build, in code order — `refuse` fails
    the run, `warn` adds `<person>: <message>` to the run's `warnings`, `hold` also lists the slip in the run's `holds`
    and the canonical `hold-payslips` rule moves it DRAFT → ON_HOLD (as `payslip_hold_automation`, which may make only
    that move). A statutory row's `configuration.warn_when` (`[{ when, message }]`, beside `refuse_when`) warns the same
    way.
    `roster`: each person-day of a work-day sheet import (the `roster_entry` pipeline's `check`), on the version governing the
    day, with the subject, `rules`, `day` (a `work.days[]` day as the import would store it — its `overtime_consented_at` / `overtime_consented` the
    sheet's consent for the day — plus `leave_code` and
    `rest_hours_before`) and `week` (`worked_hours`, `overtime_hours`, `worked_days` over the seven days ending on the
    day, from the file, and `overtime_hours_by_day_type.<WORK|REST|OFF|HOLIDAY>`: by the planned day type, and again
    under `HOLIDAY` on a published holiday, so a weekly cap can leave rest-day and holiday overtime out;
    `overtime_hours_holiday_by_day_type.<WORK|REST|OFF>`, holiday overtime alone by the day type the holiday fell on;
    `holiday_worked_hours`, the normal hours worked on holidays, worked less overtime); `refuse` refuses the file, `warn` / `hold` are returned for HR to accept, and the optional
    `column` (a sheet field, e.g. `overtime_hours`) names the cell.
  - The tap's subject: a row's `company_id`; an entity is its own; a person is one subject per approved contract; a row of
    an employment (roster day, payslip, entries) reaches the entity through its contract. The governing version is
    `services.governingVersion` on the row's own day: a run's period start, a contract's start (created) or end
    (updated), an entry's `occurred_on` / a roster day's `work_date`, else today.
- Rule contexts — every root a record's CEL can read, by site:
  - Subject (`subjectContext`, every site below): `employee`, `company` (incl. `headcount` — the entity's contracts in
    force on the day), `terms` (incl. `base_salary`, `monthly_wage`, `facts`, `allowances[]` = `{ code, catalogue_id,
amount }` of the term's fixed allowances, `effective_from` / `effective_to` = the term's own range), `employment` (`classification`,
    `service_months`, `start_date`, `exit_date`, `exit_ground`, `exit_facts`), `person`.
  - Settlement periods: a run's `period` is `YYYY-MM` for a `MONTHLY` / `INTEGER_MONTHS` entity and `YYYY-MM-<part>`
    for a sub-monthly one (`SEMI_MONTHLY` 1–15 / 16–end, the split `payroll.semi_monthly_split`, `TEN_DAY` 1–10 / 11–20 / 21–end, `WEEKLY` the n-th
    Sunday–Saturday week starting in the month, `parts` = the month's Sundays), and `YYYY-MM-DD` for a `DAILY` one
    (`part` = the day, `parts` = the month's days); a week ending in the next month belongs to its first day's month.
    The salary window is the part; a cutoff day moves the month's attendance window and each part by the same offset,
    the last part ending at the month's cutoff (`WEEKLY` and `DAILY` attend their own window). Month-to-date (`earned`, statutory) stays per calendar month, so a later part
    charges the month's liability less the earlier parts'. A part-month rate is the record's: e.g. PH prices
    `terms.base_salary / period.parts`.
  - Pay frequency switches: `entity.pay_frequency` is the frequency from the entity's start; each
    `entity.pay_frequency_changes` row (`{ from, frequency }`) switches it from that day (`frequencyOn`), so a past
    period always reads the frequency then in force. A month's keys are those of the frequencies in force in it
    (`periodsIn`, the run-create picker's list), each window cut to its own frequency's days: a switch on the 16th
    leaves `YYYY-MM-1` (1–15) and a monthly `YYYY-MM` over 16–end, or the reverse. A key the month does not offer, or a
    salary run over a day another salary run covers, is refused. The entity transform refuses a schedule change that
    rewrites history (`payScheduleRefusal`): `pay_frequency` changed once a salary run is paid, a switch added, moved or
    withdrawn on or before the last day a salary run covers, two switches a day, a switch to the frequency already
    paid, or to or from `WEEKLY` / `DAILY` (their periods straddle months, and a switched month settles by the calendar month: a week across the switch belongs to neither side's month cleanly, so supporting it would need settlement across months — refused instead). A month paid at more than one frequency settles
    every contract line (work and allowance classes) month to date: each is priced as a monthly run over the 1st to
    the period's end (`period` with `parts` 1 and the month's days and working days, `work.days` the month's attendance
    to date, `leave.rows` the month's leave to date — earlier parts' settled days included) and pays that less what the
    month's earlier salary slips paid for the code; a code no longer owed is taken back. Statutory, tax and caps were
    already month to date by calendar month; entries pay once each. So any split of a month equals the one-frequency
    month (`tests/payroll_engine.test.ts` on SG, `tests/jurisdiction_ph.test.ts` with the withholding tax). Records
    that price a part by `period.part` / `period.parts` outside the contract lines are not settled this way (statutory
    `assessable`, entry bands, validations): they should read the month to date.
  - Payslip (work, allowance and entry lines; `allowance`, `entry`, `earlier` are added at their sites): `rules`,
    `period` (`key`, `from`, `to`, `days` of the settlement period, `paid_days`, `covered_days` = days of the period
    inside the employment, `working_days` = WORK days of the period per the planned shifts, `covered_working_days` =
    those inside the employment, `part` / `parts` = its place in the month (1 / 1 monthly), `month_key`, `month_from`,
    `month_to`, `month_days` = its calendar month, `unpaid_working_days` = WORK days of the period inside the employment
    that a leave row with `is_npl` or `pay_fraction` 0 covers, `month_working_days` = the whole calendar month's planned WORK days (roster shift, else pattern) less published holidays, the same in every part (a day rate's divisor, VN-SETTINGS-7), `previous_month_working_days` / `previous_month_holiday_work_days` = the same two for the calendar month before (a cash-out divided by last month's working days, VN), `switched` = the calendar month is paid at more than one pay frequency (a rule settling a part month to date reads `month_from` / `month_to` with it, as the engine does), `month_holiday_work_days` = the month's published holidays on those planned WORK days, the same in every part (a divisor counting them, SG s.20A, is the sum), `pay_date` = the run's pay day), `work` (`overtime_hours`, `incentive_hours`, `dates`, `holidays`,
    `holiday_dates`, and `days[]` — one per employed day of the attendance window: `date`, `day_type` (WORK, REST, OFF or
    blank), `shift_code`, `holiday_kind` (`PUBLIC_HOLIDAY`, `SPECIAL_HOLIDAY`, `SUBSTITUTE`, `DOUBLE_HOLIDAY`,
    `DOUBLE_SPECIAL`, `MAKEUP_WORKDAY` — a weekend declared a working day), `holiday_name`, `scheduled_hours`, `worked_hours`, `worked` (attendance recorded: `worked_hours > 0`),
    `overtime_hours` (approved less `banked_hours`, those the employee elected to bank as time off: the paid
    overtime), `banked_hours`, `banked_band` (`roster_entry.banked_overtime_band`: the band the banked hours were
    earned in), `incentive_hours`, `overtime_consented_at` (the instant the worker consented to the day's overtime, else
    null) and `overtime_consented` (whether there is one) — consent is per day (owner ruling), never a contract, company
    or employee fact — `worksite`, `facts` (the roster day's own; e.g. piece units),
    `suspended` (`{ kind, facts }` of the work suspension covering the day for this employment, else null),
    `intervals` (each `start`/`end` local `YYYY-MM-DDTHH:MM` in `entity.time_zone`; a day clocked as one pair
    has its shift's planned `break_minutes`, centred on the shift, cut out of it, so `worked_hours`, the intervals and
    the roster checks all net the break; a recorded break is the person's own); `week_before[]` — the days of the
    week the attendance window opens in that fall before it (the week from `payroll.week_start`), as recorded, the
    same shape with `in_period: false`: a weekly limit sums the whole week and pays only this period's excess;
    `month_days[]` — the month's employed days from the 1st through the period's end, as recorded, the same shape with
    `in_period` true for this attendance window's (a monthly cap on a semi-monthly half sums the month to date); `holidays[]` — a rostered day on a
    published holiday, worked or not — carry `date`, `name`, `kind`, `day_type`, `worked`, `worked_hours`: holiday
    work is `filter(h, h.worked)`, an unworked holiday is a `work.days[]` day with `holiday_kind` and not `worked`),
    `earned`, `hours`, and `leave.rows[]` —
    `code`, `activity`, `days`, `total_days`, `period_calendar_days`, `period_working_days`, `from`, `to`, `is_npl`,
    `can_encash` (unless the class says false, as balances read it), `event_id`, `chain_from`, `taken_before` (days of the same class taken
    before this row's share here: earlier movements of its event, else of its chain, plus the row's own share of
    earlier periods), `taken_before_by_class.<CODE>` (the same across classes: one accident's outpatient and
    hospitalisation days), `month_index`, `facts`, `pay_fraction`. `chain_from` is the first day of
    the back-to-back rows of the class it continues (the next row starting the day after the previous one ends), so an
    extension entered as a new row is one leave; `month_index` counts from the event's start, else the chain's. A leave row reaching into a period is projected
    into every salary period it overlaps: `days` is this period's share of the row's `total_days` (by the WORK days it
    covers inside the employment, by calendar days when it covers none), `period_*_days` its covered days here, and
    `month_index` the event month at this period's first covered day; the row is settled (pinned) by the period holding
    its `to`, so an edit before then re-prices the later periods only. `earlier` (entry lines and entry writes): the employment's entries of the same class code before
    this one (by day, then id) — `rows[]` (each its columns and open facts, `amount`, `occurred_on`, `activity`) and the
    signed sums `calendar_year`, `lifetime`; a per-key cap filters `rows` (e.g. `r.child_id == entry.child_id`).
    Payslip validations add `payslip` (`gross`, `net`, `total_deductions`, `statutory_employee`, `statutory_employer`,
    `net_additions`, `net_deductions`, `lines.<CODE>`) and `statutory.<SCHEME>.{employee, employer}`. Contract
    validations add `term` (the term written; also `terms`) and `day` (the term's own first day, which also picks the
    version and the subject's day), and — when a rule names them, in one read — `employment.terms[]` (the
    employment's other terms as written) and `person.contracts[]` (the person's other contracts with this employer,
    oldest first: `id`, `start`, `end`, `exit_ground`, `contract_type` and `facts` of their last term, and `terms[]` — each term's `from`, `to`,
    `contract_type`, `facts`, oldest first): one probation
    per employee, an open-ended right after two fixed terms. A day's shift is the roster
    entry's `shift_definition_id`, else the cycle day of `terms.shift_pattern_id` anchored at the pattern's effective
    start, else none; `shift_definition.variant.day_type` is its day type. `pay_fraction` is the class's CEL evaluated per
    row on the payslip context with `entry` and `leave` = that row (blank = 1); `month_index` is the 1-based month of the
    row's absence event (`facts.event_id`), counted from the event's first movement.
  - `earned` (payslip, statutory, leave entitlement): `month` (earlier slips of this period), `year` (earlier periods of
    the year, which starts in the version's `payroll.tax_year_start_month`, default January), `previous_month` (the previous period's salary-run slips, plus `base_salary` of the terms then in
    force), `average` (`gross`, `net` over those months, and `months`, their count: an average monthly wage),
    `months[]` (each of the 12 calendar months before this one with a slip, oldest first, its key as `month` —
    a fiscal year from April, a 3- or 12-month average, a rolling-12 wage: filter by `m.month`), `history[]` (the same
    over the 24 calendar months before this one: the 12 months before an 18-month-back contingency). Each holds
    `<CODE>` (summed line amounts by component or catalogue code), `gross`, `net` and `statutory.<SCHEME>`
    (`employee`, `employer`, `base` = the assessed base charged, `parts.<part>` = it by wage part), and — at the payslip
    and statutory sites, when a record of the version names them — `worked_days`, `worked_hours` (recorded attendance)
    , `suspended_days` (days a work suspension covered), `suspended_days_by_kind.<KIND>` and `leave_days.<CODE>`
    (scheduled days approved time off of that class covered) of the month: an average wage with a minimum guarantee
    or excluding suspended and leave periods; an absent code is
    absent (use `has()`). E.g. six highest monthly bases:
    `sum(top(earned.history.filter(m, …).map(m, m.statutory.<SCHEME>.base), 6))`.
  - `hours` (payslip, statutory, payslip validations): the employment's approved roster days, paid or not, summed over
    `month` (the period's calendar month), `month_to_date` (the month's 1st through the settlement period's
    end, earlier parts included: a monthly cap read on a semi-monthly half), `previous_month`, `year` (the tax year's first month, `payroll.tax_year_start_month`,
    through this month) and `rolling` (this month and the ones before it, `payroll.rolling_hours_months` in all,
    default 3). Each holds `worked_hours` (from the recorded intervals), `overtime_hours`
    (approved), `incentive_hours`, and the same three by planned `day_type.<TYPE>` and by `holiday_kind.<KIND>` (a
    published holiday on the day); an absent key is absent (use `has()`). `months[]` lists the 12 calendar months ending
    with this one (`month`, `worked_hours`, `overtime_hours`, `incentive_hours`, and `day_type` / `holiday_kind` as the
    windows carry them; every `day_type` map also holds `HOLIDAY`, the days on a published holiday again, so a 2–6-month
    average can include rest-day and holiday work): a 36-agreement year from its own start
    sums `hours.months.filter(m, m.month >= "2026-04")`, a 2–6-month average the last n. Night hours are the record's
    (`hours_between` on `work.days[].intervals`), not a root. E.g. an annual cap: a `warn` validation on
    `hours.year.overtime_hours > 360.0`.
  - Statutory: the subject, `headcount`, `work`, `earned`, `hours`, `leave` (the slip's `leave.rows`; an off-cycle slip
    reads the period's rows too, settled or not, and settles none), `net_available` (gross plus net additions less net
    deductions, less the employee shares of the schemes assessed before this one), `lines[]` (this
    slip's priced lines, `{ code, amount }`: a per-payment threshold reads each), `wage` (this slip's own wage by part:
    a week's, a day's or a half's for a per-period withholding table), `month` (the month to date), `year`, `period`
    (`key`, `from`, `to`, `days` of the settlement period, `month` = its month of the year, `salary_paid`, `paid_days`,
    `pay_date`, `covered_days`, `working_days`, `covered_working_days`, `unpaid_working_days`, `part`, `parts`,
    `month_key`, `month_from`, `month_to`, `month_days`, `month_working_days`, `month_holiday_work_days`, `previous_month_working_days`, `previous_month_holiday_work_days`, `switched`), `rules`, `charged` (`year` = earlier months of the year,
    `month` = this month so far, `previous_month` = the calendar month before, `previous_year` = the whole previous
    calendar year; each `<SCHEME>.{employee, employer}`), `elections`, `scheme` (`code`, `standing`, `since` — the
    standing's start day, `elections`), `person`, `base`. No `run.totals` here: slips are assessed one at a time, so a
    run total would need a second pass. An annual reconciliation (December, or the exit month: `period.to` ends the
    year, or `employment.exit_date` falls in `period.from`–`period.to`) reads the year as `year` + `month` and the tax
    so far as `charged.year` + `charged.month`. A next-month deduction reads `charged.previous_month`. Three
    configuration flags change what the engine does: `assess_without_wage: true` evaluates the scheme on a salary
    slip even when the month paid it no wage (the slip is kept if a scheme charges), `governed_by: "pay_date"`
    assesses the scheme on its row of the version governing the run's pay day (the period's `rules` root stays), and
    `carry_uncovered: true` advances the employee share a slip's net cannot cover (fund-paid leave, a part month) as a
    NET line `<SCHEME>_CARRIED` (family `STATUTORY_CARRY`) and recovers the outstanding advance from the next slips'
    net, as far as each allows; the scheme is still charged and remitted in full, and the advance is no employer
    cost. Without it, an employee share net cannot cover refuses as negative net; a record that waives the excess
    instead caps its share at `net_available`. Schemes are assessed in `configuration.order` (lower first), then by
    code; a scheme reading another's `charged.month` still follows it. The statutory `year`, `charged.year` and
    `charged.previous_year` follow `payroll.tax_year_start_month`.
  - Money: every priced line, share and total is rounded half-up to the payroll currency's minor units (its ISO 4217
    exponent as the runtime's currency data holds it: JPY, VND and IDR 0, most others 2), or to the version's
    `payroll.minor_units` when it names one (TWD carries 2 in that data: a lineage paying whole dollars sets 0).
  - Zones: local days and clocks (`work.days[].intervals`, roster checks, the daily tick's today, leave attendance,
    the work-day sheet's import and template, the Work board, late-arrival notices) are counted in the entity's
    `time_zone`, else the governing version's `payroll.timezone`, else UTC (`services.zoneOn`).
  - Payroll settings (`jurisdiction_settings.payroll`, every lineage seeded with the engine's former behaviour, so
    results move only when a lineage changes one): `pay_date` (CEL on `period` and `company`: the run's pay day when
    the request names none; seeded `period.to`), `week_start` (0 = Sunday: `WEEKLY` periods and a calendar roster
    week; 0), `semi_monthly_split` (the first half's last day; 15), `roster_week` (`ROLLING` = the 7 days ending on the
    day, or `CALENDAR` = from `week_start`), `rolling_hours_months` (3), `base_salary_required` (a salary slip refuses
    a contract with no base; true — a day-rated lineage sets false and prices the day in its work lines),
    `off_cycle_families` (the entry families an off-cycle run may select: `ADHOC`, `CLAIM`; `LOAN_REPAYMENT` too for a
    final settlement; leave never), `monthly_wage` (CEL on `terms`: `terms.monthly_wage`; base salary plus every fixed
    allowance) and `negative_net` (`refuse`; `allow` keeps the slip). Entitlement contexts read the version governing
    their day for the tax year, monthly wage and zone.
  - Class settings: `leave_catalog.share_by` (`WORKING_DAYS`, default, or `CALENDAR_DAYS`: how a row spanning periods
    is shared), `work_catalog.denominator` (CEL: the divisor a prorated line, and the slip's service basis, state;
    default the period's calendar days), `amount_required` on ad hoc, claim and loan classes (default true; a class
    priced by its bands alone sets false), and a scheme's `configuration.as_of` (`period_start`, default,
    `period_end` or `pay_date`: the day it reads its subject on). `terms` carries every key the term holds (a grade,
    a pay frequency) beside the engine's own.
  - Lines: every line moves the scheme parts its `counts_toward` names; PAY lines also move gross, NET lines the net.
    An ad hoc class with `payable_after_exit` takes entries past the employment's end (non-compete pay, separation
    instalments): the period's salary run pays them on a slip of their own, with no contract lines, its subject the
    terms last in force; any other entry past the end is refused. An entry of such a class is pinned even when it prices to nothing (a waived instalment),
    and a slip pinning one is kept with no gross, adjustment or charge (SG-TAX-8), so the entry is settled and reaches
    the year's return.
    An EMPLOYER or DISPLAY allowance or entry (a benefit in kind) therefore reaches a tax base without being paid; such
    an entry is priced and settled (pinned) but adds no payslip adjustment.
  - Leave entitlement (`leave_catalog.entitlement.days`): `rules` (the governing version's PAYROLL rule tables, as the
    payslip reads them: a region table `rules.regions.by_region[company.region]`; balances, listings, previews and
    writes alike), `service_months`, `bands`, `as_of` (the day read), the subject
    roots, `earned`, `entry` (on a write) and `taken = { calendar_year, service_year, lifetime, event }` — days of the
    same class code, approved and held. `entitlement.window` (`CALENDAR_YEAR`, `SERVICE_YEAR`, `LIFETIME` by default, or
    `EVENT`, or `ROLLING` = the `entitlement.window_months` (default 12) ending on the day read) is the span the balance
    meters; `entitlement.service_year_offset_months` starts service years that many months after the employment start
    (the months before are a window of their own); `taken.rolling` and `taken_by_class.<CODE>` (another class's
    `taken` in the same windows, e.g. absence that forfeits a grant) are beside `taken`. A class whose entitlement
    reads `attendance` gets `attendance.window` (its window holding the day read; `LIFETIME` / `EVENT` from the
    employment start) and `attendance.previous` (the window before it: the year before a grant, the months before an
    offset service year's base date; empty for `LIFETIME` / `EVENT`), each `from`, `to`, `scheduled` (planned WORK days
    up to the day read, roster shift else pattern), `worked` (those with attendance recorded), `holidays` (those on a
    published holiday), `leave.<CODE>` (those an approved time-off movement of that class covers, whatever version
    captured it), `suspended.<KIND>` (those a work suspension of that kind covers), `banked_hours` (overtime banked
    on any day: a time-off-in-lieu class grants `attendance.window.banked_hours / daily hours`), `banked[]` (each
    banked day, `{ date, hours, band }`: a payout of untaken hours priced per band) and `months[]` (the
    same per calendar month, `month` its key); days are read 24 months back. A balance carries its class's
    `attendance` when it reads one. What
    counts as attended is the record's sum, e.g. an 80% test `(w.worked + w.leave.ANNUAL_LEAVE …) / w.scheduled >= 0.8`,
    a month counted at half its days `months.filter(m, m.worked + … >= 0.5 * m.scheduled)`. `EVENT` groups movements by `entitlement.window_key` (CEL over `entry` = the
    movement's columns and facts, e.g. `entry.facts.child_id` for a per-child cap across births), else by
    `facts.event_id` (an entry without one is its own event). A balance listing (`leave_balances`, the exit encashment's
    `event.leave_balances`) gives a class with a `window_key` one view per key its movements carry (`window_key` = the
    key), read with `entry` = that key's first movement (its facts and columns) — so a per-birth grant
    (`entry.facts.twins`) holds on reads as on writes — beside the class's own view (`window_key` blank, `entry` =
    `{ facts: {} }`, the next event). Other classes list one view, read on the same empty next `entry` (`facts: {}`, no days, no
    dates yet: the write context's shape), so a class reading `entry` never empties the list
    (`tests/leave-seed.test.ts` evaluates every lineage's `days`, `carry_forward` and `eligibility` there).
    `entitlement.carry_forward` (CEL on the previous window's context) caps the unused days of the previous
    `CALENDAR_YEAR` or `SERVICE_YEAR` window carried in: balance = entitlement + min(cap, unused) − taken − held;
    carried days carry again for `entitlement.carry_depth` windows (default 1: once). A class with `consumes_code`
    draws on the pool's days; `entitlement.consumes_after_days` keeps its first N units (in the pool's window) its own,
    and `entitlement.hours_per_day` (CEL on the subject, e.g. `double(terms.facts.daily_hours)`) converts a non-day
    `unit` into pool days. `encash_at_window_end` (a class flag) encashes the window's untaken balance on its last day:
    the daily tick reads the balances of a contract whose flagged class's window closes today (each balance names its
    `window_to`), and the canonical `encash-leave-at-window-end` rule writes one `ENCASHMENT` movement per class
    (reference `window:<contract>:<code>:<day>`, so once), priced by the work catalogue in the period holding that
    day, as the exit encashment is. Movements count by their class's code, whatever version captured them, so a window
    spanning a version change keeps its earlier days. The `leave_balances` query (the balances page, the request
    form and HR's leave entry form) offers only the classes whose `eligibility` holds for the employee (one reading the
    request's `entry` is the request's to decide); HR's form also narrows the class to the employment's governing
    version. Balances, previews, write refusals and the exit encashment all
    read `services.leaveState`.
  - Duties (`due`, `applies_when`, `when`, `repeat_key`, `occurrence`, `amount`): every duty gets `rules` (the
    governing version's PAYROLL rule tables, from the version rows the tap and tick already read: `event.rules`, which
    the canonical `raise-*` rules pass on); obligations get `period`, `company`, `run` (`totals.gross`, `.net`,
    `.employer_cost`, `.schemes.<CODE>.{employee, employer}`), `holidays`; tasks get `row` (the trigger row), `period`
    (its day's month), `company`, `contract`, `employee` (incl. `children[]` with `child_birthdate`,
    `dependents_count`, `solo_parent`), `hired_on`, `exit_on`, `holidays`, `today` (the trigger day), `headcount`,
    `headcount_permanent` (in force and not `terms.facts.fixed_term`), `headcount_by_worksite.<SITE>` (the terms in
    force's `facts.worksite`, blank when none), `headcount_permanent_by_worksite.<SITE>` (the same without fixed-term contracts; a site with none is absent) and `separations[]` (sorted by `exit_date`; the
    entity's contracts ending within a year either side of the day: `employment_id`, `exit_date`, `exit_ground`,
    `exit_facts`, `term_facts`, `worksite`, `fixed_term` (`term_facts.fixed_term`) of the terms in force that day — a
    mass-layoff count is `size(separations.filter(s, s.exit_ground in […] && s.exit_date >= add_days(today, -60)))`,
    a rolling threshold over every exit `separations.exists(s, count_within(separations, "exit_date", s.exit_date,
add_days(s.exit_date, 59)) > N)` in O(n log n)).
    Payees (`engagement: PAYEE`) are in neither. A contract row (`employment_contract` events) and a `calendar` row
    carry `leave[]` — the employment's approved time off, `{ code, from, to, chain_from, days, facts }` (a calendar
    row: the last two years) — so an exit task reads the classes taken before the exit and a daily task repeats while
    on leave. A contract row also carries `leave_balances` (on its day, each with its class's `attendance`), and a
    calendar row too when a daily task of the version names `leave_balances` (a designation raised only for a grant
    that passed its attendance test). An update's row carries `before` (the prior values of the fields it changed,
    recorded by the transform: `row.before.marital_status`; an entity's too, never its disbursement account — a
    re-registration task on `entity` updated tests `"name" in row.before`), contract rows carry `engagement`, and a contract row `terms_written[]` (the terms the write
    added or changed), so a term entered after its start raises on the write, for any effective date.
    An `obligation` update's row carries `fulfilled_on` beside `due_on` (a late-remittance surcharge task), a
    `regulatory_task` update's `done_on` beside `due_on` (the same for a task-paid contribution); `run` also carries `pay_date` / `pay_due_date` (a due date keyed to the month of payment) and
    `totals.schemes.<CODE>.base` (the run's assessed base), and `statutory.<SCHEME>` = `{ base, employee, employer,
charged_base, parts.<part> }` summed over the run's slips — `charged_base` each slip's insured or assessed amount (the
    base its rule charged on), so a unit-level premium is `rules.amount` on `run.statutory.<SCHEME>.charged_base`. `holidays` = the entity's published holiday dates from 31 days before to 400 days after the
    trigger day; `holidays_named` = those from the trigger day to 12 months after as `{ date, name, kind }` (e.g. a
    festive allowance due `add_days(first(holidays_named.filter(h, h.name == "…")).date, -7)`). The holiday row has no
    religion or other facts; a record maps names. Both are built by the canonical `raise-*` behaviour rules. An entry
    trigger's `row` carries `catalog_code` and its class row as `catalog`, and a leave entry's also the employment's
    time off (`leave[]`, each with `id` and `chain_from`) and its own `chain_from`, so a continuation raises no second
    first application; a payslip's carries `line_codes` (its base
    and adjustment component codes) and `paid_on` (the UTC day of `paid_at`), which is also its day; a `calendar` row
    is the contract. A payslip trigger's `row` also carries its run's `pay_date` and `pay_due_date` (a late payment's
    days, against `paid_on`).
  - Holiday calendar: a version's PAYROLL `rule_set` row `public_holidays` (`rules.holidays[]` = `{ date, name, kind?,
replaces?, given_to?, regions? }`) is the national calendar. The canonical `write-public-holidays` rule (entity
    created, and the row event `entity`/`calendar` the `calendar_tick` runs daily for every entity whose version has a
    rule for it) creates each listed holiday the entity lacks by date (a `regions` list limits it to entities of those
    regions), unpublished: HR publishes them as any other holiday row. A holiday's `kind` is a code the version
    governing its day lists (PAYROLL `holiday_kinds`, `rules.kinds[] = { code, name }`), checked by the holiday
    transform; a workbook import names it in a `kind` column (no default).
  - Behaviour effects: `event` (`collection`, `action`, `row`, `settings_id`, `day`, `period`, `company_id`,
    `employment_id`, `employee_id`, `headcount`, `leave_balances` — on a contract event, every class's balance on its
    day, which `encash-leave-on-exit` pays), `run` on payroll_run events, plus each declared read by name; every
    `entity` row a rule reads carries `headcount`. `services.ts` and the `behaviour_runner` (shared by the row taps and
    the daily tick) build them. A rule's `when`, read `where`s and `effect` evaluate strictly: any failure — its own, or a record
    expression it runs through `configured_eval` (a duty's `when`, `applies_when`, `due`, …), even one CEL's commutative
    `&&` / `||` would absorb (`error && false` is false) — refuses as `Behaviour <id> returned an evaluation failure on
<record code>: <message>` (the code of the declared-read row whose `rules` hold the failing text), so the tap or
    tick run is `failed` with that error instead of a success that raised nothing (`tests/e2e/behaviour-failure.test.ts`). The jurisdiction suites evaluate under `evaluateStrict` too, and
    `tests/rule-seed-strict.test.ts` runs every `TASKS` and `OBLIGATIONS` row of every version through its canonical
    `raise-*` rule, and every `VALIDATIONS` `when` on its site, on a representative context (every declared fact, then
    only the required ones); its failures are pinned in `KNOWN` (none on 2026-10-08).
  - CEL helpers beyond the calendar and number set: `top(list, n)` (the n largest numbers, largest first),
    `count_within(list, "field", from, to)` (items of a list sorted by that field whose value falls in the range,
    by binary search over only the items it touches: O(log n) a call),
    `hours_between(intervals, "HH:MM", "HH:MM")` (overlap with a daily clock window; an end not after the start
    crosses midnight), `next_working_day(date, holidays, weekend)`,
    `add_working_days(date, n, holidays, weekend)` (working day = not a `weekend` weekday — the record names them,
    `["SATURDAY", "SUNDAY"]`, `["FRIDAY", "SATURDAY"]` — and not a listed date or holiday row).
- Contract terms: each term of `facts.contract_terms` is opaque JSON shaped by the governing version's
  `employee_input_schema.properties.contract_terms.items`; a change of terms closes the term in force and carries
  every key it holds (`facts`, `currency`, ids, any declared key) to the successor, which gets a new `id`. The hire and
  change-terms forms render that schema's fields (an `enum` a choice, nothing preselected; a schema `default` only as a
  hint) and require its `required` keys, and an `allOf` / `if` → `then.required` keyed on another value (SG: a
  `PERMANENT_RESIDENT` needs `residency_since`). Classification keys are required where a lineage declares them.
- Exits: the exit ground is a code the version governing the last day lists (PAYROLL `exit_grounds`,
  `rules.kinds[] = { code, name }`; every ground a record compares is listed — `tests/jurisdiction-seed.test.ts`), checked
  by the employment_contract transform; the exit form asks for it (no default) and for the facts
  `employee_input_schema.properties.exit_facts` declares. A departure is the ground with its last day; a planned end
  (a fixed term: `effective_range.to` without a ground) is not, so a fixed-term contract exits early (its planned end
  kept in `signed_contract_end`). A departure is moved (the same form) or undone (a withdrawn resignation: the
  contract reopens to `signed_contract_end`, else open-ended); only a closed range's start is fixed. Its effects are
  keyed to the exit as it stands (`<day>/<ground>`): the canonical `retract-exit-effects` (first of the contract-update
  rules) deletes the unpaid exit encashments (`exit:<contract>:<code>:<key>`) and dismisses the open tasks the exit
  raised (`facts.exit_key`, their `occurrence_key` suffixed `:withdrawn:<day>`) whose key no longer stands; then
  `encash-leave-on-exit` and `raise-tasks` raise them for the new key, the encashment over the balance without the
  withdrawn ones (`leaveBalancesFor` `withoutExitEffects`). A paid encashment stays (its days were cashed). A ground
  change re-keys and re-evaluates; an exit-facts change alone does not.
- Runs: a run for an earlier period refuses while a later period has a run (`<later> already has a run: delete the
runs after <period>, latest first, and rebuild them after it`), so no later year to date goes stale. A deleted run
  withdraws what it raised: the canonical `withdraw-run-duties` (payroll_run `deleted`, the taps reading its pre-image)
  deletes its open, unsettled obligations (`trigger_ref` = the run) and dismisses its open tasks (their
  `occurrence_key` suffixed `:withdrawn:<day>`), so a recreated run raises them once. A statutory line carries
  `charged_base`, the base its rule charged on (`configuration.assessment`, else the assessed parts): the slip's "on".
- Loans: the Loans page's outstanding balance per instalment is the loan's `facts.principal` less its instalments to
  date (by `facts.loan_id`), and the instalments its first recorded one's `facts.sequence` says came before.
- Exit pay: an ad hoc class with `raise_on_exit` is raised by the first salary slip reaching the departure (its
  window holds the exit day, or the month before it) when its `eligibility` / `qualifies_when` hold, priced by its
  bands on an empty entry of the exit day (`entry.amount` 0), as adjustment family `EXIT`, source `exit:<code>:<key>`,
  once per key; an entry of the class HR makes wins. Flagged: MY `TERMINATION_BENEFIT`, `NOTICE_IN_LIEU`, PH
  `SEPARATION_PAY`. An `EXIT` line a PAID slip carried for a key no longer standing is taken back at what it paid
  (`<source>:reversal`) by the next salary slip. A PAID salary slip's prorated lines are repriced when the days its
  period's window now covers differ from those it paid (an exit moved or undone after the final run): fully covered,
  its `contract_amount`; uncovered, nothing; else the paid amount moved by `contract_amount / denominator` a day
  (ponytail: a working-day line is approximated by its record's calendar divisor), as family `CORRECTION`, source
  `<slip>:<code>`, net of earlier corrections. A leaver has no pay to recover from: the overpayment is a run warning on
  the first run after the paid period. The slip is kept for these corrections when nothing else pays.
- Entries: an entry that prices to nothing warns on the run (`… prices to nothing; it stays unpaid.`), unless its class
  is payable after exit (a waived instalment). A claim band's `limit` meters its `window` — `ENTRY` (default),
  `PERIOD` (the settlement period) or `CALENDAR_YEAR`, less the class's earlier claims in it (`earlier.rows`); `BLOCK`
  pays up to it, `ALLOW` pays all, and either warns with the excess.
- Leave requests: a TIME_OFF movement with a `from` charges what the server counts (`leave_days.ts`, the
  leave_catalog_entry transform and its `leave_days` / `preview_leave` queries): the employment's own plan (roster
  shift, else its terms' pattern) less published holidays, in the class's `unit` — `DAY` planned working days,
  `CALENDAR_DAY` every day, `HOUR` the planned shifts' scheduled hours; a half day halves its end. A range with
  nothing planned charges its calendar days less published holidays. The request form only shows the server's count.
- Workplace cases: `workplace_case` (an entity's, optionally an employment's) holds a `kind`, `opened_on`, `closed_on`
  and `facts` — a flexible-work or personal-data request, a breach, a work accident, a dependant change. Its kind must
  be listed by the version governing its opening day (`rule_set` PAYROLL `case_kinds`,
  `rules.kinds[] = { code, name }`). `TASKS` trigger on `workplace_case` created / updated, and `daily` — the tick runs every open case — so a reply
  or notice still owed after N days is `when: row.closed_on == null && today >= add_days(row.opened_on, N)`, raised
  once. A case update's row carries `before` (the prior values it changed). HR keeps cases and work suspensions on the payroll app's Compliance page; the kind picker offers the catalogue of the
  chosen entity's lineage version governing the record's day (every lineage's in force today before an entity is chosen).
- Work suspensions: `work_suspension` (an entity's) holds a `kind`, `starts_on`, `ends_on`, an optional `worksite` (the
  roster day's, else the terms' `facts.worksite`), `employment_ids` (empty = everyone at the entity or worksite) and
  `facts`. Its kind is a row of the governing version's `suspension_kind` catalogue (`code`, `name`, `authority`;
  cloned with the version), whose
  CEL decides what a suspended day does: `counts_as_attended` (blank = no), `scheduled` (whether it stays a scheduled
  day; blank = yes) — both read `day` (`date`, `worked`, `day_type`), `suspension` (`kind`, `facts`) and the subject —
  and `pay` (on the payslip context with `day` and `suspension`, rounded per day; blank = 0, e.g. a shutdown
  allowance `0.6 * <average daily wage>`). `work.days[].suspended` = `{ kind, from, to, facts, working_days_elapsed
(the scheduled working days from `from` through the day, across pay periods: a first-N-days floor), counts_as_attended,
scheduled, pay }` (else null) — a work line sums the pay — and the attendance root counts the day as the kind says, beside
  `attendance.<window>.suspended.<KIND>` and `suspensions[]` (`{ kind, from, to }`, once each). `TASKS` trigger on `work_suspension` created / updated (its day its first).
  No kind is named in source. A run reads suspensions only when a record of its
  version names `suspended`.
- Work-day sheet: `src/data/collection/roster/roster_entry/+pipeline.ts`, auto-wired in the Work page's ⚡ menu with
  the page's entity and period as context (template: that entity's person-days of the period as stored). The import
  is a set (`scope` by employment over `work_date`, the model's key): rows created or updated, unsettled stored days
  left out or blanked deleted, a leave code the records lack a one-day TIME_OFF entry (`related`; recorded leave is
  never written twice). `known` resolves employee numbers (the context's entity, else any entity: an ambiguous number
  refuses), shift codes, the time zone and the stored intervals a row keeps; `check` refuses structural problems and
  changes to settled days (pinned, a regular run's attendance window, awaiting approval) and runs the `roster`
  validations. The roster_entry transform guards the same settled days, deletes included. A blank row outside the
  file's mapped first-to-last day per employment cannot be reached by the scope: it warns and the stored day stays.
- Payees: an `employment_contract` with `engagement: PAYEE` is a person paid without employment (`employment.engagement`
  in every context). A salary run pays only its entries (no contract lines, no base salary needed); it is outside the
  headcount and separations. Statutory schemes price it on `employment.engagement` (a 50% base for a non-employee).
- Anonymising a former employee: the `employment_profile.anonymise` action (HR, on the person's contracts tab once
  every employment has ended) replaces the personal fields — name, identifiers, contact, birth date, family,
  biometrics, `facts` — with neutral values, stamps `anonymised_at`, and clears the contracts' `bank` and `comments`;
  payslips, runs and obligations keep their amounts. The profile transform refuses it before the latest day the
  version governing each exit returns from its PAYROLL `record_retention` rule (`rules.until`, CEL on the subject at
  the exit, e.g. `add_years(employment.exit_date, 5)`); a version without the rule never allows it. A disposal task is
  a `TASKS` row on the same date.
- Statutory returns and bank files: a version's `rule_set` rows of family `EXPORTS` (`rules.file` CEL over `runs[]`,
  optional `rules.applies_when` (CEL over `runs[]` and `company`: whether the file is made at all, e.g. a bank's
  layout for its own payers), optional `rules.when`, `rules.columns[] = { header, value, width?, align?, pad? }` CEL, `rules.format` `CSV` (default: a
  header row) or `FIXED` (each field cut and padded to its `width`; `align: right` pads left with `pad`, e.g. `"0"`),
  and optional `rules.header[]` / `rules.trailer[]` records read on `runs[]`, `rows[]` and `count` — totals and
  counts of a bank or statutory file; a row's columns also read `index`, its 1-based number; every record reads
  `company`, the runs' entity with its facts; `rules.records[] = { each, fields }` expands a row into one record per
  `item` of its `each` CEL list instead of `columns`; `rules.summary = { key, fields }` adds one record per distinct
  `key` over those records (or over its own `summary.each` CEL list, for a summary with no detail record), read on
  `key`, `items[]` and `count`, after the details or, with `summary.position: before`, ahead of them; header and
  trailer also read `items[]`; every record reads `generated_at`, the instant the file is made) render one file each in `export_payroll` over the selected
  runs: a row per employment, read on `runs[]`, `employee` (profile), `contract`, `slips[]` (`period`, `status`,
  `gross`, `net`, `total_deductions`, `lines.<CODE>`, `statutory.<SCHEME>.{employee, employer, base}`, `leave[]` = the
  leave rows the slip settled, `{ code, days, from, to, facts }` — VN-OBLIGATION-52), their `totals` and `entries[]`
  (every entry the employment's slips pinned: `{ family, code, amount, quantity, facts, employment_id }`, e.g. a
  per-residence or per-plan return as `records: [{ each: 'entries.filter(e, e.code == …)' }]`; the framing records
  read every row's as `entries`). Slips, leave and entries come in the export's one joined read (relation arms). A new return (an annual alphalist) or bank layout is a record: SG's `bank_ocbc_fast` (FIXED) is made for
  an entity whose `disbursement_account.bank_code` starts `OCBCSG`. Source writes only a generic bank CSV.
- Paid periods lock the terms: the employment_contract transform refuses a `facts.contract_terms` change that alters the
  term in force (any key of it) on any day of a period the employment has a payslip for (any run kind); a change starts after the last
  paid day, and deleting the run releases it. Off-cycle runs settle month-to-date, so totals are order-independent.
- Gaps: one tracker per jurisdiction, `docs/inventory/<CODE>.csv` (format in `docs/inventory/README.md`).
- Owner rulings: MY prices a day at monthly ÷ 26; no TW 2027 version until the tables are published.
- Design decisions: PH (coordinator, 2026-10-07) — a sealed version is one national statutory regime (PH: RR 11-2018 / RR 4-2025
  to 5 January 2026, RR 29-2025 from 6 January 2026); the many regional wage orders and the holiday proclamations are dated
  rows inside it (`minimum_wage.by_region` / `by_employment_type` newest-first `{ from, monthly }`, `public_holidays`),
  not new versions — the narrow exception to "a change of law is a new version" for regional orders. A period spanning an
  order takes the newer floor for the whole period.

## Open

- Customer data the bank does not carry (each tracker names the rows): opsph dates of birth; KDIT dependants (source says
  0, its tax implies category B), its February "Compensation" class and overtime reconciliation; Nihon R5D/R6D patterns
  with no shift days; SG entities have no roster/leave/claim history.
- Engine roots still missing (per tracker): a run-level statutory total at the statutory site; a window beyond the
  12-month `hours` history.
- Roots added on 2026-10-07 and not yet configured by any lineage (each tracker row names its root): `attendance`
  (with `suspended`, `banked_hours`), `suspension_kind`, `payable_after_exit`, task `separations` / `headcount_by_worksite` /
  `employee.children` / `row.leave` / `row.before` / `terms_written` / `repeat_key` / `occurrence`, `workplace_case`,
  `work_suspension`, `regulatory_task` updated, `WEEKLY` / `DAILY` periods, `earned.history` and `top`,
  `net_available` and `carry_uncovered`, off-cycle `leave`, `consumes_after_days`, `hours_per_day`, `carry_depth`,
  banked overtime, leave chains, `engagement: PAYEE`, obligation `headcount_months`, `EXPORTS` returns,
  `record_retention` and the anonymise action.
- Unverifiable official sources (per tracker, STILL UNVERIFIABLE): e.g. MY KWSP/HRD Corp pages, CN Kunming medical and 2026
  unemployment, TH Social Security age-at-entry text, ID PMK 168 annex body.
- Calendar: TW 2027 version once the 116年 tables publish; review every lineage each January and July for new rates.
- Obligations are per run: an off-cycle run raises its own remittance; deleting a run leaves its obligations.
- The template's Bolt is a manual overlay of the local oss build (`rsync` of `oss/packages/bolt/build` plus the
  `@cfworker/json-schema` link) because `pnpm run env -- link` fails on Colony's tenant substrate; publish the oss nested
  discovery change and re-pin before any `pnpm install` here.
- Gates: `pnpm lint`, `pnpm check`, `pnpm build`, `pnpm test`, and from `templates/`
  `node --experimental-strip-types scripts/ci.ts check --filter=hr-payroll`.
