# Jurisdiction seed specification

Status: normative seed contract. [The model contract](0002-model-specification.md) defines the models, [the calculation architecture](0001-hrms-calculation-architecture.md) the engine and [verification](0004-verification-gates.md) the gates.

## 1. Sources and scope

The legacy pack was preserved evidence for the migration, not target seed data. It held each jurisdiction's first complete configuration snapshot plus one semantic delta per later snapshot. Historical layout (not present in this workspace):

```text
seed_bank/
  manifest.json
  CN/version_1.snapshot.json
  CN/version_2.delta.json
  ...
```

The pack is no longer part of this workspace; retrieve it from the template's Git history (the `rfc/seed_bank/` directory before the docs rename) if a lane must be replayed. Nine jurisdictions, 57 snapshots. Malaysia has versions 1–5 and 9–12; Singapore has 1–3 and 5–6. A missing version is never invented, and a rolling number is never treated as a legal effective date.

Public law belongs to the template's `seed/public/jurisdiction/<lineage>/`. The private bank supplies tenant-specific people, teams and entity rows. Personal records are never copied into the jurisdiction history pack.

## 2. Pack integrity

```text
base v1 ─ delta v2 ─ delta v3 ─ … ─► reconstructed state
                                          │
                                          ▼
                     replacement base + one delta per version
```

A base is the complete first snapshot. A delta records predecessor and successor numbers, hashes and JSON Patch operations (`add`, `remove`, `replace`).

- Rows are keyed by business `code`; row order is preserved.
- Top-level row `id`, `settings_id` and `cloned_from_id` are excluded before comparison and replay, so a delta shows domain change rather than UUID churn.
- Arrays restore by order; formula strings are never executed during reconstruction.
- Hashing uses canonical JSON: sorted keys, UTF-8, no insignificant whitespace, original array order.
- The manifest records ignored fields, source hashes and artifact hashes. Verification replays all 57 semantic states and compares each with its source after the same exclusions.

This proves preservation of the compared data, not legal correctness.

## 3. Replacement procedure

Replacement happens only after the target model and engine contracts exist. One owner per jurisdiction, one directory per output.

| Stage      | Output                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Understand | Reconstructed legacy history, effective dates and policy changes                               |
| Replace    | A complete new seed history authored against [the model contract](0002-model-specification.md) |
| Verify     | Schema, graph and jurisdiction scenarios for every new version                                 |
| Export     | One version folder per legacy version, one JSON file per model type                            |
| Integrate  | Central review before runtime seed cutover                                                     |

Owners write `seed/public/jurisdiction/<J>/version_<v>/<file>.json`: one file per model type per version. The integration pass mints deterministic ids, sets `settings_id` and resolves subtotal references. The legacy builder is not a converter and never overwrites replacement work. An owner changes no shared engine, model or other jurisdiction; shared contract gaps return to the integrator.

## 4. Authoring rules

### Formulas

Formulas are rewritten from their new responsibilities. The engine owns history scoping, balance admission and posting, dependency reuse, delta assessment and rounding; formulas select an evidenced base and assess an amount.

- Each definition's constants, rates and flat legal tables live in its own `lookup`; no cross-owner inheritance.
- Statutory bases come from completed subtotals and explicit catalog references. A tax formula reuses contribution results rather than reproducing their maths.
- Legal distinctions and dated exceptions are preserved. Splitting a formula across more fields does not count as simplification.
- Minification, opaque helpers and copied orchestration are rejected. Review compares nonblank, noncomment lines before and after, in total and for the longest rules.

### Structure

- `subtotal` rows carry `code`, `name`, `previous_id` and optional `calculation`. The first computes base pay; later rows accumulate producer lines. Do not seed output bindings, phases, channels, order fields or subtotal-held catalogue lists.
- Static catalogues hold confirmed definitions and leave `subtotal_id` null when they create no pay line. Non-static catalogues own their entries.
- `payroll_run.source_manifest` holds captured source references and hashes. There is no separate source-link model.

### Data

- Seed balances as cumulative ledger movements, never as direct projection writes.
- Seed no payroll runs, payslips, YTD or per-run statutory results.
- Translate grants, reservations, usage, carry-forward and loan debt into explicit ledger movements.
- Translate suspensions and work stoppages into interruption data and work treatment.
- Register work limits against roster creation and change; planned-work refusal is distinct from recording an actual violation.
- Amounts in expected results are independently calculated, never copied from the migrated formulas.

## 5. Lane acceptance

A jurisdiction lane is accepted when it supplies:

1. A verified replacement base and delta chain for every version.
2. A responsibility map from each legacy rule to its new owner.
3. Formula-size evidence before and after, including the longest rules.
4. Passing boundary scenarios: overtime inclusion, allowances, balance limits, ledger reversal and retry, run locks, dependent contributions, exits, carry-forward and reconciliation where applicable.

Every jurisdiction also passes the [manual probe matrix](manual-probe-matrix.md): twelve consecutive months, independently verified amounts and retained evidence. Singapore additionally covers shortfall and excess/refund flows.

Public seed cutover waits for the source and schema gates in [verification](0004-verification-gates.md). Private and synthetic fixtures are replaced separately: actual employment dates, zero payroll YTD, source-linked application and loan ledger movements, and independently reconciled balance controls. The original `hr-payroll` template, `norbital_hr` tenant and its private tree are never touched.
