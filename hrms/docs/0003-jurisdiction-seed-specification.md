# Jurisdiction seed specification

Reference: how a jurisdiction's law is authored in the public seed. [The model specification](0002-model-specification.md) defines the models and [the architecture](0001-hrms-calculation-architecture.md) the engine. What the seed holds today is in [statutory coverage](0009-statutory-coverage.md).

## 1. Sources and scope

The public seed is `seed/public/jurisdiction/<CODE>/`: the law of nine jurisdictions (CN, ID, JP, MY, PH, SG, TH, TW, VN), each as one `jurisdiction` row and its dated changes. `bolt build` writes it as the release's `base` pack.

Public law belongs there. People, teams and entity rows are private data, loaded through `seed/+seeder.ts` and `bolt seed`; they never enter a release. Personal records are never copied into the public seed.

## 2. Layout

```text
seed/public/jurisdiction/
  MY/
    jurisdiction.json          the `jurisdiction` row
    jurisdiction_change.json   its changes, oldest first
  SG/
    ...
```

One folder per jurisdiction, one JSON file per model: the file name is the model. Each file is a list of rows that carry their `id` and stored fields and load as stored.

## 3. Row shapes

### `jurisdiction.json`

One row: `id`, `code`, `name`, `currency`, `timezone`, `tax_year_start_month`.

### `jurisdiction_change.json`

One row per change: `id`, `jurisdiction_code`, `effective_from` and `law`. A seeded change carries no `finding_id`.

`law` is keyed by family, then by row code, then by field:

```text
law
  conversions                 day, hour, proration, rounding, optional back_pay
  ledger                      ytd_scope
  lookup                      <table or constants key> -> value
  work_regions                <region key> -> display name
  employee_statutory_parameters   the statutory data the law asks of a person
  entity_statutory_parameters     the statutory data the law asks of a company
  subtotal                    <code> -> row
  allowance_catalog           <code> -> row
  overtime_catalog            <code> -> row
  statutory_contribution_catalog
  leave_catalog
  claim_catalog
  adhoc_catalog
  loan_catalog
  work_event_catalog
  workplace_case_catalog
  registered_rule             <code> -> row
  registered_effect           <code> -> row
```

- A row's code is its key. A row holds no `id` and no `code` field.
- Rows name each other by code: a catalogue row its `subtotal`, a statutory row its `employer_cost_subtotal`, a subtotal its `previous`. The first subtotal has no `previous`.
- A row's fields are those [the model specification](0002-model-specification.md#4-catalogues) lists for its family.

## 4. Changes

How changes fold into the law on a day is in [the architecture](0001-hrms-calculation-architecture.md#3-the-law-by-date). In the seed:

- The first change is the whole law on 1 December 2025. Each later change has the same keys and holds only what changes.
- A patch states the whole new value of a field, never a part of it: an expression or a list of citations is replaced whole. A field or a row set to `null` is removed. The one exception is a row's `lookup`, patched key by key: a change names only the lookup keys it changes (each key's value whole) and sets a key to `null` to remove it.
- A change exists only because something changed that day.
- A change already enacted with a later date of effect is seeded in advance, as its own change from that date.
- A change not yet enacted is not seeded. Research files it as a `statutory_finding` with its `jurisdiction_change` rows, and it is in force once a person confirms the finding.
- A value wrong since it was set is corrected on the change that set it, never copied into a later one.
- A reference's `effective_from` is the date its source took effect. A later change does not rewrite it.

## 5. Authoring rules

### Formulas

Formulas select an evidenced base and assess an amount. The ledger service owns balance admission and posting; the engine owns dependency order and rounding.

- A jurisdiction's global `lookup` holds only shared tables and shared constants, each with a declared shape. A value read by one row lives on that row's own `lookup`, which wins. Every `lookup` key is read by an expression or by code.
- Statutory bases come from completed subtotals and explicit catalog references. A tax formula reuses contribution results rather than reproducing their maths.
- Legal distinctions and dated exceptions are preserved. Splitting a formula across more fields does not count as simplification.
- Minification, opaque helpers and copied orchestration are rejected.
- A rule or effect validates nothing the model's own write boundary already checks (the agreed rate, normal time, category, work region and shift length). Seed JSON holds law, not guards.
- The statutory parameter declarations are authored in the seed, on each law's first change. After a change to a row param, run `bun run registry:generate` (or update the matching family schema under `src/data/model/jurisdiction/service/params/`): `bolt check` does not regenerate schemas, and `tests/configuration/configuration_ownership.test.ts` fails until they match.
- Run-level `payroll_run` effects (including payslip / wage-slip delivery duties such as `SG/ITEMISED_PAYSLIP` and `ID/PAYSLIP_ISSUE`) raise one entity-level `obligation` per paid payroll run with an O(1) `occurrence_key` lookup (`limit: 1`) rather than looping per payslip against all obligations.
- A seed edit or audit across the law packs is one agent per jurisdiction, each with the same brief.

### Structure

- `subtotal` and statutory rows carry `balance_window` (`MONTH` or `YEAR`). Do not seed output bindings, phases, channels, order fields or subtotal-held catalogue lists.
- Static catalogues hold confirmed definitions and leave `subtotal` out when they create no pay line. Non-static catalogues own their entries, which name their row by `catalog_code`.
- The law must hold on every change date, by the checks every write to a change runs. A patch that removes a row also changes or removes every row that names it.
- `conversions.back_pay` enables signing-month back pay for later-signed terms, line by line on each item's own catalogue: Malaysia and Philippines set `true` (each line stays at its own subtotal so overtime arrears stay outside EPF/HRDF while basic arrears enter them), and Singapore and Indonesia name `ADDITIONAL_WAGES` (all prior-period arrears enter at `ADDITIONAL_WAGES`). Every other law leaves it out, so a terms row there applies from its date.
- Seed no ad hoc back-pay, arrears, or manual no-pay-adjustment rows, no refund or adjustment row per scheme, and no effect for a contribution correction. A contribution or earning wrong in a paid period is corrected at its source and the next run carries the difference line by line. The generic `STATUTORY_REFUND` and `STATUTORY_ADJUSTMENT` rows hold a refund or charge decided outside the system. A row a statute's own procedure needs stays: Japan's `SOCIAL_INSURANCE_ADJUSTMENT` and `SOCIAL_INSURANCE_REFUND`.
- A tax row that counts what an ad hoc entry posts to a statutory account reads it as `ctx.posted.<SCHEME>.<employee|employer>` (Indonesia's `EMPLOYER_PAID_BENEFIT`, a benefit in kind).

### Data

- Seed balances as ledger movements, never as direct projection writes.
- Seed no payroll runs, payslips, YTD or per-run statutory results.
- Suspensions and work stoppages are work events.
- The public seed names no customer.
- Register work limits against roster creation and change; planned-work refusal is distinct from recording an actual violation.
- Amounts in expected results are independently calculated, never copied from the formulas.

### References

- A reference's URL opens for a plain reader (curl, an agent's fetch): audits and research read it again. Fetch a URL before citing it, in a `url` field or inside a title or quote.
- Where the authority's page refuses a reader, cite a copy that opens, in this order: the authority's own API or file endpoint; another official host carrying the same text; a dated `web.archive.org` snapshot of the page (`/web/<timestamp>/<url>`, with `id_` or `if_` after the timestamp for a PDF).
- A source that does not open is not cited: the reference names its instrument with no link, or goes. Research takes no host as a place to read unless a reference cites it directly.
- A reference says what its source says. Where the seed's method goes beyond the source's words, the quote names the method and why.
- `tests/configuration/seeded_laws.test.ts` refuses a URL on a host listed below, in a `url` field or inside a reference's wording.

The seed cited 579 URLs on 18 November 2026 and 115 did not open for a plain reader. The hosts that refused, and what the seed cites instead:

| Host                                           | Law | How it refuses   | Cited instead                                                                                                    |
| ---------------------------------------------- | --- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `www.kwsp.gov.my`                              | MY  | bot challenge    | archive                                                                                                          |
| `hrdcorp.gov.my`                               | MY  | bot challenge    | `supportcentre.hrdcorp.gov.my` for the levy guideline; the Minister's statement as reported for Circular 01/2026 |
| `www.perkeso.gov.my`, `perkeso.gov.my`         | MY  | no connection    | archive; `lom.agc.gov.my` for Act A1788; `lawplayer.com` for Act 800                                             |
| `jtksm.mohr.gov.my`, `gajiminimum.mohr.gov.my` | MY  | no connection    | archive                                                                                                          |
| `sso.agc.gov.sg`                               | SG  | script challenge | archive, the capture of the provision cited                                                                      |
| `peraturan.bpk.go.id` (`/Details/` pages)      | ID  | bot challenge    | archive; its `/Download/` files open                                                                             |
| `jdih.kemenkeu.go.id`                          | ID  | times out        | archive; `jdih.kemnaker.go.id`; `pajak.go.id`                                                                    |
| `www.peraturan.go.id`                          | ID  | no connection    | `jdih.kemnaker.go.id`                                                                                            |
| `laws.e-gov.go.jp` (`/law/` pages)             | JP  | script-only page | its API, `/api/2/law_data/<law id>`                                                                              |
| `www.mol.go.th`, `www.dsd.go.th`               | TH  | script challenge | archive; `infocenter.oic.go.th`; `sdfund.dsd.go.th`                                                              |
| `www.sec.or.th`                                | TH  | block page       | archive                                                                                                          |
| `laws.mol.gov.tw`                              | TW  | no connection    | `law.moj.gov.tw`; `www.mol.gov.tw`                                                                               |
| `www.nhi.gov.tw` (HTML pages)                  | TW  | bot challenge    | `law.moj.gov.tw`; its PDF downloads open                                                                         |
| `baohiemxahoi.gov.vn`                          | VN  | connection reset | the law's Gazette copy on `datafiles.chinhphu.vn`; a press relay                                                 |
| `natlex.ilo.org`                               | VN  | bot challenge    | archive                                                                                                          |
| `www.dole.gov.ph`, `car.`, `query.`            | PH  | bot challenge    | archive; `chanrobles.com` for the OSH Standards; `nwpc.dole.gov.ph` opens                                        |
| `privacy.gov.ph`                               | PH  | bot challenge    | archive                                                                                                          |

Single pages that had moved or gone were repointed the same way (LHDN Public Ruling 2/2026, MOM's Employment Pass conditions, the Shanghai housing fund notice, a Yunnan compilation, a Taipei worked example), and four press pages behind a challenge were replaced by the instrument itself or an archived copy.

Nine citations had no copy that opens (two Indonesian regional wage pages, a Kalimantan Tengah notice on Facebook, a BPS table, two WeChat articles and three Kunming pages): their links were removed and the instruments stay named. `web.archive.org` throttles bursts: one request every few seconds.

## 6. Acceptance

A jurisdiction is accepted when its boundary scenarios pass: overtime inclusion, allowances, balance limits, a correction of a paid period and its retry, a run holding its people, dependent contributions, exits and carry-forward, where applicable.

Tests prove those mechanisms with synthetic inputs; they do not certify a seeded legal value. How legal values are verified is in [statutory coverage](0009-statutory-coverage.md#how-it-is-verified).

Fixtures carry actual employment dates, zero payroll YTD, source-linked leave and claim movements, and independently reconciled balance controls.
