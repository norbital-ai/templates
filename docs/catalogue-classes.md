# Catalogues as classes — the restructuring brief

Status: agreed with the owner on 2026-09-20, not started. This brief is self-contained: read it
with `docs/architecture.md`, `docs/data.md` and `docs/gap-tracker.md` beside it, and the standing
rules in `src/+agents.md`.

## 1. Why

Three things are tangled today and each has cost a defect:

1. The **allowance catalogue** holds three different kinds of row under one name: recurring
   contract allowances (`SUA`, `ONCALL`, ID `CAR_ALLOWANCE`…), one-off HR decisions (back pay,
   `ADJ`, bonuses, THR, deductions, claw-backs) and law-owed separation payments (termination
   benefit, notice in lieu, severance, separation/retirement pay). The `fixed` / `one_off` /
   `on_separation` flags are the seams showing.
2. A recurring allowance is stored as an **event** (`allowances`: a row per person with its own
   window) and re-materialised into `allowance_entries` every cycle. It behaves like salary, is
   edited like salary, but is modelled like a claim. The delete/edit rules that follow from that
   (a run pins the row; end it with `Until`; delete the draft run to release it) are workable but
   are ceremony a contract term would not need.
3. A scheme's `assessed_on` names **our codes**: `catalog('ALLOWANCE', {'exclude':
['TERMINATION_BENEFIT', 'NOTICE_IN_LIEU']})`, `{'pick': ['SUA', 'BPAYBS', 'ONCALL']}`,
   `{'fixed': true}`. The statute does not know `SUA`; the expression is unreadable to the HR
   person who has to trust it; and a new catalogue row silently falls into or out of every base
   depending on which lists it was or was not added to.

## 2. The model after

### 2.1 Two kinds of catalogue

A catalogue row is a **class**. There are two kinds:

| Kind       | Classes                                                                   | Instances                                                                                                      | Where the instance lives                                                           |
| ---------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Static** | `allowance_catalogue`                                                     | none. The class is assigned on the contract (`employment_terms.allowances`) and priced every cycle from there. | the payslip's base lines                                                           |
| **Normal** | `leave_catalogue`, `claim_catalogue`, `adhoc_catalogue`, `loan_catalogue` | one row per event, linked to the payslip that settled it                                                       | `leave_entries`, `claim_requests`, `adhoc_requests`, `loans` (+ `loan_repayments`) |

The loan is the special normal class: its instance is the loan itself (principal, effective
period); the sub-entries are `loan_repayments`, each pinned to the payslip that recovered it.
Nothing changes there.

A static class carries no `evidence`, no approval, no window: those belong to instances. A normal
class carries them.

### 2.2 What every money class stores

1. **Its domain facts** — `destination` / `direction`, `bands` (pricing, caps), `eligibility`,
   `evidence` (normal only); leave its entitlement; loans their recovery rule; ad hoc
   `raised_by` (see §2.5).
2. **`counts_toward`** — which statutory schemes' bases this class enters, and as which part
   where the scheme splits its base. See §3.

### 2.3 Collections

| Collection                                             | Change                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `employment_terms`                                     | + `allowances` (custom datatype `contract_allowances`: `[{ catalogue_id, amount }]`), beside `base_salary`. Versioned with the contract: to change or stop an allowance is _Change terms from a date_, exactly as salary.                                                                                               |
| `allowance_catalogue`                                  | keep `code`, `name`, `authority`, `destination`, `direction`, `bands`, `eligibility`; **+ `counts_toward`**; **−** `one_off`, `on_separation`, `fixed`, `evidence`. Recurring types only.                                                                                                                               |
| `adhoc_catalogue` (new)                                | `code`, `name`, `authority`, `destination`, `direction`, `bands`, `eligibility`, `evidence`, **`counts_toward`**, `raised_by: MANUAL \| SEPARATION`. Built from today's `one_off` and `on_separation` rows.                                                                                                             |
| `adhoc_requests` (new)                                 | `employment_id`, `catalogue_id`, `amount`, `pay_period`, `evidence_file`, `reason`, `as_adjustment_entry` (claw-back), `approval_id`, `payslip_id` (the run's pin). Built from today's one-period `allowances` rows. Same write contract shape as `claim_requests` (`src/lib/pay_request_rules.ts`, `family: 'ADHOC'`). |
| `claim_catalogue`, `leave_catalogue`, `loan_catalogue` | `claim_catalogue` + `counts_toward` (a reimbursement can enter a base, e.g. PH taxable claims). Leave and loans unchanged; leave encashment already reaches a base as the reserved `ENCASHMENT` line, loans never enter one.                                                                                            |
| `allowances`, `allowance_entries`                      | **deleted**, with their policies, representations, list pages and `NO_REPRESENTATION` entry.                                                                                                                                                                                                                            |
| `payslips.base`                                        | one line per contract allowance beside `BASIC`, carrying the same proration facts (`from`, `to`, `days`, `denominator`, `basis`) BASIC carries.                                                                                                                                                                         |

### 2.4 Pricing

```
employment_terms (base_salary, allowances[])  ─┐
work rules / overtime bands                   ─┼─► base lines: BASIC, SUA, ONCALL … each prorated by
adhoc_requests (this period)                  ─┼    the terms row's coverage of the period
leave, claims, loan repayments                ─┘   adjustment lines: whole in their period
                                                     │
statutory schemes: assessed_on over reserved lines + catalogue words ─► statutory lines
```

A contract allowance is prorated exactly as base salary: by the terms row's coverage of the
salary window on the jurisdiction's proration basis (`work_rules.proration`), with unpaid days
taken off where `payroll.allowance_npl_prorates` says so. Two terms rows in one period (a
mid-month change) give two segments, as they do for BASIC. There is no per-allowance window,
ceiling, `captures.remaining` or `contract_amount`: that machinery in `src/lib/payroll/money.ts`
(`prorationOf`, `measureEntry`'s allowance arm, `allowanceEntry` payloads) goes.

An ad hoc row is due whole in its `pay_period`, priced by its class's bands (a bonus band may
read `year.earned.BASIC / 12.0` for 13th month; a separation band reads service years and the
monthly wage from the person site), and settles as an adjustment line under the payslip that
priced it — the same lifecycle as a claim.

### 2.5 Who raises what

- HR keys ad hoc rows (back pay, bonus, THR, 13th month, adjustments, deductions).
- Off-boarding (`src/automations/+leave_encashment_on_exit.ts`, an explicit automation) raises
  the `raised_by: SEPARATION` classes whose eligibility holds over the leaver on the last day,
  as `adhoc_requests` held for HR — exactly what it does today with `on_separation` allowance
  rows, retargeted.
- The engine raises nothing else. The owner rule stands: the engine calculates; HR records.

### 2.6 Expression sites

`src/lib/expressions/contexts.ts`:

- **assessment site** — reserved lines stay (`BASE`, `OVERTIME`, `INCENTIVE`, `NIGHT_PREMIUM`,
  `ENCASHMENT`, `ABSENCE`, `NO_PAY_LEAVE`); **new reserved words, one per money catalogue**:
  `ALLOWANCES`, `ADHOC`, `CLAIMS`. Each means _the sum of that catalogue's lines on this payslip
  whose class counts toward the scheme being assessed_ (§3). `year.ALLOWANCES`, `year.ADHOC`,
  `year.CLAIMS` are the same over the tax year's earlier PAID payslips (what `year_catalog(...)`
  is today). `catalog(...)` and `year_catalog(...)` are deleted. `code('X')` and
  `year.earned.X` stay (§4).
- **entry site** — `entry.window` / `entry.captures` (allowance-window members) go; the site
  serves claims, ad hoc and loans.
- **person site** — `terms.fixed_allowances` becomes the sum of the contract allowances whose
  class counts toward the scheme's _part_ the caller asks for — see §3.3; `terms.monthly_wage`
  = basic + contract allowances counting toward the caller.

The write-time compiler (`src/lib/expressions/compile.ts`, `assessedOnMentions`) refuses an
`assessed_on` that names a word the site does not have, as it does now; the version seal
(`jurisdiction_settings/+collection.ts`) checks that every `code('X')` names a class of the same
version.

## 3. `counts_toward`

### 3.1 The question it answers

"Does this class enter this scheme's base, and as which part?" The row answers; the scheme does
not list classes. Two reasons the relation lives on the class and not on the scheme:

- A forked lineage (`MY-nihon`) adds its own classes (`ONCALL`, `SUA`) to a sealed law; the
  scheme rows of that version never change, the new class row simply names the schemes it
  enters.
- Every scheme then reads the same way — `BASE + ALLOWANCES + ADHOC …` — and the whole
  answer for one class is on one row, where the HR person creating a class looks.

The scheme page shows the derived list read-only ("Enters this base: SUA, ONCALL, BPAYBS…") so
either side can be audited.

### 3.2 Shape

```ts
// on allowance_catalogue, adhoc_catalogue, claim_catalogue
counts_toward: custom('scheme_membership'); // [{ scheme: 'EPF' }, { scheme: 'CPF', part: 'ADDITIONAL' }, …]
```

`scheme` is a `statutory_contributions.code` of the **same settings version**; the seal refuses
a membership naming a scheme the version does not have. `part` is optional and only valid for a
scheme that declares parts.

### 3.3 Parts

Some schemes split one base in two and cap the parts differently. Today that split is written
inside the expression:

- **SG CPF**: ordinary wages (capped 8,000/month) vs additional wages (capped by 102,000 −
  ordinary year-to-date). Spelled with `{'fixed': true}` vs `{'fixed': false}` today.
- **MY PCB**: normal remuneration vs additional remuneration (the bonus step). Spelled with
  `catalog('ALLOWANCE', {'exclude': ['BACKPAY_ADD_WAGES', …]})` on `assessed_on` and a separate
  `ordinary_on` expression today.

A scheme therefore **declares its parts**: `statutory_contributions.parts: text[]`, empty for a
scheme with one base (EPF, SOCSO, JHT…), `['ORDINARY', 'ADDITIONAL']` for CPF and PCB. A class
that counts toward a scheme with parts names the part. In the scheme's expressions the
catalogue word carries the part: `ALLOWANCES` in `assessed_on` is every member; `ALLOWANCES.ORDINARY`
/ `ADHOC.ADDITIONAL` select a part. `ordinary_on` keeps its role (the ordinary part of the
base, for `scheme.year_to_date.ordinary`) and is written as `BASE + OVERTIME + ALLOWANCES.ORDINARY`.

### 3.4 What the bank's rules become

Every version of every lineage, mechanically (the existing selections _are_ the memberships):

| Lineage                              | Today                                                                                                                | After                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MY, MY-nihon (EPF, SOCSO, EIS, HRDF) | `catalog('ALLOWANCE', {'exclude': ['TERMINATION_BENEFIT', 'NOTICE_IN_LIEU']})`                                       | `ALLOWANCES + ADHOC`; the two separation classes simply do not count toward EPF/SOCSO/EIS                                                                                                                                                                                                    |
| MY PCB                               | `…{'exclude': ['BACKPAY_ADD_WAGES', 'TERMINATION_BENEFIT', …]}` + `ordinary_on`                                      | `ALLOWANCES + ADHOC`; back pay counts toward PCB as `ADDITIONAL`; `ordinary_on` = `BASE + OVERTIME + ALLOWANCES.ORDINARY + ADHOC.ORDINARY`                                                                                                                                                   |
| MY overtime wage (work rules)        | `{'pick': ['SUA', 'BPAYBS', 'ONCALL']}`                                                                              | `terms.fixed_allowances` = contract allowances counting toward the wage rule; `BPAYBS` is ad hoc and enters the OT wage only in the month it is paid — keep as `code('BPAYBS')` there, or drop if the READMEs show the source never included it (verify against `seed_bank/norbital_hr/raw`) |
| ID (JHT, JP, JKK, JKM, Kesehatan)    | `{'pick': ['CAR_ALLOWANCE', 'HOUSE_ALLOWANCE', 'SPECIAL_ALLOWANCE']}`                                                | `ALLOWANCES`; only those three classes count toward BPJS; `MEDICAL_ALLOWANCE` counts toward PPh21 only                                                                                                                                                                                       |
| ID PPh21                             | `{'exclude': ['TAX_INCENTIVE', 'COMPENSATION', 'DEDUCTION', 'KESEHATAN_…', 'PESANGON', 'UPMK']}`                     | `ALLOWANCES + ADHOC` with those classes not counting toward PPh21                                                                                                                                                                                                                            |
| PH (SSS, PhilHealth, Pag-IBIG, WTAX) | `{'exclude': ['bonus', 'THIRTEENTH_MONTH_PAY', 'STATUTORY_ADJUSTMENT', 'SEPARATION_PAY', 'RETIREMENT_PAY', 'meal']}` | `ALLOWANCES + ADHOC`; `meal` (de-minimis rice subsidy) counts toward WTAX only through its `code('meal')` excess rule (§4)                                                                                                                                                                   |
| SG CPF                               | `{'fixed': true}` / `{'fixed': false}` / `year_catalog(...)`                                                         | `ALLOWANCES.ORDINARY` / `ADHOC.ADDITIONAL + ENCASHMENT` / `year.ADHOC.ADDITIONAL`                                                                                                                                                                                                            |
| TW 勞保/健保/勞退                    | `{'exclude': ['SEVERANCE_PAY']}`                                                                                     | `ALLOWANCES + ADHOC`; severance counts toward nothing                                                                                                                                                                                                                                        |
| VN SI/HI/UI                          | `{'exclude': ['SEVERANCE_ALLOWANCE', 'JOB_LOSS_ALLOWANCE']}`                                                         | `ALLOWANCES + ADHOC`                                                                                                                                                                                                                                                                         |

Membership matrix per class: derive it from the selections above — a class is a member of every
scheme whose current expression includes it. Write it as a script under `.tmp/`, print the matrix
per lineage, and check it against each jurisdiction README's wage definitions before sealing.
The goldens (`tests/statutory-golden-*.test.ts`) must not move by a cent.

## 4. What `code('X')` and `year.earned.X` are still for

Membership says _whether_ a line enters a base. Some rules need the **amount of one specific
class** in arithmetic, because the law puts a cap or an exemption on that class alone. Those
keep `code('X')` (this payslip's amount of class `X`) and `year.earned.X` (the tax year's earlier
paid amount). Every use in the bank today:

| Rule                        | Expression fragment                                                                                                        | Why membership cannot express it                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| MY PCB                      | `code('TERMINATION_BENEFIT') > 10000 × service_years ? excess : 0`                                                         | only the part of the termination benefit above RM10,000 per completed year is taxable (dismissal: all of it) |
| PH WTAX                     | `annual_exempt(code('THIRTEENTH_MONTH_PAY') + code('bonus'), year.earned.THIRTEENTH_MONTH_PAY + year.earned.bonus, 90000)` | 13th month and bonuses are exempt up to ₱90,000 a year, together                                             |
| PH WTAX                     | `code('meal') > 2500 / period.month_factor ? excess : 0`                                                                   | rice subsidy is de minimis up to ₱2,500 a month; only the excess is taxable                                  |
| PH WTAX                     | `annual_exempt(code('ANNUAL_LEAVE_ENCASHMENT'), year.earned.ANNUAL_LEAVE_ENCASHMENT, 12 × ordinary_day)`                   | ten days' leave encashment a year is exempt                                                                  |
| ID PPh21 final on severance | `code('PESANGON') + code('UPMK')`                                                                                          | severance is taxed on its own progressive table, apart from monthly income                                   |
| TW NHI supplement           | `code('bonus')`                                                                                                            | the supplementary premium is levied on bonuses above four months' insured salary                             |

These are law rules about one named class of payment; naming the class is the law speaking, not
our code leaking. `X` is a class code of the same settings version (the seal already checks this
through `assessedOnMentions`). Nothing else uses `code()`.

## 5. UI after

- **Change terms** (`src/lib/ui/offboarding/change-terms-flow.svelte`, `change-terms-submit.ts`),
  **contract detail** (`src/lib/ui/contract/contract-detail.svelte`, `terms-fields.svelte`) and
  **self-service › My contract**: an allowances editor/list under base salary — type (from the
  lineage's allowance catalogue, `EligibleTypes`) and amount. Stopping one is a terms change.
- **HR Controller › Events**: Claims · Leave · Loans · Work · **Ad hoc** (replaces Allowances and
  Priced entries: `src/apps/hr_controller/events/+allowances.svelte` → `+adhoc.svelte`). The
  employee profile (`src/apps/+hr_employee.svelte`) and self-service lose the allowance tab;
  employees do not request allowances or ad hoc payments.
- **Settings › Catalog**: Allowances (static), Ad hoc, Claims, Loans, Leave. Every money class
  form gets a "Counts toward" section: one checkbox per scheme of the version, with a part
  picker beside a scheme that has parts. The scheme form shows "Enters this base" read-only.
- **Expression helper** (`docs/expression-context.md`, regenerated by
  `scripts/render-expression-context.ts`): the new words documented, `catalog` gone.

## 6. Seed bank

`seed_bank/norbital_hr` (its README states every encoding rule; keep it true):

- `jurisdiction/<CODE>/allowance_catalogue.json` splits into `allowance_catalogue.json`
  (rows with `one_off: false` and not `on_separation`) and `adhoc_catalogue.json` (the rest,
  `raised_by` from `on_separation`). Both get `counts_toward` per §3.4; drop `fixed`,
  `one_off`, `on_separation`. `claim_catalogue.json` gets `counts_toward`.
  `statutory_contributions.json` (every version) gets `parts` and re-spelt expressions.
- `records/<entity>/allowances.json` (146 rows): the recurring ones (`SUA`, `ONCALL`, ID
  `CAR/HOUSE/SPECIAL_ALLOWANCE`, PH `transport`, `communication`, `leader`, `position`,
  `duty_allowance`… ~50 rows) become `allowances` on the employment_terms row in force on their
  `effective_from`; where the amount changes mid-stream (OPSPH `960.26` to `1040` on 16 Jan 2026) the terms row is split at that date — a new terms row, as the source's change actually
  was. The one-period rows (~95: `BPAYBS`, `ADJ`, `BACKPAY_*`, KDIT's monthly `COMPENSATION`)
  become `records/<entity>/adhoc_requests.json` with `pay_period` from their window.
- `templates/hr-payroll/tests/fixtures/statutory/<J>/` mirrors the jurisdiction files; refresh
  with the existing fixture-refresh path after the bank moves (see memory: the refresh copies
  the uncommitted bank).
- The bank's README documents the split and the encoding; the READMEs under
  `seed_bank/norbital_hr/jurisdiction/<CODE>/README.md` list each scheme's memberships beside
  the law they transcribe.

## 7. Sequence

Each step lands source + tests together, gate green (`pnpm test`, `pnpm exec svelte-check
--threshold error`, `pnpm lint`), committed, ledger line in `docs/gap-tracker.md`.

1. **`counts_toward`, parts, catalogue words.** Model + datatype (`scheme_membership`),
   `statutory_contributions.parts`, seal checks, the assessment-site words and `year.*` forms,
   `contribute.ts` computing the per-scheme sums from memberships, `catalog`/`year_catalog`
   deleted from `evaluate.ts`/`compile.ts`/`contexts.ts`, catalogue forms' "Counts toward"
   section, bank rules re-spelt from the membership matrix, fixtures refreshed. **Goldens
   unchanged to the cent.** Tests: `tests/expressions.test.ts` (words compile, `catalog`
   refused), a membership-matrix test per lineage against the README, seal refusals.
2. **Allowances static.** `contract_allowances` datatype + `employment_terms.allowances`;
   base-line pricing in `families.ts` / `money.ts` beside BASIC (segment proration); the person
   site's `terms.fixed_allowances` / `monthly_wage` from the contract; `allowances` and
   `allowance_entries` collections, policies, pages, representations, exports deleted;
   contract / change-terms / self-service UI; bank's recurring rows moved onto terms; every
   golden that seeds a standing allowance re-expressed on terms. Tests: the allowance proration
   golden (`tests/allowance-proration-golden.test.ts`) over terms; a terms change mid-period
   gives two prorated lines; `payroll-regular` "removing the allowance removes the line".
3. **Ad hoc.** `adhoc_catalogue` + `adhoc_requests` (from the `claim_requests` write contract),
   `raised_by`, off-boarding retargeted, the Events tab, the catalogue tab, bank's one-period
   rows and one-off catalogue rows moved, `one_off` / `on_separation` gone, the `ADHOC` word
   live. Tests: separation raise lands as ad hoc held for HR; a claw-back (`as_adjustment_entry`)
   settles negative; captured-input refusals for ad hoc.

Estimated 3–4 days. Probe every touched surface on the local serve
(`pnpm run env -- serve --template=hr-payroll --seed=bank --port=4194`, see
`docs/gap-tracker.md` 2026-09-20 lines for the probe recipe) before calling a step done.

## 8. Rules that bind this work

- The law is the spec; the employer's listing is evidence. A membership or a band is transcribed
  from the statute and cited in the lineage README, never inferred from what the listing paid.
- No jurisdiction value or logic in engine source: memberships, parts, caps and codes live in
  the sealed settings version. The engine knows the words, not the answers.
- The engine calculates; it creates nothing but the payslip and its lines. Off-boarding's
  separation raise is the one explicit automation and stays so.
- A correction of unchanged law is applied in place to every version; only a law that moved on
  a date takes a new sealed clone.
- Seed source material stays as received; the bank is re-encoded, never re-invented (the raw
  sheets under `seed_bank/norbital_hr/raw` are the authority for what a code means).
- Day-precision instants are stored as the day's UTC midnight (`dayInstant`) and bounded with
  instants; see `docs/architecture.md`.
- Never `git checkout --` / reset in the shared checkout; one-off scripts only under `.tmp/`;
  nothing pushed or deployed.
