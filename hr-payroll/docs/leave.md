# Leave

Leave is a payroll family with a versioned catalogue, immutable manual activity and computed
balances. Payroll consumes the family's prepared outputs and captures.

## Records and ownership

| Record                 | Responsibility                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `leave_catalogue`      | A stable leave code within a sealed settings revision: eligibility, an entitlement matrix, whether a day is `paid`, a certificate threshold and one `treatments` matrix (scheme × absence/encashment). An unpaid day is deducted under the leave's own code and an encashed day is paid under `${code}_ENCASHMENT`; both orders are constants in `lib/leave/pay-items.ts`. |
| `leave_entries`        | An approved or pending manual transaction against one employment contract, with a supporting reference. Approval freezes dated charges and credit allocations.                                                                                                                                                                                                             |
| `payslip_leave_inputs` | The dates or monetary obligation consumed by a payslip, with the exact signed amount and pay-item metadata.                                                                                                                                                                                                                                                                |

`employment_id` identifies one contract with one legal entity. Entitlement, service bands, usage,
reservations, carry and encashment remain within that contract. A rehire creates another contract
and starts a fresh calculation. One employee profile can hold contracts in different entities;
their leave pools and payouts remain separate. Contracts for the same employee and entity cannot
overlap.

A linked input seals the employment contract. Recording departure separately bounds its service
without rewriting the signed contract. Ending employment does not create a leave transaction,
encashment request or separation payment.

## Catalogue and entitlement

An entity's `settings_code` selects a settings lineage. Settings → Catalog → Leave edits the leave
catalogue within its selected draft revision. A sealed revision and its catalogue rows are
immutable; changed rules require a successor revision. Codes identify leave types across revisions.

The entitlement definition contains:

| Field              | Values and meaning                                                                  |
| ------------------ | ----------------------------------------------------------------------------------- |
| `availability`     | `UPFRONT`, `MONTHLY` or `UNLIMITED`.                                                |
| `year_start_month` | The first month of the annual leave window, including fiscal years.                 |
| `proration`        | `NONE`, eligible `CALENDAR_MONTHS`, `COMPLETED_MONTHS` or eligible `CALENDAR_DAYS`. |
| `bands`            | Annual quantities by completed months of service on this contract.                  |

Queries select the rule and service band effective on the requested date, bounded by the source
window and the contract's departure. Eligibility uses effective terms and applicable child facts.
Monthly availability releases earned amounts at calendar month end. Quantities round to half days.
Unlimited leave has no finite ceiling; its scheduled dates and eligibility still require validation.

A full upfront grant can be available before the same quantity is earned under a prorated rule.
Encashment and outgoing carry validate earned quantities, including existing commitments.

An empty eligibility expression includes everyone. Expressions use the shared person context:

```text
employee.gender  employee.age  employee.citizenship  employee.spouse_status
employment.type  employment.classification  employment.service_months  employment.hire_date
terms.basic_salary  terms.workman  terms.department  terms.payroll_group
terms.ordinary_hours_per_week  terms.working_days_per_week
children.count  children.under(age)
```

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

Every entry requires `employment_id`, `leave_catalogue_id`, `event` and a `reference` unique within
that contract. The server resolves the stable leave code and derives `charges` and `allocations`;
callers cannot substitute those approval inputs.

| Category        | Entered facts                                                                                              | Effect                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `TIME_OFF`      | Start/end dates and halves, optional reason and required certificate.                                      | Charges scheduled work time on exact dates.                          |
| `ENCASHMENT`    | Source window, days, agreed gross amount and currency, optional explanatory rate, effective and due dates. | Reserves earned leave and creates an agreed monetary obligation.     |
| `CARRY_FORWARD` | Source/destination windows, days, availability date and expiry.                                            | Debits the source and creates an expiring credit in the destination. |
| `ADJUSTMENT`    | Window, signed days, effective date and reason.                                                            | Applies a documented exceptional change to the balance.              |
| `REVERSAL`      | Original entry, effective date, reason and a due date when reversing paid money.                           | Reverses the original allocations and any paid outputs exactly.      |

Employees submit their own time off. Time off is reviewed by an eligible L1 Manager, HR Manager or
Senior Management approver. Other manual categories are HR actions; controller submissions require
HR Manager or Senior Management approval. Approved entries cannot be edited, deleted or moved to a
different contract. Corrections use a linked reversal and, where needed, a replacement entry.

### Time-off approval

The shared preview and submission planner check contract dates, effective catalogue eligibility,
terms, work patterns, roster overrides, observed entity holidays, occupied halves, paid
payroll windows, available credit and certificate requirements.

A multi-day range retains each chargeable date. Holidays and rest/off days are excluded. Two
opposite half-day entries may share a date; overlapping approved or pending halves are refused.
Cross-month or cross-year ranges allocate each charge to its own annual window and payroll date.
The submitted `chargeable_days` is replaced by the measured quantity.

```mermaid
flowchart LR
    UI[Employee or HR submission] --> Preview[Shared Leave planner]
    Preview --> Review[Approval with held debit reservations]
    Review --> Validate[Revalidate complete contract batch]
    Validate --> Entry[Immutable Leave entry]
    Validate --> Seals[Charges carry their calendar and terms]
    Entry --> Family[Leave payroll preparation]
    Family --> Payroll[Regular payroll and captures]
```

Batch approval validates the whole contract batch deterministically. Replay excludes its own held
proposals while retaining reservations from other batches. The entry, dated evidence and contract
seal commit in the same graph. Consumed holiday evidence remains sealed if its original consumer
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
March 31. The single `CARRY_FORWARD` entry contains a five-day source debit dated December 31 and a
five-day destination credit dated January 1. Approval may occur in January; the named windows and
allocation dates determine both balances.

With twelve upfront days in 2027, the opening available quantity is seventeen. Three days used in
February consume carry first. On April 1 the unused two carried days expire in the query, leaving
the twelve annual days. No expiry job or additional close entry is required.

Carry-forward is always an explicit HR transaction. Calendar rollover and departure create none.

## Payroll interface and encashment

`lib/leave/payroll.ts` owns preparation, source selection, approved date coverage and calculation.
The payroll engine receives prepared Leave data for each contract. Work supplies date-specific
absence rates; Leave returns standard pay items and captures for payroll settlement and
Contribution treatment.

- Paid time off supplies approved coverage and a zero-money capture.
- Unpaid time off supplies reductions for its exact captured dates, using Work's applicable rate
  and the `absence` column of the leave's treatments; the deduction covers whom the leave covers.
- Encashment supplies the entered gross amount. An optional entered rate must reconcile to that
  amount; payroll does not derive or replace it from salary.
- Carry and adjustments change quantities without directly creating payroll money.
- A paid reversal negates the original captured amount, economic direction and contribution
  treatments. A draft capture must first be deleted or settled before its source can be reversed.

Standing captures prevent the same dated slice or single monetary obligation being consumed twice.
Cross-month leave is captured by the relevant dates in each regular run. Captures retain exact
catalogue/settings identifiers, pay-item metadata, quantity, rate and signed gross amount.

There is one regular payroll per entity and period. Late approved encashment and monetary
corrections settle in a later regular period. Outstanding Leave money can include an ended
contract without restoring its salary, roster or overtime. Other separation payments are explicit
Payment-family entries.

A departure reason, including misconduct, never decides encashment automatically. HR records the
actual departure, reviews the contract's balance and any settlement agreement, and submits the
agreed transactions. There is no encashment eligibility matrix, automatic valuation or exit policy.

## Implementation entry points

| Source                                                    | Responsibility                                                |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| `lib/leave/context.ts`                                    | Guarded, contract-scoped reads and effective rule resolution. |
| `lib/leave/entitlement.ts`                                | Pure annual/fiscal entitlement calculation.                   |
| `lib/leave/balance.ts`                                    | Credit allocation, expiry and reservations.                   |
| `lib/leave/activity.ts`                                   | Pure planning of manual activity and its dated evidence.      |
| `collections/leave_entries/+hooks.ts`                     | Approval validation, immutable entries and nested seals.      |
| `lib/leave/preview.ts`                                    | The shared calendar and selection preview.                    |
| `lib/leave/summary.ts` and `functions/+leave_balances.ts` | Computed balance projection.                                  |
| `lib/leave/payroll.ts`                                    | Leave-owned payroll preparation, outputs and captures.        |

Controller → Events → Leave shows the entity's manual activity. Employee → Events → Leave shows
computed balances and the selected contract's entries. Settings → Catalog → Leave owns definitions;
observed annual holidays belong to the entity's holiday calendar surface.
