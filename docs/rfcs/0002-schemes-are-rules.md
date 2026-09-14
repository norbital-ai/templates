# RFC 0002 — Schemes are rules

- Status: Landed. The write-time gates, the AST mentions and the UI membership read were closed in
  the 2026-09-14 pass recorded in the [RFC 0001 tracker](./0001-tracker.md).
- Scope: `templates/hr-payroll` collection **attributes**, the Settings and Payroll screens, and
  `seed_bank/norbital_hr`
- Keeps: the five catalogue families, their entries, work rules, and the RFC 0001 pipeline.
- Changes: no computed amount. The statutory golden suites must stay cent-identical.

## 0. The whole system in one page

```
LINES ──> LANDINGS ──> OPT-INS ──> SCHEMES ──> SETTLEMENT
```

1. **Landing.** Every priced line carries `destination × direction`: gross +, gross −, net +,
   net −, employer cost, or display. The landing is what keeps non-wages out of gross and net (§2).

2. **Opt-in.** Every priced line — the catalogue band that priced the entry, the work line, the
   work band — carries `statutory_opt_ins: [ { contribution_id, effect } ]`, an FK array to the
   schemes in its own settings version. Silence means no effect. The line declares which schemes
   its amount feeds; the scheme declares no list of lines at all.

   A scheme's **base** is the signed sum of the lines that name it. It is assembled at run time,
   never authored on the scheme:

   ```
   CPF base = Σ INCLUDE lines naming CPF − Σ REDUCE lines naming CPF
   ```

   `contribution_id` is an FK: the write refuses an id that is not a scheme in force in that
   version, and a line no scheme names simply feeds no base.

3. **Scheme.** The row is identity, assessment and relief-pool facts; the rule is the arithmetic:

   ```
   code · name · authority · assessment_period
   employee_share_annual_cap · shared_cap_group · project_relief_annually
   rules: [ { when, employee, employer } ] first `when` that holds governs

   employee / employer are money expressions over `base` and the person's facts.
   No `when` holds ⇒ the scheme appears on no payslip for this person; a consumer
   that names it reads zero.
   ```

   Every piece of arithmetic that used to be typed is a call to a registered helper inside those
   expressions: `round_cent`, `round_5_cents`, `truncate_cent`, `up_5_cents`, `round_unit`,
   `floor_unit`, `up_to_unit` for money; `bracket`, `ladder`, `progressive` for published tables;
   `minimum_wage(region)` for floors and caps. The only typed fields left are the three
   relief-pool fields (§5): an annual cap shared by a set of producers is state, not a dependency.

4. **Dependency.** A rule names an earlier scheme's result as `produced.<code>.employee` or
   `produced.<code>.employer`. That mention is the dependency — there is nothing else to declare
   and no order to configure. The engine compiles the expression, reads the mentions out of it,
   and computes the named schemes first; ties break by `code`. A loop is refused, naming the path:
   `orderSchemes` runs in `validate` and stops the run with `CONTRIBUTION_DEPENDENCY` (the
   write-time compile refuses a rule naming a scheme not in force, and a hyphenated code cannot be
   an identifier, so a rule cannot name one).

   The order is derived; the calculation is not. What the consumer _does_ with the value —
   subtract it, cap it, project it — is its own rule's expression.

   ```
   MY  PCB  mentions produced.EPF.employee, produced.SOCSO.employee, produced.EIS.employee
       → EPF, SOCSO, EIS run first; PCB's scale subtracts their pooled relief
   ID  PPH21 mentions produced.JHT.employee, produced.JP.employee        (reduces gross)
       and           produced.JKK.employer, produced.JKM.employer,
                     produced.KESEHATAN.employer                          (adds to gross)
       → the same mechanism, reading the other share
   ```

   The Indonesian reliefs are not modelled in the seed today; the mention is what makes them
   expressible without a junction row or a sequence number.

5. **Settlement.** The employee share reduces net; the employer share is employer cost. An
   opted-in line does not have to be employee money: an `EMPLOYER` premium may feed a scheme's
   base (ID's employer JKK / JKM / Kesehatan are taxable income to the employee). Landing and
   opt-in are orthogonal — the landing says where the line settles, the opt-in says who charges it.

Declared vs derived:

| fact            | declared on                        | derived by                    |
| --------------- | ---------------------------------- | ----------------------------- |
| landing         | the line's destination × direction | —                             |
| membership      | the line's `statutory_opt_ins`     | FK lookup                     |
| base            | —                                  | signed sum of opted-in lines  |
| tier            | `rules[].when`                     | first match                   |
| the two shares  | `rules[].employee` / `.employer`   | expression                    |
| dependency edge | any `produced.<code>` mention      | compiled from the expression  |
| order           | —                                  | topological, ties by `code`   |
| relief pool     | the producer's pool fields         | engine, when the read happens |

## 1. Work lines, and where they come from

`work_rules.rates.bands` prices a scheduled or attended day in order and emits one line per
`(line, label)` — the source of `BASIC`, the `OVERTIME` classes, `INCENTIVE` and `NIGHT`:

```jsonc
"rates": { "bands": [
  { "label": "1.5", "line": "OVERTIME", "when": "day_type == \"ORDINARY\"",
    "take": "hours_beyond_normal", "price": "ordinary_hour * 1.5",
    "funnel": { "above": "limits.daily_total", "line": "INCENTIVE" },
    "statutory_opt_ins": [ { "contribution_id": "<SOCSO>", "effect": "INCLUDE" } ] }
]}
```

They are wages by construction. Unpaid days are negative lines from the leave catalogue, and the
same array on the leave band says which schemes they reduce.

## 2. Landing is on the catalogue

Every catalogue row already carries `destination` × `direction`. That is the landing, and it is
what keeps non-wages out of gross and net:

| row (SG)                | destination × direction | lands as           |
| ----------------------- | ----------------------- | ------------------ |
| `TRANSPORT`             | `PAY` · `ADD`           | gross +            |
| `UNPAID_LEAVE`          | `PAY` · `SUBTRACT`      | gross −            |
| `MEDICAL_REIMBURSEMENT` | `NET` · `ADD`           | net +, not wages   |
| `STAFF_LOAN`            | `NET` · `SUBTRACT`      | net −, not wages   |
| `PANEL_CLINIC`          | `EMPLOYER`              | employer cost only |

Landing and opt-in are separate axes. A `NET` line usually names no scheme; an `EMPLOYER` line
may name one (ID's `KESEHATAN_TERMINATION_MONTH_EMPLOYER` opts into PPh21 because the employer
premium is taxable income). A `DISPLAY` line is information and no scheme charges it.

## 3. A scheme and its lines

A leave band, which is the priced unit an entry settles through — the array is the whole
declaration:

```jsonc
{
	"when": "",
	"amount": "entry.amount",
	"limit": { "period": "CALENDAR_YEAR", "on_exceed": "ALLOW", "amount": 576 },
	"statutory_opt_ins": [
		{ "contribution_id": "<CPF>", "effect": "REDUCE" },
		{ "contribution_id": "<SDL>", "effect": "REDUCE" }
	]
}
```

CPF itself names no lines. Its base is whatever opted into it:

```jsonc
{
	"code": "CPF",
	"name": "Central Provident Fund",
	"authority": "Central Provident Fund Act 1953",
	"rules": [
		{ "when": "person.employee.age < 16.0", "employee": "0.0", "employer": "0.0" },
		{
			"when": "person.employee.age <= 55.0",
			"employee": "(base > 6800.0 ? 6800.0 : base) * 20.0 / 100.0",
			"employer": "(base > 6800.0 ? 6800.0 : base) * 17.0 / 100.0"
		},
		{
			"when": "person.employee.age <= 60.0",
			"employee": "(base > 6800.0 ? 6800.0 : base) * 15.0 / 100.0",
			"employer": "(base > 6800.0 ? 6800.0 : base) * 14.0 / 100.0"
		},
		{
			"when": "true",
			"employee": "(base > 6800.0 ? 6800.0 : base) * 9.5 / 100.0",
			"employer": "(base > 6800.0 ? 6800.0 : base) * 7.5 / 100.0"
		}
	]
}
```

A clamp is a ternary: the engine deliberately carries no binary `min`/`max` (their overloads
collide), so `cap(base, 6800.0)` from the draft is written `base > 6800.0 ? 6800.0 : base`, and a
rule that always holds states `"when": "true"` — `when` is non-empty CEL, never `""`.

A foreign employee matches the first rule and is charged nothing — ineligibility is a rule, not a
mode. SDL is one rule, and it charges every wage line because every wage line names it; there is
no `ALL`:

```jsonc
{
	"code": "SDL",
	"name": "Skills Development Levy",
	"authority": "Skills Development Levy Act 1979",
	"rules": [
		{
			"when": "true",
			"employee": "0.0",
			"employer": "base * 0.25 / 100.0 > 11.25 ? 11.25 : base * 0.25 / 100.0"
		}
	]
}
```

And the tax scheme's relief is a mention:

```jsonc
{
	"code": "TAX",
	"name": "Income tax",
	"authority": "Income Tax Act 1947",
	"rules": [
		{ "when": "base - produced.CPF.employee <= 20000.0", "employee": "0.0", "employer": "0.0" },
		{
			"when": "true",
			"employee": "(base - produced.CPF.employee - 20000.0) * 2.0 / 100.0",
			"employer": "0.0"
		}
	]
}
```

Malaysia is the same mechanism one stop along the pipeline — PCB names the funds it is relieved
by, and the engine charges them first:

```jsonc
{
	"when": "true",
	"employee": "progressive(base - produced.EPF.employee - produced.SOCSO.employee - produced.EIS.employee, [0.0, 0.0, 0.0, 5000.0, 0.0, 1.0, 20000.0, 150.0, 3.0, 35000.0, 600.0, 6.0, 50000.0, 1500.0, 11.0])"
}
```

A published progressive ladder is inlined as `[from, amount, rate, …]` triples in one
`progressive(...)` call; the seeded PCB rules transcribe the whole table that way.

Indonesia shows the other share: PPh21's taxable gross is reduced by the employee JHT and JP but
increased by the employer JKK, JKM and Kesehatan. The mentions are the whole dependency; no
sequence number, no relief row.

## 4. A payslip through the pipeline (Singapore sample)

```
line                                lands as    wages?   opt-ins          CPF   SDL   TAX
Basic salary                5,000   gross +     yes      CPF SDL CDAC…    yes   yes   yes
Transport allowance           300   gross +     yes      CPF SDL CDAC…    yes   yes   yes
Unpaid day                   −200   gross −     yes      CPF SDL REDUCE   yes   yes   yes
Medical reimbursement          50   net +       no       —                no    no    no
Staff loan repayment          150   net −       no       —                no    no    no
Panel clinic (company)        300   employer    no       —                no    no    no

CPF  base = 5,000 + 300 − 200 = 5,100   employee 20% = 1,020   employer 17% = 867.00
SDL  base = 5,100                        employer 0.25% = 12.75 → cap → 11.25
TAX  base − CPF = 4,080 → 0 at this wage (SG assesses annually)

gross = 5,300 − 200 = 5,100
net   = 5,100 − 1,020 − 150 + 50 = 4,980
cost  = 867.00 + 11.25 + 300 = 1,178.25
```

## 5. What disappears

| today                                           | tomorrow                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `statutory_contributions.rules` (charge fields) | `relief`, `base_transform`, `share_for_dependants`, `rounding`, `no_withholding_below`, `use_period_table` folded into the rule expressions; the additional-remuneration channel had no live writer, so it is gone. No `PCB_BONUS` scheme is seeded: a source that needs one states its own scheme and rules |
| `statutory_contributions.rules` (relief pool)   | `employee_share_annual_cap`, `shared_cap_group`, `project_relief_annually` stay as columns: an annual cap shared by a set of producers is pool state read at the mention, not an order to declare                                                                                                            |
| `statutory_contributions.eligibility`           | folded into the rule `when`s (`(person…) && (base …)`) — a scheme nobody matches appears on no payslip                                                                                                                                                                                                       |
| `statutory_contributions.bands`                 | renamed `rules`; the `when` selects the tier. A flat rate is one rule, a triangle a few, a published table transcribed verbatim                                                                                                                                                                              |
| `statutory_contributions.sequence`              | gone — order from `produced.<scheme>` mentions                                                                                                                                                                                                                                                               |
| `scheme_reliefs` junction                       | gone — the relieved scheme's rule names `produced.<code>.employee`; the producer's pool columns are unchanged                                                                                                                                                                                                |
| `band.statutory_opt_ins`                        | **stays** — it is the membership declaration, the only place a base is declared                                                                                                                                                                                                                              |
| `catalogue.sequence`                            | **gone** — no stored order, no `reduction_order`: components are walked in the fixed family pipeline, each family by `code`; a negative net trims the last-emitted recovery first                                                                                                                            |
| `work_rules.lines`                              | renamed `engine_lines`                                                                                                                                                                                                                                                                                       |
| `payroll_runs`                                  | `calculation_trace` stores the whole derivation and the payslip's info affordance renders it; the scheme card draws the lines to base to rules to shares path                                                                                                                                                |

## 6. The contract the engine enforces

- Write time (`src/lib/catalogue_rules.ts`, `statutory_contributions/+hooks.ts`,
  `jurisdiction_settings/+hooks.ts`): every `contribution_id` in a catalogue band's, work band's or
  engine line's `statutory_opt_ins` must name a scheme of the same settings version, and every
  `when`/`employee`/`employer` compiles against the `scheme` context. `mentions.ts` reads the
  `produced.<code>.employee|employer` mentions from the compiled CEL AST (a string literal is not a
  mention); a read must name a scheme of the same version, and the dependency graph is rebuilt with
  the incoming rule in place, so a loop is refused when it closes, naming the path. A producer
  another rule still names cannot be deleted.
- Run time: each scheme's base is the signed sum of the priced lines that named it; schemes are
  then computed in mention order (ties by `code`); one `payslip.statutory[]` row per charged scheme
  with `base`, `employee`, `employer` and the governing rule's `when`. The run rebuilds the order
  and refuses a graph that a superseded seed or direct insert left broken.
- A person who matches no rule appears on no payslip, and a consumer reads that scheme's shares as
  zero; a wage that matches no tier is the same — the golden suites are the guard against a
  mis-transcribed ladder.
- No amount changes: the same figures, declared once per line. The statutory goldens are the gate.

## 7. Migration and acceptance

1. **Done.** `statutory_contributions` rows keep their identity; `bands` → `rules`; `sequence`,
   `eligibility`, the typed `rules` object and `scheme_reliefs` are deleted; each junction row
   became a `produced.<code>.employee` mention in the relieved scheme's rule, and the seed
   converter wrote every typed field into those expressions. The three relief-pool fields are
   columns. The custom datatype that shapes the column is `contribution_rules` (it was
   `contribution_bands`).
   - **Reset-only, no data migration** (D10): the migration dropped `bands` and repurposed the old
     typed `rules` column, so a row written before the migration by the old shape decodes as an
     object where the array is now expected. There is no non-destructive tenant update; a reset
     rebuilds from the converted seeds, and a hand-written row is expected to be reseeded.
2. **Done.** `statutory_opt_ins` stays on catalogue and work bands; no scheme gained a `base`.
3. **Done.** Rounding, `progressive`, `bracket`, `ladder` and `minimum_wage` are registered in
   both the compile-time and run-time engines; `produced.<code>.employer` is exposed.
4. **Done.** `work_rules.lines` → `engine_lines`. `catalogue.sequence` is deleted outright — no
   `reduction_order` attribute: the walk is the fixed family pipeline with a `code` tiebreak, the
   workbook sorts by code, and the negative-net guard trims recoveries in reverse emission order.
5. **Done.** All seven lineages' seeds and the statutory, public-seed and synthetic fixture banks
   converted; a one-off converter under `.tmp/` did the data pass and was deleted. The seed bank
   carries no `scheme_reliefs`, no typed-rules object and no `special` key.
6. **Done.** Refusal tests cover no-match (no row, zero read), the mention read with cap and pool,
   the unstated minimum wage and the dependency order. The loop refusal and the unknown-producer
   refusal now happen at write time (`tests/statutory-mentions.test.ts`,
   `tests/statutory-drift.test.ts`) and are re-checked at run build as `CONTRIBUTION_DEPENDENCY`.
7. **Done.** The scheme card shows the lines that opted into it (the `used-by` tab) and the
   `produced.<code>` codes its rules compute after; the form's sections name assessment, relief
   pool and rules, and no surface speaks of bands, eligibility fields, sequence or reliefs for a
   scheme. Acceptance observed: every statutory golden (ID/MY/MY-nihon/PH/SG/TW/VN) is
   cent-identical; `pnpm lint` clean; `pnpm test` green — `bolt sync` (24 collections),
   `norbital-doctor` 0 error 0 hint, four verify scripts and **854/854 tests**. Nothing was pushed
   to staging; no stored sequence and no `reduction_order` attribute remain anywhere.
8. **Done.** `payroll_runs.calculation_trace` (`datatypes/payroll_trace`) is written with every
   build: per payslip, each charged scheme's base lines, producer reads, governing rule and shares;
   the payslip's info affordance renders a charge's derivation from it, and the scheme card draws the lines → base → rules → shares path; no calculation reads it. The
   trace is part of the run's frozen graph, so a rebuild replaces it exactly as it replaces the
   payslips.
9. **Done (probe follow-up).** A request, loan or leave entry may pin a catalogue revision sealed
   under an earlier version; its opt-ins name that revision's scheme rows, and the run levies the
   version in force. `loadOptInAliases` (`lib/payroll/contribution.ts`), used by the money, loan
   and leave loaders, aliases each foreign id through its scheme's code to the row in force, so a
   pinned revision's charge lands on the current scheme instead of feeding nothing and the
   run-wide `OPT_IN_UNKNOWN` guard stays honest. A local `pnpm run env -- serve --template=hr-payroll
--seed=bank` probe built an OpsPH semi-monthly run from the bank seed and read back its
   `payslip.statutory[]` rows (one per scheme, the governing rule's `when`, base, employee and
   employer; `WTAX` reading `produced.SSS.employee + produced.PHIC.employee + produced.HDMF.employee`),
   and a Nihon run against the three-version lineage passed the gate. The same probe found one
   **bank-data defect**, not an engine gap: Nihon loan `40069e44…` stated a principal of 845.00
   against repayments summing 1,014.00 — the workbook's `SUM(E10:U10)` stops one month short of the
   12 filled instalment cells, and the hand mapping copied the cached total. The seed's principal
   is corrected to 1,014.00 (12 x 84.50), the grid's own sum and the value consistent with the
   agreement's effective range through April 2026; the schedule invariant itself is right for this
   model, which has no interest, fee, top-up or restructure concept.
