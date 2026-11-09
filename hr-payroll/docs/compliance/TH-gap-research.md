# TH compliance gap research

Status: decision record. This file is the only change. No source, seed, test or other document was edited.

Scope: Thailand seed versions under `templates/hr-payroll/seed/public/jurisdiction/TH/`. The defects exist in every TH version that carries the row; `version_7` is the current example. A released jurisdiction version is immutable, so the same correction belongs in the next version if the old one has already shipped.

Mechanism rule for every decision below: use existing model fields, registered rules/effects, catalog lookup/conversion, `reads`, and `obligation`. No new engine concept, no helper framework, no new model field. "In force" means a `SEALED` `employee_contract` whose `effective_range` covers the date; `PAYEE` remains excluded, as today.

## Summary

| #   | Decision                                                                                                                                                                                           | Mechanism                                                 | New field                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| 1   | Run `NO_PAY_OPEN_PERIOD` on `update` too, and check only days added by the update. The update transform already passes the resulting child rows.                                                   | Seed rule: `events`, `reads.fields`, added-day comparison | None                                |
| 2   | Count distinct `employee_id`s in force on the effect date, not contract versions. Apply the same expression to every headcount effect.                                                             | Seed effect conditions                                    | None                                |
| 3   | Key person duties on employee + entity; key employer duties on entity. Set `employee_id`/`employment_id` null for employer duties and change their obligation read filter.                         | Occurrence keys and `reads.obligation`                    | None                                |
| 4   | Raise only when the run's payslips contain a positive `EWF` statutory line, and read the EWF catalog's `collection_from` switch rather than copying 2027.                                          | `reads.payslip`, `reads.statutory_contribution_catalog`   | None                                |
| 5   | Filter profile updates to the register particulars at the model boundary; drop email/phone from the trigger. Seed expressions cannot see `ctx.before`/`ctx.after` (the checker's roots omit them). | `employee_profile` model effect + seed key                | None                                |
| 6   | Refuse a `WORK_INJURY_LEAVE` entry with no day slot; guard the effect against legacy slotless rows. Do not invent a knowledge date.                                                                | New registered rule + effect guard                        | None                                |
| 7   | The contract's worksite `terms.work_region` governs; employer region is the fallback. Fix the floor rule and the arrears conversion together.                                                      | Rule/catalog expression                                   | None (existing `terms.work_region`) |
| 8   | Add the weekly 48-hour check (42 hazardous) to `NORMAL_HOURS` over a rolling seven-day window. The contract-level weekly check already exists and stays.                                           | Rule `reads` and lookup                                   | None                                |

## 1. `NO_PAY_OPEN_PERIOD` runs on `create` only

### Legal position

This is not a statutory filing deadline. It is the template's paid-run lock: a paid period is closed, and a correction to it is a reversal entry dated in the next period to run. The fixed design states this at `docs/0001-hrms-calculation-architecture.md` §0 ("A correction to a period already paid is a reversal entry ... dated in the next period to run"). There is no labour.go.th source for it; do not dress it as one.

### Current source

- `registered_rule.json`: `NO_PAY_OPEN_PERIOD` has `"events": ["create"]`.
- `leave_catalog_entry/+model.ts` `update.transform` already builds `proposed` with `leave_catalog_entry_day` = existing (minus deleted) + created children, and calls `entryRead(..., 'update')`, which calls `validateRegistered(..., 'update', proposed)`. The audit's "may not pass the resulting child rows" is not true of the current source. Keep a regression test so it stays true.
- The rule's `leave_catalog_entry_day` read returns all days for the same employment and catalog that are not themselves reversals, including paid days. It filters `payroll_run_id isNull` today, which is useful for the reversal check but hides this entry's paid days from any stored-day comparison.

### Decision

Apply to every TH version:

1. `"events": ["create", "update"]`.
2. Keep `incurred_on` in the `leave_catalog_entry_day` read fields, add `leave_entry_id`, `part` and `payroll_run_id`, and remove the `payroll_run_id: { isNull: true }` condition from its `where`. Keep the employment/catalog/`reverses isNull` scope.
3. In `validate`, split the proposed slots into stored days of this entry and added days. Compare date and part, because an AM and a PM slot on the same date are different half-days:

```js
const held = ctx.reads.leave_catalog_entry_day;
const slotKey = (slot) => String(slot.incurred_on) + ':' + String(slot.part);
const stored = held.filter((slot) => slot.leave_entry_id === entry.id).map(slotKey);
const added = slots.filter((slot) => !stored.includes(slotKey(slot)));
```

4. Keep the reversal check on all `dates`, but filter for unpaid sibling days in JavaScript because the read no longer does it:

```js
if (
	get(ctx.entry, 'reverses', null) != null &&
	held.some((slot) => slot.payroll_run_id == null && dates.includes(String(slot.incurred_on)))
)
	throw 'That day has not been paid yet. Delete the entry instead of reversing it.';
```

5. Check the closed-period branch only on `added`:

```js
const closed = added.find((slot) => ran.includes(periodOf(String(slot.incurred_on))));
```

On create `stored` is empty, so every slot is checked as before. On update, an evidence-only edit adds nothing and passes even when the entry already has paid days: `stored` includes those paid days. Adding or moving a day into a period with a `payroll_run` is refused. The `payroll_run_id`-only stamping update still takes the model's fast path and never validates. No model change is needed; if the transform ever stops passing the children, the rule safely sees no added days and the regression test fails.

### Test scenario

Monthly employer, June run already exists, July open. Create a `UNPAID_LEAVE` entry for 2026-06-10: refused. Create for 2026-07-10: allowed. Run July, then update that entry to add 2026-07-11: refused. Update only `evidence_file` on the same entry: allowed. Create a reversal dated 2026-08-10 for the paid June day: allowed (the next open period after July).

## 2. Headcount counts contract versions

### Legal position

The thresholds are counts of employees, not contract documents:

- LPA s.108: an employer who employs ten or more persons has work rules; s.111 keeps them after the count falls below ten.
- LPA s.112: an employer who employs ten or more persons keeps an employee register.
- Skill Development Promotion Act: an employer of 100 or more registers with the Department of Skill Development.
- LPA s.115/1: an employer of ten or more files the annual employment-conditions report (inserted by LPA (No. 2) B.E. 2551; paragraph one replaced by LPA (No. 9) B.E. 2568).

Official text: [Labour Protection Act B.E. 2541](https://area9.labour.go.th/attachments/article/338/The%20Labour%20Protection%20Act%20B.E.%202541.pdf) (ss.108, 111, 112); [LPA (No. 9) B.E. 2568 for s.115/1](https://ratchakitcha.soc.go.th/documents/89818.pdf). Skill Development: [DSD guidance](https://www.dsd.go.th/sdpaa/Region/Download_Doc/13824).

A renewal is a replacement contract that continues the same employment (`employee_contract` field help: "A replacement contract continues employment"). It is the same natural person. Counting versions inflates the employer's headcount and raises duties early.

### Decision

Use one expression in every headcount condition. `at` is the effect's date:

- contract effects (`EMPLOYEE_REGISTER`, `WORK_RULES`, `SKILL_DEVELOPMENT_REGISTRATION`, `EMPLOYEE_REGISTER_PAYROLL_UPDATE`): `entry.effective_range.from`
- payroll-run effects (`SKILL_DEVELOPMENT_FUND_PAYMENT`, `EMPLOYMENT_CONDITIONS_REPORT`, `DISABLED_EMPLOYMENT_QUOTA`, `SKILL_DEVELOPMENT_COURSE_CERTIFICATION`): `entry.salary_coverage.from`
- profile update (`EMPLOYEE_REGISTER_UPDATE`): the profile change date, `String(entry.updated_at).slice(0, 10)`. The snippet's `entry.entity_id` is the entity resolved from that employee's sealed contract covering the date (the profile row has no `entity_id`), not the profile row.

```js
const on = (contract) => {
	const from = get(contract, 'effective_range.from', null);
	const to = get(contract, 'effective_range.to', null);
	return from !== null && from <= at && (to === null || at <= to);
};
const people = get(ctx, 'reads.employee_contract', []).filter(
	(contract) =>
		contract.entity_id === entry.entity_id &&
		contract.status === 'SEALED' &&
		contract.engagement !== 'PAYEE' &&
		on(contract)
);
const byEmployee = Object.fromEntries(
	people.map((contract) => [String(contract.employee_id), true])
);
const headcount = Object.keys(byEmployee).length;
```

This is a distinct person count. Do not use a `Set` (not exposed) and do not use `filter(...).findIndex(...)`: that is O(n²) and hits the expression interpreter's 50,000-step limit on a larger employer. `Object.fromEntries` plus `Object.keys` is the existing seed idiom (CN uses it for leave codes) and is linear. Future contracts and ended contracts are excluded by `on`; two sealed versions of one person count once even if an overlap slips through.

### Test scenario

Nine distinct employees in force on 2026-04-01, then seal a renewal for employee E1 effective 2026-04-01. Deduped headcount is 9: no `WORK_RULES` obligation (current code counts 10 and raises one). Seal employee E10 effective 2026-04-01: deduped 10, one `WORK_RULES` obligation due 2026-04-16. With the current code E10 makes 11 sealed versions, so the `< 11` gate skips the duty entirely. An employee whose contract ended 2026-03-31 is not in force on 2026-04-01 and does not count. Repeat at 99 + a renewal (no SDF obligation) and 100 distinct (one SDF obligation).

## 3. Person/employer duties keyed per contract

### Legal position

- `SSO_REGISTRATION`: Social Security Act B.E. 2533 s.34, register the employee as an insured person within 30 days from the date the employee becomes an insured person. It is one registration per employee per employer, not one per contract document. [SSA text](https://www.mol.go.th/wp-content/uploads/sites/2/2019/03/SOCIAL_SECURITY_ACT_2533_SSO_1.pdf); [SSO employer guidance](https://www.sso.go.th/wpr/assets/upload/files_storage/sso_th/e7ac89a170da1bcfe9d254ce91d4556e.pdf).
- `PDPA_PRIVACY_NOTICE` and `PDPA_SENSITIVE_DATA_CONSENT`: PDPA B.E. 2562 ss.23 and 26. Notice at or before collection; explicit consent for sensitive data. A renewal does not collect the person's data again. Official copy: [PDPA B.E. 2562](https://mdes.go.th/law/detail/3577-Personal-Data-Protection-Act-B-E--2562--2019-).
- `EMPLOYEE_REGISTER`: LPA s.112, one register entry per employee, within 15 days from the date of employment. A renewal does not restart employment.
- `SKILL_DEVELOPMENT_REGISTRATION`: Skill Development Promotion Act, one registration per employer when it reaches 100 employees. [DSD guidance](https://www.dsd.go.th/sdpaa/Region/Download_Doc/13824).
- `WORK_RULES`: LPA s.108, one set of work rules per employer; s.111 keeps it after the count falls below ten. Not one per employee or renewal.

### Decision

| Code                             | Legal unit            | Occurrence key                                          | Obligation refs                                                                |
| -------------------------------- | --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `SSO_REGISTRATION`               | employee + employer   | `SSO_REGISTRATION:<entity_id>:<employee_id>`            | `employee_id`; `employment_id` may keep the triggering contract for navigation |
| `PDPA_PRIVACY_NOTICE`            | employee + controller | `PDPA_PRIVACY_NOTICE:<entity_id>:<employee_id>`         | same                                                                           |
| `PDPA_SENSITIVE_DATA_CONSENT`    | employee + controller | `PDPA_SENSITIVE_DATA_CONSENT:<entity_id>:<employee_id>` | same                                                                           |
| `EMPLOYEE_REGISTER`              | employee + employer   | `EMPLOYEE_REGISTER:<entity_id>:<employee_id>`           | same                                                                           |
| `SKILL_DEVELOPMENT_REGISTRATION` | employer              | `SKILL_DEVELOPMENT_REGISTRATION:<entity_id>`            | `employee_id` and `employment_id` null                                         |
| `WORK_RULES`                     | employer              | `WORK_RULES:<entity_id>`                                | `employee_id` and `employment_id` null                                         |

For the two employer duties, also change `reads.obligation` from `employee_id: { isNull: false }` to `employee_id: { isNull: true }`; otherwise the new null-employee obligation is invisible to the dedupe read. Remove `employee_count_threshold_11` and the `headcount < 11` gate from `WORK_RULES`: with the entity key, `headcount >= 10` is correct, and it does not miss the duty when two hires cross ten in one batch.

`SSO_REGISTRATION` residual: a genuine rehire after a break is a new becoming-insured event, and an employee+entity key suppresses it. The model already records `service_started_on`, which a same-jurisdiction replacement keeps. If the owner wants rehire automatic, append `:<service_started_on ?? effective_range.from>` to the SSO key only; the fallback still duplicates when a replacement omits the service date. Recommended minimal fix is employee+entity; the rehire case is rare and can be filed outside the task. Do not add a field.

### Test scenario

At ten distinct employees, seal a renewal for E1. No new `SSO_REGISTRATION`, `PDPA_PRIVACY_NOTICE`, `PDPA_SENSITIVE_DATA_CONSENT`, `EMPLOYEE_REGISTER`, or `WORK_RULES` row. At 100, a renewal adds no `SKILL_DEVELOPMENT_REGISTRATION`. A new employee adds exactly one of each person duty and no second employer duty.

Occurrence-key changes are not retroactive. Existing `obligation` rows keep their old keys; a demo reset is clean. A live workspace that already holds old-key tasks needs a one-time reconciliation (waive or close the old task) before the new key would otherwise create a duplicate.

## 4. `EWF_REMITTANCE` condition is always true

### Legal position

LPA ss.126-131 create the Employee Welfare Fund; s.131 requires the employer to remit contributions. The Royal Decree B.E. 2569 (Gazette 22 October 2026) provides that no EWF collection starts before 1 January 2027. The DLPW guidance says the normal remittance is due by the 15th after the month in which wages were paid and that only a positive contribution is remitted.

- [Royal Decree B.E. 2569](https://ratchakitcha.soc.go.th/documents/135427.pdf)
- [DLPW EWF guidance](https://itserver15.labour.go.th/ewfundTemplate/media-file.php?id=18)
- [Labour Protection Act B.E. 2541](https://area9.labour.go.th/attachments/article/338/The%20Labour%20Protection%20Act%20B.E.%202541.pdf) (ss.126-131)

### Decision

The effect runs after the run's payslips are committed. Add two reads and replace `return true`:

```json
"payslip": {
  "where": { "payroll_run_id": { "eq": { "var": "ctx.entry.id" } } },
  "fields": ["breakdown"],
  "limit": 10000
},
"statutory_contribution_catalog": {
  "where": {
    "code": { "eq": "EWF" },
    "settings_id": { "eq": { "var": "ctx.entry.settings_id" } }
  },
  "fields": ["lookup"],
  "limit": 1
}
```

```js
const entry = ctx.entry;
const catalog = first(ctx.reads.statutory_contribution_catalog);
const collectFrom = get(catalog, 'lookup.collection_from', null);
if (collectFrom == null || entry.salary_coverage.from < collectFrom) return false;
const positive = get(ctx, 'reads.payslip', []).some((slip) =>
	get(slip, 'breakdown.statutory', []).some(
		(row) => row.code === 'EWF' && Number(row.employee) + Number(row.employer) > 0
	)
);
return positive;
```

The date stays on the EWF `statutory_contribution_catalog` row; the effect reads that row's `lookup.collection_from` instead of copying `2027-01-01` into a second lookup. That is the "lookup switch" correction: one owner, two readers. The positive-line check is still required, because a run with no EWF member or an exempt employer has no contribution to remit. The existing `date_offset_days: 14` stays: `month_start(pay_date) + 1 month + 14 days` is the 15th of the following month.

No new model field. `payslip.breakdown.statutory` already carries the per-scheme line, and the catalog row already carries the collection start.

### Test scenario

Run covering December 2026: EWF eligibility false, no EWF line, no `EWF_REMITTANCE` obligation. Run covering January 2027 with a positive EWF line: exactly one obligation, due the 15th of the month after `pay_date` (pay date 2027-01-31 -> due 2027-02-15). Run with zero EWF (all employees exempt or no members): no obligation. Do not assert a contribution rate in this test; the rate schedule is a separate seed question.

## 5. `EMPLOYEE_REGISTER_UPDATE` fires on any profile update

### Legal position

LPA s.113: when a particular in the employee register changes, the employer must amend the register completely within 15 days from the date of the change. The duty is a change notification, not a save notification. The s.113 particulars are name, sex, nationality, birth date, address, date of employment, position, wage and benefits, and end date. Email and phone are not in that list.

Official text: [Labour Protection Act B.E. 2541](https://area9.labour.go.th/attachments/article/338/The%20Labour%20Protection%20Act%20B.E.%202541.pdf) (ss.112-113).

### Current source limitation

The runtime context passed to effects contains `before` and `after`, but the expression checker's roots do not include them (`src/lib/payroll_engine/contracts.ts` `CALCULATION_ROOTS`; used by `registrations.ts`). A seed expression therefore cannot read `ctx.before`/`ctx.after`. Adding those roots is an engine-surface change; do not do it for this gap.

### Decision

Filter at the model boundary, which already has `before`/`after`:

```ts
// employee_profile/+model.ts, effect.updated
const registerChanged = changes.filter(
	({ before, after }) =>
		before.name !== after.name || (before.address ?? null) !== (after.address ?? null)
);
if (registerChanged.length > 0)
	yield *
		tap(
			ctx,
			'update',
			{ collection: 'employee_profile', ids: registerChanged.map(({ after }) => after.id) },
			registerChanged
		);
```

Keep the existing rename propagation for all changes. In the seed effect:

- compare only `name` and `address`; do not treat `email`, `phone`, `user_id`, `face_*`, `documents` or `location` as register changes. If the employer's own register form includes email or phone as contact particulars, add them to the same filter; the statutory minimum list does not require them;
- set the key to `EMPLOYEE_REGISTER_UPDATE:<entity_id>:<employee_id>:<dueOn>` and remove the value hash. One correction per person per change date is enough; two changes on the same day share one 15-day task;
- keep `due_on = updated_at + 15` and the `headcount >= 10` condition, using the deduped in-force count from gap 2. Pick the entity from the employee's sealed contract covering `dueOn`; if none is in force, use the latest sealed contract so a leaver's register correction still has an employer.

No new field. `employee_profile` already has `name` and `address`; the other register particulars live on `employee_contract` and are covered by `EMPLOYEE_REGISTER_PAYROLL_UPDATE`.

### Test scenario

Existing ten-employee employer. Update only `phone`: no obligation. Update `name`: one obligation due on the update date + 15. Save the same name again: no new obligation. Update `address` the next day: one new obligation. Update `user_id` through the invitation automation: no obligation.

## 6. `WORK_INJURY_NOTIFICATION` with no child slot

### Legal position

Workmen's Compensation Act B.E. 2537 as amended, s.48: the employer must notify the SSO within 15 days from the day the employer knows of the work injury. The leave entry's first day is the template's proxy for that knowledge date. A slotless entry has no injury date at all; using `created_at` or `updated_at` would be a guessed knowledge date and could shorten or extend the statutory 15 days.

Official text: [WCA s.48, SSO copy](https://www.sso.go.th/wpr/assets/upload/files_storage/sso_th/84244ea51a2464c0713a98ddd8cc0955.pdf).

### Decision

Refuse the entry, do not substitute another date. Add a registered rule on every TH version:

- code `WORK_INJURY_DAY_REQUIRED`, target `leave_catalog_entry`, events `create` and `update`
- lookup `{ "catalog_code": "WORK_INJURY_LEAVE" }`
- read `leave_catalog` by `id = ctx.entry.catalog_id`, field `code`, limit 1
- condition: the catalog code equals the lookup value
- validate: `get(ctx.entry, 'leave_catalog_entry_day', []).length > 0`

The update path already passes the resulting children (gap 1), so an update that deletes the last day is refused too. Guard the existing effect against legacy rows so it never writes a null due date:

```js
const firstSlot = first(
	ctx.reads.leave_catalog_entry_day.map((slot) => slot.incurred_on).toSorted()
);
if (firstSlot == null) return [];
```

No new field. A workspace that wants a slotless injury report must add a dated injury field first; do not add one as part of this fix.

### Test scenario

Create `WORK_INJURY_LEAVE` with no day: refused by `WORK_INJURY_DAY_REQUIRED`. Create with first slot 2026-03-01: one `WORK_INJURY_NOTIFICATION` due 2026-03-16. Delete the only day from an existing entry: refused.

## 7. `MINIMUM_WAGE_FLOOR` ignores the contract worksite

### Legal position

Thailand's minimum wage is set by province by Wage Committee Notification No. 14 (17 June 2025, in force 1 July 2025), with a nationwide 400-baht rate for category 2-4 hotels and service establishments. The rate that binds is the rate for the locality where the employee works, not the employer's registered head-office region. The contract field is already declared as "The worksite region key the jurisdiction minimum-wage tables use, where it differs from the employer region."

- [Wage Committee Notification No. 14](https://ratchakitcha.soc.go.th/documents/76681.pdf)
- [Ministry of Labour rate announcement](https://www.mol.go.th/en/news/starting-july-1-ministry-of-labour-revises-minimum-wage-to-align-with-economy-and-improve-workers-quality-of-life)

### Decision

In `MINIMUM_WAGE_FLOOR.validate`, use the contract's `terms.work_region` first, and the employer's `entity_extension_data.region` only when the contract does not state a worksite:

```js
const worksite = get(ctx.entry, 'terms.work_region', null);
const region =
	typeof worksite === 'string' && worksite !== '' ? worksite : String(get(employer, 'region', ''));
const floor =
	get(employer, 'minimum_wage_400_business', false) === true
		? ctx.lookup.business_400
		: get(ctx.lookup.by_region, region, null);
```

Keep `minimum_wage_exempt` and `minimum_wage_400_business`; both are verified legal overrides. Do not change the 30-day divisor or the hourly/monthly conversions.

Apply the same region order to the `MINIMUM_WAGE_ARREARS` adhoc catalog, both `eligibility` and `conversion`. Otherwise the floor rule refuses the contract but the arrears top-up still pays the employer-region difference:

```js
const employment = ctx.subject.employment;
const region = get(
	employment,
	'terms.work_region',
	get(employer, 'entity_extension_data.region', '')
);
```

No new field; `terms.work_region` is already declared and validated against the jurisdiction's `work_regions` keys on contract create/update.

### Test scenario (payroll amount)

Employer region `CHIANG_RAI` (352), contract worksite `BANGKOK` (400).

- Monthly contract 11,000: 11,000 / 30 = 366.67 a day. `MINIMUM_WAGE_FLOOR` must refuse. Raise the contract to 12,000 (400 a day) in the same pay-bump update: accepted.
- Day-rate employee 350 a day, quantity 2, worksite `BANGKOK`: `MINIMUM_WAGE_ARREARS` must pay `(400 - 350) * 2 = 100`. The current employer-region expression pays `(352 - 350) * 2 = 4`.

## 8. `NORMAL_HOURS` has no weekly 48-hour check

### Legal position

LPA s.23: normal working time must not exceed eight hours a day and forty-eight hours a week; for work hazardous to health and safety, seven hours a day and forty-two hours a week. The contract-level `SHARED_CONTRACT_TERMS` rule already caps `terms.normal_hours_per_week` at 48 (42 hazardous), so the missing check is the roster rule, not the contract rule.

Official text: [Labour Protection Act B.E. 2541](https://area9.labour.go.th/attachments/article/338/The%20Labour%20Protection%20Act%20B.E.%202541.pdf) (s.23).

### Decision

Extend `NORMAL_HOURS`; do not add a duplicate contract rule.

- lookup: add `"weekly_minutes": 2880` and `"weekly_minutes_hazardous": 2520` (48 and 42 hours). Keep `minutes_per_day: 480` as is.
- reads: add `roster_entry` by `employment_id = ctx.entry.employment_id`, fields `id`, `work_date`, `actual_worked_intervals`, `planned_overtime_intervals`, limit 10000.
- validate: change the existing daily `return actual - overtime <= ctx.lookup.minutes_per_day;` to `if (actual - overtime > ctx.lookup.minutes_per_day) return false;`, then compute normal hours over the entry date and the preceding six days, including the entry:

```js
const hazardous =
	get(ctx.subject.employment, 'terms.statutory_work_category', null) === 'HAZARDOUS';
const weekly = hazardous ? ctx.lookup.weekly_minutes_hazardous : ctx.lookup.weekly_minutes;
const from = add_days(ctx.entry.work_date, -6);
const siblings = get(ctx, 'reads.roster_entry', []).filter(
	(day) => day.id !== ctx.entry.id && day.work_date >= from && day.work_date <= ctx.entry.work_date
);
const days = [...siblings, ctx.entry];
if (
	days.some((day) =>
		get(day, 'actual_worked_intervals', []).some((row) => get(row, 'end', null) == null)
	)
)
	return true;
// weekly_minutes is minutes: keep the sum in minutes, never divide by 60 here
const normal_minutes = sum(
	days.map((day) =>
		Math.max(
			0,
			interval_minutes(get(day, 'actual_worked_intervals', [])) -
				interval_minutes(get(day, 'planned_overtime_intervals', []))
		)
	)
);
return normal_minutes <= weekly;
```

This mirrors the existing daily rule's `actual - planned overtime` definition of normal hours and the VN `ROSTER_NORMAL_HOURS_WEEK` rolling-window pattern. The hazardous daily 7-hour roster check is a separate gap; this change only makes the weekly cap legally correct for both categories.

No new field. The contract's `terms.statutory_work_category` is already declared; `roster_entry.work_date` and the interval fields exist.

### Test scenario

Ordinary employee with 8 hours of actual work a day (with the recorded rest break) and no planned overtime: six consecutive days (48 hours) pass; a seventh 8-hour day (56) is refused. Hazardous employee with 7 hours a day (with the recorded rest break): six days (42) pass; a seventh (49) is refused.

## Adjacent observations (not decided here)

- `EMPLOYEE_REGISTER` raises only the hire that crosses ten. LPA s.112 requires the register to cover the existing employees as well; the first nine are not backfilled by this effect. That is separate from the dedupe and keying decisions (if the owner wants it, the crossing event must raise an entry for each in-force employee, not only the new hire).
- `EMPLOYEE_REGISTER_PAYROLL_UPDATE` also fires on every replacement contract because it keys on the contract id and detects `prior`. If a renewal changes no register particular, it is noise. If the owner wants that closed, compare the register particulars (position, wage, benefits) between the prior and replacement contract before raising it; that is a change-notification decision like gap 5, not a headcount or keying decision.
- `DISABLED_EMPLOYMENT_QUOTA` counts on the January run, while its own reference says the count date is 1 October. That date issue is separate from the dedupe in gap 2.
- The `NORMAL_HOURS` daily check still uses 480 minutes for hazardous work. The weekly fix above adds the 42-hour cap, but a single 8-hour hazardous day still passes. Treat that as a separate finding.

## Sources

- Labour Protection Act B.E. 2541 (official English translation, Ministry of Labour): https://area9.labour.go.th/attachments/article/338/The%20Labour%20Protection%20Act%20B.E.%202541.pdf
- Labour Protection Act B.E. 2541 (FAO copy, for the s.112-113 particulars): https://faolex.fao.org/docs/pdf/tha220781.pdf
- Labour Protection Act (No. 9) B.E. 2568 (s.115/1 amendment): https://ratchakitcha.soc.go.th/documents/89818.pdf
- Social Security Act B.E. 2533: https://www.mol.go.th/wp-content/uploads/sites/2/2019/03/SOCIAL_SECURITY_ACT_2533_SSO_1.pdf
- SSO employer registration guidance (30 days): https://www.sso.go.th/wpr/assets/upload/files_storage/sso_th/e7ac89a170da1bcfe9d254ce91d4556e.pdf
- Personal Data Protection Act B.E. 2562: https://mdes.go.th/law/detail/3577-Personal-Data-Protection-Act-B-E--2562--2019-
- Royal Decree B.E. 2569 (EWF collection from 1 January 2027): https://ratchakitcha.soc.go.th/documents/135427.pdf
- DLPW EWF guidance: https://itserver15.labour.go.th/ewfundTemplate/media-file.php?id=18
- Wage Committee Notification No. 14: https://ratchakitcha.soc.go.th/documents/76681.pdf
- Ministry of Labour minimum-wage announcement: https://www.mol.go.th/en/news/starting-july-1-ministry-of-labour-revises-minimum-wage-to-align-with-economy-and-improve-workers-quality-of-life
- Workmen's Compensation Act s.48: https://www.sso.go.th/wpr/assets/upload/files_storage/sso_th/84244ea51a2464c0713a98ddd8cc0955.pdf
- Department of Skill Development guidance: https://www.dsd.go.th/sdpaa/Region/Download_Doc/13824

## Implementation status (2026-11-09)

- Gap 5 (`EMPLOYEE_REGISTER_UPDATE`) implemented at the model boundary: `employee_profile.updated` taps only changes to `name` or `address`; email, phone, `user_id`, face, documents and location no longer raise the duty. The effect keeps its entity/employee/due-date key and deduped headcount. Regression: `tests/employee_register_change.test.ts`.
- Gap 1 (`NO_PAY_OPEN_PERIOD`) is the template invariant `assertOpenPeriod`; it runs on create and update, checks only slots without a `payroll_run_id`, and the ledger slot set is deduped so an existing paid slot is not counted as newly added. Regression: `tests/no_pay_reversal.test.ts` adds a day to a priced entry (refused) and edits evidence (allowed).
- Gap 2 (deduped headcount) is already present in every TH version's headcount conditions: distinct `employee_id` in force at the effect date, `headcount >= threshold`, no `employee_count_threshold_11` gate. Regression: `tests/th_headcount.test.ts` nine distinct + renewal (no work rules) and ten distinct + renewal (one work rules).
- Gap 3 (person/employer keys) is already present: person duties key `CODE:<entity>:<employee>` with employee/employment refs; employer duties key `CODE:<entity>` with null employee/employment refs and `employee_id isNull: true` reads. Regression: `tests/th_headcount.test.ts` checks one person duty on a renewal and one employer duty at ten.
- Gap 4 (EWF remittance) is already present: the effect reads the EWF catalogue's `lookup.collection_from` and the run's payslips, and raises only for a positive EWF line. Regression: `tests/th_ewf.test.ts` December 2026 none, January 2027 one due 2027-02-15, exempt/non-member none.
- Gap 6 (work-injury day) is already present: `WORK_INJURY_DAY_REQUIRED` in every TH version refuses a slotless `WORK_INJURY_LEAVE`; the notification effect returns [] when no slot exists. Regression: `tests/th_work_injury.test.ts` slotless create refused, first-day notification due 2026-03-16, deleting the only day refused.
- Gap 7 (worksite-first minimum wage) is already present in `MINIMUM_WAGE_FLOOR` and `MINIMUM_WAGE_ARREARS`: `terms.work_region` first, employer `region` fallback. Regression: `tests/minimum_wage.test.ts` Bangkok worksite over a Chiang Rai employer refuses 11,000/month, accepts 12,000/month, and pays 2 days of 350/day arrears at 100 (Bangkok 400), not Chiang Rai's 4.\n- Gap 8 (weekly 48/42-hour roster check) was present in every TH version but ineffective: the rule summed hours
  (`/ 60`) and compared them to `weekly_minutes` (2880/2520), so a seven-day week always passed. The sum now stays in
  minutes in all seven versions. Regression: `tests/th_normal_hours.test.ts` six ordinary days pass, the seventh is
  refused; six hazardous seven-hour days pass, the seventh is refused; planned overtime is excluded from normal time.
- The hazardous daily seven-hour check is still the separate finding below; this change only makes the weekly cap
  effective for both categories.

## Seed round 3 (2026-11-10), every TH version

- **LPA s.67 leave pay at exit.** `ANNUAL_LEAVE` gets a `payout` (so the exit encashment raises it) and posts in
  `ADDITIONAL_WAGES`, beside s.64 holiday pay: outside the SSO, WCF, PVD and EWF bases, withheld whole in its month by
  PND1 (Por.96/2543 cl.1(5)). The exit request carries the newest window's days left. The payout pays the days above
  the current service year's s.30 grant (carried under s.30 para 3) on any exit, a s.119 dismissal included (the
  automation skips only `misconduct_dismissal`, which TH does not set); and, only where `exit_ground` is an employer
  termination (dismissal, dismissal for cause, redundancy, retirement (s.118/1), end of contract) and
  `section_119_ground` is not set, the current year's grant × completed months served ÷ 12 less the days already taken.
  Days taken count against carried days first. Day value: `ctx.day_rate` (monthly ÷ 30).
- **s.29 and the `PUBLIC_HOLIDAY` row.** s.29 requires at least 13 announced traditional holidays; they are the
  entity's holiday calendar, and a holiday on a weekly holiday moves to the next working day as a calendar `replaces`
  row. A 13-day leave balance on top granted them twice. The row is now `PUBLIC_HOLIDAY_IN_LIEU` (same ids), 0 by
  default: the day off agreed under s.29 para 4 for a holiday worked, granted by HR's manual adjustment. A holiday
  never given is paid as `HOLIDAY_NOT_GRANTED` (s.64).
- **Part-paid leave.** `SUSPENSION` (s.116) and `CHILD_CARE_LEAVE` (s.59/1) read `ctx.lookup.paid_share`, which only
  version 1's suspension row held: the run could not price them in versions 2–7. Both are now `paid_share` `0.5`.
- **Proration basis.** The statute's day is monthly ÷ 30; `conversions.proration` offers only `CALENDAR_DAYS` (kept,
  the nearest) and `WORKING_DAYS` (÷ about 22). A half-paid day therefore deducts monthly ÷ 28–31: 7% more than the
  statute in February (below the s.116 and s.59/1 half), 3% less in a 31-day month. Left for the owner.
- **WCF and PND1** read `employment_started_on` (the current unbroken stint) for the calendar-year ceiling (MOL
  notification of 21 February 2019 cl.11) and the benefit-in-kind months; severance and the s.48(5) election keep
  `service_started_on`.
