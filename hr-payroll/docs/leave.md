# Leave

Leave is a payroll family with a versioned catalogue, immutable manual activity and computed
balances. Payroll consumes the family's prepared outputs and links every consumed entry.

## Records and ownership

| Record            | Responsibility                                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leave_catalogue` | A stable leave code within a sealed settings revision: eligibility, the computed entitlement, whether a day is `is_npl`, whether it `can_encash`, and the evidence threshold                                                                         |
| `leave_entries`   | An approved or held manual transaction against one employment contract, with a supporting reference. The transform freezes dated charges and credit allocations; the entry carries the nullable `payslip_id` the run sets when it consumes it whole. |

`employment_id` identifies one contract with one legal entity. Entitlement, service bands, usage,
reservations, carry and encashment remain within that contract. A rehire creates another contract
and starts a fresh calculation. One employee profile can hold contracts in different entities;
their leave pools and payouts remain separate. Contracts for the same employee and entity cannot
overlap.

A linked input seals the employment contract. Recording departure separately bounds its service
without rewriting the signed contract. Closing a contract raises the leaver's encashment through
the `leave_encashment_on_exit` automation (below); it creates no separation payment.

## Catalogue and entitlement

An entity's `settings_code` selects a settings lineage. Settings → Catalog → Leave edits the leave
catalogue within its selected draft revision. A sealed revision and its catalogue rows are
immutable; changed rules require a successor revision. Codes identify leave types across revisions.

The entitlement definition contains:

| Field                 | Values and meaning                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `availability`        | `UPFRONT`, `MONTHLY`, `UNLIMITED` or `PER_EVENT` (a grant per birth, adoption or bereavement the entry names; `lifetime_events` caps the grants over the employment).                            |
| `year_start_month`    | The first month of the annual leave window, including fiscal years.                                                                                                                              |
| `proration`           | `NONE`, eligible `CALENDAR_MONTHS`, `COMPLETED_MONTHS`, `HALF_MONTHS` (a month with at least half its days eligible counts whole — VN Decree 145 art.66(2)) or eligible `CALENDAR_DAYS`.         |
| `rolling_months`      | Measures the window over the trailing months ending on the day instead of the leave year (MY sick leave over 12, TW over 24).                                                                    |
| `rounding`            | `HALF_DAY` (default) or `WHOLE_DAY`: a part-year grant rounds to the day, a half or more up (MY s.60E(1), SG s.88A(3)).                                                                          |
| `lifetime_days`       | The most days of the leave a person may ever take, across years and their employments here; a number or an expression over the person (SG GPCL: `children.citizens * 42.0 + …`).                 |
| `consumes_after_days` | Of a row that `consumes_code` another: the days a leave year that stay outside the pool; only days beyond them draw from it (TW menstrual leave: 3).                                             |
| `bands`               | Annual quantities by completed months of service on this contract; `days` is a number or an expression over `leave_day` (`leave.month_index`, `leave.day_index`, `leave.days`, the person root). |

The catalogue row beside it: `pay_fraction` (an expression over `leave_day`, the share of the day
wage deducted — ID sick leave steps down by month), `paid_by: EMPLOYER | FUND` (a FUND day is
deducted from the wage and reimbursed by the fund outside payroll), `consumes_code` (the row draws
from another row's pool — TW menstrual leave inside sick leave — and the pool's summary shows its
consumers), `unit: DAY | HOUR` (an hourly row's entry states `hours`, charged in eighths of a day).
An entry taken for an event carries `event_kind`, `event_relationship`, `event_child_index` and
`event_date`; the leave rules read them as `event.*` and the named child's citizenship, age, the
shared parental weeks this parent takes for the child and the days the mother was employed
elsewhere before the confinement — the last three recorded on the employee's child rows, since a
tenant cannot see the other parent's employer or an earlier employer. Lifetime counts
(`lifetime_events`, `lifetime_days`) run over the person's employments here, so a rehire does not
reset them. Where the version says a public holiday enclosed by no-pay leave is unpaid (SG
s.88(2)), a no-pay entry charges that holiday too, named by it.

Queries select the rule and service band effective on the requested date, bounded by the source
window and the contract's departure. Eligibility uses effective terms and applicable child facts.
Monthly availability releases earned amounts at calendar month end. Quantities round to half days.
Unlimited leave has no finite ceiling; its scheduled dates and eligibility still require validation.

A full upfront grant can be available before the same quantity is earned under a prorated rule.
Encashment and outgoing carry validate earned quantities, including existing commitments.

An empty eligibility expression includes everyone. Expressions use the shared person context:

```text
employee.gender  employee.age  employee.age_months  employee.citizenship  employee.spouse_status
employment.type  employment.classification  employment.service_months  employment.service_start
terms.basic_salary  terms.workman  terms.department  terms.payroll_group  terms.grade
terms.ordinary_hours_per_week  terms.working_days_per_week
children.count  children.under(n)  company.region  company.headcount  company.facts.<key>
```

The full list is the `person` site in [architecture.md](architecture.md#statutory-grammar).

Malformed expressions are refused when the catalogue is written.

`employee.citizenship` in an eligibility expression is resolved from the contract's effective
`employment_terms.residency_status`. Nationality remains a personal fact; residency standing can
differ between concurrent jurisdictions and change through an effective terms amendment.

Contract input seals preserve terms through actual approved charge and debit valuation dates.
Their facts and start dates cannot change or be deleted, and historical gaps cannot acquire new
terms. Close an unconsumed portion and create a successor: inclusive terms ending 30 June may be
followed by terms beginning 1 July. Reversal and consumer deletion do not erase the seal.

An upfront annual amount remains a query, including its future eligibility projection. January
leave permits a July salary or residency amendment; the projection may change, while January's
approved charges and agreed money remain fixed. Time off approved for July consumes its actual
July charge dates even if approval occurs in January. Previewing a balance creates no seal.

There are no materialised annual accounts, generated opening/accrual entries, or reconciliation
jobs. A new-year balance is available by querying that year.

### Policy coverage

An actual balance query, charge or dated allocation requires its applicable approved policy.
Missing evidence on that date refuses the operation. Dates before a leave type exists do not earn
leave during annual projection. Proration counts only eligible dates covered by approved policy;
it does not extend a version beyond its declared coverage.

Full grants with no proration and unlimited entitlement do not inspect dates after the requested
date. A December policy can therefore support December leave without requiring January policy.
Reservation checks inspect the dates of actual commitments, rather than requiring settings for
every unused future day. Calendar padding outside policy coverage is displayed as unavailable;
selecting an uncovered date still refuses submission.

## Manual activity

Every entry requires `employment_id`, `catalogue_id` and a `reference` unique within that
contract. There is no activity column: which activity an entry is, is the presence of its fields
(`lib/leave/activity-fields.ts`) — a charged range is time off, `encash_days` an encashment, a
destination window a carry-forward, stated `days` an adjustment, `reversal_of_id` a reversal. The
server resolves the stable leave code and derives `charges` and `allocations`; callers cannot
substitute those approval inputs.

| Category        | Entered facts                                                                    | Effect                                                                    |
| --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `TIME_OFF`      | Start/end dates and halves, optional reason and required certificate.            | Charges scheduled work time on exact dates.                               |
| `ENCASHMENT`    | Source window, `encash_days`, effective and due dates; a `can_encash` row only.  | Reserves earned leave; payroll prices the days at the ordinary day wage.  |
| `CARRY_FORWARD` | Source/destination windows, days, availability date and expiry.                  | Debits the source; the approved entry is the expiring destination credit. |
| `ADJUSTMENT`    | Window, signed days, effective date and reason.                                  | Applies a documented exceptional change to the balance.                   |
| `REVERSAL`      | Original entry, effective date, reason and a due date when reversing paid money. | Reverses the original allocations and any paid outputs exactly.           |

Employees submit their own time off. Time off is reviewed by an eligible L1 Manager, HR Manager or
Senior Management approver. Other manual categories are HR actions; controller submissions require
HR Manager or Senior Management approval. Approved entries cannot be edited, deleted or moved to a
different contract. Corrections use a linked reversal and, where needed, a replacement entry.

### Time-off approval

The shared preview and submission planner check contract dates, effective catalogue eligibility,
terms, work patterns, roster overrides, observed entity holidays, occupied halves, paid
payroll windows, available credit and certificate requirements.

A multi-day range retains each chargeable date. Holidays and rest/off days are excluded. Two
opposite half-day entries may share a date; overlapping approved or held halves are refused.
Cross-month or cross-year ranges allocate each charge to its own annual window; a range that would
straddle two payroll periods is refused at payroll and entered as one entry per period. The
entry's `days` is the measured quantity, whatever the caller stated.

```mermaid
flowchart LR
    UI[Employee or HR submission] --> Preview[Shared Leave planner]
    Preview --> Review[Approval with held debit reservations]
    Review --> Validate[Revalidate complete contract batch]
    Validate --> Entry[Immutable Leave entry]
    Validate --> Seals[Charges carry their calendar and terms]
    Entry --> Family[Leave payroll preparation]
    Family --> Payroll[Regular payroll and entry links]
```

The transform validates the whole contract batch deterministically. Replay excludes the batch's
own held rows while retaining reservations from other batches. The entry, dated evidence and
contract seal commit in the same graph. Consumed holiday evidence remains sealed if its original consumer
is later removed; calendar amendments cannot shift a linked observation or add a holiday that
would change an already consumed date.

## Balances and reservations

For one contract, stable leave code, annual window and query date:

```text
posted balance
  = computed entitlement available on the date
  + approved credits effective by the date
  - approved debits effective by the date
  - expired unused carry
```

Available leave also reserves pending debits and approved future commitments. Pending credits and
pending reversals cannot fund another application. Expiring carry is allocated first, while
previously allocated future usage retains its original credit. Rejecting or withdrawing a pending
transaction releases its reservation.

A reversal restores the original dates, windows and credit identities. It cannot give expired
carry a new validity period. A spent carry transfer cannot be reversed unless dependent usage has
first been resolved. An original entry can be reversed only once.

### Carry-forward example

HR approves a five-day transfer from the 2026 window into 2027, available January 1 and expiring
March 31. The single `CARRY_FORWARD` entry contains a five-day source debit dated December 31 and is
itself the five-day destination credit, available January 1: the engine names the row, so the entry
never allocates to its own id, and a reversal negates the credit by naming the entry. Approval may
occur in January; the named windows and allocation dates determine both balances.

With twelve upfront days in 2027, the opening available quantity is seventeen. Three days used in
February consume carry first. On April 1 the unused two carried days expire in the query, leaving
the twelve annual days. No expiry job or additional close entry is required.

Carry-forward is always an explicit HR transaction. Calendar rollover and departure create none.

## Payroll interface and encashment

`lib/leave/payroll.ts` owns preparation, source selection, approved date coverage and calculation.
The payroll engine receives prepared Leave data for each contract. Work supplies date-specific
absence rates; Leave returns its frozen pay items for payroll settlement; each scheme's `assessed_on` formula
says which of them it charges.

- Paid time off supplies approved coverage and a zero-money link.
- Unpaid time off supplies reductions for its exact linked dates, using Work's applicable rate and
  the reserved `NO_PAY_LEAVE` line each scheme's formula subtracts or ignores; the deduction
  covers whom the leave covers.
- Encashment supplies its days; payroll prices them at the ordinary day wage as `ENCASHMENT`.
  Leave carries no pricing of its own, so nothing is entered and nothing is repriceable.
- Carry and adjustments change quantities without directly creating payroll money.
- A paid reversal negates the original linked amount and economic direction. A
  draft link must first be deleted or settled before its source can be reversed.

Standing links prevent the same dated slice or single monetary obligation being consumed twice.
A time-off entry settles whole in the one period that contains all of its days; a range that would
straddle periods is refused at payroll and entered as one entry per period. The entry's own `payslip_id` is the link, and
its frozen pay items retain the exact catalogue/settings identifiers, quantity, rate and signed
amount, priced by the engine at the ordinary day wage.

There is one regular payroll per entity and period. Late approved encashment and monetary
corrections settle in a later regular period. Outstanding Leave money can include an ended
contract without restoring its salary, roster or overtime. Other separation payments are explicit
Allowance-family entries.

### Encashment on departure

Closing a contract (recording its last day) trips `automations/+leave_encashment_on_exit.ts`. It
reads the leaver's balances on the last day and, when the annual leave row (the code beginning
`ANNUAL`, `lib/leave/codes.ts`) is `can_encash` and has days left, submits one `ENCASHMENT` entry
for the whole balance, settling on the last day and referenced `exit:<employment_id>:<code>`. No
other row is paid out at departure, whatever its `can_encash` says: that flag only admits a manual
encashment. The entry goes through the ordinary HR leave door under the
automation's own policy, so it lands held for the HR Manager or Senior Management: the collection's
`approvalStepRequested` rule puts an `inbox` notification in front of every member of those teams in
the same statement that holds the row, and their decision is the review — approve and the next regular payroll prices
the days at the ordinary day wage; reject and HR enters the agreed figure by hand. The reference is
the idempotency key: a re-run, a later departure-note edit or an entry HR posted first raises
nothing more. A zero balance raises nothing. An `exit_reason` of `DISMISSAL` raises nothing — every
jurisdiction's payout carries a misconduct exception and the engine carries no jurisdiction, so a
dismissed leaver's encashment, if owed, is HR's manual entry. Beyond that there is no encashment
eligibility matrix or exit policy.

## Implementation entry points

| Source                                                    | Responsibility                                                |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| `lib/leave/context.ts`                                    | Guarded, contract-scoped reads and effective rule resolution. |
| `lib/leave/entitlement.ts`                                | Pure annual/fiscal entitlement calculation.                   |
| `lib/leave/balance.ts`                                    | Credit allocation, expiry and reservations.                   |
| `lib/leave/activity.ts`                                   | Pure planning of manual activity and its dated evidence.      |
| `collections/leave_entries/+collection.ts`                | Declared create selection; the transform plans the batch.     |
| `lib/leave/preview.ts`                                    | The shared calendar and selection preview.                    |
| `lib/leave/summary.ts` and `functions/+leave_balances.ts` | Computed balance projection.                                  |
| `lib/leave/payroll.ts`                                    | Leave-owned payroll preparation, outputs and entry links.     |
| `lib/leave/exit-encashment.ts`                            | Pure planning of the departure encashment.                    |
| `automations/+leave_encashment_on_exit.ts`                | Raises it, held for the HR Manager, when a contract closes.   |

Controller → Events → Leave shows the entity's manual activity. Employee → Events → Leave shows
computed balances and the selected contract's entries. Settings → Catalog → Leave owns definitions;
observed holidays belong to the entity's holiday surface.
