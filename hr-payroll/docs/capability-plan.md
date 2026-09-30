# hr-payroll capability plan

Merged from three architect designs: engine, input and lifecycle. This plan decides the capabilities
to build before any more per-jurisdiction seed work. Each one is generic. Every capability keeps the
two owner rules in `docs/inventory/README.md`:

- **Runtime-schema rule.** No jurisdiction code or jurisdiction-named collection in `src`. Adding a
  jurisdiction is configuration only.
- **Calculation rule.** Every figure, band, rate, cap, divisor and rounding step is stored as runtime
  objects (expressions and band rows). None of it is engine code.

Malaysia is one profile, `MY`: the former Nihon fork, renamed on 2026-09-30.

The row counts come from the 2026-09-30 blocker ranking, run over all nine trackers:

| Rows | Count |
|---|---|
| All tracker rows | 3,004 |
| VERIFIED | 142 |
| NOT-APPLICABLE | 117 |
| **Open** | **2,745** |

The ranking lists only its top tags, so the per-tag figures below add up to less than the class
totals. Class totals are exact.

---

## 1. Diagnosis

### 1.1 Classes of gaps

| Class | Rows | What it is | Largest tags |
|---|---|---|---|
| PROBE | 786 | Behaviour exists (IMPLEMENTED, TESTED or PARTIAL), but no production-path probe has matched it | JP production-path 138, SG golden-only 111, CN not-run 107, ID pending-test 43, VN golden-case 42, MY saved-path 41, CN none 41, CN rerun 40, TW pending-run 36, PH awaiting-run 30, SG no-golden 27, PH missing-case 26, CN unseeded 20 |
| INPUT | 700 | The fact that decides the result has no place to be captured, or cannot be validated | JP worksite-industry-class 230, JP in-kind-provision 52, evidence-document 32, dated-person-fact 31, CN worker-class 26, company-fact(s) 25, CN dated-pay-state 12, SG worker-profile-status 11, SG occupation-sector 10 |
| FEATURE | 658 | A product lifecycle the app does not have | statutory-filing 93, benefit-case 34, CN filing-evidence 32, MY obligation-evidence-ledger 30, CN construction-project-regime 29, SG gov-reimbursement 23, employer-levy 20, retro-recalc 18, CN subsidy-claim 18 |
| ENGINE | 248 | A calculation shape the expression language cannot state | MY territorial-lineage-overlay 45, derived-contribution-base 10, CN admission-gate 7, ID nonmonthly-contribution-base 6, plus the tail (trailing averages, premium base, leave units, rolling limits) |
| LAW | 205 | Law text that is missing, unpublished or unresolved | source-blocked 72, JP awaiting-gazette 41, legal-reading 26, ID locality-decree-transcription 15, awaiting-publication 14, JP operative-order-text 8 |
| EXTERNAL | 148 | Duties outside the employer's payroll | SG/MY enforcement 14, SG organisation-governance 11, SG individual-gov-benefit 10, SG gov-administration 8, TH insurer-benefit 6 |

### 1.2 Why the current architecture cannot reach 100%

Seeding alone cannot close these rows. Each point is a structural wall, cited against the inventory
contract or the source.

1. **Tables are code-shaped, not stored rows.**
   - Only contribution ladders and catalogue bands are stored as rows.
   - `progressive`, `ladder` and `by_region` hold statutory tables inline, inside expressions.
   - `src/lib/datatypes/wages.ts` grows one flag per statute shape: `by_region`,
     `hourly_by_region`, `classified_by_worksite`, `sector_editions`, `sector_code_pattern`.
   - JP's specific minimum wages (prefecture × industry, 230 rows) and its in-kind values
     (prefecture, 52 rows) have no keyed, dated lookup to live in.
   - The README's calculation rule names exactly this case: "a GAP for a generic expression
     primitive".
2. **Functions accrete one per rule.**
   - `evaluate.ts` carries about 45 single-purpose functions: `earned_monthly_average`,
     `average_daily_wage`, `piece_wages_last_workdays`, six `*_exempt`/`*_excess` functions and six
     rounding functions.
   - The calculation choices are closed enums in code: `proration_basis`,
     `ordinary_rate_reference`, the encashment reference and the leave units.
   - So every new rule shape needs a `src` change. That breaks the calculation rule structurally.
3. **Inputs have no home.**
   - `terms.worksite` is free text, so an establishment's industry, territory and project cannot
     be recorded.
   - `employees` has fixed, jurisdiction-shaped columns (`race`, `religion`, `solo_parent` and
     others) and no dated fact bag.
   - Leave events are fixed columns, for example
     `event_wife_prior_living_biological_children`.
   - `employments.exit_reason` is a closed enum.
   - Nothing records prior employment or insured history.
   - `fact_evidence.subject` accepts only six collections (`src/data/+relationship.ts:218`).
     Exits, leave, person facts and requests cannot carry evidence.
4. **Lifecycles are missing.**
   - `src/data/custom_field/obligations` is free text with a status enum. It has no instances,
     due dates, evidence or money.
   - There is one `income_return`.
   - There is one run per period, so there is no off-cycle, final or correction run.
   - A frozen source cannot be edited (`docs/architecture.md`), so no retro recalculation is
     possible.
   - Benefit cases have one fixed formula (top-N credits ÷ divisor).
5. **Lineages do not compose.**
   - `worksite_coverage` can refuse an uncovered worksite but cannot route it to a sub-lineage.
     That blocks MY Sabah, Sarawak and Labuan (45 rows).
   - CN city lineages repeat the national rows.
6. **The proof harness cannot express the oracle.**
   - VERIFIED requires "saved inputs → payroll run → saved payslip".
   - The harness pins saved payslip lines only. It has no multi-period history, no refusal
     assertion and no oracle for a duty instance or a generated file.
   - So PROBE rows about refusals, deadlines and filings cannot be verified even when the
     behaviour exists.

---

## 2. The capability set

Each capability below is listed with:

- its configuration shape,
- the engine change,
- the input model,
- how it is proven,
- the rows it unblocks,
- its effort (S, M or L).

Proof always has two parts: a hand-computed golden in `tests/*.test.ts` (with jurisdiction-free
fixtures), and a production-path probe in `tests/e2e/probes/<J>.ts`.

### Conflicts resolved in the merge

| Conflict | Decision | Why |
|---|---|---|
| Tables: a `jurisdiction_settings.tables` JSON field (A1) or a `reference_rows` child collection (A2) | One child collection, `reference_rows`, serving both option lists and band rows | The JSIC codes and JP's 230 floors are too large for one JSON field. A code picker needs row queries. Holidays already set the child-row precedent (sealed and cloned with the version). |
| `lookup()` (A2) or `table()`/`band()` (A1) | `table()`, `band()`, `bands()` | One function family |
| Admission and exit gates (A1 E8) or obligation `blocks` (A3 L1) | One mechanism: stored `checks`. L1 exposes `obligations.open(code)` for a check to read | One gate code path |
| Entity and year cadence (A1 E10), annual assessment (A3 L5), concurrent scope (A3 L8) | One capability, E7, owning `contribute.ts` | They share one file and one abstraction |
| Opening history (A1 E4 extends wage periods) and prior history (A2 I6) | Opening pay stays in `employment_wage_periods`. Non-pay periods (prior employer year-to-date, insured periods, military service, prior contracts) go in `employment_history`. E4 reads both. | No second pay store |
| Leave episode (A1 E7) | Folded into I4 as one generic `episode_id` on `leave_entries` | Same file owner |
| Worksite as a relation (I1) or as a terms fact (A1) | `worksites` collection | An establishment's facts are shared by its workers and dated. Copying them onto each terms row drifts. L1 also needs a worksite subject. |

Architect 1's E12 was truncated in transit and is not in this plan. If it held a capability that
does not appear here, it re-enters as its own GAP.

### (a) Dynamic engine primitives

#### E1. Expression core — S

- **Configuration.** Literals inside stored expressions, for example
  `round(x, 0.05, 'UP')`. `remittance_round` becomes an expression.
- **Engine.**
  - `round(value, step, mode)`, where mode is HALF_UP, HALF_EVEN, UP, DOWN or TRUNCATE.
  - Variadic `min` and `max`.
  - List aggregates: `sum`, `avg`, `count`, `max_of`, `min_of`, `top(n)`.
  - `compile.ts` refuses a mode that is not a literal.
  - The six fixed rounding functions are deleted once the seeds have moved.
  - Files: `src/lib/expressions/functions/core.ts` (new) and `src/lib/payroll/run/rounding.ts`.
- **Input.** None.
- **Proof.**
  - Goldens: every mode, negative values, and steps of 0.01, 0.05, 1, 10 and 100.
  - The existing rounding probes must stay green.
- **Unblocks.** The rounding and clamp branches spread through every tracker. It is also a
  prerequisite of E4, E7 and L6.

#### E2. Dated tables and lookups — M (shares its data with I2)

- **Configuration.**
  - The settings version declares each table:
    `tables: [{name, keys:[..], range?:{from_inclusive,to}, columns: FactKey[]}]`.
  - Its rows live in `reference_rows` (see I2).
- **Engine.**
  - `table(name, key...)` returns a row map or null.
  - `band(name, value, key...)` returns the row whose range contains the value.
  - `bands(name, key...)` returns a list.
  - `progressive` and `ladder` read stored rows, not inline lists.
  - Resolution date by site: the day (work_day), `period.end` (scheme and entry sites), the event
    date (person site).
  - A write-time fault refuses overlapping ranges and overlapping effective dates. Ceilings are
    inclusive, so seams need one cent (memory note on rate-band seams).
  - Afterwards, delete the `wages.ts` flags. The floor becomes one stored expression, for example
    `max(table('REGIONAL_MW', worksite.region).hourly, table('SPECIFIC_MW', worksite.region, worksite.facts.industry).hourly ?? 0)`.
  - Files: `src/lib/expressions/functions/tables.ts` (new).
- **Input.** Keys come from declared facts (worksite, terms, person, day).
- **Proof.**
  - Goldens: an effective-date boundary, an inclusive range edge, a lookup with no match.
  - Probes: JP-SF001, where the regional minimum beats a lower specific floor, and one case where
    the specific floor wins, each on both sides of 2025-12-01. SG-PWM01.
- **Unblocks.**
  - JP worksite-industry-class, 230 rows (with I1 and I2).
  - JP in-kind-provision, 52 rows.
  - SG occupation-sector, 10 rows.
  - Service-band, birth-cohort and VN session tiers, about 14 rows.
  - About 306 rows in total.

#### E3. Date spans — S

- **Configuration.** Used from expressions.
- **Engine.**
  - `span(a, b)` with `.calendar_days()`, `.working_days()`, `.rest_days()`, `.holidays()`,
    `.months()`, `.intersect()` and `.contains()`.
  - `add_days(date, n)`.
  - `period.days_where(expr)` and `sum_days(expr, measure)` over day facts.
  - Reuses `holiday-calendar.ts` and `scheduling/`.
  - Files: `src/lib/expressions/functions/spans.ts` (new).
- **Input.** Existing rosters, patterns and holidays.
- **Proof.** Goldens: a span across a rest day, a holiday, a month edge and a leap day.
- **Unblocks.** The per-day-condition (8) and per-day-output (6) rows, together with E6. It is the
  base for E4 and E5.

#### E4. History accessor — L (keystone)

- **Configuration.** Expressions only.
- **Engine.**
  - `history.slips(window)`: each slip carries its wage month and pay month, lines and classes by
    code, bases by scheme, and days.
  - `history.days(window)`, `history.leave(window)` (grouped by episode) and
    `history.terms(window)`.
  - Window functions: `months_before(d, n[, skip])`, `days_before`, `year_of`, `service_year_of`
    and `span`.
  - `rolling(list, n)` returns rolling windows.
  - Slips are attributed by **wage month**, so arrears land in the right month.
  - Files: `src/lib/payroll/history.ts` (new, the only reader), with `reference-wages.ts` and
    `statutory-history.ts` folded into it; `src/lib/expressions/functions/history.ts` (new).
  - `gather.ts` loads a bounded window. The window size is derived at compile time from the
    largest literal window in the version. `compile.ts` refuses a window without a literal bound,
    because of the guest CPU budget.
  - Once the seeds have moved, prune `earned_monthly_average`, `average_daily_wage`,
    `average_monthly_wage`, `piece_wages_last_workdays`, `earned_average`, the `*_exempt` and
    `*_excess` functions, `scheme.trailing_*`, `year.earned` and `history_trigger`.
- **Input.** Saved slips and days. Opening pay comes from `employment_wage_periods`. Prior periods
  come from `employment_history` (I6).
- **Proof.**
  - Goldens:
    - a 3-month calendar-day average with the maternity months excluded;
    - the JP average-wage floor, `max(total/cal, 0.6*total/worked)`;
    - a rolling 7-day window across a month edge;
    - a 12-month average where tenure is shorter.
  - Probe: the H1 multi-period harness.
- **Unblocks.** About 45 direct rows:

  | Rows | Count |
  |---|---|
  | trailing-average and trailing-aggregate | 10 |
  | derived-contribution-base | 10 |
  | nonmonthly-contribution-base | 6 |
  | leave-pay-expression | 6 |
  | pattern-average | 4 |
  | rolling-period-limit | 4 |
  | others | about 5 |

  It is also the prerequisite of E5, E7, L4 and L6.

#### E5. Ordinary rate, premium base and leave as expressions — M

- **Configuration.**
  - `work_rules` gains:
    - `ordinary_rate: {hour, day}`,
    - `leave_pay_reference`,
    - `encashment_reference`,
    - `proration`.
    Each is an expression over `contract.classes`, `table()` and `history`.
  - `leave_catalogue` rows gain `charge`, `pay` and `entitlement` expressions, plus
    `per: EPISODE | EVENT | YEAR` and a `cease_when` expression.
  - The enum values become seed expressions. Then the enums are deleted: `ordinary_rate_reference`,
    `ordinary_divisor_days`, the encashment enum, `proration_basis`, and about 30 statute-shaped
    `leave_entitlement.ts` flags.
- **Engine.**
  - A new `rate` site.
  - Files: `datatypes/work_rules.ts`, `datatypes/leave_entitlement.ts`, `run/ordinary-rate.ts`,
    `run/overtime.ts`, `run/proration.ts`, `payroll/work-bands.ts`, `src/lib/leave/*`, and the
    leave charging in `payroll/work.ts`.
- **Input.** Catalogue class tags already exist. Each allowance row declares its class (the
  component-characterisation rows).
- **Proof.**
  - Goldens:
    - the JP premium base excluding family, commuting and housing allowances;
    - the CN-SH03 leave base;
    - maternity of 98+60 days charged in calendar days, with the working days paid;
    - SG flexible maternity rounded down to the half-day;
    - twins giving one allocation.
  - **Parity:** the existing SG, MY and PH overtime and proration probes must stay green through
    the enum-to-expression move.
- **Unblocks.** Premium-base-composition, calendar-day-leave, leave-episode, the SG-CD13 cap and
  the CN-SH12 ladders, about 20 rows. It closes the closed-enum wall (§1.2 point 2).

#### E6. Period-derived lines — S

- **Configuration.** `work_rules.derived_lines: [{code, when, amount, component}]`, evaluated
  after the work and leave lines, over `lines.*`, `classes.*` and `period.*`.
- **Engine.** `run/accumulate.ts` and `payroll/work-lines.ts`.
- **Input.** Per-day and per-session output units, declared as `work_day_facts` numbers.
- **Proof.** Golden: piece pay below the floor produces a top-up line. Probe: a PH piece-rate
  worker.
- **Unblocks.** Piece-floor 4, per-day-output 6, per-session-output about 4, per-day-condition 8.
  About 22 rows.

#### E7. Contribution base, cadence and scope as expressions — M

This merges A1 E10 with A3 L5 and L8.

- **Configuration.**
  - On `statutory_contributions`:
    - `base` is an expression;
    - `base_when` holds overrides;
    - `assessment_period` gains QUARTER and YEAR;
    - `assessment_scope` gains COMPANY and PERSON.
  - COMPANY-scope aggregates: `company.headcount_on(d)`, `company.year.headcount_average(where)`,
    `company.year.wages_total`, `company.facts.*`.
  - Levy estimate and true-up: the true-up is (assessed − estimate), raised as an L1 instance.
- **Engine.**
  - Files: `run/contribute.ts`, `payroll/contribution.ts`, `run/statutory-facts.ts`,
    `statutory_contributions/{model,collection}`, `expressions/functions/company.ts` (new).
  - The directed-tax special case in `contribute.ts` is deleted and becomes an L7 order.
- **Input.**
  - Dated status facts (I3).
  - External concurrent-employer wages as `employment_statutory_facts` declared facts.
- **Proof.**
  - Goldens:
    - the CN prior-year base;
    - the MY EPF floor;
    - the ID daily wage × 25;
    - a quota levy of (headcount × ratio − disabled) × average wage;
    - the annual estimate and true-up.
  - Probes: SG-CPF11, MY-SKBBK-02, CN-N24.
- **Unblocks.** Employer-levy 20, employer-annual-levy 6, levy-reconciliation 7, multi-employment
  7, and the CN base rows, about 50 rows.

#### E8. Territorial overlays — M

- **Configuration.**
  - A settings version declares
    `overlays: [{when: "worksite.region in [...]", lineage, authority}]`.
  - Overlay versions hold only what they replace, matched by code: work_rules parts, leave rows,
    holidays, checks and tables.
  - National schemes stay with the base lineage. The seal refuses an overlay that replaces a
    scheme.
- **Engine.**
  - `src/lib/jurisdiction_settings.ts`, `run/configuration.ts` and `run/effective.ts` resolve the
    base plus the overlay per day.
  - A mid-period worksite change splits the day spans, reusing the `worksite_coverage` split.
  - `worksite_coverage.refused` becomes "routed".
- **Input.** `worksite.region` (I1).
- **Proof.**
  - Golden: a Sabah worksite reads the Sabah rows.
  - Probe: a mid-month transfer from Peninsular Malaysia to Sabah. Overtime and holidays switch on
    the transfer day, and EPF stays continuous.
- **Unblocks.** MY territorial, 45 rows. Optionally, the CN cities can later be rebased as overlays
  to remove duplicated rows. That is not needed for 100%.

#### E9. Stored checks — M

This merges A1 E8 with A3's L1 `blocks`.

- **Configuration.**
  - `jurisdiction_settings.checks:
    [{at: EMPLOYMENT_START|TERMS_CHANGE|EXIT|PAYSLIP|LEAVE_ENTRY|DEDUCTION, when, action: REFUSE|WARN, message, authority}]`.
  - It absorbs `worksite_coverage.refuse_when` and `final_pay_due_days`.
- **Engine.**
  - What each check can read:
    - `before.*` and `after.*` on TERMS_CHANGE;
    - `deduction.*` on DEDUCTION;
    - `history.terms` (E4);
    - `obligations.open(code)` (L1).
  - Files: `src/lib/checks.ts` (new, one helper) and `datatypes/checks.ts`. It is called from
    `run/validate.ts`, `run/precheck.ts` and the transforms of employments, terms, leave and loans.
    Each of those collection owners adds a one-line call.
- **Input.** Dated facts (I3, I4).
- **Proof.** Goldens for each stage. Probes use the H1 refusal assertion.
- **Unblocks.**
  - admission-gate 7, terms-change-guard 4, disbursement-check 5;
  - the exit bars behind open duties (part of L1);
  - the refusal probes: TH 6 and PH 6.

  About 30 rows.

### (b) Input capture model

#### I1. Worksites — M

- **Configuration.** `jurisdiction_settings.worksite_facts: FactKey[]`.
- **Input model.**
  - New collection `worksites`: `company_id`, `code`, `name`, `region`, `facts`,
    `effective_range`. `noOverlap` on `[company_id, code]`.
  - `employment_terms.worksite` becomes a relation to it.
  - The text column and `worksite_sector` are deleted (zero legacy; a rename is a drop plus an
    add).
- **Engine.** `gather.ts` resolves the revision in force. `worksite.{code,region,facts.*}` is
  exposed on the person, day and entry sites.
- **Proof.** Unit test: an overlap is refused and the revision in force is picked. Probe: two JP
  worksites in two prefectures give two floors.
- **Unblocks.**
  - JP 230 rows (with E2 and I2);
  - the input half of MY's 45 territorial rows;
  - the project key for CN construction (29 rows);
  - the WORKSITE subject for L1.

#### I2. Reference rows and the `code` fact type — M

- **Configuration.** The child collection `reference_rows` of `jurisdiction_settings`:
  `settings_id`, `table`, `code`, `parent_code?`, `label`, `effective_range`, `range_from?`,
  `range_to?`, `values`. It is sealed and cloned with its version.
- **Input model.**
  - FactKey type `code`, with `table` and `parent_fact?`.
  - `factValueFault` checks that the code exists and is in force on the fact's date. It takes a
    resolver, so it stays pure.
  - The picker in `declared-facts-field.svelte` filters by date and by parent code.
- **Engine.** The data behind E2.
- **Proof.** Unit test: an unknown or expired code is refused, and seal and clone carry the rows.
  Probes: JP-SF001 and SG-PWM01.
- **Unblocks.**
  - all the coded classifications: worker-class 26, role 8, worker-legal-class 8, trainee 6,
    work-permit 4, insured-class 4, occupation 10;
  - the table half of E2's 306 rows.

#### I3. Dated person facts — M

- **Configuration.** `jurisdiction_settings.person_facts: FactKey[]`. The existing
  `change_effect` handles monthly and annual declarations.
- **Input model.**
  - Collection `person_facts`: `employee_id`, `employment_id?`, `facts`, `effective_range`,
    `source: HR|EMPLOYEE|IMPORT`. A row for an employment overrides the personal row.
  - Phase 2 deletes:
    - the fixed `employees` columns: `marital_status`, `solo_parent`, `disabled`,
      `receiving_pension`, `race`, `religion`, `spouse_status`, `dependents_count`;
    - the terms columns `residency_status`, `pass_type`, `statutory_work_category` and
      `weather_dependent_piece`, which move to `terms_facts`.
- **Engine.** `person.facts.*` in `eligibility.ts`. `gather.ts` resolves the revision in force.
- **Proof.** Probes: SG-CD01, CN-N13 and MY-EPF-03.
- **Unblocks.** dated-person-fact 31, worker-profile-status 11, election 8, declaration 5, and the
  identity inputs that filings read. About 55 rows.

#### I4. Leave and state event facts — S

- **Configuration.** `leave_catalogue.event_facts: FactKey[]`.
- **Input model.**
  - `leave_entries` gains `facts` and a generic `episode_id`.
  - The fixed `event_*` columns and `agreed_pay_fraction` are deleted.
  - A stoppage, quarantine or disciplinary state is a leave row whose pay is an E5 expression over
    `leave.day_index` and `leave.month_index`.
- **Engine.** `leave.facts.*` and `event.facts.*`.
- **Proof.** Probes: VN-LEAVE-01, CN-N04.stoppage, and one episode that crosses a period.
- **Unblocks.** life-event 7, leave-arrangement-election 6, dated-pay-state 12, leave-episode 4.
  About 29 rows.

#### I5. Evidence on any subject — S

- **Configuration.** FactKey `evidence` gains `document` (a code from a `DOCUMENT_TYPE` table)
  and `valid_days?`.
- **Input model.**
  - `fact_evidence.subject` adds `person_facts`, `worksites`, `employments`, `leave_entries`,
    `adhoc_requests`, `claim_requests`, `employment_statutory_facts`, `employment_history` and
    `obligation_instances`.
  - `fact_evidence` gains `document_type` and `expires_on`.
- **Engine.** `evidence.<key>.{received_on,expires_on}` readable in expressions.
- **Proof.** Unit test: a value is refused until its evidence exists, for each new subject. Probe:
  SG-EA35.certification.
- **Unblocks.** evidence-document 32 and component-characterisation 4. It is also the evidence
  shape of L1.

#### I6. Prior history — M

- **Configuration.** `jurisdiction_settings.history_kinds: [{code, label, facts: FactKey[]}]`.
- **Input model.** Collection `employment_history`: `employee_id`, `kind`, `effective_range`,
  `facts`, with evidence.
- **Engine.** `history.external(kind, window)` in E4, and `employment.terms_count(expr)`.
- **Proof.** Probes: MY-PCB-03, VN-LC46-02 and VN-LC20-01.
- **Unblocks.** prior-employment 7, insured-history 4, contract-history 4.

#### I7. Declared exit grounds — S

- **Input model.** `employments.exit_reason` (a 9-value enum) becomes `exit_ground`, a code from a
  `TERMINATION_GROUND` table. Exit facts can carry evidence. Writers are swept first, as in the
  lesson on deleting a column.
- **Proof.** Probes: SG-EA06, TH-EXIT-05 and VN-LC34-01.
- **Unblocks.** termination-cause 4, termination-ground 4, and the input half of termination-case
  6.

#### I8. Facts-owed gate and inputs oracle — M

- **Engine.**
  - One renderer, `declared-facts-field.svelte`, for any `FactKey[]`: code pickers, inline
    evidence and a live `required_when`.
  - One queue of facts owed before the next run (page `hr_controller/+facts_owed.page.svelte`).
    It shares the same fault list as `validate.ts` and `precheck.ts`.
  - Self-service writes `person_facts` with `source=EMPLOYEE`, as a provisional commit.
- **Proof.**
  - `tests/inventory-inputs.test.ts` enumerates the seeds and checks that every tracker
    `config_path` naming a fact key or a table resolves to a seeded declaration.
  - The surface sweep renders and saves every declared set.
- **Unblocks.** It unblocks no rows directly. It is the correctness gate for Q2: it proves the
  inputs are captured correctly.

### (c) Product lifecycle features

#### L1. Obligation ledger — L

- **Configuration.** `custom_field/obligations` becomes `duty_types`:

  ```
  {code, authority, subject: COMPANY|EMPLOYMENT|WORKSITE|RUN|CASE,
   trigger: {on: RUN_FINALISED|PERIOD_CLOSE|HIRE|EXIT|FACT_CHANGE|CALENDAR|CASE_EVENT, when, every?},
   due: <date expr>, evidence: FactKey[], amount?: <money expr>, late_charge?: <expr>,
   blocks?: EXIT|PAYMENT|RUN, retain_years: <expr>}
  ```

- **Input model.**
  - Collection `obligation_instances`: `duty_code`, `settings_version_id`, `subject`,
    `trigger_ref`, `due_on`, `amount_due`, `amount_settled`, `fulfilled_on`, `reference`,
    `facts`.
  - State is OPEN, FULFILLED or WAIVED (with a reason). LATE is derived, not stored.
  - Unique on `(duty_code, subject, trigger_ref)`, so creation is idempotent.
  - Evidence goes through I5.
- **Engine.**
  - `src/lib/obligations/materialise.ts`, a pure function. It is called from `run/graph.ts`, from
    the employments transform on hire and exit, and from `+obligation_calendar.automation.ts`.
  - A `blocks` value becomes an E9 check.
  - A new `obligation` site.
  - Page `hr_controller/compliance/`.
  - `final_pay_deadlines` becomes a duty type.
- **Proof.**
  - Golden `tests/obligations.test.ts`: materialise, due date, the late state, a fulfilment
    refused without its evidence, an idempotent re-run.
  - Probe: trigger through the real write path, then assert `due_on` and `amount_due` against the
    cited figures.
- **Unblocks.**
  - About 355 rows:
    - the deadline and evidence half of statutory-filing 93;
    - filing-evidence 32, obligation-evidence-ledger 30, obligation-evidence-log 14,
      obligation-evidence 13;
    - registers 7, retention 11, compliance-register 10, notice-evidence 8;
    - remittance-ledger 7, work-pass 11, hr-request 7, enforcement-remediation 15, subsidy 18;
    - construction 29 (with I1).
  - It also moves EXTERNAL rows with capturable evidence to EXTERNAL-RECORDED.

#### L2. Returns and bank files — M

- **Configuration.** `returns: [{code, cadence: MONTH|YEAR|EVENT, population, columns:[{key,label,value}], identity_patterns, format:{kind: CSV|XLSX|FIXED, header, encoding, widths}}]`
  in `datatypes/returns.ts`. It replaces `IncomeReturnSettings`, which is deleted. Bank files use
  the same column spec, and the coded `ocbc-fast` path in `run/bank-formats.ts` is deleted.
- **Engine.**
  - `run/income-return.ts` becomes `run/returns.ts`.
  - A `filing` site over settled slips.
  - The export automation attaches the generated file as evidence on the matching L1 instance.
- **Proof.** A golden per return, compared byte for byte against the authority's published layout.
  Probe: run, generate, compare.
- **Unblocks.** The content half of the 93 statutory-filing rows, and the bank formats.

#### L3. Run kinds and pay calendar — L

- **Configuration.** `pay_calendar`: `due` and `late_when` expressions for each cadence. The wage
  due date becomes an L1 duty.
- **Input model.** `payroll_runs.kind` (REGULAR, OFF_CYCLE, FINAL or CORRECTION) and `sequence`.
  The unique key becomes `(company, period, sequence)`.
- **Engine.**
  - `run/period.ts`: ordering applies to REGULAR runs only.
  - The population in `run/gather.ts`:
    - FINAL takes the employments that exit in the window;
    - REGULAR skips anyone a FINAL has already settled;
    - OFF_CYCLE takes the selected sources, including people who have already left.
  - Month-to-date schemes read the frozen slips of every run in the period.
  - Files: `run/engine.ts`, `run/graph.ts` and `run/settlement.ts`.
- **Proof.** Golden: a FINAL run then a REGULAR run gives the same contributions as one combined
  run. Probes: CN-N04 payday, SG-EA09 and CN-N42.
- **Unblocks.** pay-calendar 9, post-exit, termination-case 6 and the others, about 31 rows. It
  also enables L4.

#### L4. Retro recalculation — L (needs owner decision 2)

- **Configuration.** Each scheme states, as expressions over `line.origin_period` and
  `base.by_origin`, whether a difference is reallocated to its origin month (raising an arrears
  duty) or assessed now. Recovery windows and late fees are stored expressions.
- **Input model.**
  - `employment_terms` and `work_days` gain `decided_on`. A frozen row is superseded, never
    edited.
  - Reinstatement supersedes the exit.
- **Engine.**
  - `run/retro.ts` (new): find the affected periods, rebuild each with the version in force for
    that period, and diff per line. The differences go into a CORRECTION run as lines with
    `origin_period`.
  - It uses `buildPeriod(asOf)`, exposed by L3, and `allocateByOrigin`, exposed by E7.
- **Proof.** Golden: a rise backdated three months gives exactly 3 × the difference. Probes:
  SG-CPF20, CN-SH38, MY-EPF-DEDUCT-01 and CN-SH04.
- **Unblocks.** retro-recalc 18, award-order 7 and contribution-correction 8, about 33 rows.

#### L5. Generalised cases — L

- **Configuration.** `datatypes/case_types.ts` replaces `BenefitCaseType`:

  ```
  {facts, qualifications, event_kinds, movement_kinds,
   phases:[{code, days, award, employer_pays, reimbursable}]}
  ```

  Deadlines are L1 duty types with subject CASE. `credit_top_count`, `daily_divisor`,
  `full_pay_days_divisor` and `credit_window` are deleted.
- **Engine.** Files: `src/lib/benefit-cases/*`. A new `case` site with:
  - `credits.window(..).top(n)`,
  - `earnings.average(m)`,
  - `case.previous(kind)`.
- **Proof.** **Parity:** the current maternity case type, re-expressed, keeps its goldens green.
  Then a work-injury case with tiers. Probes: SG-WICA\*, TH-SS-03 and SG-CD\*.
- **Unblocks.** benefit-case 34 and gov-reimbursement 23, plus insurer-benefit 6 moving to
  EXTERNAL-RECORDED. About 63 rows.

#### L6. Third-party deduction orders — M

- **Configuration.**
  - `loans` gains:
    - `creditor` (EMPLOYER or THIRD_PARTY) and `authority`;
    - `recovery_rule`, an expression over `payment.net`, `payment.disposable` and `wage_floor`;
    - `priority`;
    - `on_exit`.
  - Remitting to the creditor is an L1 duty.
- **Engine.** Files: `payroll/loan.ts` and `loan-schedule.ts`. The run captures a
  `loan_repayments` row. The directed-tax path in `contribute.ts` is removed and becomes a loan
  whose creditor is the tax authority.
- **Proof.** Golden: an order capped at a stored fraction of net pay, with a floor and full
  recovery on exit. Probes: TW-WAGE-06, PH-SS04 to 07, and MY CP38.
- **Unblocks.** government-loan-servicing and the garnishee rows, 4 or more.

### (d) Proof harness — the only capability for the 786 PROBE rows

#### H1. Probe harness extensions — M

- **What.**
  1. A **multi-period** harness: save N paid runs, then the event run. This is the missing
     `PROBE:multi-period-harness`.
  2. A **refusal assertion**: the write or run is refused, and the saved message matches.
  3. A **non-payslip oracle**: a saved duty instance's `due_on` and `amount_due`, or a generated
     file's bytes, match the cited result.
- **Files.** `tests/e2e/probes/_harness.ts` (or the existing helper module) and
  `tests/inventory-csv.test.ts`, which accepts the new oracle kinds.
- **Proof.** Self-test cases in the harness.
- **Unblocks.**
  - The oracle side of the PROBE class. Once the behaviour exists, the rest is execution: the
    seed-phase agents write a probe per row.
  - It needs owner decision 1.

### Owner decisions required

1. **VERIFIED for rows that do not end in a payslip.** The README defines VERIFIED as ending in a
   saved payslip. Accept "a saved refusal, duty instance or generated file matches the cited
   result" as the production-path oracle. Without this, the L1 and L2 rows and the refusal rows
   stop at EXTERNAL-RECORDED or TESTED.
2. **Retro recalculation replaces "a frozen source is never edited"** with "a frozen source is
   superseded by a `decided_on` revision" (`docs/architecture.md`). This is the largest contract
   risk. L4 does not start until it is decided.
3. **Tables live in a child collection, `reference_rows`,** not in a JSON field on the settings
   version (resolved above; confirm).

---

## 3. The honest ceiling after these capabilities

"100%" means every row is either VERIFIED or in an honest terminal status: NOT-APPLICABLE,
EXTERNAL-RECORDED, EXTERNAL, AWAITING-LAW or SOURCE-BLOCKED. No row stays GAP or PARTIAL.

| Remaining | Rows | Why it stays |
|---|---|---|
| LAW: source-blocked | 72 | The official text cannot be reached. It stays SOURCE-BLOCKED until a source is found. This is research work, not product work. |
| LAW: awaiting gazette or publication | 55 | Not yet law (JP R8 revisions and others). It stays AWAITING-LAW, then becomes a new sealed version once gazetted. |
| LAW: legal-reading | 26 | **Resolvable by decision.** Under the owner rule ("law silent → a lawful, consistent default"), each one gets a recorded default and then goes through the normal path. |
| LAW: locality-decree transcription and operative-order text | 23 | **Seed work** once the text is obtained. No capability is missing. |
| EXTERNAL with nothing the employer can evidence | about 43 visible (enforcement 14, organisation governance 11, individual government benefit 10, government administration 8), plus the tail | Duties of a government, a court or another party. They stay EXTERNAL permanently, and that is the honest terminal status. |
| EXTERNAL with capturable evidence | the rest of the 148 | Move to EXTERNAL-RECORDED through L1 and L5. |

The true ceiling is about 150 rows that stay SOURCE-BLOCKED or AWAITING-LAW, plus about 50 or more
that stay EXTERNAL. That is about 7% of all 3,004 rows. It is outside the product's control. Every
other open row is structurally reachable once §2 lands.

---

## 4. Build plan

### Ownership rules for shared hotspots

| File or files | Owner | Others |
|---|---|---|
| `src/lib/expressions/{contexts,compile,evaluate}.ts`, `docs/expression-context.md` | **K** | Request site members in writing; function modules live in their own files, and K registers them |
| `src/lib/payroll/run/gather.ts`, `run/eligibility.ts` | **K** | Send loaders as exported functions |
| `src/data/+relationship.ts` | **D** | Send their entries |
| `jurisdiction_settings` model and collection, `settings_clone.ts`, `settings_seal.ts` | **T** | Send field additions as single hunks |
| `run/configuration.ts`, `run/effective.ts`, `lib/jurisdiction_settings.ts` | **Y** | — |
| `run/contribute.ts` | **S** | — |
| `run/graph.ts`, `run/engine.ts`, `run/period.ts` | **N** | Call L1 `materialise()` and L6 instalment capture as pure imports, stubbed until they land |
| `datatypes/payroll_settings.ts` | **C** | Send one-line property hunks |

### Wave 1 — parallel, no cross dependencies

| Pkg | Capabilities | Owns | Effort |
|---|---|---|---|
| **K** kernel | E1, E3, the new sites (rate, obligation, filing, case), registration | expressions/*, `expressions/functions/{core,spans}.ts`, `gather.ts`, `eligibility.ts`, `run/rounding.ts`, `tests/expressions*.test.ts` | M |
| **T** tables | I2, E2 | `data/{model,collection}/reference_rows/*`, the `jurisdiction_settings` model and collection, `settings_clone.ts`, `settings_seal.ts`, `datatypes/fact_keys.ts`, `lib/declared-facts.ts`, `expressions/functions/tables.ts` | M |
| **W** worksites | I1 | `data/{model,collection}/worksites/*`, the `employment_terms` model and collection | M |
| **P** people | I3, I6 | `data/{model,collection}/{person_facts,employment_history}/*`, the `employees` model | M |
| **D** events, exit, evidence | I4, I5, I7 | the `leave_entries`, `leave_catalogue`, `employments` and `fact_evidence` models and collections, `+relationship.ts` | M |
| **O** obligations | L1 (except the gate) | `data/{model,collection}/obligation_instances/*`, `custom_field/obligations/*`, `lib/obligations/*`, `automation/+obligation_calendar.automation.ts`, `app/hr_controller/compliance/*`, `tests/obligations.test.ts` | L |
| **H** harness | H1, the I8 oracle test | `tests/e2e/probes/` harness helpers, `tests/inventory-csv.test.ts`, `tests/inventory-inputs.test.ts` | M |

### Wave 2 — after K and T (the others as noted)

| Pkg | Capabilities | Owns | Needs |
|---|---|---|---|
| **R** history | E4 | `payroll/history.ts`, `expressions/functions/history.ts`, folding in `reference-wages.ts` and `statutory-history.ts` | K, P |
| **G** checks | E9 | `lib/checks.ts`, `datatypes/checks.ts`, `run/validate.ts`, `run/precheck.ts` | K, O |
| **N** run kinds | L3 | `data/{model,collection}/payroll_runs/*`, `run/{period,engine,graph,settlement}.ts`, `datatypes/pay_calendar.ts`, `tests/run-kinds.test.ts` | K, O |
| **Y** overlays | E8 | `lib/jurisdiction_settings.ts`, `run/{configuration,effective}.ts` | T, W |
| **V** derived lines | E6 | `run/accumulate.ts`, `payroll/work-lines.ts` | K, T |
| **F** returns | L2 | `run/{income-return,export,export-data,bank-formats}.ts`, `datatypes/returns.ts`, `automation/+payroll_export.automation.ts` | K, O |
| **L** orders | L6 | `data/{model,collection}/{loans,loan_repayments}/*`, `payroll/loan.ts`, `loan-schedule.ts` | K, O |
| **U** capture UI | I8 (UI) | `ui/declared-facts-field.svelte`, `app/hr_controller/+facts_owed.page.svelte` | T, D, P |

### Wave 3 — after R

| Pkg | Capabilities | Owns | Needs |
|---|---|---|---|
| **S** contributions | E7 | `run/contribute.ts`, `payroll/contribution.ts`, `run/statutory-facts.ts`, `statutory_contributions/*`, `expressions/functions/company.ts` | R, O, L (directed-tax removal) |
| **E** rate and leave | E5 | `datatypes/{work_rules,leave_entitlement}.ts`, `run/{ordinary-rate,overtime,proration}.ts`, `payroll/{work-bands,work}.ts`, `lib/leave/*` | R, D |
| **C** cases | L5 | `benefit-cases/*`, `benefit_case*` models, `datatypes/{case_types,payroll_settings}.ts` | R, O |

### Wave 4 — after N and S

| Pkg | Capabilities | Owns | Needs |
|---|---|---|---|
| **X** retro | L4 | `run/retro.ts`, `datatypes/payslip_adjustments.ts`, supersession in the `employment_terms` and `work_days` collections (after W hands over) | N, S, owner decision 2 |
| **Z** legacy sweep | Zero-legacy deletes | `wages.ts` flags, the pruned `evaluate.ts` functions (through K), `exit_reason` readers, fixed employee and leave columns | All the replacements seeded. Writers are swept before columns are deleted. |

### Gates for every package

1. `bolt sync`, then `bolt check`.
2. `bolt test`, including `tests/no-jurisdiction-code.test.ts`, `tests/inventory-csv.test.ts` and
   the package's goldens.
3. `pnpm check` in the templates repository.
4. Parity: any enum or formula that moves into an expression keeps its existing probes green.

A package lands its source and its test together.

### Phase 2: per-jurisdiction seed and configuration (parallel, after the relevant waves)

- Each agent owns exactly one lineage: `seed/jurisdiction/<lineage>/*` and
  `tests/e2e/probes/<J>.ts`. It updates only `docs/inventory/<j>.csv`.
- MY has one owner.
- Seeding can start per capability as each package goes green. It does not wait for everything.

| Order | Jurisdiction | Needs | Main work |
|---|---|---|---|
| 1 | JP | T, W, K; then R and E | Tables for regional, specific and in-kind values; 290 rows |
| 2 | SG | T, P, D, O, C, H | PWM tables, person facts, evidence, WICA and CD cases, the golden-only → probe backlog (138) |
| 3 | CN | P, D, R, S, O, N, H | Worker class, stoppage, dispatch, bases, construction duties, the not-run and rerun backlog (147+) |
| 4 | MY | Y, W, S, O, F | Sabah and Sarawak overlays, EPF floor, the obligation ledger, returns |
| 5 | ID, PH, TH, TW, VN | In parallel once their dependencies are green | — |

In every jurisdiction:

- **Record defaults.** Each LAW:legal-reading row gets its recorded default (owner rule).
- **Transcribe decrees.** Once the text is reachable, transcribe locality decrees and operative
  orders into tables.
- **Mark terminal statuses.** Mark AWAITING-LAW and SOURCE-BLOCKED honestly.

A row reaches VERIFIED only when both of these hold:

- its probe passes through the real write path;
- `tests/inventory-inputs.test.ts` resolves its `config_path` against the seeds.

## Owner decisions (2026-09-30)

1. **Verified beyond payslips:** a production probe that proves a saved refusal, obligation instance or generated
   return/file (with its figures) counts as `VERIFIED`. Filing rows can reach `VERIFIED` or `EXTERNAL-RECORDED`.
2. **No retro:** committed payslip rows stay frozen; **L4 (retro recalculation) is out of scope.** Corrections are
   manual ad hoc lines in a later run (L3 correction runs may still exist, but never rewrite a committed slip).
   Tracker rows that require retro stay `GAP` with reason "owner decision 2026-09-30: no retro recalculation".
3. **Tables:** statutory tables live in the generic `reference_rows` child collection, versioned with each settings
   version, read by `table()` / `band()` / `bands()`.
