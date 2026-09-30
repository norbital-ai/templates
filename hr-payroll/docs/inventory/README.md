# Jurisdiction obligation trackers

One CSV tracker per jurisdiction, `docs/inventory/<jurisdiction>.csv`:

| Jurisdiction              | Tracker           |
| ------------------------- | ----------------- |
| Malaysia (incl. MY-nihon) | `malaysia.csv`    |
| Indonesia                 | `indonesia.csv`   |
| Thailand                  | `thailand.csv`    |
| Philippines               | `philippines.csv` |
| Singapore                 | `singapore.csv`   |
| China (Shanghai, Kunming) | `china.csv`       |
| Taiwan                    | `taiwan.csv`      |
| Vietnam                   | `vietnam.csv`     |
| Japan                     | `japan.csv`       |

Scope: every payroll and HR statutory/compliance obligation applicable from 1 December 2025,
plus earlier facts that decide an opening balance, eligibility, entitlement, rate or deadline.
One row = one operative provision or decision branch. A broad statute heading is an index, not a
row. A missing profile or instrument is an explicit row, never an omitted one. Amendments reopen
affected rows. The `<jurisdiction>.md` registers are the legacy form until converted.

`tests/inventory-csv.test.ts` enforces this contract on every tracker.

## Owner rule (2026-09-28)

Law states it → follow it exactly. Law silent → a lawful, consistent default, recorded in the
row's `reason` (and its `config_path`).

## Format

RFC 4180 CSV, UTF-8, comma-separated, `"`-quoted fields where a value holds a comma, quote or
newline (`""` escapes a quote). The first line is the header, exactly these columns in this order:

`id,profile,area,provision,citation,url,source_checked,effective_from,effective_to,status,reason,config_path,golden,probe,verified_at`

| Column           | Content                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`             | Stable row id, unique across **all** trackers (e.g. `MY-EPF-001`). Never reused or renumbered.                                                               |
| `profile`        | Jurisdiction or locality/employer/worker profile the row applies to (`MY`, `MY-nihon`, `CN-shanghai`, `CN-kunming`, …).                                      |
| `area`           | One of the areas below.                                                                                                                                      |
| `provision`      | The legal result in one sentence: amount, entitlement, deadline, report, or sourced exclusion.                                                               |
| `citation`       | Instrument and section (e.g. `Employment Act 1955 s.60A(3)`).                                                                                                |
| `url`            | Official primary source. Required unless `SOURCE-BLOCKED`.                                                                                                   |
| `source_checked` | ISO date the official source was last read.                                                                                                                  |
| `effective_from` | ISO date the provision takes effect.                                                                                                                         |
| `effective_to`   | ISO date it ceases; empty while in force.                                                                                                                    |
| `status`         | One of the statuses below.                                                                                                                                   |
| `reason`         | The actual missing evidence or failure, or the recorded default where law is silent. Required unless `VERIFIED` or `NOT-APPLICABLE`.                         |
| `config_path`    | Where it is configured: settings key, catalogue code, or fact key (e.g. `payroll.allowance_npl_prorates`, `statutory_contributions:EPF`). Never a code path. |
| `golden`         | Exact `test(...)` title of the hand-computed golden in `tests/*.test.ts`.                                                                                    |
| `probe`          | Exact case id(s) of the production-path probe in `tests/e2e/probes/*.ts`, `; `-separated.                                                                    |
| `verified_at`    | ISO date the probe last matched.                                                                                                                             |

### Areas

`wages`, `minimum_wage`, `hours`, `overtime`, `rest_holiday`, `leave`, `proration`,
`contribution`, `tax`, `rounding`, `severance`, `notice`, `final_pay`, `bonus`, `levy`, `filing`,
`records`, `other`.

### Statuses

| Status              | Meaning                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VERIFIED`          | A production-path probe — saved inputs through the real workspace write path → payroll run → saved payslip — matches a hand-computed, cited result. Needs `probe` and `verified_at`. |
| `TESTED`            | A hand-computed golden passes against the engine; no probe yet. Needs `golden`.                                                                                                      |
| `IMPLEMENTED`       | Configured or coded; no golden.                                                                                                                                                      |
| `PARTIAL`           | Some branches proven; `reason` names the branches that are not.                                                                                                                      |
| `GAP`               | A missing engine, profile or input feature that changes a payslip or HR result.                                                                                                      |
| `EXTERNAL`          | An employer duty outside the calculator (filing, remittance, registration).                                                                                                          |
| `EXTERNAL-RECORDED` | Such a duty whose evidence (date, reference) the product captures.                                                                                                                   |
| `AWAITING-LAW`      | Announced but not yet published or gazetted.                                                                                                                                         |
| `SOURCE-BLOCKED`    | The official text is unreachable; `reason` names what was tried.                                                                                                                     |
| `NOT-APPLICABLE`    | A sourced exclusion; `citation`/`url` carry the source.                                                                                                                              |

## Runtime-schema rule

Jurisdiction-specific behaviour and captured data are **configuration**: settings versions,
catalogues, rule expressions and declared FactKey schemas. They are never `src` code branches on a
jurisdiction and never jurisdiction-named collections. Adding a jurisdiction is seed/config only —
no `src` change, no new collection, no migration. A row whose behaviour cannot be expressed that
way is a `GAP` in the generic engine, not a licence for a jurisdiction branch.

`tests/no-jurisdiction-code.test.ts` enforces this rule, with codes read from `seed/jurisdiction`
(lineage directories, their first segment, and every seeded `jurisdiction_code`). It fails on a
`src` string equal to a code, a country or locality name in `src` outside `src/i18n`, a
jurisdiction-named collection, model, custom field, `src/lib` or `src/app` entry, a model field
with a jurisdiction prefix or scheme name, a jurisdiction-scoped i18n key, and a `HARDCODED:`
`config_path`. There is no exception list.

## Calculation rule

Every statutory calculation lives in the runtime objects — the stored rule expressions, band
rows, rates, caps, floors, divisors, thresholds and rounding modes of the settings versions and
catalogues — never in the engine's flow. The engine evaluates what is stored; it does not know a
rate, a band edge, a ceiling, a divisor, a rounding step or an age. A statutory figure or band
written as a literal in `src` (a `0.2`, `20000`, `26`, `× 1.5`, a band table, a rounding to 50 sen)
is a defect: move it into the version's configuration and give the engine only the generic
operation that evaluates it. A calculation the expression language cannot state is a `GAP` for a
generic expression primitive, not a licence for a literal.
