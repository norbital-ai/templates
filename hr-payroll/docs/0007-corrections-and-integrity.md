# 0007 — Corrections and integrity

How a mistake is undone, what must always be true of the ledger, and how the workspace proves it. Nothing here
changes the calculation engine. Section 0 of [0001](0001-hrms-calculation-architecture.md) still governs.

## 1. The ledger moves only with its record

Owner, 2026-11-11: every ledger entry happens on approval only, in the approval's own changeset; if the ledger cannot
move, the approval does not pass. Nothing locks the database.

- **One writer.** Only `src/lib/ledger/service.ts` writes `ledger_entry` and `employee_balance.account`.
- **A record carries its postings.** A leave, claim or ad hoc entry, a payroll run and HR's manual adjustment each
  return their ledger rows from their own write as `onApproved`. The rows commit in the same statement as the record.
- **Held for approval, nothing posts.** While a request is pending the engine drops what the write carries. On the
  final approving decision it asks the model again and commits the request's state change and the postings as one
  statement. A refusal, a conflict or a database failure leaves the request pending and the ledger untouched.
- **No balance row, no entry.** An entry or a payslip for a person whose balance row is not open is refused, in the
  approving decision too. It is never saved with nothing on the ledger.
- **A run is not a decision.** A run refuses when an entry it would pay still waits for its decision, whoever runs it,
  including the reviewer whose step it is.
- **Sync.** Entitlements owed by rule are settled by the `ledger` automation: one read, then one act per 50 balances.
  It writes the difference between what is owed and what is posted, so a retry or a second run writes nothing twice.
- **No locks.** The template uses no `ctx.transaction`, no interactive session and no lock held across statements.
  Every write above is one short statement. The engine locks the tables a commit writes for that one statement only,
  bounded by a 5-second lock wait and a 15-second statement limit: writers queue briefly, readers never wait.

## 2. Two zones

| Zone        | Meaning                                        | How it is corrected                                                                 |
| ----------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Open**    | No run has paid it.                            | Edit or delete it. The delete carries the inverse postings in the same statement.   |
| **Settled** | A run has priced it; the run may also be paid. | Never edited. A reversal entry on the same catalogue item undoes it, going forward. |

Between them: an entry sealed by an **unpaid** run is locked, and deleting that run reopens it. Nothing moves under an
unpaid run, by hand or by the system.

## 3. Invariants

Hard invariants must always hold. A watch can be reached by legitimate acts and is only reported.

| #   | Invariant                                                                                    | Enforced by                                                                                    |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| H1  | A balance figure equals the signed sum of its ledger rows per account, code, period, measure | Construction (the one writer); checked by `integrity`                                          |
| H2  | Every ledger row names its source, period, measure and amount                                | Database check `names_its_movement` on `ledger_entry`                                          |
| H3  | A ledger source that still holds something exists                                            | Deletes carry inverse postings; checked by `integrity`                                         |
| H4  | Only posting, sync and HR's manual row write the ledger and the balance                      | The model transforms and the one writer                                                        |
| H5  | An entry is reversed at most once, only for what a run priced, a cash-out only as a cash-out | Database uniqueness on `reverses`; `assertReversals`                                           |
| H6  | An entry sealed by a run has that run's payslip for its person                               | The run's own write; checked by `integrity` for unpaid runs and runs paid in the last 2 months |
| H7  | Sealed contracts never overlap; states move one way; one on-cycle run per group and period   | Database constraints and state triggers; the run's coverage check                              |
| H9  | No open exit task on a contract that is not an exit, or for a last day that moved            | The dependants routine (section 8); checked by `integrity`                                     |
| H10 | No approved derived entry outside a run whose fact no longer stands                          | The dependants routine (section 8); checked by `integrity`                                     |
| W1  | An entitlement, or what is left of it, below zero                                            | Reported by `integrity`                                                                        |
| W2  | A pending derived request whose fact no longer stands                                        | It cannot be approved; `integrity` raises the task that tells HR to reject it                  |

A manual deduction may take a window below zero: days taken stay taken, and HR's row is HR's decision. W1 reports it.

## 4. The `integrity` automation

`src/lib/integrity.ts` `verify` reads the workspace in one request (ten roots, paged) and returns findings for H1, H3,
H6, H9, H10, W1 and W2. `src/automation/+integrity.automation.ts` raises one task per finding, keyed
`integrity:<invariant>:<subject>`.

- It only raises tasks. It repairs nothing and writes nothing else.
- A finding with an open task raises nothing more. One that returns after its task was closed raises a dated task.
- It runs at the end of the `ledger` automation's whole-workspace pass, so it adds no wake-up. HR can start it by hand.

## 5. Proof by tests

- `tests/integrity.test.ts`: a clean workspace has no findings; each invariant, broken on purpose, yields exactly its
  finding; the automation raises once.
- `tests/integrity_random.test.ts`: seeded random sequences of real acts (leave, claims, ad hoc entries, manual rows,
  runs, deletes, payments, approvals, clock moves, an exit raised, moved and cancelled) with the acts that try to
  break it: the same act twice, entries on a void contract, a run made and deleted, direct writes to the ledger, the
  balance and a payslip by HR, the employee and an administrator. After every step: no failed automation, a refused
  act changed nothing, no hard finding, an independent sum of the ledger equals the balance, a paid payslip is
  unchanged, every payslip and seal names a run, and what sealed entries pay is on payslips once. `HR_SEED` and
  `HR_STEPS` replay or lengthen a sequence.
- `tests/corrections.test.ts`, `tests/cash_out.test.ts`, `tests/contract_lifecycle.test.ts`,
  `tests/loan_lifecycle.test.ts`, `tests/approval_flow.test.ts`: each mistake below and its way out.

## 6. Forward and backward

Every act that moves the ledger or raises a dependant, and the way back from each zone. Each cell is one act (one
statement) unless it says otherwise. "none" means there is no way back: the way forward is in the next column or row.

| Forward act                           | What it moves                                                                                        | Backward while open                                                                                                                                        | Backward once paid                                                                                                                                                   | Who                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Entry created (leave, claim, ad hoc)  | The balance, in the entry's own write                                                                | Edit or delete it; the delete carries the inverse postings                                                                                                 | A reversal entry on the same catalogue item, once, for no more than it held; the next run flips the line                                                             | HR                             |
| Reversal entry created                | The inverse of what it reverses, at once; the money in the next run                                  | Delete it                                                                                                                                                  | none: a reversal is not reversed. Key the entry again                                                                                                                | HR controller                  |
| Manual balance row                    | `entitled` (or a claim `limit`) of one window                                                        | A second manual row the other way                                                                                                                          | The same                                                                                                                                                             | HR controller                  |
| Run created                           | Payslips, the seals on what it paid, payslip postings                                                | Delete the run, newest first: the seals and postings come off                                                                                              | none: a paid run is locked. A reversal or an adjustment entry goes in the next run or an off-cycle run                                                               | HR                             |
| Run paid                              | The run's state                                                                                      | none                                                                                                                                                       | none                                                                                                                                                                 | HR                             |
| Contract ended (an exit)              | Exit tasks, leave proration, a held cash-out request, the loan settlement keyed on the contract page | Take the last day off, or draft a successor: the routine in section 8 withdraws them. Under an unpaid run the last day cannot change: delete the run first | The paid month stands. Seal a successor from the next month; the routine raises one task and HR keys the cash-out's reversal; pay cut off goes in as an ad hoc entry | HR ends it; the system follows |
| Contract version sealed with a change | Entitlements, by sync                                                                                | Void the version (draft its replacement first), or seal a correcting version from the same date                                                            | Seal a correcting version from the next month; arrears or recovery go in as ad hoc entries                                                                           | HR                             |
| Family fact sealed                    | The leave it opens, by sync                                                                          | Seal a correcting version. Refused while leave taken stands on the dropped fact: delete or reverse that leave first                                        | The same, with a reversal for leave a run paid                                                                                                                       | HR                             |
| Loan created and scheduled (two acts) | Nothing on the ledger; open instalments                                                              | Delete the open instalments, then the loan                                                                                                                 | A reversal of the instalment a run took, refunded by the next run                                                                                                    | HR                             |
| Request held for approval             | Nothing until the approving decision                                                                 | An approver rejects it: the record goes back to what it was. The requester cannot withdraw it                                                              | Approved, it is the entry: see the first row                                                                                                                         | Approver                       |

## 7. Known residue

States with no automatic way back. Each has the manual way out named.

- **Pending request of a cancelled exit.** Only an approver changes a held record. Approving it is refused; HR rejects it
  (W2 raises the task). The same holds when the exit date moved after the request was raised: the request keeps its
  first size, and HR rejects it and the routine raises it again on its next pass.
- **A paid cash-out of a cancelled exit.** The system does not reverse it. One task asks HR to key the reversal.
- **A reverse task is raised once for an entry.** Waived because the exit stood again, it is not raised a second time if
  that exit is cancelled again. HR keys the reversal without a task.
- **A reverse task stays open after HR keys the reversal** until the routine next looks at that contract. HR may close
  it by hand.
- **Take-back of overdrawn leave, paid, then the exit cancelled.** It is a reversal, and a reversal is not reversed. HR
  keys the leave again.
- **A paid cash-out reversed, then the exit raised again.** No second cash-out is raised for that leave row. HR keys it.
- **A fulfilled exit task** keeps its record.
- **A paid loan final settlement stands** (owner). The loan's repayment period stays as the settlement moved it.
- **The contract page settles a leaver's loan in several acts**, not one. Stopped half way, HR regenerates the schedule
  from the loan form.
- **Latest contract version voided before a replacement is drafted.** It reads as an exit. Draft the replacement first.
- **An employee's own request and the law's registered effects.** A leave or claim entry's effect runs as its writer.
  An employee cannot read `registered_effect`, so the effect fails when they ask, and a duty the law registers on that
  leave is not raised. HR-keyed entries are unaffected.
- **A law version voided when the law never changed.** The research automation finds no standing version. File the
  finding by hand.

## 8. Dependants of a fact

Owner, 2026-11-11: every derived record names the fact that caused it. When the fact is cancelled, one routine handles
each dependant: withdrawn while nothing has paid it, a task asking HR to reverse it once a run has; nothing under an
unpaid run moves.

- **The key.** `occurrence_key` is `<fact>:<record id>`. `obligation` has it; `leave_catalog_entry` has it hidden, set
  only by the system. The one fact today is an exit: `exit:<contract id>` on a cash-out, and an exit task's key carries
  `:exit:<last day>` (the loan task too: `LOAN_RECOVERY:<contract>:exit:<last day>`; the older key without `:exit:` is
  still read). The task asking for a reversal is `reverse:<leave entry id>`. The database allows one live keyed entry a
  fact and catalogue row.
- **A derived entry posts only while its fact stands.** The leave entry's write refuses otherwise, in the approving
  decision too, and says to reject the request.
- **The chain.** The contract's write schedules `ledger` for the people and contracts whose exit was raised, moved or
  cancelled. `ledger` syncs, then starts `encashment` for those contracts, so a cash-out is sized after the exit's
  proration and the two never write at once. A run that sealed a keyed entry, deleted or paid, starts `encashment`
  directly. It retries; its last failure raises a task.
- **The routine.** `src/lib/dependants.ts` `reconcile`: up to three passes in one run. Each pass reads afresh and takes
  the first step that has work, one act, safe to repeat:
  1. **Withdraw.** Approved keyed entries in no run, of a cancelled exit or of a last day that moved, are deleted, their
     postings inverted in the same statement; a loan still holding an unpaid final settlement goes back to monthly
     instalments over its period.
  2. **Raise.** A contract at a time, one held request: the cash-out of an exit that stands, sized under any ordinary
     leave of that row still waiting for its decision. A row that already has one is left alone.
  3. **Tasks.** Open exit tasks of a cancelled exit, or of an earlier last day, are waived. A keyed cash-out a paid run
     took, whose exit was cancelled, gets one task asking HR to reverse it; the task is waived once the reversal exists
     or the exit stands again.
- **Three zones.** Open: withdrawn. Under an unpaid run: untouched and no task; the run deleted, it is open again and
  withdrawn; the run paid, it is settled. Paid: one task; HR keys the reversal as a cash-out, the days return at once and
  the next run takes the money back once.
- **A moved exit.** A cash-out approved and in no run, with half a day or more left or overdrawn after the new
  proration, is withdrawn and raised again. Nothing else is resized.
- **Exit tasks are waived by this routine**, the same way for every jurisdiction. No law seed carries a waiving effect.
  A workspace whose sealed law still has the old one is unaffected: both waive only open tasks.
