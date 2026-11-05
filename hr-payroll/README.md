# HR & Payroll

![HR & Payroll workspace thumbnail](assets/thumbnail.svg)

A multi-country HR and payroll workspace for employment records, rosters, leave, claims, loans,
payroll runs and statutory obligations. Jurisdiction law is dated, sealed data; the engine holds no
country-specific calculation.

## Apps and roles

The HR controller group contains seven apps; employee self-service is the eighth app. The kiosk is
the chromeless attendance device.

| App                   | Pages                                                                               | Audience                                                      |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Cases                 | Cases                                                                               | Workplace case files per legal entity                         |
| Entities              | Entities                                                                            | Legal entities, profile versions, holidays and shift patterns |
| Events                | Work, Leave, Claims, Ad hoc, Loans, Interruptions                                   | Dated employee activity and its evidence                      |
| Formats               | —                                                                                   | Shared export format configuration (no standalone page)       |
| Payroll               | Payroll runs, Compliance                                                            | Run creation, payslips, findings and exports                  |
| People                | People                                                                              | Employee profiles and employment contracts                    |
| Settings              | Lineage (sealed versions, Changelog, Compare), Scheduled (releases, inbox, sources) | Payroll configuration and statutory change                    |
| Employee self-service | Home, requests, payslips                                                            | Each employee's own records                                   |
| Attendance kiosk      | Clock                                                                               | Attendance capture and face enrolment                         |

Teams are source declarations. **Employee** holds `employee`; **Supervisor** and **Production
Manager** add `supervisor`; **L1 Manager** holds `manager`; **HQ Payroll HR** and **Manager (HR
Controller)** hold `hr_controller`; **HR Manager** holds `hr_manager`; **Senior Management** holds
`senior_management`; **Attendance Kiosk** holds `kiosk`.

## Data model

The 36 models group by owner:

- `employee_profile` → `employee_contract`; `employee_balance` → `ledger_entry`
- `entity` → `entity_profile_version`, `holiday`, `shift_pattern` → `shift_definition`
- `jurisdiction_settings` → `subtotal`, static and non-static catalogues, `registered_rule`,
  `registered_effect`
- `obligation`; `payroll_run` → `payslip`; `roster_entry`
- `statutory_finding` → `statutory_change`: one legal instrument and its dated field or row changes. They
  record what is known about the law; `jurisdiction_settings` remains the sealed snapshot payroll reads
- `statutory_source`: where research reads, by jurisdiction; it outlives versions

Jurisdiction versions are sealed, effective-dated configurations. A version owns its catalogues,
statutory schemes, registered rules and effects, and one linear `subtotal` chain. A later version
is a new row, never an edit to a sealed one.

Every fact has one owner. The first subtotal computes base pay from the contract; each later
subtotal adds the employee lines that name it. Statutory schemes evaluate in `depends_on` order and
persist only as ledger rows. `payroll_run.create` calculates and writes payslips and ledger rows as
one payload; the run starts `UNPAID`, is marked `PAID` once, and has no separate finalise step. `payslip` stores
totals only.

Event-time movements (leave, claims, ad hoc pay, loan repayments) post to `ledger_entry` and update
the `employee_balance` projection when approved. Payroll-time movements post money and statutory
results. Neither writer repeats the other's movement.

## Automations

| Automation              | Trigger                    | What it does                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `statutory_research`    | Weekly, Saturday 03:00 UTC | One watch run per jurisdiction in use reads its sources for what is new, one audit run per family compares each value with its citation and official law; each files instruments as classified `PROPOSED` `statutory_finding` rows, then one run per affected family drafts the dated changes. Also raises the notice of releases due within 14 days. |
| `statutory_materialize` | Started by HR              | Merges one release (one jurisdiction, one effective date): a cumulative draft from `CONFIRMED` findings, then sealed; predecessor shortened, findings `APPLIED`. Refuses a release a later sealed version would silently revert.                                                                                                                      |
| `invitation_profile`    | Every minute               | Creates one employee profile per accepted staff invitation and links it to the accepting user.                                                                                                                                                                                                                                                        |

All run as the reserved system identity with their declared policies. `statutory_research` and
`statutory_materialize` use `configuration_execution`; `invitation_profile` uses
`invitation_profile_automation`.

## Seed

- **Public base** — `seed/public/jurisdiction/<CODE>/version_<v>/` holds 53 sealed versions across
  nine jurisdictions (CN, ID, JP, MY, PH, SG, TH, TW, VN), with catalogues, subtotals, registered
  rules and effects. `bolt build` writes them as the release's `base` pack.
- **Private demo** — `seed/+seeder.ts` names the seed bank tree `norbital_hr`. Rows are loaded
  by `bolt seed --bank=<checkout>`; they never enter a release.

The old per-jurisdiction seed bank that lived under `rfc/seed_bank/` has been removed. The
replacement seed is the maintained public pack above.

## Checks

```bash
bun install --frozen-lockfile
bunx bolt check   # declarations, schema history, policies and types
bun run test      # standalone mechanism and edge-case tests
bunx bolt build   # writes .norbital/ and the release artifact
```

Schema changes generate editable SQL under `migrations/`. Commit the SQL, `snapshot.json`,
`migrations.lock.json` and `physical.json` together. `.norbital/` is generated and never committed.

## Documentation

- [Documentation hub](docs/README.md)
- [Calculation architecture](docs/0001-hrms-calculation-architecture.md)
- [Model specification](docs/0002-model-specification.md)
- [Jurisdiction seed contract](docs/0003-jurisdiction-seed-specification.md)
- [Verification and gates](docs/0004-verification-gates.md)
- [Manual probe matrix](docs/manual-probe-matrix.md)

The workspace agent reads [`src/agent/+agent.md`](src/agent/+agent.md); coding agents start from
[`src/agent/AGENTS.md`](src/agent/AGENTS.md).
