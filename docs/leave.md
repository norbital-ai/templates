# Leave accounts, applications, and statutory change

This is the source of truth for the implemented leave system.

## The model

| Record           | Job                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jurisdictions`  | Immutable, effective-dated statutory profile versions. Each leave kind states its legal floor, eligibility, units, transition rule, carry floor, and authority. |
| `leave_plans`    | Immutable, effective-dated company policy versions. HR prepares a draft; one manager approval activates it.                                                     |
| `leave_types`    | Rules inside one company plan version. Each is yearly or tied to one qualifying event and may map to a statutory kind.                                          |
| `leave_accounts` | One sealed calculation receipt per employment and yearly or qualifying-event window.                                                                            |
| `leave_entries`  | Append-only signed movements inside an account.                                                                                                                 |
| `leave_requests` | Time-off applications only. They never double as balance corrections or carry records.                                                                          |

There is no allocation table, yearly HR batch, provisional carry, live entitlement recalculation, or
balance column on a person. A balance is a sum of posted ledger entries.

```text
available(as_of)
  = SUM(leave_entries.days WHERE effective_on <= as_of)
  - held application days
```

Positive entries grant or restore days. Negative entries take, encash, transfer, or expire days.
Corrections append another entry; posted history is never edited.

## Who does what

The HR Controller does not create yearly accounts for each employee and does not run a yearly
process.

Normal work:

1. Prepare a draft company leave-plan version and its leave types.
2. Set the effective date and how a mid-year change applies.
3. Submit the plan lifecycle change.
4. One HR Manager or Senior Management approver activates it.

The system then creates missing current- and next-year accounts and reconciles affected open
accounts. The daily repair sweep is idempotent and catches missed event delivery without requiring
an operator action. It also creates a current-year account when an employee first becomes eligible:
up-front leave is granted then; company-only monthly leave receives its remaining schedule, while a
statutory monthly rule may also post the law's completed-service catch-up.

An employee application has a separate, single approval stage. Any one L1 Manager, HR Manager, or
Senior Management approver can approve it. Those are alternative approvers, not sequential layers.
The request hook validates the candidate; it is not an approval layer.

An exceptional balance correction is also append-only. The HR Controller enters one
`MANUAL_ADJUSTMENT` with a reason and unique reference; any one HR Manager or Senior Management
approves it. This path corrects evidence and is never part of yearly account creation.

For leave earned by a qualifying event, HR verifies the actual event date, any distinct statutory
cohort date, the employee's allocated profile units, weekly index when the law measures weeks, the
window and the evidence once. The resulting `EVENT` account is the allocation fact; a controller's
create has one HR Manager/Senior Management approval, while those approvers may create it directly.
The account-created automation posts its opening entry. There is no separate allocation table or
second request approval.

## Full browser-to-ledger flow

```text
HR CONTROLLER       MANAGER APPROVAL       RECONCILER             EMPLOYEE BROWSER       REQUEST HOOK         REQUEST APPROVAL      LEDGER / PAYROLL
-----------------   ---------------------  ---------------------  ---------------------  -------------------  --------------------  ----------------------
Draft leave plan
and leave types
       |
Set effective date
and transition
       |
Submit ACTIVE ----> one HR Manager or
                    Senior Management
                    approves
                              |
                              +----------> resolve statutory profile
                                           + active company plan
                                                     |
                                           for each eligible employment
                                           and leave type
                                                     |
                                           missing year account?
                                             | yes             | no
                                             v                 v
                                           create sealed      keep stored
                                           account receipt    calculation
                                             |
                                           append opening or monthly
                                           entitlement entries
                                             |
                                           current-year rule changed?
                                             | yes
                                             v
                                           append one statutory or
                                           policy adjustment entry
                                             |
                                             +-----------------------> balance UI reads account
                                                                       + posted entries
                                                                                |
                                                             choose account + dates
                                                                                |
                                                             preview ----------> schedule, overlap,
                                                                                 eligibility, account,
                                                                                 balance, payroll lock
                                                                                |
                                                             submit -----------> rerun same checks;
                                                                                 normalize charged days
                                                                                           |
										 one pending request ----> any ONE L1 / HR Manager /
                                                                                                          Senior Management approves
                                                                                                                     |
                                                                                                          commit request row
                                                                                                                     |
                                                                                                                     +--------------> append TAKEN entry
                                                                                                                                        |
                                                                                                                     approved unpaid leave ----> payroll deduction
                                                                                                                     approved paid leave ------> balance only
                                                                                                                                        |
                                                     payroll capture ----------> freezes request

Qualifying event ---> HR verifies actual event, statutory cohort, household reference,
                      allotted days/weeks, weekly index and use-by date
                              |
                              +----> one reviewed EVENT account ----> one opening ledger entry
                                                                        |
                                                                        +----> same application flow above
```

## Year close, carry, cash and leaving early

Accounts are generated for the previous, current and next leave year. Each account is compiled with
two rules, and both are shown on the balance row with who decided them:

- `settlement` — what the year does with its unused balance: `FORFEIT`, `CARRY { limit_days,
expiry_months }` or `COMMUTE { pay_basis }`.
- `exit_settlement` — what the balance does when the employment ends: `FORFEIT` or
  `PAY_OUT { pay_basis, misconduct_forfeits }`.

The statute's kind is binding. A company plan may only widen a statutory carry (a higher limit,
a later or no expiry); it can never change the kind. Where the statute says FORFEIT, or has no
member for the leave kind, the company plan decides. `settlement_source` and
`exit_settlement_source` record which side won.

A leave year closes once, on its end date, by the reconciler:

```text
balance at year end = 6 days

CARRY  { limit 5, expiry 3 months }      COMMUTE { ORDINARY_DIV26 }       FORFEIT
  old: CARRY_TRANSFER_OUT   -5             old: COMMUTED  -6                old: EXPIRED  -6
  new: CARRY_FORWARD        +5             leave_payouts: 6 x rate          (nothing owed)
       expires_on = 31 March
  old: EXPIRED              -1
  old: status -> CLOSED                    old: status -> CLOSED            old: status -> CLOSED
```

Every close line is keyed `close:<account>`, so a rerun restates and never doubles. A request
still pending approval holds the close until it is decided. An account receives at most one
carried lot (from its predecessor); on the lot's expiry date whatever of it was not taken lapses
as one `EXPIRED` line, and a later restore appends only the delta.

Leaving early closes every open account on the exit date. With `PAY_OUT` the balance becomes an
`ENCASHED` line and a payout priced at the exit-date terms; `MISCONDUCT` as the employment's
`exit_reason` forfeits it where the statute says so. With `FORFEIT` the balance lapses.

The money is the ledger line itself. Payroll prices each `COMMUTED` and `ENCASHED` line when it
prints it: the days on the line, the statute's basis from the account's rule (`pay_basis`), and
the terms in force on the line's date. Nothing stores an amount. The company's `LEAVE_PAYOUT` pay
component (source `LEAVE_PAYOUT`) prints the total as a base line: a year-end line on the run
whose period its date names under the pay cutoff, an exit line on the final slip, the run whose
salary window covers the exit date. Its statutory treatment is the component's, like any other
earning.

Event accounts do not roll over. One account covers the statutory or company event window, even
across calendar years; at the end of the window the reconciler expires the unused balance and
closes the account.

## Statutory qualification and event cohorts

Each statutory leave member can independently state:

- yearly versus qualifying-event coverage;
- minimum completed service months;
- upfront versus monthly vesting and the statute's own half-day or whole-day rounding rule;
- an event window and individual or shared-household allocation scope;
- whether an event allocation is measured in days or weeks, including its weekly-index cap; and
- the effective profile range that selects the legal cohort.

Company eligibility does not suppress a statutory floor. When a statutory monthly entitlement first
becomes available after a service wait, the opening movement catches up completed service months and
future monthly movements continue from there. Company-only monthly leave still earns only future
scheduled months.

For a cohort change such as Singapore shared parental leave, the reviewed statutory cohort date
selects the sealed legal version while the actual birth/FIA date anchors the use-by window. They are
normally equal; a reviewed exception such as an early birth with a later estimated delivery date can
differ without moving the 12-month window. Week allocations are multiplied by each employee's
verified working-days-per-week index and the final duration is floored to a half day. Both parents
across every company and leave code in the tenant share the same normalized event reference and law
cohort, so committed and held allocated weeks are summed before another portion can be approved.
Bolt rechecks those observed reads under ordered table locks in the write/approval transaction, so
two concurrent allocations cannot both commit from the same prior total.

Every statutory member must have a company-plan leave type mapped by kind, account basis and event
unit. When law introduces a new category, HR must add that mapping before reconciliation can resume.
Company reconciliation refuses loudly while it is missing; it never reports success while silently
omitting a legal floor. Amount-only successors of an already mapped kind need no company-plan change.

## Mid-year changes

Both statutory members and company plans state one transition:

| Transition               | Current-year result                                                       |
| ------------------------ | ------------------------------------------------------------------------- |
| `FULL_AT_EFFECTIVE_DATE` | Append the full difference on the effective date.                         |
| `PRORATE_REMAINDER`      | Append the difference prorated over the unelapsed part of the leave year. |
| `NEXT_LEAVE_YEAR`        | Do not alter the current account; the next account uses the new target.   |

Reconciliation compares the new target with prior award entries, never with remaining balance after
leave was taken. Re-running the same version is a no-op because every generated movement has a
stable source key. `PRORATE_REMAINDER` calculates one rounded half-day delta and posts it on the
effective date; it does not silently change the already scheduled monthly entries.

The calculation receipt uses the employment and child facts effective on the date it is created.
Once created, an account is sealed: ordinary service-time or fact drift does not continuously rewrite
its target. A new leave year, a newly satisfied eligibility rule, or an approved statutory/company
version is an explicit compilation point.

For a regulatory change, HR reviews the researched statutory successor and its effective date once.
Approval seals the legal version. The reconciler finds every company in that law family, recalculates
the target for each affected open account, and appends the required adjustment. Future-year changes
need no further action.

## Application rules

A request is refused unless:

- its employment, leave type, plan, and account are approved and consistent;
- the open account covers the complete date range;
- employment terms and roster codes can measure every selected day;
- the range is after hire, before exit, and outside paid payroll windows;
- it does not overlap an approved or held request;
- it contains chargeable scheduled work time;
- the employee satisfies the leave type eligibility rules;
- a limited account has enough posted balance after held applications; and
- required evidence is attached.

`UNLIMITED` leave still receives a yearly account and follows the same approval and payroll rules,
but skips only the balance ceiling. It is intended for unmetered categories such as unpaid leave.

## Payroll and correction

Only approved request rows reach payroll. Paid leave creates no money adjustment. Unpaid leave maps
to its configured deduction component. Every consumed request receives a
`payslip_leave_request_inputs` capture; after capture the request is immutable.

Deleting or changing an uncaptured approved request causes reconciliation to append the exact
`RESTORED` or additional `TAKEN` delta. Account calculation receipts and ledger entries themselves
remain immutable. On employment exit, the remaining positive balance is appended as `ENCASHED` when
the sealed leave type requires encashment, otherwise as `EXPIRED`; the account then closes.
