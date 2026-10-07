# HR & Payroll

![HR & Payroll workspace thumbnail](assets/thumbnail.svg)

A Bolt workspace for employment records, rosters, leave, claims, loans, payroll and statutory contributions
across several jurisdictions. A payroll run builds one payslip per employment contract and links it to the
records it settled.

## Logic lives in records

Country law is data, not code. Each jurisdiction is a lineage of dated, sealed `jurisdiction_settings` versions
with their catalogue rows (`statutory_contribution`, `leave`, `claim`, `adhoc`, `loan`, `allowance`, `work`) and
`rule_set` rows. Rates, bands, eligibility and pricing are CEL expressions on those rows, and behaviours (for
example exit leave encashment) are rules on the settings version. The engine under `src/lib/payroll_engine/`
evaluates them and holds no jurisdiction-specific logic. A change of law is a new version, made without
touching source.

The public seed ships the lineages at `seed/jurisdiction/<CODE>/version_*/` for SG, MY, PH, ID, VN and TW. What
each one configures, and its gaps, is tracked in the [jurisdiction trackers](docs/inventory/README.md).

## Applications

| Application           | Tasks                                                          |
| --------------------- | -------------------------------------------------------------- |
| Employee self-service | Own schedule, leave, claims and payslips                       |
| Entities              | Legal entities, shift patterns and definitions, holidays       |
| People                | Profiles, employment contracts, face enrolment and offboarding |
| Events                | Roster and attendance, leave, claims, one-time payments, loans |
| Payroll               | Regular and off-cycle runs, payslips and exports               |
| Settings              | Jurisdiction versions, catalogues, rules and behaviours        |
| Kiosk                 | Attendance capture                                             |

## Automations

| Automation            | Trigger                                                              | Result                                                                                         |
| --------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `behaviour_taps`      | Payroll run created; employment contract exit facts or range updated | Applies the version's behaviour rules: each reads its declared rows and returns the writes.    |
| `statutory_drift`     | Monthly; also on demand                                              | Enqueues one `statutory_lineage` run per sealed in-force lineage. It never seals.              |
| `statutory_lineage`   | Enqueued by `statutory_drift`; also on demand                        | Checks one lineage against its official sources; changes become one unsealed draft for review. |
| `late_arrival_notice` | Every five minutes                                                   | One reminder per person-day when a rostered shift has no clock-in after the entity's grace.    |
| `calendar_tick`       | Daily                                                                | Runs the behaviour rules for every employment in force, so date-driven duties raise tasks.     |

## Verification

From this directory:

```bash
pnpm lint
pnpm check
pnpm build
pnpm test
```
