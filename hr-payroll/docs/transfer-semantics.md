# Transfer semantics

Status: normative design for employment changes. The source tree is the final authority; this
document states the rules the data and payroll must satisfy, then records which parts are already
enforced.

## 1. Terms

- **Employment** — the continuous relationship between a person and the employer group. It owns
  one `employee_balance`.
- **Contract** — dated terms for one entity and one jurisdiction version. A person has a chain of
  contracts, not a balance per contract.
- **Same-jurisdiction transfer** — the successor contract's `jurisdiction_settings.code` equals the
  predecessor's. Entity may change; the law does not.
- **Cross-jurisdiction transfer** — the successor's jurisdiction code differs. The old employment
  under that law ends; a new employment under the new law begins.
- **Promotion** — same jurisdiction and same entity; `reason = Promotion`; terms change.
- **Termination** — the contract ends with no successor. This is an exit.
- **Void** — a sealed record is cancelled with a reason. It is not a transfer and not a deletion.

The comparison is always by **jurisdiction lineage code**, never by entity id and never by the
version id (two versions of the same law are one jurisdiction).

## 2. Contract state machine

```text
DRAFT ──seal──► SEALED ──void──► VOID
  ▲                │
  │                ├── set last day + successor exists ──► replacement continues
  │                └── set last day + no successor ──────► exit
  └── create replacement draft (may overlap the current sealed contract)
```

Rules:

1. A replacement is created as `DRAFT` first. A draft may overlap its predecessor.
2. The predecessor gets its last day before the replacement is sealed.
3. Two `SEALED` contracts for one employee must never overlap. The successor starts the day after
   the predecessor's last day. The overlap rule is employee-wide, so it also covers a successor in
   another entity. A draft may overlap; sealing it is refused until the predecessor ends.
4. The successor keeps the employee number; it does not create a new employee profile or balance.
5. A sealed record is read-only except for the fields its state allows. Void is the only way to
   cancel it; there is no delete verb.
6. A void requires a reason and is irreversible. A record already captured by a finalised payroll
   run may still be voided, but no later run may use it.

The overlap rule is now employee-wide. A live probe sealed a TH draft while the MY contract was
still open and got `overlap`; after the MY contract ended on 2026-11-04 the same seal committed.

## 3. Balance semantics

`employee_balance` is one row per employee. `entity_id` on that row is administrative; payroll reads
the row by `employee_id` only.

| Scenario                                 | Leave                                                                 | Loans                                         | Ledger history      |
| ---------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------- | ------------------- |
| Promotion, same entity                   | Carry unchanged                                                       | Carry unchanged                               | Keep                |
| Transfer, same jurisdiction              | Carry unchanged                                                       | Carry unchanged                               | Keep                |
| Cross-jurisdiction, leave encashable     | Normal exit encashment: deduct the balance, pay in the old final run  | Settle or assign before transfer              | Keep; old rows stay |
| Cross-jurisdiction, leave not encashable | Explicit `CARRY` or `FORFEIT` policy; never implicit                  | Settle or assign before transfer              | Keep; old rows stay |
| Cross-jurisdiction, policy missing       | **Refuse the transfer** until a policy is declared                    | **Refuse** while an outstanding loan remains  | Keep                |
| Termination                              | Encash if the jurisdiction permits; otherwise forfeit/carry by policy | Settle before the final run; otherwise refuse | Keep                |

### 3.1 Leave

Leave is jurisdiction law, not a portable company currency. The old jurisdiction declares one of:

- **ENCASH** — create the normal `leave_catalog_entry` with `encashment: true`; approval deducts the
  balance, the old jurisdiction's final run pays the conversion in `FINAL_PAY`. This is implemented
  for MY.
- **CARRY** — post a dated ledger movement from the old leave account into an explicitly named
  carried-leave account (for example `leave.CARRIED_ANNUAL_LEAVE`) with an expiry date. The new
  jurisdiction's payroll must understand that account. Do not leave days under a statutory code the
  new law does not recognise.
- **FORFEIT** — post a dated deduction/removal with the policy reason. No pay line.
- **Missing / unclear** — refuse the cross-jurisdiction transfer. Silent carry is not allowed.

SG's current seed has no `encash_on_exit`. Under this design an SG→TH transfer is therefore refused
until SG declares `CARRY` or `FORFEIT` (or an encashment rule is added with statutory evidence).
That is deliberate: carrying SG statutory leave into TH without a decision is not a valid default.

### 3.2 Loans

A loan is a receivable of the old employer. It does not disappear because the person changes
jurisdiction.

- **Same jurisdiction** — carry. The loan and its open schedule are repointed to the successor
  contract; for a cross-entity move the loan's `entity_id` and the open repayments move with it.
  Sealed repayments keep their original entity and employment. Payroll selects the open repayments
  by entity and `paid_on`.
- **Cross-jurisdiction** — transfer or settle before the old contract ends:
  - **TRANSFER**: when the target settings have a loan catalogue with the same code, create the
    target loan and monthly schedule from the outstanding principal, delete the old open schedule,
    and post a dated `DEDUCT` + `ADD` `loan` ledger pair.
  - **SETTLE**: otherwise, or when the user checks **Settle from final pay instead of transferring**,
    delete the old open schedule, create the settlement repayment, and post a dated `DEDUCT` `loan`
    ledger movement.
- **No decision** — the sheet defaults to TRANSFER when the target has the code, otherwise SETTLE.

Silent carry is unsafe across jurisdictions: the new jurisdiction's payroll reads its own loan
catalogue, so the old loan's `catalog_id` may not exist and the deduction silently stops.

### 3.3 Service continuity

Service for leave bands is a property of the **employment**, not of the latest contract. A
promotion or transfer must not reset annual-leave service.

Implemented: `employee_contract.service_started_on` stores the service start for the contract's
jurisdiction. A same-jurisdiction replacement copies the predecessor date; a cross-jurisdiction
replacement starts new statutory service but the profile keeps `first_hired_on` for company
service. The payroll engine exposes `service_started_on` as `effective_range.from` to expressions,
so existing leave formulas read service continuity without a per-formula change.

## 4. Payroll consequences

- **Same-jurisdiction transfer** — no final pay and no encashment. The successor's payroll continues
  the same balance. Posted leave/loan entries stay stamped with their original `payroll_run_id` and
  are never repaid.
- **Cross-jurisdiction transfer** — the old entity runs its final payroll for the exit period. Leave
  settlement (if any) is paid there. The new entity starts under its own settings; its first run
  must not see the old contract, settings version or employer version.
- **Voided records** — a voided contract is excluded from later runs. A voided employer or
  jurisdiction version cannot cover a later run; the run refuses with `No employer version covers
the salary period` or `Choose a sealed jurisdiction`. Historical payslips are not rewritten.
- **Captured period** — a finalised run blocks substantive contract changes in its period. Void is
  the exception: it is allowed with a reason, and the next run excludes the voided record.
- **No double payment** — an entry with a `payroll_run_id` is posted; the engine skips it in later
  runs.

## 5. Operator sequence

1. Open the sealed contract → **Employment history**.
2. Press **Promotion** or **Transfer**; the sheet creates a dated `DRAFT` successor.
3. Set the predecessor's last day with **End employment** (the same action is used for a promotion
   or transfer; the presence or absence of a successor decides whether it is an exit).
4. Seal the successor. It must start after the predecessor's last day.
5. For a cross-jurisdiction transfer, confirm the old leave settlement and loan decision before
   sealing the successor.
6. Run the old entity's final payroll for the exit period; then run the new entity.

The UI copy states this order. The server currently enforces the sealed-overlap rule per entity and
the captured-run rule; the remaining settlement guards are listed below.

## 6. Implementation status

| Rule                                                          | Status                                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| One balance per employee; payroll reads by `employee_id`      | Implemented                                                                                              |
| Same-jurisdiction transfer carries leave and loans            | Implemented — a carried loan and its open schedule are repointed to the successor contract/entity        |
| Cross-jurisdiction leave encashment when the old law allows   | Implemented                                                                                              |
| Unknown leave policy refuses the transfer                     | **Not implemented** — currently carries                                                                  |
| Cross-jurisdiction loan settlement/assignment guard           | Implemented — target-catalogue transfer with a dated ledger pair, settlement fallback, forced settlement |
| Cross-jurisdiction target terms                               | Implemented — the Transfer sheet edits statutory work category, residency status and work classification |
| Service continuity across a replacement contract              | Implemented via `service_started_on` and the expression remap                                            |
| No overlap between sealed contracts across entities           | Implemented                                                                                              |
| Void used-in-payroll records; later runs exclude them         | Implemented                                                                                              |
| No delete on contract, entity version or jurisdiction version | Implemented                                                                                              |
| Posted entries never repaid                                   | Implemented                                                                                              |

## 7. Probe references

- Q19 transfer balances
- Q26 same-jurisdiction promotion does not encash
- Q27 void used-in-payroll records
- Q28 cross-jurisdiction leave settlement

The live evidence and exact IDs live in the [manual probe matrix](manual-probe-matrix.md).
