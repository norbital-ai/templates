# Attendance on the month board

A proposal, not yet a contract. It answers five questions the owner raised about the Scheduling
board, and each answer is written against what the template already does — three of the five are
smaller than they look, because the mechanism already exists and is either mis-wired or unreachable
from the board.

Read `docs/architecture.md` §"Time, overtime and cutoffs" and §"Run snapshot and locking" first;
this document only records what changes.

---

## 0. Summary of the five answers

| # | Question | Answer in one line |
|---|----------|--------------------|
| 1 | Fold time entries into the month board | The facts are already there. What is missing is a **day sheet** to edit them and three fields on the board's query. |
| 2 | Attendance managed solely here | Yes — but `+time_attendance.svelte` keeps its table as the exception queue and analytics surface. The board is where a day is *changed*. |
| 2.1 | Show what is locked | A four-rung **lock ladder** drawn on a channel of its own, because a cell already carries plan and actual and cannot spend either on lock state. |
| 2.2 | Consumption locks; a passed date does not | The stored `payroll_settlements` claim is already exactly this. `DATE_PASSED` and the window inference are **over-applied** and must be pulled back — see §2. |
| 2.3 | Locked / manage entries / swap | One day sheet, one swap gesture, one amendment path for a published month. |
| 2.4 | Break minutes owed after long hours | A `rest_break_rules` member returns to `statutory_regime`. The primary text is already transcribed in `seed_bank/norbital_hr/statutory/rest_break_rules.json`; it was removed for having no consumer, and this proposal is the consumer. |
| 2.5 | Upload a month of attendance | Already built (`expandTimeMonthGrid`), only reachable from the wrong screen. Move it onto the board beside the roster import. |
| 3 | Retire the raw tables | One fact table, two renderers: the controller's people×days board and the employee's single-person calendar. Both raw `time_entries` tables go — see §8. |
| 4 | Employee self-service calendar | Roster **and** punches on one month view. Every read it needs is already granted; the one write it offers (report a missing punch) already exists as an approval-gated create. |

---

## 1. One board, two layers, one day sheet

`buildRosterMonth` already joins six sources into one `DayFacts` per person-day, and attendance is
among them: `clockedIn`, `workedIntervalCount`, `attendanceState`. The board *renders* attendance
today — `actualMark(day)` is the small glyph under the shift code. What it cannot do is change it.

```text
                         WHAT A CELL ALREADY KNOWS                 WHAT IT CANNOT DO YET
   ┌──────────────────────────────────────────────┐          ┌──────────────────────────────┐
   │ roster_entries ──┐                           │          │ • edit punches               │
   │ work_pattern   ──┼─► designation, shiftCode  │          │ • edit break minutes         │
   │ shift_defs     ──┘   shiftStart/End/Break    │          │ • swap two assignments       │
   │                                              │          │ • say WHY it is read-only    │
   │ time_entries   ──► clockedIn, attendanceState│          └──────────────────────────────┘
   │ leave_requests ──► leaveCode, pendingLeave   │
   │ company_holidays ► holidayName               │
   │ payroll_runs   ──► lock: DayLock             │
   └──────────────────────────────────────────────┘
```

### 1.1 Cell anatomy

Three horizontal bands in a 36px cell. Plan on top, actual below, lock as a left rail — a rail
rather than a fill, because a fill is already spent on `STATUS_PRESENTATION` and a holiday overlay
already tints the cell background.

```text
        unlocked            in a draft run        consumed by a run       paid & permanent
      ┌───────────┐         ┌───────────┐         ┌───────────┐         ┌───────────┐
      │  A        │         │▍ A        │         │▓ A     🔒 │         │█ A     🔒 │
      │  08:16-17 │         │▍ 08:16-17 │         │▓ 08:16-17 │         │█ 08:16-17 │
      └───────────┘         └───────────┘         └───────────┘         └───────────┘
        no rail             thin brand rail        solid rail +          heavy rail +
                            (advisory)             padlock               padlock
         ▲   ▲
         │   └─ actual band: punches, or the absence mark (`!`), or `OT`
         └───── plan band: roster code glyph; `PH`/leave codes overlay it
```

The rail is one channel with four values and nothing else uses it, so "why can't I click this" has
exactly one place to look. Hover gives the sentence; `sourceLockReason` already composes it.

### 1.2 The day sheet

Clicking an unlocked cell opens a right-hand drawer, not the current single-select dialog. A dialog
is the wrong container once the cell owns two records and a lock explanation.

```text
   ┌─ 04 Aug 2026 · NHPMY0005 TAUFIK BIN MOHAMAD ──────────────────────────┐
   │                                                                        │
   │  PLAN                                                    [ Swap ⇄ ]    │
   │  Roster code   [ A · 08:00–17:00 · 60m break        ▾ ]                │
   │  Source        pattern baseline (no explicit entry)                    │
   │  Note          ______________________________________                  │
   │                                                                        │
   │  ── overlap check: none · leave: none · holiday: none ──               │
   │                                                                        │
   │  ACTUAL                                                                │
   │  ┌ interval 1   [08:16] → [12:30]                            [×] ┐    │
   │  │ interval 2   [13:00] → [17:10]                            [×] │    │
   │  └ + add interval                                                ┘    │
   │  Unpaid break  [ 60 ] minutes                                          │
   │                                                                        │
   │  Worked 8.4 h · scheduled 8.0 h · beyond schedule 0.4 h                │
   │  ⚠ Rest break: 30 min owed after 5 consecutive hours (EA s.60A(1)(a)); │
   │     the 12:30→13:00 gap satisfies it.                                  │
   │                                                                        │
   │  LOCK                                                                  │
   │  Open. Payroll 2026-08 is a draft and has not taken this day yet.      │
   │                                                                        │
   │                                        [ Cancel ]   [ Save changes ]   │
   └────────────────────────────────────────────────────────────────────────┘
```

Overtime is **not** an input anywhere on this sheet, and there is no overtime field to add. The
"beyond schedule" line is derived and read-only, for the same reason `overtime_authorized` and the
five `approved_ot_*_hours` buckets were dropped in `drop_time_entry_overtime_approval`.

### 1.3 What has to change to get there

- `timeEntriesQuery` in `+scheduling.svelte` selects four columns; it needs `break_minutes` and
  `norbital_id` too, and `DayFacts` needs `timeEntryId`, `breakMinutes` and `workedMinutes`.
- `roster-month-board.svelte` gains a lock rail and routes `onSelectDay` to the drawer.
- A new `src/lib/ui/roster/day-sheet.svelte` owns both editors; both writes go through
  `client.db.roster_entries` and `client.db.time_entries` so every hook still runs.

---

## 2. The lock model — what is right, and what is over-applied

This is the part with real defects, and the design the owner described is already 80% built.

### 2.1 Three locks exist; only one of them is a fact

```text
   payroll_settlements row            ← STORED FACT
   "run 2026-08 consumed time_entries/abc123"
        released only by deleting the run; a PAID run is never deleted
              │
              ▼
   sourceLock() ─────────────► SETTLED_BY_RUN   ✅ this is the owner's rule, exactly

   payroll_runs window arithmetic     ← INFERENCE
   "this DAY falls inside a PAID run's attendance_from…attendance_to"
        answers a question about days, not records
              │
              ▼
   sourceLock() ─────────────► SETTLED         ⚠️ correct for creates, wrong for updates

   today's date                       ← NOT A LOCK AT ALL
   "work_date < today"
              │
              ▼
   sourceLock() ─────────────► DATE_PASSED     ❌ delete from the attendance path
```

`payroll_settlements/+model.ts` already argues this case in its own doc comment: window arithmetic
"was wrong in both directions", and it names the second direction precisely — a record merely
*dated* inside a paid window was frozen "even when no payslip had ever consumed it, which froze
arrears entries the run had deliberately pushed into the next period." The stored claim was added
to fix that. It was added, and the inference was left switched on beside it.

### 2.2 The three places to change

| Site | Today | Change |
|------|-------|--------|
| `roster-month-board.svelte:cellEditable` | `&& day.past !== true` | Delete the clause. A past day is the *normal* day to be editing attendance on. |
| `+time_attendance.svelte:attendanceRowLock` | passes `today`, so every historical row renders frozen | Stop asking for `DATE_PASSED` on attendance. |
| `time_entries/+hooks.ts` update & delete | `assertAttendanceSourceUnlocked` (claim **+** window **+** date) then `assertDayNotSettled` (window again) | Claim decides for an existing record. Window decides only for a create. |

The rule in one line:

```text
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  A RECORD is governed by the claim held over it.                             │
   │  A DAY WITH NO RECORD is governed by the window, because there is no claim   │
   │  to ask — and a paid run has already priced that day's silence as absence.   │
   └──────────────────────────────────────────────────────────────────────────────┘
```

Write-path decision, in order:

```text
   write attendance for (employment, date)
        │
        ├─ approval pending on the row?  ──────────────► platform 409, untouched
        │
        ├─ payroll_settlements claim on this record?
        │     ├─ run is DRAFT  ─► refuse: "delete run 2026-08 to release it"
        │     └─ run is PAID   ─► refuse: "correct with an adjustment entry"
        │
        ├─ creating a NEW record, and the day sits in a PAID window?
        │                       ─► refuse: that day's absence is already priced
        │
        ├─ approved leave owns the whole day?  ─────────► refuse (unchanged)
        │
        └─ otherwise ───────────────────────────────────► WRITE, whatever the date
```

### 2.3 The one open decision

An existing, **unconsumed** record whose date falls inside a paid window — a punch keyed in after
the run was paid. Under the rule above it stays editable and settles as arrears in the next run.
That is what `payroll_settlements`' own reasoning implies, and it is the recommendation. It does
mean the board will show an editable cell inside a period the operator thinks of as "closed", so
the rail draws it as **in a paid period** with the arrears sentence on hover rather than as open.

### 2.4 Publication is a third axis, and it should not lock a swap

`roster_entries/+hooks.ts` refuses every write in a published month. That is right for the plan of
record and wrong for operations: a swap on the 12th of a published month is the ordinary case, and
"re-open the whole month" is not a proportionate answer — re-opening also un-freezes the other 300
people's days.

Proposal: keep the freeze for **bulk** paths (import, pattern re-projection) and open a narrow
amendment path for single-cell writes in a published month.

```text
   roster_entries.origin :  IMPORT │ MANUAL │ AMENDMENT   ← new arm

   published month + single write + non-empty note  ──►  origin = AMENDMENT, allowed
   published month + import/bulk                    ──►  refused, as today
   any month + payroll claim on the day             ──►  refused, as today
```

`AMENDMENT` rows draw a corner tick on the board and are filterable, so "what changed after we
published" is one filter rather than an audit query. The alternative — keep the hard freeze and
make re-open the only path — is simpler and is the fallback if the amendment arm proves contentious.

---

## 3. Swapping an assignment

Two cells, one gesture, one transaction. Drag a cell onto another cell in the same row (a
date-for-date swap) or the same column (a person-for-person swap).

```text
                     M 10      T 11      W 12                        M 10      T 11      W 12
   NHPMY0005      │   A    │   REST  │    A    │                  │   A    │    A    │  REST  │
   NHPMY0008      │  REST  │    A    │    A    │       ───►       │  REST  │    A    │   A    │
                        └──── drag ───┘                                    swapped, one note
                                                                           on both rows

   NHPMY0005      │   A    │   REST  │    A    │                  │   A    │   REST  │    A   │
   NHPMY0008      │  REST  │    A    │    A    │       ───►       │   A    │  REST   │    A   │
                     └─ drag ─┘  (same column)                        person-for-person
```

Rules, all of them already-existing checks re-used rather than new ones:

1. **Both cells unlocked**, by §2's ladder. A swap that touches one consumed day is refused whole.
2. **`overlappingWorkShifts`** runs over both people's ±1 day windows, exactly as
   `assignmentOverlap` does now for a single cell.
3. **`assertDayNotOwnedByLeave`** runs on both, so a swap cannot drop work onto approved leave.
4. Both writes carry the same `note` and, in a published month, `origin = AMENDMENT`.
5. `validateRosterSchedule` re-runs for both employments — a swap can break a contractual
   guarantee or cap even when neither day individually looks wrong.

Failure is reported per-pair, not per-row: "Cannot swap — 11 Aug is inside paid payroll 2026-08."

---

## 4. Break minutes owed after long hours

### 4.1 Where this is configured

On the **jurisdiction snapshot**, as a fourth member of `statutory_regime`, beside coverage, rules
and limits. Not on the company, not on the employment, not in code.

This member existed and was deleted. `docs/architecture.md` records why: "every field of it was
resolved, snapshotted and read by nothing: no line was priced, no run was blocked, no screen quoted
a figure." That reasoning was correct then and this proposal is what changes it — the board is the
screen that quotes the figure. The primary text survived the deletion in
`seed_bank/norbital_hr/statutory/rest_break_rules.json`, which is what makes this a restore rather
than a fresh transcription.

```text
   jurisdictions (effective-dated)
     └── regime : statutory_regime
           ├── overtime_coverage    (who the ladder applies to)
           ├── overtime_rules       (bands → awards)
           ├── overtime_limits      (DAY/WEEK/MONTH caps, WARN | BLOCK)
           └── rest_break_rules     ◄── restored
                 ├── after_consecutive_hours : number | null
                 ├── minimum_minutes         : number | null
                 ├── counts_as_worked_time   : boolean | null
                 ├── applies_when            : ALWAYS | CONTINUOUS_ATTENDANCE
                 ├── on_exceed               : WARN | BLOCK      ◄── new, mirrors overtime_limits
                 └── authority               : citation

   Malaysia, from the seed bank:
     • after 5 consecutive hours → ≥ 30 min      EA 1955 s.60A(1)(a)
     • continuous-attendance work: 8 consecutive hours inclusive of ≥ 45 min aggregate
                                                  EA 1955 s.60A(1) proviso (ii)
   Philippines:  ≥ 60 min meal, no consecutive-hours trigger   Labor Code art.85
   Indonesia:    after 4 consecutive hours → ≥ 30 min, NOT worked time   UU 13/2003 ps.79(2)(a)
   Singapore:    after 6 consecutive hours → period of leisure, no minimum stated   EA 1968 s.38(1)(a)
```

That table is the modularity answer: four jurisdictions, four different shapes, zero branches in
code. A fifth country is a seed row.

### 4.2 A correction to the premise

The rule is not "if someone OTs N hours they must take a break." It is a **consecutive-hours** rule.
Overtime is merely the usual way a person crosses five consecutive hours on the far side of their
shift. Modelling it as a function of overtime hours would produce the wrong answer for a
ten-hour split shift with no overtime at all, and would miss the s.60A(1)(a) proviso (i) subtlety
that a break shorter than thirty minutes does not interrupt the five hours.

So the input is punches, never an overtime total:

```text
   worked_intervals + break_minutes
        │
        ▼
   ┌──────────────────────────── src/lib/scheduling/rest-break.ts ─────────────────────────┐
   │  restBreakAssessment({ intervals, breakMinutes, rules, continuousAttendance })         │
   │                                                                                        │
   │  1. inter-interval gaps ≥ minimum_minutes are breaks in their own right                │
   │  2. gaps shorter than the minimum do NOT break continuity      ← proviso (i)           │
   │  3. flat `break_minutes` tops the observed gaps up to the aggregate actually recorded  │
   │  4. longest consecutive run vs after_consecutive_hours → owed vs taken                 │
   │                                                                                        │
   │  → { rule, longestRunHours, requiredMinutes, takenMinutes, shortfallMinutes }          │
   └────────────────────────────────────────────────────────────────────────────────────────┘
        │              │                    │
        ▼              ▼                    ▼
   day sheet      roster publish       time_entries hook
   ⚠ badge        gate: a WORK code     on_exceed = WARN → toast, saves
   + citation     window whose span     on_exceed = BLOCK → refuse with the citation
                  exceeds the trigger
                  with too small a
                  break fails the
                  publish check
```

One pure module, three consumers, same numbers everywhere — the pattern `lock.ts` already uses to
keep the hooks and the board from disagreeing.

### 4.3 What it deliberately does **not** do

It does not change anybody's pay. `counts_as_worked_time` is `null` for Malaysia, because s.60A(1)(a)
calls the period "leisure" and is silent on payment — `docs/architecture.md` §"Whether the Malaysian
break is paid" already records that as unresolved. Pricing off a null would be inventing law. The
engine keeps deducting the break the entry records; the rule is a **compliance check with a
citation**, and it stays one until the paid/unpaid question is answered from primary text.

Where the shortfall *does* need to reach money, the honest route is a company-level policy that
imputes a break — an explicit decision on `companies`, visible and dated — never a silent default
buried in the overtime engine.

---

## 5. Uploading a month of attendance

This is built. `expandTimeMonthGrid` in `time_entries/import-month-grid.ts` reads exactly the shape
the roster import reads — people down the side, days across the top — with `HH:mm-HH:mm` cells, or
`HH:mm` for a punch still open. The `Settings` sheet carries the timezone and the month, and a file
that omits the timezone is refused rather than guessed at.

The only defect is placement: it hangs off the `CollectionTable` in `+time_attendance.svelte`, which
is the analytics screen. The board is where a month is worked on.

```text
   ┌──────────── Scheduling · Month board · 2026-08 ────────────────────────────────┐
   │                                                                                │
   │   [ Import ▾ ]                                                                 │
   │     ├─ Roster for 2026-08          → roster_entries   (needs a DRAFT month)    │
   │     └─ Attendance for 2026-08      → time_entries     (needs no draft at all)  │
   │                                                                                │
   │   [ Download template ▾ ]                                                      │
   │     ├─ Roster grid    — people × days, pre-filled with the current plan        │
   │     └─ Attendance grid — people × days, pre-filled with punches already in     │
   └────────────────────────────────────────────────────────────────────────────────┘

        workbook                  pipeline                     hooks                   board
   ┌───────────────┐        ┌────────────────┐          ┌────────────────┐      ┌─────────────┐
   │ Settings      │        │ expandTime     │          │ per-row:       │      │ cells       │
   │  timezone     │  ───►  │  MonthGrid     │  ───►    │  interval order │ ──► │ repaint;    │
   │  month        │        │ parseClockRange│          │  leave conflict │      │ exception   │
   │ Time entries  │        │ → one row per  │          │  claim / window │      │ counters    │
   │  A2:AG301     │        │   person-day   │          │  ALL-OR-NOTHING │      │ drop        │
   └───────────────┘        └────────────────┘          └────────────────┘      └─────────────┘
```

Two properties worth keeping explicit because they are what make a monthly upload survivable:

1. **All-or-nothing.** `expandTimeMonthGrid` collects every problem and throws one
   `WorkbookImportError` listing all of them; nothing is written. A 300-person sheet is corrected
   once and re-imported once.
2. **Attendance needs no draft roster.** The roster import requires a `DRAFT` month because
   assignments belong to a roster. Attendance belongs to nothing but the day, so a month that was
   never drafted still accepts its punches — and that is the common case when a customer is
   backfilling history.

The import must run the same lock ladder per row, which means a mixed file lands its unlocked rows
and refuses the whole file if any row is locked. Refusing the file is the right choice: partial
application of a payroll-period upload is how two systems end up disagreeing about a month.

---

## 6. Order of work

```text
   ① lock correctness ──────────────────────────────────────────► highest value, smallest diff
      delete DATE_PASSED from the attendance path;
      claim governs records, window governs creates;
      drop `day.past !== true` from cellEditable.
      Nothing new is drawn; a whole class of false refusals disappears.
              │
              ▼
   ② lock rail + hover sentence ────────────────────────────────► makes ① legible
      four rungs, one channel, `sourceLockReason` already writes the sentence.
              │
              ▼
   ③ day sheet ─────────────────────────────────────────────────► the actual feature
      plan editor + attendance editor + lock panel in one drawer.
              │
              ├──────────────► ④ attendance import moved onto the board (independent, small)
              │
              ▼
   ⑤ swap gesture ──────────────────────────────────────────────► needs ③'s writes and ①'s locks
      two-cell transaction, re-using overlap / leave / schedule validation.
              │
              ▼
   ⑥ rest_break_rules ──────────────────────────────────────────► needs ③ to have somewhere to show
      restore the regime member from the seed bank, add rest-break.ts,
      wire the badge, the publish gate and the WARN/BLOCK hook.
              │
              ▼
   ⑦ AMENDMENT origin ─────────────────────────────────────────► decide before building ⑤ in anger
      the one genuinely contested change; ⑤ works without it in a draft month.
              │
              ▼
   ⑧ ESS calendar ──────────────────────────────────────────────► needs ③'s day sheet only
      roster-month-calendar.svelte over the same DayFacts, employment-scoped;
      day sheet in mode="employee"; report-a-missing-punch on the existing
      approval-gated create. No policy change, no new collection.
              │
              ▼
   ⑨ retire the raw tables ─────────────────────────────────────► last, because it removes
      ESS "My time" table → ⑧'s calendar;                           the fallback surface
      HR "Time & Attendance" → Scheduling "Exceptions" tab;
      exception counters become board filters; exports join the board menu.
```

Steps ①–② are the correctness floor and are worth landing on their own even if nothing else here is
built. Steps ⑧–⑨ are the only ones that delete code, and they go last for the ordinary reason: the
tables stay reachable until the surface replacing them is in front of a real month.

---

## 7. Decisions this document asks for

1. **Unconsumed record inside a paid window** — editable with an arrears badge (recommended), or
   frozen? §2.3.
2. **Post-publication single-cell writes** — `AMENDMENT` origin (recommended), or keep the hard
   freeze and require re-opening the month? §2.4.
3. **`on_exceed` default for rest breaks** — `WARN` (recommended: the rule is unenforced today, and
   `BLOCK` on day one would refuse historical imports) or `BLOCK`?
4. **Does `+time_attendance.svelte` survive at all?** Recommended: retired, with its chart and
   export folded into Scheduling as an Exceptions tab, so there is exactly one place a day changes.
   Fallback: keep the app, delete only the Entries table, and leave it read-only. §8.3.
5. **Does the employee calendar replace the ESS time table, or sit beside it?** Recommended:
   replaces it. A table of punches with no roster beside it cannot answer "am I on tomorrow?", which
   is the question the tab exists for. §8.1.

---

## 8. One fact table, two renderers — and no raw tables left

The board and the employee's calendar are not two features. They are one derived fact table drawn at
two densities, for two audiences, with two different sets of affordances. Nothing about the
derivation differs, and nothing about the lock differs.

```text
                        buildRosterMonth()            ← already takes employments[]:
                        STATUS_PRESENTATION              one person is the n = 1 case
                        lock.ts ladder                   and needs no new code
                               │
              ┌────────────────┴─────────────────┐
              ▼                                  ▼
   roster-month-board.svelte          roster-month-calendar.svelte      ← new
   people × days · dense · 13px       one person · weeks × weekdays · roomy
   HR Controller → Scheduling         Employee Self-Service → My schedule
              │                                  │
              │  onSelectDay(employment, date)   │
              └────────────────┬─────────────────┘
                               ▼
                        day-sheet.svelte                                 ← new
                  mode="controller"   │   mode="employee"
                  edits both records  │   reads both, may report a punch
```

Two audiences, one truth. An employee who asks "why does HR think I was absent on the 5th" is
looking at the same `DayFacts` the controller is looking at, drawn larger.

### 8.1 The employee's month

The ESS "My time" tab is a `time_entries` table today. It shows punches and **nothing about what the
person was supposed to work** — no shift, no rest day, no holiday, no leave. An employee cannot
answer "am I on tomorrow?" from their own self-service app, which is the single most common question
self-service exists to answer.

```text
 ┌─ My schedule · August 2026 ····························· NHPMY0005 · Nihon Pigment ─┐
 │  ‹  2026-08  ›                              Worked 142.5 h · Beyond schedule 6.0 h   │
 │                                                                                      │
 │    Mon         Tue         Wed         Thu         Fri         Sat         Sun       │
 │  ┌─ 3 ─────┐ ┌─ 4 ─────┐ ┌─ 5 ─────┐ ┌─ 6 ─────┐ ┌─ 7 ─────┐ ┌─ 8 ─────┐ ┌─ 9 ─────┐│
 │  │ A       │ │ A       │ │ A       │ │ A       │ │ A       │ │ REST    │ │ OFF     ││
 │  │ 08–17   │ │ 08–17   │ │ 08–17   │ │ 08–17   │ │ 08–17   │ │         │ │         ││
 │  │ 08:16   │ │ 08:02   │ │ ⚠ no    │ │ 08:11   │ │ 07:58   │ │         │ │         ││
 │  │ ↳ 17:10 │ │ ↳ 17:05 │ │   punch │ │ ↳ 17:44 │ │ ↳ 17:02 │ │         │ │         ││
 │  │ 8.4 h   │ │ 8.5 h   │ │ [report]│ │ 8.9 h ↑ │ │ 8.5 h   │ │         │ │         ││
 │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘│
 │  ┌─ 10 ────┐ ┌─ 11 ────┐ ┌─ 12 ────┐ ┌─ 13 ────┐ ┌─ 14 ────┐ ┌─ 15 ────┐ ┌─ 16 ────┐│
 │  │▓ A    🔒│ │▓ A    🔒│ │  PH     │ │ ANNUAL  │ │ A       │ │ REST    │ │ A    OT ││
 │  │▓ 8.5 h  │ │▓ 8.5 h  │ │  Merdeka│ │  LEAVE  │ │ 08–17   │ │         │ │ 09–13   ││
 │  │▓ paid   │ │▓ paid   │ │  no work│ │ approved│ │ …       │ │         │ │ call-in ││
 │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘│
 │                                                                                      │
 │  ▓🔒 settled in payroll 2026-07   ⚠ needs attention   ↑ beyond schedule   OT extra   │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

The tile carries the same three bands as a board cell — plan, actual, lock — with room to spell them
out instead of glyphing them. `STATUS_PRESENTATION` and the lock rail are shared verbatim, so a day
that is amber for the controller is amber for the employee.

### 8.2 What the employee may do, and why it needs no new permissions

`+employee.policy.ts` already grants every read this calendar makes, and exactly one write:

```text
   READ   employees · employments · employment_terms · roster_entries · time_entries
          leave_requests · payslips · component_entries · repayment_agreements
          + employeeReferenceGrants: companies, company_holidays, shift_definitions,
            rosters, pay_components, leave_types
          + settlementLedgerGrants: payroll_settlements
                    ▲
                    └─ the ledger read is why a refusal on a settled day is an EXPLANATION
                       for the employee rather than an access denial. Already deliberate.

   CREATE time_entries, scoped to own employment, via timeEntryApproval(...)
          ── no update, no delete. An employee reports; a controller decides.
```

So the calendar's one affordance is **report a missing punch** on an unlocked day with no entry.
It creates a `time_entries` row that carries `norbital_approval_id` until a manager settles it,
which the tile draws as a fifth rung on the ladder:

```text
   OPEN ──► PENDING ──► IN A DRAFT RUN ──► CONSUMED ──► PAID
    no      submitted,   a draft run's      a run holds   permanent;
   claim    waiting on   window covers      a claim on    corrections
            a manager    the day            this record   are adjustments
            (platform    (advisory)         (delete the   (arrears entry)
             409)                            draft)
```

`PENDING` is the platform's own lock (`norbital_approval_id`) and stays the platform's — the domain
never refuses it, it only draws it. That is already how `sourceLockBlocksWrite` treats it.

### 8.3 Retiring the raw tables

Three collection tables over the same two collections exist today, and every one of them is an
editing surface that does not know what the day means:

| Surface | Today | After |
|---|---|---|
| HR Controller → Time & Attendance → **Entries** | editable `time_entries` table | **deleted** |
| HR Controller → Time & Attendance → **Overview** | exception-rate chart | moves to Scheduling → Exceptions |
| Employee Self-Service → **My time** | `time_entries` table | becomes **My schedule** calendar |

Which leaves `+time_attendance.svelte` holding a chart, and an app that is one chart is not an app.
The recommendation is to retire it and fold both halves into Scheduling:

```text
   BEFORE                                  AFTER
   HR Controller                           HR Controller
     ├── Leave                               ├── Leave
     ├── Loans                               ├── Loans
     ├── Pay components                      ├── Pay components
     ├── Payroll                             ├── Payroll
     ├── People                              ├── People
     ├── Scheduling                          ├── Scheduling
     │     ├── Month board                   │     ├── Month board      ← the one editing surface
     │     ├── Roster codes                  │     ├── Exceptions       ← chart + drill-through
     │     └── Holidays                      │     ├── Roster codes
     ├── Statutory profile                   │     └── Holidays
     └── Time & Attendance                   └── Statutory profile
           ├── Overview                      (Time & Attendance retired)
           └── Entries        ← the raw table
```

**The exceptions tab is not another table.** The counters the board already computes
(`monthProgress`) become the drill-through: clicking `1,028 missed clock-ins` filters the board to
those person-days. The list of exceptions *is* the board, narrowed — which is the whole argument for
deleting the table, because a table of time entries beside a board of person-days is two places to
read the same month and one of them has no idea what a rest day is.

```text
   [ 2026-08 not started yet ] [ 2 people still need shifts ] [ 1,028 missed clock-ins ⟶ ]
                                                                          │
                                                     click ───────────────┘
                                                                          ▼
                                            board filters to status = ABSENT,
                                            people axis narrows to those affected,
                                            month and search survive the filter
```

Export keeps its place: `exportPipelines` moves onto the board's action menu beside the two imports,
so issue-template → fill → import → inspect is one screen from end to end.

### 8.4 What actually has to be built

Smaller than it reads, because the derivation is shared:

- `roster-month-calendar.svelte` — a weeks × weekdays renderer over the same `DayFacts` map. No new
  queries beyond scoping `buildRosterMonth` to one employment.
- `day-sheet.svelte` — one component, a `mode` prop. `employee` hides the roster-code picker and
  the interval editor, and offers `report a missing punch`.
- ESS gains the board's six month-scoped queries, all already permitted, all `employment_id`-scoped
  rather than company-scoped — so they are 1/300th the size of the controller's.
- `+time_attendance.svelte` deleted; its chart snippet and `attendance_summary` invoke move into a
  Scheduling tab; its i18n keys move with it.
- ESS `attendanceRowLock` loses `today`, same as §2.2 — otherwise the employee's own calendar
  greys out every day they have actually worked.
