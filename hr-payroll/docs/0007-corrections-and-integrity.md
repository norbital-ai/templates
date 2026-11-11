# Reversals and corrections

How a mistake is undone, what must always be true of the ledger, and how the workspace checks it. Structure is in [the architecture](0001-hrms-calculation-architecture.md); the ordinary flow is in [the mechanisms, run through](0008-mechanisms-walkthrough.md).

## 1. The ledger moves only with its record

Every ledger row is written with the record that caused it, and only once that record stands. If the ledger cannot move, the write does not pass.

- **One writer.** Only `src/lib/ledger/service.ts` writes `ledger_entry` and `employee_balance`. An administrator's direct write is refused too.
- **A record carries its postings.** A leave, claim or ad hoc entry, a payroll run and HR's manual adjustment each carry their ledger rows in their own write. The rows commit in the same statement as the record.
- **Held for approval, nothing posts.** While a request waits, nothing is on the ledger. On the final approving decision the request's state change and the postings commit as one statement. A refusal, a conflict or a failure leaves the request waiting and the ledger untouched.
- **A waiting request still holds its days.** The balance does not show it, but the check before a second leave entry counts it, so the same days cannot be asked for twice.
- **No balance row, no entry.** An entry or a payslip for a person whose balance row is not open is refused, in the approving decision too.
- **A run is not a decision.** A run refuses when an entry it would pay still waits for its decision, whoever runs it, including the reviewer whose step it is.
- **Sync.** Entitlements owed by rule are settled by the `ledger` automation: one read, then one write per 50 balances. It writes the difference between what is owed and what is posted, so a retry writes nothing twice.
- **The law's effects on an entry** run under the system identity, whoever keyed the entry, and only once it stands. A request still waiting raises nothing; its posting on approval raises them.
- **No locks.** No write holds a lock across statements, and nothing here uses a transaction that spans statements. Every write above is one short statement.

## 2. Two zones and a boundary

| Zone        | Meaning                   | How it is corrected                                                                 |
| ----------- | ------------------------- | ----------------------------------------------------------------------------------- |
| **Open**    | No run has paid it.       | Edit or delete it. The delete carries the inverse postings in the same statement.   |
| **Settled** | A paid run has priced it. | Never edited. A reversal entry on the same catalogue item undoes it, going forward. |

The boundary between them is the **unpaid run**. An entry sealed by an unpaid run is locked, and deleting that run reopens it. Nothing moves under an unpaid run, by hand or by the system. Once the run is paid, what it sealed is settled.

A reversal entry:

- is made by the HR controller only, from Events, on the same person and catalogue item as the entry it reverses;
- reverses one entry a run has sealed, once, for no more than that entry held;
- is never itself reversed;
- gives the balance back at once, and the money in the next run, priced on the original month;
- can be deleted until a run pays it; after that it stands.

An entry no run has sealed is not reversed. It is deleted.

## 3. Forward and backward

Every act that moves the ledger or raises a dependant, and the way back from each zone. "None" means there is no way back; the way forward is in the same cell or the next row.

| Forward act                               | What it moves                                                                         | Backward while open                                                                                                                                                       | Backward once a paid run holds it                                                                                                                        | Who                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Entry keyed (leave, claim, ad hoc)        | The balance, in the entry's own write                                                 | Edit a wrong amount; delete a wrong date or person and key it again. The delete carries the inverse postings                                                              | A reversal entry on the same item; the next run flips the line                                                                                           | HR; HR controller for reversals |
| Request held for approval                 | Nothing until the approving decision                                                  | The requester withdraws it, or an approver rejects it. The record goes back to what it was and the days can be asked again                                                | Approved, it is the entry: see the first row                                                                                                             | Requester or approver           |
| Request withdrawn by its requester        | The request ends; nothing was posted                                                  | None needed: the person asks afresh                                                                                                                                       | Does not apply                                                                                                                                           | Requester                       |
| Leave cash-out keyed by HR                | The days, drawn on approval; the payout in the next run                               | Delete it; the days come back                                                                                                                                             | A reversal that is itself a cash-out: the next run takes the payout back and the days return, once                                                       | HR; HR controller approves      |
| Reversal entry keyed                      | The inverse of what it reverses, at once; the money in the next run                   | Delete it. Refused if a half day it freed has been booked again                                                                                                           | None: a reversal is not reversed. Key the entry again                                                                                                    | HR controller                   |
| Manual balance row                        | `entitled` of one leave window, or a claim `limit`                                    | A second manual row the other way. No row is ever changed                                                                                                                 | The same                                                                                                                                                 | HR controller                   |
| Statutory adjustment entry (ad hoc)       | The scheme's balance for the closed month it corrects; the money in the next run      | Delete it                                                                                                                                                                 | A reversal entry; it counts in the year of what it reverses                                                                                              | HR; HR controller for reversals |
| Run created                               | Payslips, the seals on what it paid, the payslip postings                             | Delete the run, newest first. The seals and postings come off and the period can run again at the same figures                                                            | None: a paid run is locked whole. A reversal or the right entry goes in the next run; what cannot wait goes in an off-cycle run                          | HR                              |
| Run marked paid                           | The run's state                                                                       | None                                                                                                                                                                      | None                                                                                                                                                     | HR                              |
| Contract ended (an exit)                  | Exit tasks, the leave proration, a held cash-out request, the loan's final settlement | Take the last day off, or seal a successor. The routine in section 4 withdraws what the exit raised. Under an unpaid run the last day cannot change: delete the run first | The paid month stands. Seal a new contract from the next month; one task asks HR to reverse the cash-out; pay cut off goes in as an arrears ad hoc entry | HR ends it; the system follows  |
| Contract version sealed with a wrong term | Entitlements, by sync                                                                 | Draft the replacement first, then void the wrong version, so the chain never reads as an exit                                                                             | The version stands. The right term starts the next month; the difference is an arrears or recovery ad hoc entry, paid once                               | HR                              |
| Contract change filed ahead               | Nothing until its day                                                                 | Edit or cancel it before its day. On its day it seals. If an unpaid run covers the day it stays filed and raises a task: delete the run and make the version              | A paid run covers the day: the change moves to the next month and seals there                                                                            | HR                              |
| Family fact or event sealed               | The leave it opens, by sync                                                           | Seal a correcting version without it; sync takes back the leave it opened. Refused while leave taken stands on the fact: delete that leave first                          | The same, after a reversal gives back the leave a run paid. Tax a run withheld under the fact stands                                                     | HR                              |
| Loan created and scheduled                | Nothing on the ledger; open instalments                                               | Delete the open instalments, then the loan. An open instalment can be edited                                                                                              | A reversal of the instalment a run took; the next run refunds it, once. A loan with a paid instalment cannot be deleted                                  | HR                              |
| Roster day keyed                          | Nothing on the ledger; the run prices it                                              | Change the day on its own row                                                                                                                                             | Locked. Attendance a run priced takes no new day: what it missed is paid by an arrears ad hoc entry in the next run                                      | HR, the kiosk                   |
| Pay group schedule changed                | Later cycles' coverage, cutoff and pay date                                           | Change it back                                                                                                                                                            | A paid run keeps its pay date and coverage; the next cycle follows the corrected schedule. No day of salary is paid by two cycles                        | HR                              |
| Employer version sealed                   | Entitlements, by sync; what later runs read                                           | Void it with a reason and seal a replacement for its dates                                                                                                                | The payslip stands. No later run uses a void version; a replacement does                                                                                 | HR                              |
| Law version sealed (a change merged)      | Entitlements, by sync; what later runs read                                           | Merge a corrective version from the next day, then delete the unpaid run made under the wrong one and run it again. Or void it and merge the release again                | A paid run stands. Later runs need a sealed version covering their pay date: merge the corrective version                                                | HR                              |
| Law version voided                        | No run can be made for the pay dates it covered                                       | None: a void is final. Merge the release again as it should have been, from the version that stood before                                                                 | The same; runs already paid stand                                                                                                                        | HR                              |
| Task fulfilled                            | The task's state                                                                      | None: a fulfilled task keeps its record                                                                                                                                   | Does not apply                                                                                                                                           | HR                              |
| Task waived                               | The task's state                                                                      | Reopen it. The routine reopens only what it waived itself; a task HR waived for its own reason stays waived until HR reopens it                                           | Does not apply                                                                                                                                           | HR, or the system               |

## 4. When an exit is cancelled or its date moves

Every record the system derives names the fact that caused it in `occurrence_key`. The one such fact is an exit: `exit:<contract id>:<last day>`. A moved last day is another fact, so its key changes.

The chain is always the same. The contract's write schedules `ledger` for the people whose exit was raised, moved or cancelled. `ledger` syncs, then starts `encashment`, so a cash-out is sized after the exit's leave proration. `encashment` runs the routine in `src/lib/dependants.ts`, one step per run, each step safe to repeat, until nothing is left. Its last failure raises a task.

What the routine does to each dependant of an exit that no longer stands, or whose last day moved:

| Dependant                                    | Still waiting for approval | Approved, in no run                                | Under an unpaid run                           | In a paid run                                          |
| -------------------------------------------- | -------------------------- | -------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| Leave cash-out request                       | Withdrawn by the system    | Deleted; its days return                           | Untouched. Delete the run and it is withdrawn | One task asks HR to reverse it                         |
| Take-back of leave overdrawn at the last day | Withdrawn by the system    | Deleted                                            | Untouched                                     | Stands. HR keys the leave again                        |
| Exit tasks (the law's duties, the loan task) | —                          | Open ones are waived                               | Open ones are waived                          | Open ones are waived; a fulfilled one keeps its record |
| Loan final settlement                        | —                          | Back to monthly instalments over the loan's period | Untouched                                     | Stands                                                 |

Then, for an exit that stands (the new last day of a moved exit, or an exit raised again):

- One cash-out request is raised per leave row with a `payout`, for the days left, held for HR approval. It is sized under any ordinary leave of that row still waiting for its decision. A row that already has a cash-out a run holds, or one HR keyed, gets no second one.
- A dismissal for misconduct (`exit_ground` `MISCONDUCT_DISMISSAL`) raises none.
- Leave taken beyond what the last day leaves earned is taken back the same way: a reversal of the latest paid half days.
- The tasks the routine waived are opened again. None is raised twice.

The task that asks HR to reverse a paid cash-out is keyed `reverse:<leave entry id>`. HR keys the reversal as a cash-out: the days return at once and the next run takes the money back once. The task is waived when the reversal exists or the exit stands again, and opened again if the exit is cancelled again.

No law version carries a waiving effect. Exit tasks are waived by this routine, the same way for every jurisdiction.

## 5. Invariants

A hard invariant must always hold. A watch can be reached by a legitimate act and is only reported.

| #   | Invariant                                                                                    | Enforced by                                                                     |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| H1  | A balance figure equals the signed sum of its ledger rows per account, code, period, measure | The one writer; checked by the integrity check                                  |
| H2  | Every ledger row names its source, period, measure and amount                                | A database check on `ledger_entry`                                              |
| H3  | A ledger source that still holds something exists                                            | Deletes carry inverse postings; checked by the integrity check                  |
| H4  | Only posting, sync and HR's manual row write the ledger and the balance                      | The model write rules and the one writer                                        |
| H5  | An entry is reversed at most once, only for what a run priced, a cash-out only as a cash-out | Database uniqueness on `reverses`; the reversal check                           |
| H6  | An entry sealed by a run has that run's payslip for its person                               | The run's own write; checked for unpaid runs and runs paid in the last 2 months |
| H7  | Sealed contracts never overlap; states move one way; one on-cycle run per group and period   | Database constraints and state rules; the run's coverage check                  |
| H9  | No open exit task on a contract that is not an exit, or for a last day that moved            | The routine in section 4; checked by the integrity check                        |
| H10 | No approved derived entry outside a run whose fact no longer stands                          | The routine in section 4; checked by the integrity check                        |
| W1  | An entitlement, or what is left of it, below zero                                            | Reported by the integrity check                                                 |

A manual deduction may take a window below zero: days taken stay taken, and HR's row is HR's decision. W1 reports it.

## 6. The integrity check

`src/lib/integrity.ts` reads the workspace in one request and returns findings for H1, H3, H6, H9, H10 and W1. It raises one task per finding, keyed `integrity:<invariant>:<subject>`.

- It only raises tasks. It repairs nothing and writes nothing else.
- A finding with an open task raises nothing more. One that returns after its task was closed raises a dated task.
- It is the last step of the `ledger` automation's whole-workspace pass, not an automation of its own. It adds no wake-up and nothing to start.

The tests that prove this:

- `tests/integrity.test.ts`: a workspace worked through its real acts has no finding; each invariant, broken on purpose, yields exactly its finding; the check raises each finding once.
- `tests/integrity_random.test.ts`: seeded random sequences of real acts, with the acts that try to break the ledger. `HR_SEED` replays one sequence and `HR_STEPS` lengthens it.
- `tests/corrections.test.ts`, `tests/cash_out.test.ts`, `tests/contract_lifecycle.test.ts`, `tests/loan_lifecycle.test.ts`, `tests/approval_flow.test.ts`, `tests/ledger_limits.test.ts`: each mistake above and its way out.

## 7. States with no automatic way back

Each has its manual way out.

| State                                                                        | Manual way out                                                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A cash-out a paid run took, and the exit was cancelled                       | One task asks HR to key the reversal. The system does not reverse it                          |
| A take-back of overdrawn leave a paid run took, and the exit was cancelled   | It is a reversal, and a reversal is not reversed. HR keys the leave again. No task is raised  |
| A paid cash-out reversed, then the exit raised again                         | No second cash-out is raised for that leave row. HR keys it                                   |
| A paid loan final settlement, and the exit was cancelled                     | It stands. The open schedule is untouched and the loan task is waived                         |
| A fulfilled task whose cause was cancelled                                   | It keeps its record                                                                           |
| The contract page settles a leaver's loan in several acts and stops half way | HR regenerates the schedule from the loan form                                                |
| The latest contract version voided before a replacement is drafted           | It reads as an exit until the replacement is drafted. Draft the replacement first             |
| A law version voided                                                         | No run can be made for its pay dates until the release is merged again                        |
| A paid run with a wrong figure                                               | The run is locked. A reversal or an adjustment entry goes in the next run or an off-cycle run |
