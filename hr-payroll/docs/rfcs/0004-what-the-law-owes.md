# RFC 0004 — The catalogue states what the law owes, not what somebody keyed

- Status: Proposed 2026-09-16. §7 is the landing order; slice 1 lands with this RFC.
- Scope: the five catalogues, `statutory_contributions.base`, `leave_entitlement`, `work_rules`,
  `employment_statutory_facts`, the expression contexts in `lib/expressions`, and the seed bank's
  seven lineages.
- Keeps: RFC 0001's pipeline and families, RFC 0002's rule ladders, RFC 0003's declared bases and
  unit-named expressions, `destination × direction` landings, write-time compile.
- Changes: what a catalogue row can be the _source_ of, and what every expression can _see_. No
  golden moves unless a lineage's seed is changed to use a new primitive, and then the golden is
  what proves the primitive.

## 0. Why the engine is non-compliant today

Six lineages carry 93 "NOT APPLIED" residues between them. Read against the current grammar they
sort into seven causes, and every one of them is a _shape_ the catalogue cannot state, never a
number the engine gets wrong:

| #   | Cause                                                                                                                                                                                                                                     | Residues | Examples                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Money enters only through a keyed entry.** Every catalogue row prices something a person typed; Work and Leave deductions are the only lines the engine derives itself. What the law owes _on its own calendar or event_ has no source. | 9        | PH 13th month (P.D. 851), ID THR (Permenaker 6/2016), PH unworked regular holiday (art. 94), fund-paid VN sick/maternity, TW half-pay leave, KDIT THR withheld twice                                                                         |
| B   | **Contexts are period-local.** A rule sees this period's base and one scheme's year-to-date. The law's annual constructs need the year as an axis.                                                                                        | 11       | PH ₱90,000 exemption, SG Additional Wage ceiling, TW NHI 補充保費 on cumulative bonus, PH RR 11-2018 / ID PMK 168 / VN art. 70 year-end true-up, EPF total-first rounding, TW §31 four-times-monthly test                                    |
| C   | **A boolean or an enum where the law has a quantity or a predicate.** `leave.paid`, `base.salary`, `night_premium.overtime_add`, `holiday_rest_precedence`, `prorates`, `on_day`.                                                         | 19       | ID sick pay 100/75/50/25%, TW half pay, contractual-vs-measured SI base (PH, VN), PH 260% holiday-on-rest-day, VN 270/390% night overtime, ID 75% overtime base, SG 5-day/9-hour week                                                        |
| D   | **Facts the predicates cannot see.** Contribution history, elections, pass type, domicile, the child's citizenship, the birth.                                                                                                            | 27       | SOCSO first entry ≥ 55, EIS 57-never-contributed, SKBBK opt-out, SHG opt-out, SG child citizenship, PH four deliveries, VN insurance years, TW 183 days, ID PTKP for a married woman, HRD Corp 5–9 election                                  |
| E   | **Charges assessed on the employer, not the person.**                                                                                                                                                                                     | 5        | TW 積欠工資墊償基金 on the insured-salary total, NHI employer 補充保費 on the payroll aggregate, VN union fee on the salary fund, PH SIL < 10 employees, ID JKP employer arrears                                                             |
| F   | **Entitlement windows the leave grammar lacks.** Rolling, per-event, lifetime-per-child, one head consuming another.                                                                                                                      | 14       | TW 2-in-1-year hospitalised sick leave, VN art. 115 per event, SG 42-day lifetime cap per child, ID cuti bersama offsets annual leave, TW 家庭照顧假 inside 事假                                                                             |
| G   | **Already expressible; the note predates RFC 0002/0003.**                                                                                                                                                                                 | 8        | TW part-time grades (`person.employment.type` is readable), SG non-workman ceiling (`overtime_when`), VN 300-hour sector ceiling (limits take `when`), PH art. 82 exclusions, PhilHealth split rounding (`round_cent(base*0.05) - employee`) |

The pattern is one thing said seven ways: **the catalogue stores the shape of a customer's payroll
register, not the shape of the statute.** A register has columns somebody fills in; a statute has
obligations that fall due on their own, on a person's whole year, on facts about the person and the
employer, over windows the register never drew. The CEL engine can already evaluate any of it; it
is not _given_ the right inputs, and the rows that would carry the expression do not exist.

## 1. The target in one page

```
SOURCE ──> ROW (who · when · how much · where it lands) ──> LINES ──> BASES ──> RULES ──> SETTLEMENT
  ENTRY        every catalogue row, one grammar                       year axis on every context
  SCHEDULE
  EVENT
```

1. **Every catalogue row says where its entries come from.** `source: ENTRY` is today's keyed
   request. `source: SCHEDULE` generates one entry per occurrence of a calendar the row states —
   a 13th month every 24 December, a THR seven days before the version's Idul Fitri, a company
   AWS every December. `source: EVENT` generates one entry per event the run observes — an
   unworked regular holiday, a separation, a birth. The engine materialises these exactly as it
   already materialises a standing allowance's per-period slice: a derived request row, pinned to
   the payslip, released when the draft is deleted. Nobody keys them; nobody can forget them.
2. **Every knob is an expression over a stated context, or typed data.** A boolean that the law
   states as a fraction becomes a money or fraction expression (`leave.pay_fraction`); a scalar
   the law varies by day type becomes a band (`night` bands beside overtime bands); an enum that
   the law compounds becomes a predicate the bands can read (`day.rest_day && day.holiday.kind`).
   Nothing new is invented for one country: each is the same `when`/`amount` grammar RFC 0003 gave
   work bands.
3. **Every context carries the year.** `year.earned.<code>`, `year.charged.<scheme>`,
   `year.months_employed`, `year.days_employed`, `period.last_of_year`. A ₱90,000 exemption, an
   Additional Wage ceiling and a December true-up are then ordinary expressions.
4. **Facts are typed and dated, on the person and on the employer.** A registration carries
   `since`; an election is a fact; a company has statutory facts of its own (registrations,
   sector, consents). Both are members of the person context.
5. **A scheme may be assessed on the company.** `assessed_on: PERSON | COMPANY`. A company scheme's
   base is the sum of its declared entries over the run and it lands as a run-level employer cost,
   which is where an establishment levy belongs.
6. **Leave entitlement windows are data.** `period: CALENDAR_YEAR | ROLLING_MONTHS(n) | PER_EVENT |
LIFETIME(key)`, and a head may state which other head it consumes.

## 2. Source and schedule (cause A)

Add to `payment_catalogue`, `allowance_catalogue` and `claim_catalogue`:

```ts
source: enums(['ENTRY', 'SCHEDULE', 'EVENT']).notNull().default('ENTRY'),
schedule: custom('catalogue_schedule')   // null unless source is SCHEDULE
```

```ts
catalogue_schedule = {
  every: 'YEAR' | 'MONTH',
  month?: 1..12,           // YEAR only
  day: 1..31 | 'LAST',
  when: string,            // person-site boolean: who is owed it on that day; empty = everyone
  from_service_months: n   // 0 = from day one; THR 1, 13th month 1 (P.D. 851 §1, Revised Guidelines ¶)
}
```

The band's `amount` prices the occurrence and reads the year axis: 13th month is
`year.earned.BASIC / 12`; THR is `person.terms.base_salary * min(1, year.months_employed / 12)`
on a version whose `day` is the year's own Idul Fitri minus seven.

A SCHEDULE row occurs once per calendar occurrence per employment and is materialised the moment a
run's window contains the occurrence day; a leaver whose final period precedes the day is owed the
prorated occurrence on separation, which is `source: EVENT` with `event: SEPARATION` on the same
row (the Philippine "13th month pay adjustment" rows the register carries by hand in March are
exactly this, and are the two `payment_requests` the seed keys today).

`source: EVENT` rows state `event: SEPARATION | UNWORKED_HOLIDAY | BIRTH | ...`; the run observes
the event from the facts it already gathers (exit date, holiday calendar against attendance, a
leave event of kind BIRTH). PH art. 94(a) is one Work-family row:
`{ source: EVENT, event: UNWORKED_HOLIDAY, when: day.holiday.kind == "PUBLIC" && person.terms.pay_basis == "DAILY", amount: rates.ordinary_day }`.

## 3. The year axis (cause B)

Every site gains:

| member                                                   | meaning                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `year.start`, `year.end`                                 | the tax year the period sits in (from `payroll.tax_year_start_month`)                |
| `year.months_employed`, `year.days_employed`             | of this employment, through the period end                                           |
| `year.earned.<code>`                                     | cumulative measured amount of a component code in the tax year, this period included |
| `year.charged.<scheme>.base` / `.employee` / `.employer` | what `year_to_date` already gives the scheme site, everywhere                        |
| `period.last_of_year`                                    | true in the period that closes the tax year, or a leaver's final period              |

The scheme base gains, per entry: `annual_exempt: money | null` — the first N a year of that
entry's amount is outside the base (NIRC s.32(B)(7)(e) ₱90,000 on `THIRTEENTH_MONTH_PAY` in the
WTAX base). ACCUMULATE reads `year.earned.<code>` to know how much of the exemption is spent.

A true-up is then a rule, not a mode: on the WTAX/PPh 21/PIT scheme,
`when: period.last_of_year`, `employee: annual_tax(year.charged.WTAX.base + base) - year.charged.WTAX.employee`,
with `annual_tax` the version's own progression stated in CEL as every other ladder is.

## 4. Expressions where the law has quantities (cause C)

| today                                        | after                                                                                           | reads                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `leave_catalogue.paid: boolean`              | `pay_fraction: string` (fraction expression; `''` = 1)                                          | `leave.day_index`, `leave.days_in_event`, `person.*` — ID art. 93(3) is `leave.day_index <= 120 ? 1.0 : leave.day_index <= 240 ? 0.75 : …` |
| `leave_catalogue.paid_by` (new)              | `EMPLOYER \| FUND`                                                                              | a FUND-paid day is an INFORMATION line: no employer money, and the base flags decide the rest                                              |
| `base.salary: boolean`                       | `salary: 'NONE' \| 'MEASURED' \| 'CONTRACTUAL'`                                                 | PH PhilHealth, VN SI/HI/UI charge the contract figure whether or not the month was worked                                                  |
| `night_premium.{ordinary_add, overtime_add}` | night bands in `work_rules.bands` with `night_hours` in the day context                         | VN art. 98(3): `day_type == "PUBLIC_HOLIDAY" ? 3.9 : day_type == "REST_DAY" ? 2.7 : 1.5`                                                   |
| `holiday_rest_precedence` enum               | keep, plus `day.rest_day` and `day.holiday.kind` as independent context members                 | PH 260%: `day.holiday.kind == "PUBLIC" && day.rest_day`                                                                                    |
| `allowance_catalogue.prorates: boolean`      | `proration: string` (fraction expression; `''` = whole)                                         | ID art. 32(4) 75% base, SG daily-rated proration                                                                                           |
| `ordinary_divisor_days`                      | already an expression; add `person.terms.pay_basis` (`MONTHLY \| DAILY \| HOURLY`) to the terms | MY s.60(3)(a), PH factor 313 vs 365                                                                                                        |

## 5. Facts (cause D), the employer (cause E), windows (cause F)

**Facts.** `statutory_fact_status.REGISTERED` gains `since: calendarDay | null` (first entry into
the scheme) and both variants gain `elections: Record<string, string | number | boolean>`. The
person context exposes `facts.<code>.registered`, `facts.<code>.since_months`,
`facts.<code>.elections.<key>`. Employees gain `pass_type`, `tax_domicile`, `days_present_year`;
`employee_children[]` gains `citizenship` and `born_on`, and `leave_event` of kind `BIRTH`
carries `delivery: SINGLE | MULTIPLE`, `caesarean`, `weeks`. A new `company_statutory_facts`
collection carries the employer's registrations, sector and consents as `company.facts.<code>`.

**Employer.** `statutory_contributions.assessed_on: 'PERSON' | 'COMPANY'`. A COMPANY scheme's
base is the sum over the run of what its declaration admits; its charge lands on the run as an
employer cost with no payslip, and the bank file and report carry it as a run line.

**Windows.** `leave_entitlement.period` gains `ROLLING_MONTHS: n`, `PER_EVENT` and
`LIFETIME: key`; `leave_catalogue.consumes: code | null` states the head whose balance this
head's days come out of (TW 家庭照顧假 → 事假, ID cuti bersama → annual leave).

## 6. The inventory, residue by residue

Every NOT APPLIED item of every lineage README, with the primitive that closes it. `now` means
the current grammar already carries it and the README was stale; `S1..S5` is the landing slice.

| Lineage | Residue                                                                                            | Cause | Primitive                                                                                     | Slice   |
| ------- | -------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------- | ------- |
| PH      | 13th-month pay not generated                                                                       | A     | SCHEDULE + `year.earned`                                                                      | S1      |
| PH      | ₱90,000 exemption                                                                                  | B     | `base.entries[].annual_exempt`                                                                | S1      |
| PH      | year-end annualisation (RR 11-2018 s.16)                                                           | B     | `period.last_of_year` rule                                                                    | S2      |
| PH      | PhilHealth premium split                                                                           | G     | rule: `employer = round_cent(base*0.05) - employee`                                           | now     |
| PH      | contractual salary base (PHIC, HDMF)                                                               | C     | `base.salary: CONTRACTUAL`                                                                    | S2      |
| PH      | SSS Regular / MPF split                                                                            | C     | two schemes in one relief group                                                               | now     |
| PH      | de minimis meal cap                                                                                | B     | `annual_exempt` on the `meal` entry, expression form                                          | S1      |
| PH      | 260% / 150% compounded day types                                                                   | C     | `day.rest_day` + `day.holiday.kind` in bands                                                  | S3      |
| PH      | pay for an unworked regular holiday                                                                | A     | Work EVENT row `UNWORKED_HOLIDAY`                                                             | S3      |
| PH      | art. 82 exclusions beyond MANAGERIAL                                                               | G     | `overtime_when` names the terms                                                               | now     |
| PH      | art. 85 short breaks                                                                               | C     | `breaks[].when` (exists)                                                                      | now     |
| PH      | SIL exclusions, < 10 employees                                                                     | D/E   | `company.facts`, `headcount`                                                                  | S4      |
| PH      | maternity miscarriage event, SSS 3-month test                                                      | D/F   | BIRTH event facts, `facts.SSS.since_months`                                                   | S4      |
| PH      | paternity four deliveries                                                                          | F     | `LIFETIME: child`                                                                             | S5      |
| PH      | RA 9710 twelve-month window                                                                        | F     | `ROLLING_MONTHS: 12`                                                                          | S5      |
| PH      | solo-parent forfeiture, ID card                                                                    | D     | `elections.solo_parent_id`                                                                    | S4      |
| PH      | 313 / 365 factors                                                                                  | C     | `person.terms.pay_basis` in `ordinary_divisor_days`                                           | S3      |
| PH      | regional wage orders                                                                               | —     | `wages.by_region` (exists); seed the order                                                    | seed    |
| PH      | minimum-wage earner premium exemption                                                              | B     | WTAX base entries `when` over `person.terms.base_salary <= minimum_wage(region)`              | S2      |
| PH      | apprentice / learner 75%                                                                           | C     | `wages.applies_when` + `wage_floor` expression form                                           | S2      |
| MY      | SKBBK opt-out, HRD Corp election                                                                   | D     | facts (exists as NOT_REGISTERED)                                                              | now     |
| MY      | SKBBK phases 2–3                                                                                   | —     | future sealed versions                                                                        | seed    |
| MY      | SOCSO first entry ≥ 55, EIS 57-never-contributed                                                   | D     | `facts.<code>.since`                                                                          | S4      |
| MY      | HRD Corp Malaysians-only base and headcount                                                        | C     | `headcount` predicate + `base.entries[].when`                                                 | S2      |
| MY      | EPF total-first rounding                                                                           | B     | rule: `up_to_unit(employee + employer)` split                                                 | now     |
| MY      | PCB disabled-person, disabled-spouse, zakat                                                        | D     | `elections` on the PCB fact                                                                   | S4      |
| MY      | annual-leave fraction rule and 10% forfeiture                                                      | F     | `year.days_absent_unauthorised`, rounding in the band                                         | S5      |
| MY      | maternity allowance conditions                                                                     | D/F   | BIRTH facts, `facts.*`, `pay_fraction`                                                        | S4      |
| MY      | paternity five confinements, notice                                                                | F     | `LIFETIME: child`                                                                             | S5      |
| MY      | normal hours declaration                                                                           | C     | `work_rules.normal_hours` expression                                                          | S3      |
| MY      | rest-day pay for daily-rated                                                                       | C     | `pay_basis` in bands                                                                          | S3      |
| MY      | domestic employees                                                                                 | D     | `employment.type = DOMESTIC` (enum)                                                           | S4      |
| MY      | s.59(1) rest-day suspension                                                                        | F     | `weekly_rest_rule.suspended_when`                                                             | S5      |
| MY      | PCB non-resident 30%                                                                               | D     | `rate_override` on the fact (exists)                                                          | now     |
| SG      | Additional Wage ceiling                                                                            | B     | `year.earned.<OW codes>` in the CPF cap rule                                                  | S1      |
| SG      | age-band boundary month                                                                            | C     | rule reads `person.employee.age_months`                                                       | S2      |
| SG      | SPR residency unrecorded                                                                           | —     | records                                                                                       | records |
| SG      | SINDA and pass type; SHG opt-out                                                                   | D     | `employee.pass_type`, `elections`                                                             | S4      |
| SG      | Part 4 second ceiling                                                                              | G     | `overtime_when` (exists)                                                                      | now     |
| SG      | rest-day work at whose request                                                                     | D     | `work_day.requested_by` fact                                                                  | S3      |
| SG      | 5-day / 9-hour week                                                                                | C     | `normal_hours` expression                                                                     | S3      |
| SG      | holiday on a non-working day                                                                       | A     | Work EVENT row                                                                                | S3      |
| SG      | hospitalisation includes outpatient                                                                | F     | `consumes`                                                                                    | S5      |
| SG      | child citizenship, EA maternity conditions, marriage window, lifetime caps, SPL pool, adoption age | D/F   | child facts, BIRTH facts, `LIFETIME: child`                                                   | S4/S5   |
| SG      | retirement ages, NDR 2026 childcare                                                                | —     | future versions                                                                               | seed    |
| VN      | contractual salary base                                                                            | C     | `base.salary: CONTRACTUAL`                                                                    | S2      |
| VN      | union fee on the fund                                                                              | E     | `assessed_on: COMPANY`                                                                        | S5      |
| VN      | union dues 1% (members)                                                                            | D     | `elections.union_member`                                                                      | S4      |
| VN      | reduced 0.3% occupational rate                                                                     | D     | `company.facts`                                                                               | S4      |
| VN      | overtime premium PIT-exempt (pre-July)                                                             | C     | `base.entries[]` may name a band label: `OVERTIME:premium`                                    | S2      |
| VN      | night overtime by day type                                                                         | C     | night bands                                                                                   | S3      |
| VN      | 300-hour sector ceiling                                                                            | G     | `limits[].when`                                                                               | now     |
| VN      | 45-minute night break                                                                              | C     | `breaks[].when` on `night_hours`                                                              | S3      |
| VN      | four-rest-days average                                                                             | F     | `weekly_rest_rule.average_over_days`                                                          | S5      |
| VN      | arduous cohorts, disabled worker                                                                   | D     | `employment.classification` values, `employee.disabled`                                       | S4      |
| VN      | seniority ladder past 30 years                                                                     | C     | entitlement `days` as an expression                                                           | S2      |
| VN      | sick leave by insurance years                                                                      | D     | `facts.SI.since_months`                                                                       | S4      |
| VN      | maternity / paternity variants                                                                     | D     | BIRTH facts                                                                                   | S4      |
| VN      | art. 115 per event                                                                                 | F     | `PER_EVENT`                                                                                   | S5      |
| VN      | fund-paid leave                                                                                    | A/C   | `paid_by: FUND`                                                                               | S2      |
| VN      | holiday on the rest day at 300%                                                                    | C     | `day.rest_day` + `holiday.kind`                                                               | S3      |
| VN      | elective National Day                                                                              | —     | company holiday row                                                                           | records |
| VN      | year-end finalisation                                                                              | B     | `period.last_of_year` rule                                                                    | S2      |
| TW      | sub-minimum grades                                                                                 | G     | `person.employment.type` in rules                                                             | now     |
| TW      | 積欠工資墊償基金                                                                                   | E     | `assessed_on: COMPANY`                                                                        | S5      |
| TW      | NHI 補充保費                                                                                       | B/E   | `year.earned.<bonus codes>`; COMPANY scheme for the employer leg                              | S5      |
| TW      | 勞退 voluntary contribution                                                                        | D     | `elections.voluntary_rate`                                                                    | S4      |
| TW      | annual assessment schedule                                                                         | B     | `period.last_of_year` rule                                                                    | S2      |
| TW      | 扣繳稅額表 election                                                                                | D     | `elections.withholding_table` + a second rule ladder                                          | S4      |
| TW      | half-pay leave                                                                                     | C     | `pay_fraction`                                                                                | S2      |
| TW      | hospitalised sick leave, 2-in-1                                                                    | F     | `ROLLING_MONTHS: 24`                                                                          | S5      |
| TW      | bereavement and miscarriage tiers                                                                  | D     | BIRTH facts, `leave_event.relationship`                                                       | S4      |
| TW      | 家庭照顧假 inside 事假                                                                             | F     | `consumes`                                                                                    | S5      |
| TW      | hourly leave                                                                                       | F     | `leave_event` in hours (exists for TOIL)                                                      | S5      |
| TW      | §32-1 補休                                                                                         | A     | TOIL conversion (exists)                                                                      | now     |
| TW      | 54-hour consent                                                                                    | D     | `company.facts.overtime_consent` in `limits[].when`                                           | S4      |
| TW      | §35 break proviso, §84-1 責任制                                                                    | D     | `company.facts`                                                                               | S4      |
| TW      | grade rounding                                                                                     | —     | table transcription                                                                           | seed    |
| TW      | encashment re-grading                                                                              | C     | `base.entries[].when`                                                                         | S2      |
| TW      | EI nationality and age boundary                                                                    | G     | rules (exists)                                                                                | now     |
| ID      | non-JKP population, JKP eligibility, JP nationality                                                | D     | `facts.JKP.registered`, `employee.nationality` (exists)                                       | now/S4  |
| ID      | district UMK floor                                                                                 | —     | `wages.by_region` keyed by district; company region                                           | seed    |
| ID      | PPh 21 December true-up                                                                            | B     | `period.last_of_year` rule                                                                    | S2      |
| ID      | PPh 21 DTP                                                                                         | D/E   | `company.facts.sector`                                                                        | S4      |
| ID      | employer premiums as taxable income                                                                | C     | `base.entries[]` may name a scheme's employer share: `{ scheme: KESEHATAN, share: employer }` | S2      |
| ID      | PTKP for a married woman                                                                           | D     | `elections.ptkp`                                                                              | S4      |
| ID      | sick-pay scale                                                                                     | C     | `pay_fraction`                                                                                | S2      |
| ID      | KIA extensions                                                                                     | D     | BIRTH facts                                                                                   | S4      |
| ID      | cuti bersama offset                                                                                | F     | `consumes`                                                                                    | S5      |
| ID      | 75% overtime base                                                                                  | C     | `ordinary_divisor_days` reads `year.earned`, or a `proration` expression                      | S3      |
| ID      | art. 26(2) carve-out                                                                               | G     | `limits[].when`                                                                               | now     |
| ID      | THR                                                                                                | A     | SCHEDULE payment row (landed 2026-09-16, RFC 0005 §6.1)                                       | S1      |
| ID      | JP ceiling 2027                                                                                    | —     | future version                                                                                | seed    |

Cause-G rows are README corrections, not engine work: the notes were written against the band
selector RFC 0002 replaced.

## 7. Landing order

Each slice is a sealed step: the goldens stay cent-identical unless a lineage's seed adopts the
new primitive, and a lineage that adopts it gets a golden that states the law.

- **S1 — the year axis and scheduled payments** (landed 2026-09-16). `year.*` and
  `period.last_of_year` on the entry site; `catalogue_schedule`; `source` on payment rows;
  materialisation of occurrences and separation events, pinned by `payment_requests.schedule_key`;
  `base.entries[].annual_exempt`. Seeds: PH `THIRTEENTH_MONTH_PAY` is a SCHEDULE row (24
  December, `year.earned.BASIC / 12.0`, rank-and-file from one month of service, on separation)
  with the ₱90,000 exemption on the WTAX entry; the Philippine register's hand-keyed March "13
  month pay adjustment" rows and the KDIT `PPH21_BONUS_THR` rows go (PPH21 already prices
  `BONUS_THR` inside its base). Goldens: PH December, PH March leaver. Not in S1: `source` on
  allowance and claim rows, so ID THR stays the keyed `BONUS_THR` allowance until S2 gives the
  allowance row a schedule.
- **S2 — expressions for booleans, and the allowance schedule.** `source` on allowance and claim
  rows (ID `THR` becomes a SCHEDULE row seven days before the version's Idul Fitri, one month's
  wage from twelve months of service and pro rata before, Permenaker 6/2016). `pay_fraction`, `paid_by`, `base.salary: CONTRACTUAL`,
  `proration` expression, entitlement `days` expression, base entries by band label and by
  another scheme's employer share, `period.last_of_year` true-up rules. Seeds: PH/VN contractual
  bases, ID sick-pay scale, TW half pay, the three December true-ups.
- **S3 — the work day.** `day.rest_day`, `day.holiday.kind`, `night_hours`, night bands,
  `normal_hours`, `pay_basis`, Work EVENT rows. Seeds: PH compounded holidays and unworked
  holiday pay, VN night overtime by day type, MY daily-rated rest-day pay.
- **S4 — facts.** `since`, `elections`, employee pass and domicile, children facts, BIRTH event
  facts, `company_statutory_facts`.
- **S5 — windows and the employer.** entitlement windows, `consumes`, `assessed_on: COMPANY`.

## 8. What is deliberately not done

- No new rule vocabulary. Everything above is `when`/`amount` CEL over a richer context, or typed
  data the write validates. A residue that would need a new _operator_ is a sign the context is
  missing a member, not that CEL needs a feature.
- No per-country code. A SCHEDULE row is a SCHEDULE row in Manila and Jakarta; the version's
  numbers and dates make it the 13th month or the THR.
- Registers stay evidence. Where the customer's workbook keys a statutory payment by hand, the
  seed drops the keyed row once the SCHEDULE row produces the same figure, and the golden is the
  proof; the raw file is kept as the record of what was reconciled against.
