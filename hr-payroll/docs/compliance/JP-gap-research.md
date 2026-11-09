# JP compliance gap research

Status: research memo, no source, seed, test or other documentation change.
Date: 2026-11-09.
Scope: the five JP gaps found in the HR/Bolt seed audit. Paths use `JP/version_17` (current head); the same gaps exist in the versions inspected (`version_10` and `version_17`). Apply changes to the JP version being authored, never by rewriting a sealed historical version.

Constraint: every recommendation uses existing HRMS mechanisms — model fields, extension-schema declarations, registered rules/effects, catalog lookups/conversions, reads and obligations. No engine semantics, no new native model field, no helper framework.

## Decisions at a glance

| # | Gap | Decision | Mechanism |
|---|-----|----------|-----------|
| 1 | Establishment dates optional | Mandatory at seal, not anchored to entity or contract dates | Entity extension schema `required` + one registered rule on `entity_profile_version` |
| 2 | Employment type mapping | Derive two booleans from native `engagement` and `signed_contract_period.to`; do not restore a three-value lookup | Registered-effect condition only |
| 3 | Company rest interval absent | Declare `work_interval_hours` on the entity extension; company value may raise but never lower the driver floor | Entity extension field + one expression change in `ROSTER_REST_INTERVAL` |
| 4 | Week start absent | Entity owns `week_start`; do not read the shift pattern for the statutory week | Entity extension field + registered rule at seal; existing readers unchanged |
| 5 | Annual hours absent | Move `normal_hours_per_year` to the contract extension; use annual hours / 12, not weekly × weeks-per-month, when hours vary | Employee extension field + expression change in `MINIMUM_WAGE_CONTRACT` |

Where a gap affects payroll amounts, a short scenario is included under gaps 4 and 5. Gaps 1–3 are obligation/rule triggers and have no amount test.

---

## 1. Establishment and opening dates

### Legal position

The three dates are different statutory facts, not one "establishment date".

- **Health and employees' pension insurance.** The `新規適用届` is due within five days of the office first becoming an applicable office (健康保険法施行規則 art.19; 厚生年金保険法施行規則 art.13; Japan Pension Service, "新規適用の手続き"). Applicability is determined by 健康保険法 art.3(3) and 厚生年金保険法 art.6: a corporation's office with continuously employed workers is applicable, as is a sole proprietor's office with five or more employees in the listed businesses; other offices may apply voluntarily (健康保険法 art.31; 厚生年金保険法 art.6(3)). The date is the actual date the office meets the requirement, not the incorporation date.  
  Sources: <https://www.nenkin.go.jp/service/kounen/tekiyo/jigyosho/20150311.html>, <https://laws.e-gov.go.jp/law/215M10000008036>, <https://laws.e-gov.go.jp/law/329M50000100037>, <https://laws.e-gov.go.jp/law/211AC0000000070>, <https://laws.e-gov.go.jp/law/329AC0000000115>.
- **Labour insurance.** The 労災保険 relationship arises on the day the business starts (労働保険徴収法 art.3); the 雇用保険 relationship arises on the day the business starts (art.4). The `保険関係成立届` is due within ten days of that day (art.4の2). "Business start" is a fact that can precede incorporation and the first payroll.  
  Sources: <https://laws.e-gov.go.jp/law/344AC0000000084>, <https://www.mhlw.go.jp/bunya/roudoukijun/roudouhoken01/yougo.html>.
- **Employment insurance office.** The `雇用保険適用事業所設置届` is due within ten days counted from the day after the office is set up (雇用保険法施行規則 art.141). The applicable business is one where workers are employed (雇用保険法 art.5), subject to the exclusions in art.6. "Office set up" is not the same fact as "first employee outside insured coverage" or "labour insurance relationship".  
  Sources: <https://laws.e-gov.go.jp/law/350M50002000003>, <https://laws.e-gov.go.jp/law/349AC0000000116>, <https://hoken.hellowork.mhlw.go.jp/static/koyohoteki_setchi.html>.

The seed descriptions already state the correct owner: `social_insurance_applicable_on` "differs from incorporation where coverage begins later"; `labour_insurance_established_on` includes "the reviewed opening date for pre-workspace coverage; do not replace it with incorporation"; `employment_insurance_established_on` is "distinct from first employment of a person outside insured coverage".

Anchoring is therefore wrong for three independent reasons:

1. `entity_profile_version.effective_range` is the validity period of a payroll version, not a legal establishment fact; a replacement version would reset it.
2. `employee_contract.effective_range` and `service_started_on` are employment dates; social insurance can apply before the first employee, and labour insurance can arise with the business, not the contract.
3. `signed_contract_period` is the worker's term, not the employer's registration date.

Deriving a date from any of them would fabricate a statutory fact, which is worse than a missing one.

### Decision

**Mandatory at seal; not anchored.** This is the minimal implementation for the template's current employer scope.

Add the three names to the entity extension schema's `required` list so the editor asks for them, and add one registered rule on `entity_profile_version` so the seal update itself refuses a missing date. The seal action is a direct update; JSON Schema `required` is an editor constraint, not a runtime invariant. The existing rule `PAYROLL_OFFICE_EVENT_DATE_REQUIRED` is the pattern to copy.

Minimal rule shape:

```js
// ESTABLISHMENT_EVENT_DATES_REQUIRED, target entity_profile_version
const ext = get(ctx.entry, 'entity_extension_data', {});
const keys = [
  'social_insurance_applicable_on',
  'labour_insurance_established_on',
  'employment_insurance_established_on'
];
return keys.every((key) => {
  const value = get(ext, key, '');
  return typeof value === 'string' && value !== '';
});
```

Use `events: ['create', 'update', 'seal']`, `target_collection: 'entity_profile_version'`, a lookup `name`/`message`, and an order after the payroll-office rule. The effects already read the dates and fire when the version is `SEALED`; no effect change is needed for the normal DRAFT-to-SEALED path.

The occurrence key of each effect includes the date, so a replacement entity version that repeats the same date does not raise a duplicate obligation. A pre-start entity can remain `DRAFT` until the facts exist. If a version can be created directly in `SEALED` status, add `create` to the effect events or force `DRAFT` on create; the current UI seals by update.

**Scope caveat.** A genuinely non-applicable establishment (for example, a sole proprietorship below the five-employee threshold, or an officers-only company with no employment-insurance establishment) can lawfully have no date for one or more schemes. Do not invent a date for it. If the owner later supports that case, add an explicit applicability declaration per scheme and make the date conditional on that declaration. That is a larger change. The current template already assumes an insured employer: `workers_accident_rate_per_mille` is required and `health_insurer` defaults to `KYOKAI`; unconditional dates are therefore the minimal consistent choice.

### Fields and paths

- `templates/hr-payroll/seed/public/jurisdiction/JP/version_17/jurisdiction_settings.json`
  - `entity_extension_schema.required` currently contains only `workers_accident_rate_per_mille`; add the three date names.
  - The three `properties` already exist with the correct descriptions; no new property is needed.
- `templates/hr-payroll/seed/public/jurisdiction/JP/version_17/registered_rule.json`
  - Add `ESTABLISHMENT_EVENT_DATES_REQUIRED` after `PAYROLL_OFFICE_EVENT_DATE_REQUIRED`.
- `templates/hr-payroll/seed/public/jurisdiction/JP/version_17/registered_effect.json`
  - No change for the normal path. The citation URL on the three establishment effects currently points to the Administrative Organs Holiday Act used for the deadline extension; add the substantive law URL (or split the reference) so a reader can reach the filing rule.

### Verification

No payroll amount. Probe the obligation trigger: seal an entity with the three dates and expect the three obligations; seal without one and expect a refusal; create a replacement version with the same dates and expect no duplicate occurrence.

---

## 2. Employment type mapping

### Legal position

The law uses two independent axes, not one three-value type:

- **Part-time worker (短時間労働者)**: a worker whose prescribed weekly hours are shorter than those of an ordinary worker of the same employer (短時間労働者及び有期雇用労働者の雇用管理の改善等に関する法律 art.2(1)).
- **Fixed-term worker (有期雇用労働者)**: a worker who has a labour contract with a fixed term (art.2(2)).

The axes overlap: a worker can be both part-time and fixed-term. On hiring a 短時間・有期雇用労働者, the employer must promptly give the specified terms in writing and explain the measures it will take (arts.6(1), 14(1)). Fixed-term contracts also engage the indefinite-conversion right (労働契約法 art.18) and the term and written-condition rules (労働基準法 arts.14, 15).

The removed `INDEFINITE` / `FIXED_TERM` / `PART_TIME` lookup is a single-axis projection of these two axes. It cannot represent a part-time fixed-term worker, and it mislabels an open-ended part-time worker. Do not restore it.

Sources: <https://laws.e-gov.go.jp/law/405AC0000000076>, <https://laws.e-gov.go.jp/law/419AC0000000128>, <https://laws.e-gov.go.jp/law/322AC0000000049>, <https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000046152.html>. The 2026 amendment adds specified items to the notice content; it does not change the two-axis trigger.

### Decision

**Derive, do not store.** The native contract fields are the source:

```js
const engagement = ctx.entry.engagement;
const employeeLike = ['EMPLOYEE', 'PART_TIME', 'INTERN', 'APPRENTICE'].includes(engagement);
const partTime = engagement === 'PART_TIME';
const term = ctx.entry.signed_contract_period;
const fixedTerm = term != null && term.to != null;
return employeeLike && (partTime || fixedTerm);
```

- `CONTRACTOR`, `CONSULTANT` and `PAYEE` are excluded because the template treats them as non-employment or payee roles; `PAYEE` is explicitly outside employment.
- An open-ended signed period (`signed_contract_period.to == null`) is an indefinite contract, not a fixed-term one. If the template's convention is that `signed_contract_period` is only populated for fixed-term contracts, the `to` check is redundant but harmless; the explicit test is the safer invariant.
- If a single display label is needed, use `PART_TIME` first, then `FIXED_TERM`, then `INDEFINITE`, and document that the label is lossy for a part-time fixed-term worker. Do not persist the label.
- The law defines part-time by comparison with an ordinary worker, not by the label. The template has no establishment-level ordinary weekly hours field, so the minimal implementation trusts the declared `engagement: PART_TIME`. If the owner wants a statutory-hours test, add an entity-level ordinary weekly hours declaration and compare `terms.normal_hours_per_week`; that is a new extension field and a larger change.

Align `INDEFINITE_CONVERSION_NOTICE` to the same `to != null` fixed-term test. It currently uses `signed_contract_period != null`, so an open-ended signed period could raise a conversion notice.

### Fields and paths

- Native fields: `employee_contract.engagement`, `employee_contract.signed_contract_period`, `employee_contract.terms.normal_hours_per_week` (`templates/hr-payroll/src/data/model/employee_profile/employee_contract/+model.ts`).
- `templates/hr-payroll/seed/public/jurisdiction/JP/version_17/registered_effect.json`
  - `PART_TIME_TERMS_NOTICE.condition` — replace the current `engagement === 'PART_TIME' || signed_contract_period != null` with the two-boolean derivation.
  - `INDEFINITE_CONVERSION_NOTICE.condition` — add the `signed_contract_period.to != null` test.
- No extension field and no lookup.

### Trigger tests (no amount)

| Contract | Expected notice |
|----------|-----------------|
| `EMPLOYEE`, `signed_contract_period = { from: 2027-04-01, to: null }` | none (indefinite) |
| `EMPLOYEE`, `signed_contract_period = { from: 2027-04-01, to: 2028-03-31 }` | `PART_TIME_TERMS_NOTICE` |
| `PART_TIME`, no signed period | `PART_TIME_TERMS_NOTICE` |
| `CONTRACTOR`, fixed term | none (not an employee) |

---

## 3. Company rest interval

### Legal position

- For general workers, the employer must **endeavour** to set the interval between the end of one day's work and the start of the next (労働時間等の設定の改善に関する特別措置法 art.2(1)). There is no general statutory minimum. A fallback of `0` for `GENERAL` is therefore lawful: it means "no company interval declared", not "zero rest is required".
- For drivers, the 改善基準告示 (令和4年厚生労働省告示第367号) sets a rest-period floor. The MHLW truck guidance states the 11-hour effort target and the 9-hour floor; the seed's `default_minimum_rest_hours: 9` is that floor. A company interval may be stricter, but it cannot undercut the floor.

The current expression uses the company value as an override:

```js
const minimum = get(entityExt, 'work_interval_hours', driver ? 9 : 0);
```

A company value of 8 would therefore undercut the driver floor. That is the defect.

Sources: <https://laws.e-gov.go.jp/law/404AC0000000090>, <https://work-holiday.mhlw.go.jp/interval/>, <https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/gyosyu/roudoujouken05/index.html>, <https://www.mhlw.go.jp/content/2023_Pamphlet_T.pdf>.

### Decision

Declare `work_interval_hours` on the **entity** extension schema. It is an establishment-wide work-rule policy applied to all workers, not a per-shift or per-contract value, and `ROSTER_REST_INTERVAL` already reads it from the entity. Do not put it in the jurisdiction rule's `lookup`: the lookup is shared by every employer in the version, while this value is employer-specific. Keep the driver floor `9` in the rule's `lookup` as the law constant.

Change the minimum to:

```js
const company = Number(get(entityExt, 'work_interval_hours', 0));
const driverFloor = get(entityExt, 'overtime_sector', 'GENERAL') === 'DRIVER'
  ? ctx.lookup.default_minimum_rest_hours
  : 0;
const minimum = Math.max(company, driverFloor);
```

The company may raise the interval; it may never lower the driver floor.

### Fields and paths

- `templates/hr-payroll/seed/public/jurisdiction/JP/version_17/jurisdiction_settings.json`
  - Add `entity_extension_schema.properties.work_interval_hours`: number, minimum `0`, maximum `24`, title `勤務間インターバル`, description citing 労働時間等設定改善法 art.2(1) and the driver 9-hour floor. Leave it optional; absence means no company interval.
- `templates/hr-payroll/seed/public/jurisdiction/JP/version_17/registered_rule.json`
  - `ROSTER_REST_INTERVAL.validate` — replace the override with `Math.max(company, driverFloor)`.
  - Keep `lookup.default_minimum_rest_hours: 9`.

### Verification

No payroll amount. Rule probes: `DRIVER` with 8 hours' rest fails and 9 hours passes; `GENERAL` with no company interval passes at 0 hours; `GENERAL` with a company interval of 11 hours fails at 8 hours.

---

## 4. Statutory week start

### Legal position

労働基準法 art.32 sets the 40-hour week and the 8-hour day. The "week" is the calendar week from Sunday to Saturday unless the work rules or equivalent set another start (昭和63年1月1日基発1号). The start is an establishment-wide work-rule fact; it is not a per-shift-pattern fact. The same start must be used by every 40-hour computation, including overtime.

The seed has 14 roster rules and the overtime catalog reading `entity_extension_data.week_start`. The field is not declared, so `Number(get(entityExt, 'week_start', 0))` silently becomes `0` (Sunday). Sunday is the statutory default, so the value is not itself unlawful; the defects are the silence and the mismatch with `shift_pattern.pattern.week_start`, which defaults to `MONDAY` and claims in its help text to be "the weekday the statutory week opens on". Two owners with different defaults is the bug.

Sources: <https://laws.e-gov.go.jp/law/322AC0000000049>, <https://www.mhlw.go.jp/web/t_doc?dataId=00tb1899&dataType=1&pageNo=1>, <https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/roudouzikan/index.html>.

### Decision

**The entity owns the statutory week start.** Declare `week_start` as an integer `0..6` (`0 = Sunday`, matching `weekday()` and the existing expressions) in the entity extension schema, and require it at seal. Do not switch the rules to `shift_pattern.pattern.week_start`:

- The statutory week is establishment-wide. Two shift patterns in one establishment cannot lawfully use different statutory weeks.
- The overtime catalog only receives the employer (entity profile version); it has no shift-pattern read. Switching would require an engine payload change and would create a second source.
- All 16 readers (14 roster rules and the two overtime catalog rows) already read `entityExt.week_start`; one declaration fixes them all without touching the formulas.

Keep `shift_pattern.pattern.week_start` for now as a roster display/scheduling default. Its help text should stop claiming to be the statutory week; changing or removing the model field is outside this fix and needs the owner's decision. If the owner wants one field, the entity field is the one the payroll formulas already use.

Because the seal action is a direct update, add a registered rule `WORK_WEEK_START_REQUIRED` on `entity_profile_version` (or fold the check into the establishment-dates rule, with a message that names the week start). The schema `required` entry helps the editor; the rule is the runtime invariant.

### Fields and paths

- `templates/hr-payroll/seed/public/jurisdiction/JP/version_17/jurisdiction_settings.json`
  - Add `entity_extension_schema.properties.week_start`: integer, `0..6`, title `週の起算日`, description citing 労働基準法 art.32 and 昭和63年1月1日基発1号. Add `week_start` to `required`.
- `templates/hr-payroll/seed/public/jurisdiction/JP/version_17/registered_rule.json`
  - Add `WORK_WEEK_START_REQUIRED` for `entity_profile_version`, events `['create', 'update', 'seal']`.
- `templates/hr-payroll/src/data/model/entity/shift_pattern/+model.ts`
  - Update the `week_start` help text so it is not the statutory owner; no behavior change.
- `templates/hr-payroll/src/lib/ui/roster/month_board.ts`
  - If the week header is meant to show the statutory week, feed it the entity `week_start`; otherwise label it as the pattern's display week. Do not let the board and the payroll rule silently disagree.
- No change to their `week_start` reads in the 14 roster rules or in `overtime_catalog.json`; the `ROSTER_REST_INTERVAL` change in gap 3 is unrelated.

### Amount test: Monday vs Sunday start, including a pay bump

Fixture (synthetic, arithmetic only):

- Entity: `week_start = 1` (Monday), `working_time_regime = STANDARD`, `weekly_limit_44 = false`.
- Employee: `rate = { amount: 312000, unit: 'MONTHLY' }`, `normal_hours_per_week = 40`, `normal_hours_per_day = 8`, `statutory_work_category = 'SOCIAL_AND_EMPLOYMENT'`, `work_classification = 'ORDINARY'`.
- Roster: Monday–Friday 8 hours each (40 hours), Sunday 8 hours; Saturday is the rest day. Sunday is a scheduled work day, not the statutory rest day, and the 8 hours are approved overtime (`overtime: 8`).
- Engine hourly rate: `312000 × 12 / (52 × 40) = 1800`.

| Week start | Sunday treatment | `OVERTIME` | `WITHIN_HOURS_OVERTIME` |
|------------|------------------|-----------:|------------------------:|
| Monday (`1`) | 41st–48th hour of the same week | `8 × 1800 × 1.25 = 18,000` | `0` |
| Sunday (`0`, or field absent) | first 8 hours of a new week | `0` | `8 × 1800 = 14,400` |

The wrong start underpays the 25% premium by `3,600`. The overtime catalog's `OVERTIME` multiplier is `1.25` and `WITHIN_HOURS_OVERTIME` is `1.0` in the JP seed. The fixture marks only Sunday as approved overtime; under the wrong start the sixth day is Friday, and that excess is unapproved and separately flagged by `ROSTER_OVERTIME_UNRECORDED`. The table isolates the premium on the approved Sunday hours; a complete run would also correct the Friday approval.

**Pay-bump variant.** A replacement contract effective on the Sunday at monthly `332,800` gives an hourly rate of `332800 × 12 / (52 × 40) = 1,920`. Correct Monday-start `OVERTIME`: `8 × 1920 × 1.25 = 19,200`. Wrong Sunday-start `WITHIN_HOURS_OVERTIME`: `8 × 1920 = 15,360`; the premium shortfall is `3,840`. This checks that the week start survives a contract replacement and uses the new rate.

Test path: `templates/hr-payroll/tests/overtime_bands.test.ts` (add a JP case alongside the existing band cases). A leaver or reversal does not move the week boundary; the same arithmetic applies to the final week, and a reversal recalculates the same line.

---

## 5. Minimum-wage monthly-hours conversion

### Legal position

- The employer must pay at least the applicable minimum wage; a contract term below it is void to that extent (最低賃金法 art.4).
- For a monthly wage, the ordinance converts the wage to an hourly amount by dividing it by the month's prescribed hours; where the prescribed hours differ by month, by the annual average monthly prescribed hours (最低賃金法施行規則 art.2(1)(3)). The same ordinance gives the daily and hourly conversions.
- The seed's fallback is `normal_hours_per_week × 4.333333` (52/12). That is an annualization of a **uniform weekly schedule**, not the statutory conversion. It is lawful only when it equals the contract's actual monthly prescribed hours (or the annual average). For an annual-hours contract, the monthly hours vary; using weekly × 52/12 can understate or overstate the hourly rate. It is not a lawful substitute when the contract's monthly hours vary, and the direction of the error is not something a compliance rule should rely on.

The current rule also reads `normal_hours_per_year` from `entity_extension_data`. That is the wrong owner: annual prescribed hours are agreed per worker, especially for part-timers; an entity-wide figure would compare a part-timer against full-time hours.

Sources: <https://laws.e-gov.go.jp/law/334AC0000000137>, <https://laws.e-gov.go.jp/law/334M50002000016>, <https://jsite.mhlw.go.jp/tokushima-roudoukyoku/newpage_00549.html>, <https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/chingin/newpage_43875.html>.

### Decision

Declare `normal_hours_per_year` on the **employee** extension schema (contract-level). Read `ext.normal_hours_per_year` first and use `annual / 12`.

```js
const annual = get(ext, 'normal_hours_per_year', null);
const monthlyHours = annual != null
  ? Number(annual) / 12
  : (get(terms, 'normal_hours_per_week', ctx.lookup.standard_weekly_hours) * ctx.lookup.weeks_per_month);
```

Keep the fallback only for a `STANDARD` regime with a uniform weekly schedule. For `VARIABLE` or `FLEX` (or any contract whose monthly hours vary), require the annual figure. Prefer a small registered rule `MINIMUM_WAGE_HOURS_REQUIRED` on `employee_contract` that refuses the seal with a clear message when the regime varies and the field is absent; `MINIMUM_WAGE_CONTRACT` can then assume the field. If the owner prefers one rule, `MINIMUM_WAGE_CONTRACT` may return false when the annual figure is absent, but its message must then explain that annual hours are missing, not that the wage is below the minimum.

Do not use the entity's annual hours for part-timers. If the owner wants an entity default for full-time standard contracts, it can be a fallback only when the contract has no annual figure and the schedule is uniform; the contract field wins.

The daily branch follows the ordinance for a fixed daily schedule; a varying-day schedule would need the weekly average, which is outside this gap. The hourly branch needs no conversion. The rule compares `terms.rate.amount`, so a leaver's prorated final pay does not create a false failure; a pay bump changes the rate and must be revalidated on the replacement contract.

### Fields and paths

- `templates/hr-payroll/seed/public/jurisdiction/JP/version_17/jurisdiction_settings.json`
  - Add `employee_extension_schema.properties.normal_hours_per_year`: number, minimum `0`, title `年間所定労働時間`, description citing 最低賃金法施行規則 art.2(1)(3).
- `templates/hr-payroll/seed/public/jurisdiction/JP/version_17/registered_rule.json`
  - `MINIMUM_WAGE_CONTRACT.validate` — read `ext.normal_hours_per_year`, not `entityExt.normal_hours_per_year`; use `annual / 12` when present; restrict the fallback to a uniform standard schedule.
  - Add `MINIMUM_WAGE_HOURS_REQUIRED` (target `employee_contract`) if the owner wants the clear separate refusal.
  - Adjust the rule's lookup `message` if the annual hours are missing, so it does not claim a below-minimum wage for a missing input.
- No engine change; the existing rule expression language and reads cover it.

### Validation test: annual-hours contract, pay bump and leaver

Use the seeded Tokyo band `2026-10-01: 1,280` (fixture data, not a new statutory claim).

**Annual-hours regression.** Monthly wage `200,000`, `normal_hours_per_week = 40`, `normal_hours_per_year = 1820`, `working_time_regime = VARIABLE`, Tokyo band.

| Conversion | Monthly hours | Hourly | Result vs 1,280 |
|------------|--------------:|-------:|-----------------|
| Annual / 12 | `1820 / 12 = 151.6667` | `200000 / 151.6667 = 1,318.68` | pass |
| Weekly × 52/12 | `40 × 4.333333 = 173.3333` | `200000 / 173.3333 = 1,153.85` | fail (false rejection) |

This is the test that proves the fallback is not a lawful substitute for the annual figure: the same compliant contract flips from pass to fail when the annual field is ignored.

**Pay bump around the floor.** Monthly `222,000`, weekly `40`, annual `2,080`, Tokyo band: monthly hours `173.3333`, hourly `1,281.23` — pass. At monthly `221,000`: hourly `1,275.00` — fail. A raise across the floor flips the rule, and the rule must re-run on the replacement contract.

**Leaver.** Monthly `222,000`, employee leaves on the 15th, final pay `111,000`. `MINIMUM_WAGE_CONTRACT` compares the contract rate `222,000`, not the prorated payment, so the rule still passes. This guards against using a partial final payment as the rate.

**Reversal / encashment.** Not applicable: this is a contract-seal rate check, not a payment. A reversal entry does not change the contract rate, and leave encashment is a payment, not a rate.

Test path: `templates/hr-payroll/tests/minimum_wage.test.ts` (the JP case already evaluates the rule with a synthetic context; extend it with the monthly/annual-hours cases).

---

## Implementation order

1. **Schema declarations** in the JP version under authoring: add the three establishment dates to `required`; declare `week_start`, `work_interval_hours` and `normal_hours_per_year` (employee). These are extension-schema declarations, not native model fields.
2. **Registered rules/effects**: add `ESTABLISHMENT_EVENT_DATES_REQUIRED`, `WORK_WEEK_START_REQUIRED` and (optionally) `MINIMUM_WAGE_HOURS_REQUIRED`; change `ROSTER_REST_INTERVAL`, `MINIMUM_WAGE_CONTRACT`, `PART_TIME_TERMS_NOTICE` and `INDEFINITE_CONVERSION_NOTICE` expressions.
3. **Seed/tests last**: update the JP rule tests and add the amount scenarios in `overtime_bands.test.ts` and `minimum_wage.test.ts`. The private seed bank has no JP entity or contract row today; a future JP demo seed must carry the three dates, `week_start`, and (where the schedule varies) `normal_hours_per_year`, or the seal rules will refuse it.
4. **No engine, native model or helper changes.** All five fixes use the existing extension-schema, registered-rule/effect, lookup/read and obligation mechanisms.
5. **Do not rewrite sealed historical versions.** Apply to the next authored JP version; forward-port only if the release policy explicitly allows it.

## Open owner decisions

- Whether the template supports genuinely non-applicable establishments (then the three dates need an explicit applicability declaration and conditional requirement, not unconditional `required`).
- Whether `shift_pattern.pattern.week_start` is retired or redefined as a display-only scheduling default; the payroll formulas should keep reading the entity field either way.
- Whether part-time classification is trusted from `engagement` or tested against an entity-level ordinary weekly hours declaration; the latter is a new extension field and a larger change.
- Whether the annual-hours field is mandatory only for `VARIABLE`/`FLEX` or for every contract whose monthly hours vary; the legal test is the actual schedule, and the regime is the practical trigger.

## Sources

- Japan Pension Service, 新規適用の手続き (five days): <https://www.nenkin.go.jp/service/kounen/tekiyo/jigyosho/20150311.html>
- 健康保険法施行規則 art.19: <https://laws.e-gov.go.jp/law/215M10000008036>
- 厚生年金保険法施行規則 art.13: <https://laws.e-gov.go.jp/law/329M50000100037>
- 健康保険法 art.3(3): <https://laws.e-gov.go.jp/law/211AC0000000070>
- 厚生年金保険法 art.6: <https://laws.e-gov.go.jp/law/329AC0000000115>
- 労働保険徴収法 arts.3, 4, 4の2: <https://laws.e-gov.go.jp/law/344AC0000000084>
- 雇用保険法 arts.5, 6: <https://laws.e-gov.go.jp/law/349AC0000000116>
- 雇用保険法施行規則 art.141: <https://laws.e-gov.go.jp/law/350M50002000003>
- ハローワーク, 雇用保険適用事業所設置届: <https://hoken.hellowork.mhlw.go.jp/static/koyohoteki_setchi.html>
- 短時間労働者及び有期雇用労働者の雇用管理の改善等に関する法律 arts.2, 6, 14: <https://laws.e-gov.go.jp/law/405AC0000000076>
- 労働契約法 art.18: <https://laws.e-gov.go.jp/law/419AC0000000128>
- 労働基準法 arts.14, 15, 32, 36, 37: <https://laws.e-gov.go.jp/law/322AC0000000049>
- 労働時間等の設定の改善に関する特別措置法 art.2(1): <https://laws.e-gov.go.jp/law/404AC0000000090>
- MHLW, 勤務間インターバル制度: <https://work-holiday.mhlw.go.jp/interval/>
- MHLW, 自動車運転者の労働時間等の改善のための基準: <https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/gyosyu/roudoujouken05/index.html>
- MHLW, トラック運転者の改善基準 (9-hour floor): <https://www.mhlw.go.jp/content/2023_Pamphlet_T.pdf>
- 昭和63年1月1日基発1号 (week is Sunday–Saturday unless work rules set another start): <https://www.mhlw.go.jp/web/t_doc?dataId=00tb1899&dataType=1&pageNo=1>
- MHLW, 労働時間・休日: <https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/roudouzikan/index.html>
- 最低賃金法 art.4: <https://laws.e-gov.go.jp/law/334AC0000000137>
- 最低賃金法施行規則 art.2(1)(3): <https://laws.e-gov.go.jp/law/334M50002000016>
- MHLW, 最低賃金額以上かどうかの確認方法: <https://jsite.mhlw.go.jp/tokushima-roudoukyoku/newpage_00549.html>
- MHLW, 最低賃金制度: <https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/chingin/newpage_43875.html>
- MHLW, パートタイム・有期雇用労働法: <https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000046152.html>
- MHLW, 2026年10月からパートタイム・有期雇用のルールが変わります: <https://www.mhlw.go.jp/web_magazine/column/20260803.html>
