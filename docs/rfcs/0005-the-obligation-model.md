# RFC 0005 — The obligation model: what the law owes, in one shape

Status: proposed, 2026-09-16. Supersedes the slice plan of RFC 0004 §7 from slice 2 on.

## 0. Why gaps keep appearing

RFC 0004 inventoried 96 residues and closed 4 of them. Slices 2–5 would close the rest one
primitive at a time, and the next vetting would find more, because the residues are symptoms of
five decisions taken before any RFC:

1. **The catalogue was transcribed from the customers' spreadsheets.** Whatever a workbook keyed
   by hand became a keyed entry; whatever it computed outside payroll got no row. The register was
   the specification, so the law's own triggers (a date, a separation, a birth) had nowhere to live.
2. **The expression context grew one member at a time.** CEL can express any arithmetic; it cannot
   read a fact the context does not carry. Most residues are missing context members (a year
   axis, an election, a company fact, a window), not missing operators.
3. **Six money families are six shapes.** Claim, allowance, payment, leave, loan and contribution
   each grew from a UI family with its own row, hooks and read path. Slice 1 could give a payment
   row a schedule and not an allowance row. The law does not care which family a bonus is filed
   under.
4. **Verification compared the engine to the same spreadsheets.** The host audit checks the
   register's own law checks; the goldens covered contribution schemes only; the fixtures did not
   carry a payment catalogue. What the spreadsheet also lacked stayed invisible and green.
5. **The gap list was hand-written.** Every NOT APPLIED list is what a vetting pass noticed. It
   cannot contain what nobody noticed. Termination pay, the largest single payment the law owes,
   appears in no lineage's list.

This RFC does the opposite: §1 enumerates what the statutes owe by category, whatever the
spreadsheets did; §2 states the one shape every obligation takes; §3 declares the complete context
up front; §4 maps each family onto the shape; §5 says where every hand-keyed register row goes.

## 1. What the law owes, by category

Status per cell: **M** modelled and seeded · **K** keyed by hand today · **A** absent from the
model · **S** seeded as a SCHEDULE row · — the jurisdiction has no such obligation.

### 1.1 Wages and time

| Obligation                                             | MY  | SG  | PH  | ID  | VN  | TW  |
| ------------------------------------------------------ | --- | --- | --- | --- | --- | --- |
| Basic wage, proration, minimum-wage floor and coverage | M   | M   | M   | M   | M   | M   |
| Overtime ladders, rest-day and holiday work            | M   | M   | M   | M   | M   | M   |
| Night premium                                          | M   | —   | M   | —   | M   | —   |
| Compounded day types (holiday on a rest day)           | —   | —   | A   | M   | A   | —   |
| Pay for an unworked regular holiday                    | M   | M   | A   | —   | —   | —   |
| Daily-rated rest-day pay, `pay_basis`                  | A   | —   | A   | —   | —   | —   |
| Hours ceilings, breaks, weekly rest                    | M   | M   | M   | M   | M   | M   |

### 1.2 Payments the law owes on its own calendar

| Obligation                                                                                                           | Trigger                             | Status | Family       |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------ | ------------ |
| PH 13th month pay (P.D. 851)                                                                                         | 24 Dec, separation                  | S      | PAYMENT      |
| ID THR (Permenaker 6/2016): one month's wage after 12 months, pro rata from 1 month; wage = basic + fixed allowances | 7 days before the religious holiday | S      | PAYMENT      |
| SG AWS, TW year-end bonus, VN Tết bonus                                                                              | contractual, not statutory          | —      | —            |
| TW NHI supplementary premium on bonuses over 4× the insured salary (健保法 §31)                                      | each bonus payment                  | A      | CONTRIBUTION |

### 1.3 Payments the law owes on separation

Every jurisdiction but Singapore owes money on the day an employment ends, and none of it is in
any residue list. All of it is keyed by hand today, or would be.

| Obligation                                                                                                        | Depends on                                              | Status |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------ |
| MY Termination and Lay-Off Benefits Regs 1980: 10 / 15 / 20 days' wages per year of service                       | exit reason, service years, EA coverage                 | K      |
| PH separation pay (Labor Code art. 298–299): ½ or 1 month per year of service by cause                            | exit reason, service years                              | K      |
| PH retirement pay (RA 7641): 22.5 days per year at 60–65 after 5 years' service                                   | age, service years, exit reason                         | K      |
| ID pesangon, UPMK, UPH (PP 35/2021 art. 40–59): multipliers by exit reason and service years                      | exit reason, service years, wage incl. fixed allowances | K      |
| VN severance (Labour Code art. 46) and job-loss allowance (art. 47): ½ / 1 month per year net of UI-insured years | exit reason, service years, SI/UI since                 | K      |
| TW severance (勞退條例 §12, LSA §17): ½ month per year, cap 6 months                                              | exit reason, service years, scheme (old/new)            | K      |
| Leave commutation at exit: PH SIL (art. 95), VN (art. 113(3)), TW (LSA §38(4)), MY (s.60E(3))                     | leave balance on the exit date                          | K      |
| Notice pay in lieu (every jurisdiction)                                                                           | exit reason, notice period from terms                   | K      |
| Final pay timing (PH DOLE LA 06-20: 30 days; ID; VN 14 days)                                                      | exit date                                               | A      |

### 1.4 Leave

| Obligation                                                                                                                                     | Status | Missing member                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------- |
| Entitlement by service, eligibility, accrual, proration                                                                                        | M      |                                                   |
| Pay fraction (TW half-pay sick, ID 100/75/50/25 sick scale, VN)                                                                                | A      | `pay_fraction` expression on the row              |
| Paid by a fund and advanced by the employer (VN SI sick/maternity, PH SSS maternity and sickness, SG government-paid leave, TW 勞保 maternity) | A      | `paid_by: FUND`, employer reimbursement line      |
| Per-event windows (VN art. 115, PH paternity per delivery, SG per child)                                                                       | A      | `PER_EVENT` on the entitlement, keyed to an event |
| Lifetime caps (MY 5 confinements, PH 4 deliveries, SG 42 days per child)                                                                       | A      | `LIFETIME` keyed to an event fact                 |
| Rolling windows (TW 2-in-1 hospitalisation, PH RA 9710 12 months)                                                                              | A      | `ROLLING_MONTHS`                                  |
| One quota consuming another (TW 家庭照顧假 in 事假, ID cuti bersama, SG outpatient in hospitalisation)                                         | A      | `consumes`                                        |
| Birth, miscarriage, adoption, bereavement variants                                                                                             | A      | employee events with attributes                   |

### 1.5 Contributions and levies

| Obligation                                                                                                                                                | Status | Missing member                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| Employee/employer schemes on a declared base, ladders, reliefs                                                                                            | M      |                                                                |
| Annual ceilings across the year (SG AW ceiling)                                                                                                           | A      | `year.earned` on the scheme site (S1 gave the entry site only) |
| Registration since (MY SOCSO first entry ≥ 55, EIS 57, VN sick by insurance years)                                                                        | A      | `facts.<code>.since`                                           |
| Elections (MY zakat, disabled reliefs; TW voluntary 勞退, withholding table; SG SHG opt-out, SPR full rate; ID PTKP for a married woman; VN union member) | A      | typed elections per version                                    |
| Company-level facts (VN 0.3% low-risk rate, ID DTP sector, TW 54-hour consent, PH < 10 employees)                                                         | A      | `company.facts`                                                |
| Levies on the establishment, not the employment (VN union fee on the fund, TW 積欠工資墊償基金)                                                           | A      | `assessed_on: COMPANY`                                         |
| Employer premiums as taxable income (ID JKK/JKM/Kesehatan into PPh 21)                                                                                    | A      | base entry naming another scheme's employer share              |

### 1.6 Tax

| Obligation                                                                       | Status | Notes                                                                                                |
| -------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| Monthly withholding ladders and reliefs                                          | M      |                                                                                                      |
| Year-end true-up (PH RR 11-2018 s.16, ID PMK 168/2023 December, VN finalisation) | K      | opsph keys `PRIOR_YEAR_TAX_DUE` / `PRIOR_YEAR_TAX_REFUND`; KDIT keys `PPH21_PRIOR_PERIOD_ADJUSTMENT` |
| Authority-directed instalments (MY CP38)                                         | K      | correctly keyed: an order from the authority is an entry                                             |
| Prior-period statutory corrections (opsph `STATUTORY_ADJUSTMENT`)                | K      | correctly keyed: a correction is evidence                                                            |
| Annual exemptions inside a base (PH ₱90,000, de minimis)                         | M      | `annual_exempt`, expression form pending                                                             |

### 1.7 Facts the obligations above read and the model does not hold

| Fact                                                                                                        | Read by                                                          |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Exit reason (resignation, dismissal for cause, redundancy, retirement, end of contract, death, mutual)      | every separation payment, notice pay                             |
| Fixed allowances in force (`terms.fixed_allowances`)                                                        | ID THR and pesangon, VN and ID overtime bases, TW insured salary |
| Registration since date per scheme                                                                          | MY SOCSO/EIS age limbs, VN sick leave                            |
| Elections per scheme (typed per version)                                                                    | §1.5                                                             |
| Company facts (sector, consent, headcount test population)                                                  | §1.5                                                             |
| Employee events: birth (with citizenship), miscarriage, adoption, marriage, death of a relative, with dates | §1.4 windows and variants                                        |
| Pass type, disability, union membership, retirement / re-employment                                         | SG SINDA, VN disabled worker and union dues, SG retirement ages  |

## 2. One shape

An obligation is:

```
source        ENTRY | SCHEDULE | EVENT | DERIVED
              ENTRY:    a person keys the occurrence (a claim, an order from the authority)
              SCHEDULE: the version's calendar raises it (every YEAR|MONTH, month, day)
              EVENT:    a fact raises it (SEPARATION, HIRE, BIRTH, ...), keyed to the event row
              DERIVED:  the engine measures it from another family (work, leave)
eligibility   person predicate, evaluated on the occurrence date
bands         [{ when, amount, limit }] over the entry site; amount reads person, entry, year, rates
base          for a scheme: what lines it charges, with annual exemptions and `when` per entry
paid_by       EMPLOYER | FUND   (a fund-paid line is advanced and reimbursed, never gross)
assessed_on   EMPLOYMENT | COMPANY   (a levy on the establishment charges once per run)
destination   PAY | NET | EMPLOYER | DISPLAY, and direction
window        for entitlements: CALENDAR_YEAR | MONTH | LIFETIME | PER_EVENT | ROLLING_MONTHS
```

Nothing in it is new vocabulary: `source`, `schedule`, `bands`, `base`, `eligibility`,
`destination` and the entitlement windows already exist on one family or another. The change is
that every family carries the same members, so a primitive landed for one is landed for all.

## 3. The context, declared once

The entry, person, scheme and work-day sites keep their members. These are added, all at once,
because every obligation in §1 reads one of them:

| Member                                                                       | Source of truth                                                                              |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `employment.exit_reason`, `employment.exit_date`, `employment.service_years` | `employments.exit_reason` (new enum), effective range                                        |
| `terms.fixed_allowances`, `terms.monthly_wage`                               | standing PAY allowances in force on the date + basic                                         |
| `facts.<scheme>.registered`, `.since_months`, `.elections.<key>`             | `employment_statutory_facts.status` gains typed `elections`, `since`                         |
| `company.facts.<key>`, `company.headcount`                                   | `companies.facts` (typed per version), the run's headcount                                   |
| `event.kind`, `event.date`, `event.<attribute>`                              | `employee_events` (new): BIRTH, MISCARRIAGE, ADOPTION, MARRIAGE, BEREAVEMENT with attributes |
| `year.*` on the scheme site                                                  | S1's year axis, one call site wider                                                          |
| `period.last_of_year` on the scheme site                                     | for the year-end true-up rules                                                               |
| `leave.balance(code)` on the entry site                                      | commutation at exit                                                                          |

Each version declares the election and company-fact keys it reads (`jurisdiction_settings.facts`),
so a write of an unknown key is refused and the UI can render the right form per jurisdiction.

## 4. Family by family

| Family       | Today                          | Under the shape                                                                                                           |
| ------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| PAYMENT      | ENTRY \| SCHEDULE              | + EVENT (SEPARATION): termination pay, retirement pay, notice pay, commutation                                            |
| ALLOWANCE    | ENTRY with recurrence          | + SCHEDULE (a standing row raised by the version, not keyed per person)                                                   |
| CLAIM        | ENTRY                          | unchanged; a claim is a person's evidence by definition                                                                   |
| LEAVE        | entitlement, `paid` boolean    | `pay_fraction`, `paid_by`, windows per event / lifetime / rolling, `consumes`                                             |
| LOAN         | ENTRY (agreed)                 | unchanged                                                                                                                 |
| CONTRIBUTION | base + rules on the employment | `assessed_on: COMPANY`, base entries by band label and by another scheme's share, `year.*` and `last_of_year` on the site |

## 5. Every hand-keyed register row, and where it goes

| Register row                                              | Count | Verdict                                                                                                                                                                |
| --------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KDIT `BONUS_THR` allowance                                | 14    | PAYMENT SCHEDULE row `THR`; 11 of 14 match `monthly_wage × min(1, service_months/12)` to the rupiah, 2 need `fixed_allowances`, 1 the workbook rounded a part month up |
| KDIT `HOUSE_ALLOWANCE`, `CAR_ALLOWANCE` monthly one-offs  | 12    | standing RECURRING allowance rows; they are the fixed allowances THR and pesangon read                                                                                 |
| KDIT `PPH21_PRIOR_PERIOD_ADJUSTMENT`                      | 13    | the December true-up rule once landed; until then evidence                                                                                                             |
| KDIT `PPH21_PRIOR_PERIOD_REFUND`, `COMPENSATION`          | 6     | evidence (a refund and a settlement are entries)                                                                                                                       |
| opsph `PRIOR_YEAR_TAX_DUE` / `PRIOR_YEAR_TAX_REFUND`      | 10    | the RR 11-2018 s.16 annualisation rule once landed; until then evidence                                                                                                |
| opsph `STATUTORY_ADJUSTMENT`, `BACKPAY_*`                 | 9     | evidence (corrections and back pay are entries)                                                                                                                        |
| opsph `meal`, `transport`, `communication`, `leader`, ... | 383   | standing allowance rows keyed per period; RECURRING rows, one per employment                                                                                           |
| nihon `CP38`                                              | 2     | evidence (an authority's order)                                                                                                                                        |
| nihon `MEDICAL_CLAIM*`                                    | 88    | claims; correct                                                                                                                                                        |

## 6. Landing order

Each step is small because the shape already exists somewhere; each is a data-model change with a
golden that states the law, never a per-country branch.

1. **Separation** (landed 2026-09-16): `employments.exit_reason`; `catalogue_schedule.every`
   gains `SEPARATION`; `employment.exit_reason`, `service_years`, `terms.fixed_allowances` on the
   person site; ID `THR` as a PAYMENT SCHEDULE row and the KDIT rows converted; goldens for THR.
2. **Separation payments seeded** per lineage from §1.3, each a PAYMENT row with `every: SEPARATION`
   and bands over `employment.exit_reason` and `service_years`; leave commutation reads
   `leave.balance`.
3. **Year-end true-ups**: `period.last_of_year` and `year.*` on the scheme site; PH annualisation
   and ID December rules as ladders; the opsph and KDIT prior-year rows retired.
4. **Facts**: `elections` and `since` on the statutory fact, `companies.facts`, `employee_events`;
   the version declares its keys; MY/TW/SG/ID election residues seeded.
5. **Leave**: `pay_fraction`, `paid_by`, windows keyed to events, `consumes`.
6. **Work day**: compounded day types, unworked holiday pay, `pay_basis`.

## 7. What is deliberately not done

- No merging of the six tables. The shape is shared datatypes and context, not one table; the
  UI families stay.
- No new operators. Every rule is `when`/`amount` CEL over the declared context.
- Registers stay evidence. A keyed row is retired only when a catalogue row reproduces it and a
  golden proves the law, as the THR comparison above does.
