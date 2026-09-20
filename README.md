# HR & Payroll

![HR & Payroll workspace thumbnail](assets/thumbnail.svg)

A Bolt workspace for employment records, scheduling, leave, payroll and statutory contributions.
Approved inputs produce a payslip for each employment contract, with calculation details and links
to the records settled by that payslip.

**Compliance coverage is incomplete.** Review the [compliance matrix](docs/compliance-matrix.md)
for jurisdiction coverage, release blockers and obligations outside calculation. Regression tests
verify specific cases; they do not certify every legal obligation or future statutory version.

## Applications

| Application           | Tasks                                                                         |
| --------------------- | ----------------------------------------------------------------------------- |
| Employee self-service | View employment details, record events, request leave and review payslips     |
| Entities              | Maintain legal entities, payroll settings and published holidays              |
| People                | Maintain profiles, contracts, effective terms, statutory facts and departures |
| Events                | Review attendance, leave, claims, one-time payments and loans                 |
| Payroll               | Create a regular period, review payslips, record payment and export reports   |
| Settings              | Review effective rules, edit draft catalogues and compare versions            |
| Kiosk                 | Record attendance and manage face enrolment                                   |

Access and approval policies distinguish employees, supervisors, HR controllers, HR managers,
senior management and kiosk users. Automation policies do not bypass approval requirements.

## Payroll inputs

| Family       | Source                                                                            | Result                                                  |
| ------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Work         | Effective terms, shift patterns, roster, attendance and published entity holidays | Salary, overtime, night premiums and absence deductions |
| Leave        | Effective entitlement rules and approved leave entries                            | Paid/unpaid absence coverage, encashment and reversals  |
| Claim        | Approved expense requests                                                         | Reimbursements and recoveries                           |
| Allowance    | Monthly amounts on employment terms                                               | Recurring earnings or deductions, prorated with salary  |
| Ad hoc       | Approved requests against the one-time payment catalogue                          | Bonuses, back pay, separation payments and recoveries   |
| Loan         | Agreement and repayment schedule                                                  | Whole instalments recoverable within the net-pay limit  |
| Contribution | Effective statutory rules, declared employee facts and calculated pay lines       | Employee deductions, employer contributions and tax     |

One regular payroll is permitted per legal entity and period. A draft can be deleted and recreated;
paid results are protected. Approved late entries remain due against their original contract. The
regular-period model does not itself enforce final-pay deadlines or tax-clearance holds.

An employee may have contracts with different entities. Service dates for the same employee and
entity cannot overlap. Rehire creates a new contract; it does not reset statutory year-to-date
amounts where a scheme requires aggregation.

Settings and catalogue revisions are effective-dated. Sealing a version freezes its rules.
Holidays are managed separately by each legal entity and must be published before payroll uses
them. Existing payroll retains its captured holiday evidence.

## Automations

| Automation                 | Trigger                                    | Result and review                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `statutory_drift`          | Monthly; also on demand                    | Compares contribution rules and leave entitlements with official sources. Creates an unsealed draft only for supported changes with a known commencement date. Missing evidence and unsupported changes require review. |
| `leave_encashment_on_exit` | Employment contract update; also on demand | Submits the unused balance of leave types marked for exit encashment and eligible separation payments for HR approval. Dismissal alone does not establish forfeiture. Existing requests are skipped on retry.           |
| `leave_encashment_due`     | Daily at 01:00 UTC; also on demand         | Catches departures recorded in advance. Future departures reserve no leave; due requests use the balance calculated when the automation runs.                                                                           |
| `holiday_import`           | Annually on 1 October; also on demand      | Imports holiday candidates from the entity's Google Calendar source. HR reviews and publishes each holiday.                                                                                                             |

Drift detection does not cover every statutory field. Exit approval must establish entitlement,
valuation, any lawful forfeiture and payment timing. See the [automation acceptance requirements](docs/compliance-matrix.md#automation-acceptance).

## Documentation

| Document                                           | Purpose                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| [Compliance matrix](docs/compliance-matrix.md)     | Current coverage, blockers, external obligations and official sources   |
| [Verification record](docs/verification.md)        | Synthetic acceptance, live standalone observations and remaining limits |
| [Architecture](docs/architecture.md)               | Models, expression contexts, calculation and settlement                 |
| [Leave](docs/leave.md)                             | Entitlement, balances, manual activity, approval and payroll            |
| [Scheduling](docs/scheduling.md)                   | Patterns, rosters, attendance, holidays and kiosk                       |
| [Source data](docs/data.md)                        | Input evidence, provisioning and reconciliation                         |
| [Expression reference](docs/expression-context.md) | Available fields and functions for rule expressions                     |
| [Implementation register](docs/gap-tracker.md)     | Historical statutory issues and implementation records                  |
| [Statutory review history](docs/statutory-gaps.md) | Detailed historical jurisdiction reviews                                |

## Verification

Run from this template directory:

```bash
pnpm lint
pnpm sync
pnpm test
pnpm test:e2e
```

`sync` generates workspace types and the portable artifact under `.norbital/artifact/`.
Tests use synthetic fixtures and an isolated local host. Browser tests run headlessly by default.
The drift integration test substitutes the research model and official-page reader; a passing test
does not verify live provider access or deployment.

Models, collection transforms, forms and import/export pipelines are under `src/collections/`.
Applications are under `src/apps/`; automations are under `src/automations/`. English and Chinese
copy is maintained in `src/i18n/`. `src/+agents.md` supplies agent context without granting access.

Template edits affect source and local artifacts. Existing tenants continue using their recorded
release until the normal publication and provisioning workflow consumes the change.
