# Scheduling, attendance, overtime and leave

This is the consolidated product and architecture contract for the redesign. The controlling rule
is simple: store decisions and observations; derive summaries and classifications. If two values
can disagree, one of them should not be writable.

## Vocabulary and mental model

### Employment schedule (the work pattern in employment terms)

The employee has one effective-dated set of employment terms. Its `work_pattern` is the schedule
part of those same terms—not a separate record that can drift from them.

It has two variants:

1. **Repeating schedule** — the system can project the expected assignment on any date from an
   anchor, one or more phases, and each phase's roster-code cycle.
2. **Monthly roster** — the assignments cannot be predicted reliably, so HR supplies the month's
   roster. It can be “as assigned” or carry a contractual guarantee/cap that publication validates.

The repeating variant covers different populations without different schemas:

- Fixed office: `WORK × 5, OFF, REST`, repeating every seven days.
- Short rotating crew: any cycle such as `DAY, DAY, NIGHT, NIGHT, OFF, REST`.
- Long rotation: three calendar months of a DAY phase followed by three calendar months of a NIGHT
  phase, repeating from the anchor.
- Other fixed arrangements: a different roster-code sequence, not more boolean attributes.

The monthly-roster variant covers genuinely ad hoc populations such as part-time teachers whose
dates are only known when the month is planned.

### Roster code

A roster code says what one planned person-day means. Its variants are:

- `WORK`: start time, end time, unpaid break minutes.
- `REST`: protected statutory rest day.
- `OFF`: another non-working day.

`crosses_midnight` is derived from end ≤ start. Scheduled/paid minutes derive from start, end and
break. A public holiday is not a roster-code variant; it is overlaid from `company_holidays` only
when observed for that legal entity/employee scope.

### Monthly roster and roster entry

There is at most one roster per legal entity/month. A roster entry is an explicit person/date roster
code. It has two uses:

- For a repeating schedule it is an exception to the projected baseline (swap, call-back, special
  assignment).
- For a monthly-rostered schedule it is the assignment itself.

An absent entry means “use the repeating baseline” or “not yet assigned”, depending on the work
pattern variant. It never silently means REST. Publication validates every employee against their
effective terms.

## HR controller workflow

```text
Employee profile
┌──────────────────────────────────────────────────────────────────────────┐
│ Employment terms                                      Effective 1 Jul → │
│ Salary / classification / role / payroll group                         │
│                                                                          │
│ Employment schedule                                                     │
│ How is this person scheduled?  [ Repeating schedule ▾ ]                 │
│ Pattern begins                  [ 01 Jul 2026        ]                   │
│                                                                          │
│ Phase 1         Duration [ Continuous ▾ ]                               │
│ Day 1 [ OFFICE-9-5 · Work 09:00–17:00 ▾ ]                              │
│ Day 2 [ OFFICE-9-5 · Work 09:00–17:00 ▾ ]                              │
│ Day 3 [ OFFICE-9-5 · Work 09:00–17:00 ▾ ]                              │
│ Day 4 [ OFFICE-9-5 · Work 09:00–17:00 ▾ ]                              │
│ Day 5 [ OFFICE-9-5 · Work 09:00–17:00 ▾ ]                              │
│ Day 6 [ OFF · Off day ▾ ]                                               │
│ Day 7 [ REST · Protected rest ▾ ]                       [ + cycle day ] │
└──────────────────────────────────────────────────────────────────────────┘
```

For a long rotation:

```text
Employment schedule: Repeating schedule · begins 01 Jan 2026

Phase 1  [ 3 calendar months ]   cycle [ DAY ]
Phase 2  [ 3 calendar months ]   cycle [ NIGHT ]
                                               [ + phase ]
```

For ad hoc assignments:

```text
Employment schedule
How is this person scheduled?  [ Monthly roster ▾ ]
Contract expectation           [ As assigned ▾ ]
Reference period               [ Month ▾ ]
Maximum paid hours (optional)  [ 80 ]
```

HR then opens Scheduling:

```text
Scheduling · August 2026                     Entity [ Norbital SG ▾ ]
┌──────────────────────────────────────────────────────────────────────────┐
│ [ Month board ] [ Roster codes ] [ Holidays ]                          │
├──────────────────────────────────────────────────────────────────────────┤
│ ‹ Jul              August 2026              Sep ›       [ Import XLSX ] │
│ Draft · 1,204 projected · 38 explicit · 4 require approval             │
│                                                                          │
│ Person          01 Sat   02 Sun   03 Mon   04 Tue   …                   │
│ A. Office       OFF      REST     OFFICE   OFFICE                       │
│ B. Rotation     DAY      DAY      NIGHT    NIGHT                        │
│ C. Teacher      —        —        TEACH-4H —                            │
│ D. Called back  OFF      REST→DAY OFFICE   OFFICE  ⚠ approval          │
│                    PH is overlaid from observed holiday calendar         │
│                                                                          │
│ [ Validate month ]                                      [ Publish ]     │
└──────────────────────────────────────────────────────────────────────────┘
```

The contractual schedule itself stays with the employee: **People → Employee → Employments** shows
each employment and its effective-dated terms/work pattern in one aligned representation. Scheduling
is the operational month board; it does not duplicate a second organization-wide employment-terms
table.

HR can declare another OFF only as an explicit exception. They cannot silently change a five-day
contract: validation compares the final month (projected baseline plus exceptions) with the
employment schedule. A mismatch blocks publication or requires the appropriate terms change/
approval. For a monthly-rostered employee, the guarantee/cap is the validation contract.

If no roster is imported:

- Repeating schedules still project and operate normally; a monthly roster stores only exceptions.
- Monthly-rostered schedules remain visibly unassigned and cannot publish when their contractual
  expectation is unmet.

## One XLSX, one reconciliation flow

The current workbook can contain both planned roster data and actual attendance. Import has two
explicit stages even when it starts from one file:

```text
XLSX rows
   │
   ├─ planned assignment token ── resolve to WORK/REST/OFF roster code
   │                               blank = no explicit row
   │                               PH = validate calendar, store nothing
   │
   └─ actual punch columns ─────── normalize to worked_intervals[]
                                   merge overlapping source intervals
                                   never store source “OT hours” as OT

project employment schedules + explicit roster entries + observed holidays
   │
compare with actual worked intervals
   │
derive absence, exceptions, projected/actual OT and approval requirements
```

The source can call columns “OT in/out” for compatibility. At the boundary they are merely more
observed intervals. They do not retain an overtime meaning in the data model.

## Overtime layers

Overtime is never a roster kind, time-entry state or entered number.

1. **Plan:** derive the baseline day from terms and holiday scope.
2. **Schedule:** an explicit WORK assignment over REST/OFF/observed PH is projected extra work and
   starts approval before the person works.
3. **Observe:** attendance stores worked intervals only.
4. **Classify:** compare actual intervals with the effective schedule/day type.
5. **Price:** apply effective-dated statutory/contractual coverage, rate and limit rules.
6. **Approve/settle:** approval is workflow evidence; payroll remains reproducible from the plan,
   observation, policy and decision.

The pure scheduled-extra-work detector is implemented, but the current hook API cannot conditionally
open an approval from the joined schedule and holiday derivation. That remains a platform approval
capability gap. Until the capability exists, the template must not add a stored `requires_approval`
or overtime field, and it must not gate every roster edit as a substitute.

Whether somebody is legally/contractually covered is derived from policy plus effective employment
facts. It is not an `overtime_eligible` boolean on employment terms.

## Leave request UX

The leave overview treats an unresolved live query as loading, never as an authoritative empty
result. Its seasonality heat map uses the rolling five-year window through the current year, so the
latest seeded or live requests appear immediately instead of being pushed into an unlabelled future
bucket.

One request contains one contiguous range. The range endpoints are datetimes snapped to half-day
steps; they are not separate “from”, “to”, “first day”, “last day” and “days” fields. Chargeable
days are derived from the selected half-day slots after applying the employee's schedule, observed
holidays, existing requests and entitlement balance.

```text
New leave request
┌──────────────────────────────────────────────────────────────────────────┐
│ Person      [ NHPMY0359 · Aisha ▾ ]                                     │
│ Leave type  [ Annual leave ▾ ]             Balance  4.5 days            │
│                                                                          │
│ Range       [ 4 Jun 2026, AM → 11 Jun 2026, AM  ▾ ]                     │
│             ┌─────────────────────────────────────┐                     │
│             │ ‹ Jun 2026 ›                       │                     │
│             │ Mo Tu We Th Fr Sa Su               │                     │
│             │  1  2  3 [4][5] OFF REST           │                     │
│             │  8 PH [10][11] 12 OFF REST         │                     │
│             │ each date exposes AM · PM steps    │                     │
│             └─────────────────────────────────────┘                     │
│                                                                          │
│  Thu 4 Jun AM  →  Thu 11 Jun AM                                         │
│  Charges 4.5 days · 3 excluded automatically                            │
│  4.5 of 4.5 days remaining                                              │
│                                                                          │
│ Reason      [ Family matter                                    ]         │
│ Certificate [ Attach file ]                                             │
│                                                    [ Submit request ]    │
└──────────────────────────────────────────────────────────────────────────┘
```

Interaction contract:

- Pointer drag and keyboard selection use the same half-day slot model.
- The calendar opens in a compact date-range popover and uses the standard date-field trigger;
  AM/PM are the two selectable steps inside each day rather than a permanently expanded form.
- Unobserved holidays elsewhere do not disable a date; only applicable observed holidays do.
- REST/OFF/holiday slots remain visible with the reason they are excluded.
- The picker stops selection at the remaining entitlement and explains the boundary.
- Existing approved/pending leave and overlapping requests are unavailable.
- Server validation repeats every rule at submission time; the UI is guidance, not authority.
- One request is one range. Separate non-contiguous absences are separate requests, keeping approval,
  cancellation and audit behavior understandable.

## Stored versus derived

| Store                                          | Derive                                                    |
| ---------------------------------------------- | --------------------------------------------------------- |
| Employment terms with polymorphic work pattern | Weekly hours/days for repeating schedules                 |
| WORK/REST/OFF roster-code variant              | Crosses midnight, scheduled/paid minutes                  |
| Explicit monthly person/date/code assignment   | Projected baseline and final day type                     |
| Entity holiday and scope                       | Whether PH applies to this person/date                    |
| Worked intervals and break observation         | Open/closed state, lateness, overtime duration/type/value |
| Leave half-day range and workflow decision     | Chargeable days, exclusions and remaining balance         |
| Effective-dated statutory/contractual policy   | Overtime coverage and rates                               |
