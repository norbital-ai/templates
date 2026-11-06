# Verification and gates

Status: normative verification contract. [The calculation architecture](0001-hrms-calculation-architecture.md) defines the engine, [the model contract](0002-model-specification.md) the models and [the seed contract](0003-jurisdiction-seed-specification.md) the seeds. This document defines what counts as verified and what remains open.

## 1. Scope

Work is confined to `templates/hr-payroll` (handle `norbital_hr`, package `@template/hr-payroll`) and the private tree `seed_bank/norbital_hr`. The original `hr-payroll` template, `norbital_hr` tenant and `seed_bank/norbital_hr` are never redirected, reset or deployed over.

The four contracts above are the implementation source of truth. Legal evidence, jurisdiction reports and platform guidance are evidence or guidance; they do not certify the implementation. Nothing here authorises a commit, push, release or deployment.

## 2. Implementation map

```text
source tree ──► schema baseline ──► build ──► check ──► tests
     │                                              │
     │                                              ▼
     └──► engine ──► payroll_run.create ──► payslips + ledger
                              │
                              └──► file syncs ──► salary xlsx / bank txt

seeds ──► jurisdictions ──► fixtures ──► live acceptance
```

## 3. Verified state

| Area                     | State                                                                                                  | Evidence                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Source tree              | 36 models, 8 apps, 3 automations (`statutory_research`, `statutory_materialize`, `invitation_profile`) | `src/data/model`, `src/app`, `src/automation` |
| Schema history           | Seven generated migrations, `0001_initial` through `0007_schema`; no destructive steps                 | `migrations/`                                 |
| Build                    | Passes with the linked SDK that accepts `data/model/**` and the `txt` export writer                    | local `bolt build`                            |
| Native checks            | Schema, model, policy, discovery, app and type checks pass                                             | local `bolt check`                            |
| Engine tests             | Linear payroll, statutory order, subtotal chain and balance operations pass                            | `tests/payroll_engine.test.ts`                |
| Public jurisdiction seed | 53 versions across nine jurisdictions, 689 files, wired and decoded                                    | `seed/public/jurisdiction/`                   |
| Private fixtures         | None accepted                                                                                          | —                                             |
| Live acceptance          | 0 of 108 country-months                                                                                | —                                             |

### SDK release gap

The published `@norbital-ai/*` 0.0.8 discovers only `src/data/model/<name>` and writes only `xlsx/csv/tsv/json/ics`. The template needs `data/model/**` discovery, the `txt` writer and runtime `ctx.act.checked` callables. Those exist in the local OSS build and are linked; they must ship in a release before a registry-only install reproduces the build.

## 4. Open gates

| Gate              | Completion evidence                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK release       | A published `@norbital-ai/*` set containing nested model discovery, the `txt` file writer and dynamic checked callables                                                                                                                                   |
| Source closure    | Zero type findings; no UI, policy or comment references retired models, fields or automations; all four documents match the source tree                                                                                                                   |
| Registry coverage | `registered_rule` and `registered_effect` callbacks on every write-capable model, not only the entry, roster and contract models                                                                                                                          |
| Balance rebuild   | `employee_balance.account` reconstructable from `ledger_entry`, proved from an empty opening in `tests/balance_reruns.test.ts`; the rebuild command is not wired                                                                                          |
| Payroll export    | Bank layouts verified against each bank's current specification; paid and held payslip filtering                                                                                                                                                          |
| Seeds             | Private demo rows rebuilt against the new models; legal values revalidated                                                                                                                                                                                |
| Fixtures          | Source-linked application and loan movements, zero payroll YTD, independently reconciled balances                                                                                                                                                         |
| Live acceptance   | Complete [manual probe matrix](manual-probe-matrix.md): 9 jurisdictions × 12 cycles × ≥30 employees, lifecycle, band, China probation, overtime and event-time ledger probes. Each row records expected and actual values, evidence and PASS/FAIL/BLOCKED |

A gate closes on executed evidence, never on a prior pass. A green E2E probe is weak evidence; a red one is a defect.

## 5. Evidence policy

- Keep each gate's current evidence in this table and in `.tmp/` logs; replace stale rows instead of appending a timeline.
- Local databases are PGlite in owned directories. Neon acceptance runs against staging and production, separately from automated suites.
- Personal-data screenshots and exports stay outside the public template; shareable reports use synthetic or redacted values.
- Seed preservation proves only that the compared legacy data was retained. It never proves legal correctness or runtime behaviour.
- The durable generated state is `migrations/` (`*.sql`, `snapshot.json`, `migrations.lock.json`, `physical.json`); `.norbital/` is generated and never committed.
