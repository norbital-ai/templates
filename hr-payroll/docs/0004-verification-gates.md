# Verification and gates

Status: normative verification contract. [The calculation architecture](0001-hrms-calculation-architecture.md) defines the engine, [the model contract](0002-model-specification.md) the models and [the seed contract](0003-jurisdiction-seed-specification.md) the seeds. This document defines what counts as verified and what remains open.

## 1. Scope

This contract covers `templates/hr-payroll` (handle `norbital_hr`, package `@template/hr-payroll`) and its private demo rows.

The four contracts above are the implementation source of truth. Legal evidence, jurisdiction reports and platform guidance are evidence or guidance; they do not certify the implementation. Nothing here authorises a commit, push, release or deployment.

## 2. Implementation map

```text
source tree ──► schema history ──► build ──► check ──► tests
     │
     └──► engine ──► payroll_run.create ──► payslips + ledger + balance, one write
                              │
                              └──► file syncs ──► salary xlsx / bank txt

seeds ──► jurisdictions ──► fixtures ──► live acceptance
```

## 3. Verified state

| Area                     | State                                                                                                                                             | Evidence                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Source tree              | 40 models, 7 apps, 1 kiosk, 8 automations (`ledger`, `contract_materialize`, `entity_materialize`, `contract_exits`, `encashment`, `statutory_research`, `statutory_materialize`, `invitation_profile`) | `src/data/model`, `src/app`, `src/kiosk`, `src/automation`  |
| Schema history           | Generated migrations from `0001_initial`; destructive steps carry an explicit `-- accept:` line                                                   | `migrations/`                                               |
| Build                    | Passes on the pinned `@norbital-ai/*` 0.0.18 set; one `0001_initial` migration                                                                      | local `bolt build`                                          |
| Native checks            | Schema, model, policy, discovery, app and type checks pass                                                                                        | local `bolt check`                                          |
| Engine tests             | Linear payroll, statutory order, subtotal chain, typed programs and balance operations pass                                                       | `tests/payroll_engine.test.ts`                              |
| Full HR suite            | 888 tests in 82 files pass after the ownership/reversal/allowance, compliance-gap, cash-out pricing/capture, employer scheduling, OIL and UI changes | `.tmp/hr-full-55.log`                                       |
| Ledger tests             | `settle`, `diff` and `apply`, reruns, and a balance that equals its ledger                                                                        | `tests/ledger_core.test.ts`, `tests/balance_reruns.test.ts` |
| Public jurisdiction seed | 57 versions across nine jurisdictions, wired and decoded; 1,398 rules and 4,159 effects; settings conversions and balance windows typed            | `seed/public/jurisdiction/`, `bolt build` output            |
| Private fixtures         | None accepted                                                                                                                                     | —                                                           |
| Live acceptance          | 0 of 108 country-months                                                                                                                           | —                                                           |

## 4. Open gates

| Gate              | Completion evidence                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source closure    | Zero type findings; no UI, policy or comment references retired models, fields or automations; all four documents match the source tree; `configuration_ownership.test.ts` and `extension_fields.test.ts` green                                           |
| Registry coverage | `registered_rule` and `registered_effect` callbacks on every write-capable model; configuration models, `obligation`, `contract_change` and the statutory research models carry none                                                                      |
| Balance rebuild   | `employee_balance.account` reconstructable from `ledger_entry`, proved from an empty opening in `tests/balance_reruns.test.ts`; the rebuild command is not wired                                                                                          |
| Payroll export    | Bank layouts verified against each bank's current specification                                                                                                                                                                                           |
| Seeds             | Private demo rows rebuilt against the models; legal values revalidated                                                                                                                                                                                    |
| Fixtures          | Source-linked leave and claim movements, zero payroll YTD, independently reconciled balances                                                                                                                                                              |
| Live acceptance   | Complete [manual probe matrix](manual-probe-matrix.md): 9 jurisdictions × 12 cycles × ≥30 employees, lifecycle, band, China probation, overtime and event-time ledger probes. Each row records expected and actual values, evidence and PASS/FAIL/BLOCKED |

A gate closes on executed evidence, never on a prior pass. A green E2E probe is weak evidence; a red one is a defect.

## 5. Evidence policy

- Keep each gate's current evidence in this table and in `.tmp/` logs; replace stale rows instead of appending a timeline.
- Local databases are PGlite in owned directories. Neon acceptance runs against staging and production, separately from automated suites.
- Personal-data screenshots and exports stay outside the public template; shareable reports use synthetic or redacted values.
- The durable generated state is `migrations/` (`*.sql`, `snapshot.json`, `migrations.lock.json`, `physical.json`); `.norbital/` is generated and never committed.
