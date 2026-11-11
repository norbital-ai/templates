# HR & Payroll

![HR & Payroll workspace thumbnail](assets/thumbnail.svg)

A multi-country HR and payroll workspace for employment records, rosters, leave, claims, loans,
payroll runs and statutory obligations. Jurisdiction law is dated, sealed data; the engine holds no
country-specific calculation.

## Apps and roles

The HR controller group holds the controller apps; employee self-service is its own app. The kiosk
is the chromeless attendance device.

| App                   | Pages                                                                  | Audience                                                      |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| Entities              | Entities                                                               | Legal entities, profile versions, holidays and shift patterns |
| Events                | Work, Leave, Claims, Ad hoc, Loans, Cases, Work events                 | Dated employee activity, workplace cases and their evidence   |
| Formats               | —                                                                      | Shared export format configuration (no standalone page)       |
| Payroll               | Payroll                                                                | Run creation, payslips and exports                            |
| Obligations           | Obligations                                                            | Tasks and reminders the law's effects raise                   |
| People                | People                                                                 | Employee profiles and employment contracts                    |
| Settings              | Lineage (sealed versions, Compare); Change log (Change log, Scheduled) | Payroll configuration and statutory change                    |
| Employee self-service | Self-service                                                           | Each employee's own records                                   |
| Attendance kiosk      | Clock                                                                  | Attendance capture and face enrolment                         |

Teams are source declarations. **Employee** holds `employee`; **Supervisor** and **Production
Manager** add `supervisor`; **L1 Manager** adds `manager`; **HQ Payroll HR** and **Manager (HR
Controller)** hold `hr_controller`; **HR Manager** holds `hr_manager`; **Senior Management** holds
`senior_management`; **Attendance Kiosk** holds `kiosk`.

## Data model

The models group by owner:

- `employee_profile` → `employee_contract` → `contract_change`; `employee_balance` → `ledger_entry`
- `entity` → `entity_change`, `entity_profile_version`, `pay_group`, `holiday`, `shift_pattern` → `shift_definition`
- `jurisdiction_settings` → `subtotal`, static and non-static catalogues, `registered_rule`,
  `registered_effect`
- `obligation`; `payroll_run` → `payslip`; `roster_entry`; `work_event`
- `statutory_finding` → `statutory_change`: one legal instrument and its dated field or row changes. They
  record what is known about the law; `jurisdiction_settings` remains the sealed snapshot payroll reads
- `statutory_source`: where research reads, by jurisdiction; it outlives versions

Jurisdiction versions are sealed, effective-dated configurations. A version owns its catalogues,
statutory schemes, registered rules and effects, and one linear `subtotal` chain. A later version
is a new row, never an edit to a sealed one.

Every fact has one owner. The first subtotal computes base pay from the contract; each later
subtotal adds the employee lines that name it. Statutory schemes evaluate in `depends_on` order and
persist only through the payslip and ledger rows. `payroll_run.create` calculates and writes
payslips as one payload; the run starts `UNPAID`, is marked `PAID` once, and has no separate
finalise step. `payslip` stores totals and the breakdown as calculated.

`src/lib/ledger/` is the single ledger service: a record that posts carries its rows in its own write, and the `ledger` automation syncs.
`ledger_entry` moves only by catalog entry posting (leave, claims, ad hoc pay and payslips), by
sync, which works out entitlements, or by HR's manual adjustment, and `employee_balance` is its projection. A repeat posts
nothing. Loans stay out of the ledger, and workplace cases never move a balance.

## Automations

| Automation              | Trigger                                                                                                      | What it does                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `statutory_research`    | Weekly, Saturday 03:00 UTC                                                                                   | One watch run per jurisdiction in use reads its sources for what is new, one audit run per family compares each value with its citation and official law; each files instruments as classified `PROPOSED` `statutory_finding` rows, then one run per affected family drafts the dated changes. Also raises the notice of releases due within 14 days. |
| `statutory_materialize` | Started by HR                                                                                                | Merges one release (one jurisdiction, one effective date): a cumulative draft from `CONFIRMED` findings, then sealed; predecessor shortened, findings `APPLIED`. Refuses a release a later sealed version would silently revert.                                                                                                                      |
| `ledger`                | Scheduled by writes; 1 January                                                                               | Syncs entitlements, one run at a time; posting is no part of it. Started for an exit, it then starts `encashment`. Each full sync schedules the next day anyone's window turns and ends with the integrity check. Safe to run at any time.                                                                                                            |
| `contract_materialize`  | Scheduled by `contract_change`                                                                               | Seals the changes whose day has come into one contract version per person and date. A change that cannot seal stays filed and raises a task.                                                                                                                                                                                                          |
| `entity_materialize`    | Scheduled by `entity_change`                                                                                 | Seals the employer changes whose day has come into one employer version per entity and date. The open version ends the day before. A change that cannot seal stays filed and raises a task.                                                                                                                                                           |
| `encashment`            | Started by `ledger` for an exit raised, moved or cancelled; by a run deleted or paid that held a keyed entry | An exit that stands gets one cash-out request per encashable balance, held for the HR controller. One that no longer stands has its open tasks waived and its unpaid cash-outs withdrawn; a cash-out a paid run took raises a task asking HR to reverse it. One step a run.                                                                           |
| `registered_effects`    | Scheduled by a leave or claim entry                                                                          | Applies the law's registered effects of the entry once it is not pending.                                                                                                                                                                                                                                                                             |
| `invitation_profile`    | Every minute                                                                                                 | Creates one employee profile per accepted staff invitation and links it to the accepting user.                                                                                                                                                                                                                                                        |

All run as the reserved system identity with their declared policies. `ledger`, `contract_materialize`,
`entity_materialize`, `encashment` and `registered_effects` use `payroll_execution`; `statutory_research` and
`statutory_materialize` use `configuration_execution`; `invitation_profile` uses
`invitation_profile_automation`.

## Seed

- **Public base** — `seed/public/jurisdiction/<CODE>/version_<v>/` holds the sealed versions of
  nine jurisdictions (CN, ID, JP, MY, PH, SG, TH, TW, VN), with catalogues, subtotals, registered
  rules and effects. `bolt build` writes them as the release's `base` pack.
- **Private demo** — `seed/+seeder.ts` names the seed bank tree `norbital_hr`. Rows are loaded
  by `bolt seed --bank=<checkout>`; they never enter a release.

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

- [Documentation map](docs/README.md)
- [Architecture](docs/0001-hrms-calculation-architecture.md)
- [Core mechanisms, run through](docs/0008-mechanisms-walkthrough.md)
- [Reversals and corrections](docs/0007-corrections-and-integrity.md)
- [Statutory coverage in the seed](docs/0009-statutory-coverage.md)

The workspace agent reads [`src/agent/+agent.md`](src/agent/+agent.md); coding agents start from
[`src/agent/AGENTS.md`](src/agent/AGENTS.md).
