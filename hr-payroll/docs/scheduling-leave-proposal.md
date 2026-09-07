# Scheduling, attendance, overtime and leave

This is the consolidated product and architecture contract for the redesign. The controlling rule
is simple: store decisions and observations; derive summaries and classifications. If two values
can disagree, one of them should not be writable.

## Vocabulary and mental model

### The three layers: base, override, time entries

Every employment has a **base**: the days its named shift pattern projects. A **work day row is an
override** of one date: its planned side is a rostered code (what a swap moves, and what must still
conform to the pattern over the month) and its actual side is the **time entries**. Payroll uses
the row when it exists, and an empty interval list on a WORK day is an absence; a day with no row is
the base taken as worked to plan, with no overtime. The board, the employee's calendar and the day
sheet all say which layer a mark belongs to ("Base from pattern AM-2x2", "Rostered override,
imported", "Clocked 08:31 to 17:02").

### Shift pattern (the named base the terms point at)

The employee has one effective-dated set of employment terms. Its `shift_pattern_id` points at one
of the company's named `shift_patterns` rows, so the same "2 on 2 off" is one row with a code, not a
value repeated on every contract that follows it. Terms that point at no pattern are rostered as
assigned: nothing is projected and nothing is guaranteed.

A pattern has two variants:

1. **Repeating schedule** (`PATTERNED`) - the system can project the expected assignment on any
   date from an anchor, one or more phases, and each phase's roster-code cycle.
2. **Rostered expectation** (`ROSTERED`) - the assignments cannot be predicted reliably, so HR
   supplies the month's rows. The row names the contractual guarantee or cap payroll validates,
   for a company that wants that expectation named.

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

An absent entry means "use the base the pattern projects" or "not yet assigned", depending on the
pattern variant. It never silently means REST. Every plan write is validated against the
employment's pattern for the month.

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

The named patterns live on Scheduling's **Shift patterns** tab beside Roster codes and Holidays.
The contractual schedule itself stays with the employee: **People → Employee → Employments** shows
each employment and its effective-dated terms with the pattern it points at, in one aligned
representation. Scheduling is the operational month board; it does not duplicate a second
organization-wide employment-terms table.

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

The complete implemented leave contract is in [`leave.md`](leave.md). This section records the
picker interaction that belongs to the wider scheduling design.

One request contains one contiguous range. Each endpoint is a calendar date plus a `FIRST` or
`SECOND` shift half; the halves are not necessarily AM and PM. They are not separate “from”, “to”,
“first day”, “last day” and writable “days” fields. The server derives chargeable days from the
selected half-day slots after applying the employee's schedule and observed holidays, then checks
overlap, paid payroll windows and the projected balance.

```text
New leave request
┌──────────────────────────────────────────────────────────────────────────┐
│ Person      [ PUBEM0359 · Aisha ▾ ]                                     │
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
- Submission starts exactly one approval stage. The platform temporarily holds that pending request
  until any one configured approver accepts it; this is storage for the same approval, not another
  approval layer. The hold reserves range and balance immediately. Approval commits the
  `leave_requests` row and its `TAKEN` ledger entry; rejection or withdrawal releases the hold.
- The leave type's `eligibility` rules are checked for each selected workday against the terms
  effective on that day. All rules must match. `requires_certificate_after_days` requires a
  certificate when server-measured workdays exceed the threshold. Only time-off events accept it.

## Stored versus derived

| Store                                        | Derive                                                    |
| -------------------------------------------- | --------------------------------------------------------- |
| Named shift pattern, and the terms' pointer  | Weekly hours/days for repeating schedules                 |
| WORK/REST/OFF roster-code variant            | Crosses midnight, scheduled/paid minutes                  |
| Explicit monthly person/date/code assignment | Projected baseline and final day type                     |
| Entity holiday and scope                     | Whether PH applies to this person/date                    |
| Worked intervals and break observation       | Open/closed state, lateness, overtime duration/type/value |
| Leave half-day range and workflow decision   | Chargeable days, exclusions and remaining balance         |
| Effective-dated statutory/contractual policy | Overtime coverage and rates                               |

## Attendance kiosk

A face-recognition time clock for a shop-floor tablet, built into this workspace as the
`hr_controller/kiosk` app. It writes the same `work_days.worked_intervals` the board writes, so
everything downstream (day classification, overtime, payroll) treats kiosk punches exactly like
board punches.

**Setup.** Create one user row per device and put it on the `Attendance Kiosk` team. That team
holds only the `kiosk` policy: the kiosk app and nothing else, interval-only day writes, masked
person reads, face-field-only person writes, and restricted creation. The app declares
`<meta name="bolt:kiosk">`, so the shell renders it chromeless — no sidebar, finder, agent or
banner. Sign in once on the tablet; the session persists. The page needs HTTPS (camera) and
network (matching and punches are server calls; there is no offline queue).

**Punch.** A punch toggles the day's last interval: the first face of the day opens it, the next
closes it. Manual entry takes an explicit in/out. Guards, all server-side in `kiosk_punch`: a
10 s per-person cooldown, duplicate-orientation refusal for manual entry, and the standard day
guards (leave-owned days, paid windows, captured rows) running as the device account — the kiosk
policy carries the masked reads those hooks need (`leave_requests`, `payroll_runs`,
`payslip_work_day_inputs`), and nothing they do not need. Kiosk writes carry no approval flow;
HR-side attendance edits keep their reviewed grants.

**Enrollment.** Face data inlines on `employees`: a 1024-d cosine descriptor (`face_embedding`,
HNSW-indexed), a snapshot (`face_photo`), and `face_enrollment_status`. Enrollment opens from the
employee profile (Face ID tab), never from the wall kiosk, as a guided five-pose flow
(`src/collections/employees/face-enroll-flow.svelte` over `src/lib/kiosk/guided-capture.ts`):
straight, left, right, up, down, each captured automatically once held ~600 ms inside its window
with a readable descriptor, then averaged into one vector. Every enrollment writes through
the `kiosk_enroll` command, which approves a known person at once and refuses a pending or
suspended enrollment HR has not reviewed; consent is recorded in both cases. HR approves in
People (the face-status column), which alone may set `APPROVED` or `SUSPENDED`.

**Matching and spoofing.** `kiosk_match` runs `findNearest` on the embedding column (cosine,
default max distance 0.4) over `APPROVED` rows and returns the current in-force employment.
Recognition runs in the tablet browser (`@vladmandic/human`: blazeface detector, faceres
descriptor; WebGL with WASM fallback; ~60–100 ms warm, one ~7 s cold load per device). Model
weights are emitted by Vite from the pinned Human package into the immutable browser artifact at
`models/human/`, beside the `assets/` chunks, and the kiosk resolves that directory from its own
chunk URL (a hosted release is served only under a versioned static root). No CDN or install
script is required. A punch additionally requires the antispoof `real` floor and a
blink-to-confirm inside a 2 s window; a still photo cannot blink. A video replay on a second
phone can — randomized look/blink challenges and cooldowns mitigate it; only depth hardware
closes it. Thresholds live in `src/lib/kiosk/config.ts` and were bench-measured (see
`kiosk-probe`); recalibrate `KIOSK_REAL_MIN` against live captures on the device.

**Voice.** Everything the kiosk says is one list (`src/lib/kiosk/phrases.ts`, en + zh), one clip
per key per language under `assets/kiosk-voice/` (MP3, Edge neural voices, female, +15%; see
`SOURCE.md`), shipped beside the models by the `kiosk-voice-clips` Vite plugin and played one at a
time through a queue (`src/lib/kiosk/voice.ts`). No browser or system voice exists: a key without
a clip is silent at run time and a build error. The camera guide is a measured
silhouette: a head ellipse at 58% of the frame height with shoulders off the bottom edge
(`src/lib/kiosk/silhouette.ts`).
