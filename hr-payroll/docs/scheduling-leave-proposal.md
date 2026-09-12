# Scheduling, attendance and Leave

Work records planned assignments and observed time for an employment contract. Leave records
approved activity against that contract and retains the dated charges used at approval. The shared
schedule combines effective terms, named patterns, explicit Work rows and the entity's published
holidays. Payroll uses those same facts.

This document replaces the earlier UI proposal. The family source boundary is implemented, and the
combined changes are verified by artifact sync, type checks, the full suite and browser acceptance.
See [Architecture](architecture.md) for family processing and [Leave](leave.md) for entitlement and
manual activity validation.

Work's preparation and calculation live in `src/lib/payroll/work.ts`; Leave's payroll preparation
and results live in `src/lib/leave/payroll.ts`. `src/lib/payroll/families.ts` coordinates their shared
schedule/absence inputs with the other families. Payroll consumes those prepared family results.

## Contract and schedule

`employees` identifies the person; `employments` identifies the stint with one entity. Work and Leave
always reference the contract. Only one contract for a person/entity pair can cover a date, while
contracts in other entities may be active simultaneously. Rehire starts a new contract. A sealed
contract's departure is recorded separately and does not create Leave or Payment entries.

Three scheduling layers have distinct meanings:

| Layer      | Stored input                                     | Meaning                                        |
| ---------- | ------------------------------------------------ | ---------------------------------------------- |
| Base       | Terms reference a named `shift_patterns` row     | The contractual schedule projected onto a date |
| Assignment | `work_days.shift_definition_id`                  | An explicit plan for that contract/date        |
| Attendance | `work_days.worked_intervals` and `break_minutes` | The observed time worked                       |

A `PATTERNED` shift pattern repeats one or more roster-code phases from its anchor. It covers fixed
weeks, short crew cycles and calendar-month rotations without copying the pattern into each
contract. A `ROSTERED` pattern states the workload expectation for supplied assignments. No pattern
means rostered as assigned. Every reader resolves the pattern through the effective terms.

`shift_definitions` is the collection for roster codes:

- `WORK` has start, end and unpaid break. Crossing midnight and paid minutes are derived.
- `REST` is the protected rest-day baseline.
- `OFF` is another planned non-working day.

An attendance-only row leaves the base assignment in force. A planned Work assignment on a patterned
REST/OFF day can supply clock boundaries while retaining the baseline classification for pricing.
A Work row with an empty interval list records absence unless approved Leave covers it. For a
patterned contract, no row means worked to the base with no overtime. For rostered contracts, missing
assignments remain visible and contractual workload checks prevent an unmet guarantee being treated
as a valid month.

Patterned changes are validated against the required monthly days and paid minutes. Rostered
changes are validated against their stated guarantee or cap. Assignment and attendance are separate
facts even when imported or displayed together.

## Entity holidays

Holidays are not roster codes, employee events or per-person selections. An entity's observed days
are rows of `jurisdiction_holidays` — `unique(company_id, date)` — each published on its own.
Company closures remain Work schedule decisions. The entity's Holidays tab is one table: add a day,
import the holidays spreadsheet or the Google calendar set beside it, and publish each day;
Settings → Catalog is untouched.

The yearly `holiday_import` automation reads the following year each 1 October from each entity's
configured Google calendar and adds the days that entity does not have yet, unpublished. A manual
run chooses an entity and a year. Every page must succeed before a row is written; credentials
belong to the managed connection. An imported day is not a payroll holiday until a person publishes
it.

```mermaid
flowchart LR
    Calendar[Entity's published holidays] --> Schedule[Contract schedule and dated Work row]
    Schedule --> Charges[Leave chargeable slots and exclusions]
    Schedule --> Classification[Ordinary, rest, off or public holiday]
    Classification --> OT[Work overtime pricing]
    Charges --> Coverage[Approved absence coverage]
    Coverage --> OT
```

Nothing asks a year to be complete: a day that is not published is simply not a holiday, and a
missing year is not a block. The freeze derives from live references, not a stamp: a
work day classified as a holiday pins it (`work_days.holiday_id`) and a payroll run captures the
holidays it read (`payroll_runs.holidays`). Retracting a holiday (unpublish, moving its day or
entity, delete) is refused while a run captures it; otherwise the pinning days are re-saved —
re-classified, lieu credits reversed — while a credit already taken refuses the change. A finished
run is never touched by a holiday published later, and an import skips a day the entity
already has.

Observed substitute dates are their own rows with an `original_date`. Work's explicit precedence
resolves an overlap with a rest day without inventing a personal substitute date. Leave charging,
calendar displays and overtime use the same resolved input and preserve existing Work links.

## Work import and overtime

Controller → Events → Work is the operational month board. People holds the contracts and effective
terms; Settings → Catalog holds family calculation definitions. The board identifies projected base,
explicit assignments and clocked time so an implied schedule cannot be confused with an observation.

A workbook may carry both planned roster data and actual attendance:

```text
planned code  → resolve WORK / REST / OFF assignment
blank cell    → no explicit assignment
PH token      → validate against the entity's published holidays
punch columns → normalize worked intervals
```

Import does not manufacture holiday rows, personal holiday scope or overtime quantities. A source
column named "OT in/out" is still an observed interval. Overlap normalization and source evidence
belong to import; the resulting Work rows follow the ordinary validation and approval path.

Overtime follows this order:

1. Resolve effective contract terms and the base schedule.
2. Apply dated assignments and the entity's holiday classification.
3. Validate and measure observed intervals.
4. Determine coverage and price the applicable Work bands.
5. Apply dated floors, compliance controls and the payroll settlement window.

Overtime duration, type and amount are calculated values. A stored `overtime_eligible` or
`requires_approval` flag would duplicate a derivation. The source includes a pure scheduled-extra-work
detector; conditional approval based on joined schedule/calendar facts still needs a supported
workflow integration. Detection alone is not an automatic approval path.

The ordinary approval policy remains authoritative. Paying hours that occurred does not establish
that the schedule complied with working-time requirements. Detailed rounding, excess-overtime and
coverage rules remain in [Architecture](architecture.md#work-calculation).

## Time-off interaction

Employee → Events → Leave submits time off against the selected contract. HR uses the same family
for manual encashment, carry-forward, adjustments and reversals. Those activities do not appear as
fake absence ranges and are not triggered by departure or the calendar turning over.

One `TIME_OFF` activity contains one contiguous range. Each endpoint is a date and `FIRST` or `SECOND`
shift half; these halves need not be morning and afternoon. The server resolves the schedule and
calendar, derives chargeable slots, checks eligibility, certificate requirements, overlap, paid
windows and available quantity, and freezes the dated charges on approval.

The picker contract is:

- Show excluded REST/OFF/holiday slots with their reason.
- Use the same half-day model for pointer and keyboard selection.
- Show approved usage and pending reservations against the selected contract.
- Keep separate non-contiguous absences as separate activities.
- Repeat all validation on the server; a displayed preview is not approval.

Submission follows the existing approval workflow. A held create reserves its range and debit
quantity immediately. Approval revalidates and commits that single activity; rejection or withdrawal
releases the hold. Approval does not create a second usage movement. A submitted credit becomes
spendable only after approval.

Entitlement is computed from the catalogue, contract and effective facts for the relevant window and
date. There is no stored annual account or monthly refresh prerequisite. Manual carry names its
source/destination windows and credit validity explicitly. Manual encashment names its approved
quantity and money. Each payroll consumes only the dated charges or due monetary amounts belonging
to its window; a multi-month absence is not charged entirely to the first month.

## Stored facts and derived views

| Store                                                           | Derive or prepare                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| Contract, terms and named pattern reference                     | Service scope and projected base                             |
| Roster-code variant and explicit dated assignment               | Normal minutes, final day type and workload                  |
| Published holiday rows and permanent input captures             | Holiday classification for each date                         |
| Observed intervals and break minutes                            | Open/closed state, duration and overtime value               |
| Approved activity, half-day range and frozen dated charges      | Calendar presentation and period-specific charge selection   |
| Manual carry/encashment/correction terms and source allocations | Balance, expiry and outstanding monetary obligations         |
| Effective family catalogues and contract facts                  | Eligibility, entitlement, contribution treatment and amounts |

An approved charge or captured classification is historical evidence, even if the original value was
calculated. Recomputing a current preview must not rewrite consumed evidence. Corrections use new
approved activities.

## Attendance kiosk

The kiosk writes `work_days.worked_intervals` through the same contract, Leave, capture and paid-window
guards as other attendance entry. Device accounts use the Attendance Kiosk team and restricted kiosk
policy. The kiosk app declares `bolt:kiosk` for the chromeless shell. Camera use requires HTTPS;
matching and punches require the network because there is no offline queue.

Face enrollment belongs on the employee profile. The guided five-pose flow produces the stored
embedding and consent evidence; HR controls enrollment status. Matching reads approved profiles and
resolves a contract before a punch. Both face matching and manual selection require the chosen entity
and resolve exactly one active contract within it. Conflicting active contracts are refused. Entity
selection and the resulting Work records are implemented and exercised by the kiosk and public-seed
suites.

Model assets are bundled from the pinned Human package and resolved relative to the immutable
browser artifact. The page reports unavailable models instead of claiming the camera is ready.
Manual check-in/check-out remains available when recognition is unavailable. Punch guards include
cooldown, orientation checks and source locks. Antispoof and blink checks reduce simple replay
attempts but do not establish a general guarantee against spoofing.

Spoken guidance uses the phrase list in `src/lib/kiosk/phrases.ts` and bundled clips in
`assets/kiosk-voice/`, played serially. Phrase and asset changes must be verified together. The kiosk
and employee views require browser acceptance for contract selection, locked inputs, empty states
and import/review feedback; unit checks alone do not establish those interactions work.
