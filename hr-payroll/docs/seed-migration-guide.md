# Jurisdiction seed migration guide

Each agent owns exactly one jurisdiction and one file type. It writes that file for every version of that jurisdiction and nothing else.

## Inputs

The legacy pack is not kept in this workspace. Restore it from the template's Git history (the
`rfc/seed_bank/` directory before the docs rename) when a lane must be replayed.

- Legacy base: `seed_bank/<J>/version_1.snapshot.json`
- Legacy deltas: `seed_bank/<J>/version_<n>.delta.json`
- Version list per jurisdiction:

```text
CN 1–4    ID 1–4    JP 1–16   MY 1–5, 9–12   PH 1–2
SG 1,2,3,5,6        TH 1–8    TW 1–5         VN 1–4
```

Read the base once and apply deltas linearly. Deltas are JSON Patch (`add`, `remove`, `replace`) over a semantic view that excludes row `id`, `settings_id` and `cloned_from_id`. Never execute formula strings. Reconstruct only the family this agent owns; use the manifest hashes when a value is ambiguous.

## Output

Write one JSON array per version:

```text
seed/public/jurisdiction/<J>/version_<v>/<file>.json
```

Files: `jurisdiction_settings`, `subtotal`, `registered_rule`, `registered_effect`, `allowance_catalog`, `overtime_catalog`, `statutory_contribution_catalog`, `leave_catalog`, `claim_catalog`, `adhoc_catalog`, `loan_catalog`, `work_interruption_catalog`, `workplace_case_catalog`.

Rows are keyed by business `code`; omit native ids, `settings_id`, revision and audit columns. Keep legal values, dates, URLs and quoted sources. Do not edit models, policies, other families or the legacy pack.

## Renames

| Legacy                                      | Target                                                   |
| ------------------------------------------- | -------------------------------------------------------- |
| `rule_set`                                  | `registered_rule`                                        |
| `behaviour`                                 | `registered_effect`                                      |
| `parameter`                                 | Flat constants inside the owning definition's `lookup`   |
| `export_layout`                             | Deleted                                                  |
| `suspension_catalog`                        | `work_interruption_catalog` and `workplace_case_catalog` |
| `employment_profile`, `employment_contract` | `employee_profile`, `employee_contract`                  |
| `entity_payroll_version`                    | `entity_profile_version`                                 |
| `company_id`                                | `entity_id`                                              |
| `*_input_schema`                            | `<employee                                               | entity>_extension_schema` |
| captured `facts`                            | `<employee                                               | entity>_extension_data`   |

## Model field contracts

Use [the model contract](0002-model-specification.md) for every field. Key points:

- Catalogue definitions: `code`, `name`, `settings_id`, `lookup`, `references`, `off_cycle_eligible`, nullable `subtotal_id`, and for pay producers `eligibility`, `conversion`, `incurred_on`, `direction`, `party`.
- Leave adds `pay_treatment` (`PAID`/`UNPAID`). Statutory adds `kind`, `depends_on`, `employee_amount`, `employer_amount`.
- `subtotal`: `code`, `name`, `previous_id`, optional `calculation`. The first row (`previous_id = null`) computes base pay; later rows accumulate producer lines by `subtotal_id`.
- `registered_rule`: `target_collection`, `events`, `reads`, `condition`, `validate`, `order`, `lookup`, `references`.
- `registered_effect`: `source_collection`, `events`, `reads`, `condition`, `target_collection`, `target_action`, `effects`, `lookup`, `references`.
- `jurisdiction_settings`: extension schemas, `lookup` (rounding and statutory conversion constants), currency, timezone, effective range, lifecycle.

## Computation flow and tap points

```text
approval ──► ledger_entry + employee_balance (leave, claim, adhoc, loan, repayment)

payroll_run.create
  intake: settings, subtotal chain, catalogues, statutory, entries, balances, history
      │
      ▼
  subtotal 1 = base pay          ← subtotal.calculation, contract.rate, unpaid leave
      │
      ▼
  subtotal 2..n                  ← catalogue.subtotal_id, eligibility, conversion, direction, party
      │
      ▼
  statutory                      ← depends_on, employee_amount, employer_amount
      │
      ▼
  payslips + ledger rows         ← net pay, statutory employee/employer
```

A definition affects payroll only through its `subtotal_id` and expressions. A null `subtotal_id` means the catalogue records facts but creates no pay line. Statutory schemes post both sides; employer lines never enter net.

## Acceptance

- Every version file is valid JSON and contains one row per legacy business code that survives in that version.
- Applied linearly, the family's rows reproduce the legacy versions after the documented renames.
- Legal distinctions and dated changes are preserved.
- Every catalogue row carries one concise, valid reference. Verify that the cited instrument supports the row's values and mechanism for that version's effective window.
- The effective time frame is part of the contract: a change to a PIT/table/rate requires a new version; never rewrite an earlier version with later values.
- Legacy expressions are evidence of intent, never text to port. Do not copy an expression wholesale. Re-author it against the current linear flow: base pay from `subtotal.calculation`; producers accumulate by `subtotal_id`; statutory uses `depends_on` and employee/employer amounts; the engine owns history, rounding, dependencies and posting. A shorter formula is expected; keep only the legal selection and amount logic.
- Report the output paths and row count per version.
