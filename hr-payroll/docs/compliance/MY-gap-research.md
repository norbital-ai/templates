# MY compliance gaps — legal and engineering decisions

Status: research and implementation record, 9 November 2026. The source changes and tests for the gaps below are recorded in their implementation-status sections.

Scope: the five MY gaps in the HR/Bolt seed audit, plus the public-holiday-in-lieu behaviour found during the manual payroll probe:

1. `exit_ground` is read but undeclared (`RETRENCHMENT_NOTIFICATION`, `RETIREMENT_AGE_REVIEW`, `RETRENCHMENT_FOREIGN_FIRST`).
2. `work_pass_valid_until` is read but undeclared (`WORK_PASS_RENEWAL`).
3. EPF/SOCSO/EIS employer registration has no fact, so the reminders are unconditional.
4. `SOCSO_ACCIDENT_REPORT` keys on `inputs.work_injury`; the MY workplace-case catalog has no accident kind.
5. HRD registration raises for `NOT_REGISTERED`, `DEREGISTERED` and missing.
6. A public holiday on a weekly rest day has no in-lieu day; `PUBLIC_HOLIDAY_IN_LIEU` is a manual entry with no eligibility rule.

Paths name `version_8` for orientation. `version_8` is sealed (effective 2031-06-01); a seed fix lands in the next MY version, or in `version_8` only if the owner reopens it before release. Recommendations use existing mechanisms only: model fields, registered rules/effects, catalog `lookup`/`input_schema`, declared `reads`, and `obligation`. No engine, run or ledger semantics change.

## Summary

| Gap                       | Lawful trigger                                                                                             | Decision                                                                                                                                                                         | Payroll amount?                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. Exit ground            | Redundancy/closure for Form PK; age-based retirement for the MRA review; a redundancy selection for s.60N  | Native contract enum; Form PK and s.60N are exercise-level, retirement is per-contract                                                                                           | Yes — the same fact excludes resignation/retirement/misconduct from termination benefit |
| 2. Work pass expiry       | The pass expiry date; the renewal window opens three months before. No statutory 90-day notice             | Native contract date, editable when SEALED; reminder key includes the expiry                                                                                                     | No                                                                                      |
| 3. Employer registration  | First contribution month (EPF); first employee (SOCSO/EIS), with a 30-day deadline                         | Two registration dates on the mutable `entity`; stop the reminder once recorded                                                                                                  | No                                                                                      |
| 4. Accident report        | A reportable employment-injury accident, not a boolean                                                     | `WORKPLACE_ACCIDENT` catalog kind with an `accident_type` input                                                                                                                  | No                                                                                      |
| 5. HRD registration       | Compulsory only for a covered employer with 10+ Malaysian employees; approved deregistration ends the duty | Raise only for `NOT_REGISTERED` with a liability date; suppress `DEREGISTERED`, missing and `OUT_OF_SCOPE`                                                                       | No (the levy row is separate)                                                           |
| 6. Public holiday in lieu | A public holiday that falls on the employee's weekly rest day (s.60D(1))                                   | Stays a manual `PUBLIC_HOLIDAY_IN_LIEU` entry; eligibility is implicit from `terms.normal_days_per_week`; the entry date must be the next working day after the rest-day holiday | Yes as a paid leave day; exit cash-out is priced by the catalog conversion              |

---

## 1. Exit ground — retrenchment, retirement, foreign-first

### 1.1 Law

**Retrenchment notification.** Employment Act 1955 (Act 265) s.63 is the power to require returns; the operative duty is the Employment (Retrenchment) Notification 2004, P.U.(B) 430/2004, Form PK. JTKSM states that notification is required for terminations due to **company closures and redundancies**, and expressly not for disciplinary action or dismissal:

- Form PK Parts I–IV: at least 30 days **before** the action.
- Part V: within 14 days **after**; Part VI and attachments: within 30 days **after**.
- Part V and VI apply only to retrenchment and separation schemes.

JTKSM FAQ: “termination that needs to be notified are only termination due to company closures and redundancies … This does not include termination due to disciplinary action and dismissal of employees.”
<https://jtksm.mohr.gov.my/en/frequently-asked-questions/employees-retrenchment>

JTKSM service page and Form PK:
<https://jtksm.mohr.gov.my/en/services/employees-retrenchment>
<https://jtksm.mohr.gov.my/sites/default/files/2023-01/Pemberitahuan-Pemberhentian-Pekerja-20014-Borang-PK.pdf>

**Retirement.** Minimum Retirement Age Act 2012 (Act 753):

- s.4(1): the minimum retirement age is **60**; the Minister may prescribe a higher age (s.4(2)).
- s.5(1): an employer shall not prematurely retire an employee before the minimum age; s.5(2): offence.
- s.5(3): “premature retirement” does not include an **optional retirement under s.6** or a termination for a reason other than age.
- s.6: an employee may retire at the optional retirement age agreed in the contract or collective agreement.
- s.8: a prematurely retired employee may complain in writing to the Director General within **60 days** of the retirement.

<https://jtksm.mohr.gov.my/sites/default/files/2023-03/6.%20Minimum%20Retirement%20Age%20Act%202012.pdf>

The existing `RETIREMENT_AGE_REVIEW` is therefore a **review**, not an automatic finding of breach: a retirement below 60 may be the employee’s s.6 optional retirement or an unlawful s.5 premature retirement. The review must decide which.

**Foreign-first retrenchment.** Employment Act 1955 s.60N:

> Where an employer is required to reduce his workforce by reason of redundancy necessitating the retrenchment of any number of employees, the employer shall not terminate the services of a local employee unless he has first terminated the services of all foreign employees employed by him in a capacity similar to that of the local employee.

s.60O excludes a foreign employee who is a permanent resident of Malaysia.

<https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1744567_BI/Reprint%20Act%20265%20(Final).pdf>

The duty is on the **selection of local employees in a redundancy exercise**. It is not a duty to notify anyone, and it is not about the foreign employee’s own exit.

### 1.2 Native fact, not an extension string

**Decision: add `employee_contract.exit_ground` as a native enum.** It is not a jurisdiction declaration:

- It decides statutory money in MY (termination benefit), TH (severance tax/eligibility) and ID (severance), and obligations in MY.
- ID and TH already duplicate it in `employee_extension_data`; MY is the third reader of the same fact.
- The architecture already says the facts that decide severance, “such as `exit_ground` and `termination_cause`, are on the contract” (`docs/0005-target-architecture.md`).
- The extension schema cannot carry a live exit fact: `employee_extension_data` is **not editable when the contract is SEALED**. The SEALED edit list is only `effective_range`, `final_pay_due_on`, `reason`, `employee_name`. A live exit is recorded after sealing, so an extension field would be frozen.

Minimal field path:

- `src/data/model/employee_profile/employee_contract/+model.ts`: add `exit_ground` to `fields`, to the `columns` list, and to the `SEALED` `edit` list beside `reason`.
- `src/lib/payroll_engine/registrations.ts`: add `exit_ground` to `SUBJECT_CONTRACT`; the adhoc formula’s `ctx.subject.employment` is built from that list.
- Values: at minimum `RETRENCHMENT` (covers redundancy and company closure; add `CLOSURE` only if the UI needs to distinguish), `RETIREMENT`, `RESIGNATION`, `DISMISSAL`, `MISCONDUCT_DISMISSAL`, `END_OF_CONTRACT`, `MUTUAL`, `DEATH`, `UNILATERAL`, `BREACH_BY_EMPLOYER`. The misconduct value is distinct: a dismissal without misconduct can still attract termination benefit. Keep the existing `misconduct_dismissal` extension boolean for the leave-encashment logic, but do not make the live exit depend on it; it is frozen when SEALED.
- Keep `reason` as the narrative/evidence field.
- Do **not** model the exit as a contract `event`: contract events are dated statutory incidents; termination is the contract status/reason.

If the owner refuses a model field in this cycle, the only seed-only fallback is a top-level `exit_ground` in the MY `employee_extension_schema` **plus** `employee_extension_data` in the SEALED edit list. That opens the whole extension blob to edits, including statutory declarations, so it is not recommended. The native field is the smaller correct change.

### 1.3 Effect-by-effect

| Effect                       | Lawful trigger                                                                                                             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RETRENCHMENT_NOTIFICATION`  | A redundancy or company closure affecting one or more employees. Form PK is one filing per exercise, not one per employee. | Condition on `RETRENCHMENT` (covers redundancy and closure) or a separate `CLOSURE`/`REDUNDANCY` value if the owner adds one. Remove `RETRENCHMENT_TERM_CONTRACT` unless it means an early termination because the role is redundant; a fixed term merely expiring is not retrenchment. Exclude `UNILATERAL` and `BREACH_BY_EMPLOYER`: they are not redundancy. Key the obligation by `entity_id` + action date, not by contract, so one exercise raises one reminder. Due `effective_range.to − 30`; title includes the action date.                                             |
| `RETIREMENT_AGE_REVIEW`      | A contract ending on the ground of age, with the employee below 60 at the exit.                                            | Keep. Read native `exit_ground`; condition `exit_ground = RETIREMENT` (or the existing `retirement_grounds` list) and `age_on(date_of_birth, effective_range.to) < 60`. Key per contract; due the exit date. The task asks whether this was a s.6 optional retirement or a s.5 premature retirement.                                                                                                                                                                                                                                                                              |
| `RETRENCHMENT_FOREIGN_FIRST` | A redundancy exercise in which a **local** employee is selected while a comparable foreign employee remains.               | **Delete the per-foreign-employee effect.** It fires on the foreign employee’s exit and says “retrench foreign employees first”, which is the opposite of s.60N. Have `RETRENCHMENT_NOTIFICATION` return a **second obligation** from the same effect, keyed `<entity_id>:<action date>:FOREIGN_FIRST`, titled “Confirm all foreign employees in a similar capacity were terminated before local employees (EA s.60N; s.60O excludes permanent residents)”. Same due date. The comparison is a human determination; the contract row does not hold comparable-capacity headcount. |

The Form PK coverage limit: the effect above reminds for Parts I–IV only (the 30-day pre-action filing) and only for retrenchment/closure. VSS, temporary lay-off and pay-cut also require Form PK, but the contract row is not their source; they are out of scope here. Parts V and VI are post-action filings and are not modelled by this effect. If the owner wants them tracked, the existing mechanism is a `RETRENCHMENT_EXERCISE` workplace case (`opened_on` = decision date, `scheduled_on` = action date, `inputs` = affected headcount) with its own obligations; that is a larger change. The minimal fix here is the pre-action notification and the s.60N check.

If `payroll.date_of_birth` is missing, the retirement review cannot compute age. A registered rule may refuse a `RETIREMENT` exit without a date of birth; otherwise the operator must fill it before the review. This is a data-quality guard, not a new obligation.

Deleting `RETRENCHMENT_FOREIGN_FIRST` does not delete obligations a tenant already holds. A live tenant must close or waive the old `MY:RETRENCHMENT_FOREIGN_FIRST:<contract>` rows; a local reset clears them with the demo data.

The two obligations need **independent** `occurrence_key` checks. The existing effect pattern returns `[]` when its one key already exists; if the Form PK key exists but the s.60N key does not, that pattern would suppress the s.60N task forever.

Both records are entity-level: leave `employee_id` and `employment_id` null. Form PK carries the affected employees in its appendix; the task is the filing, not one employee’s exit.

**Granularity limit.** Keying by `entity_id` + action date makes one obligation for employees with the same last day. If an exercise has employees leaving on different dates, it raises one per date. If exact exercise identity matters, add the `RETRENCHMENT_EXERCISE` case and key the obligation on it. Record this as a `shortcut:` in the seed if the minimal key is used.

### 1.4 Adjacent payroll defect — `TERMINATION_BENEFIT`

`TERMINATION_BENEFIT` cites the Employment (Termination and Lay-Off Benefits) Regulations 1980 regs. 3–6 and states that benefit is not payable on contractual retirement, misconduct dismissal after due inquiry, or voluntary resignation. Its **eligibility body does not read any of those facts**. It pays on a resignation or a misconduct dismissal. The same native `exit_ground` fixes it:

```js
// existing eligibility remains; add before the rate/category checks
// EMPLOYEE_RETIREMENT is the legacy MY value; drop it once the native enum is normalized to RETIREMENT
if (
	['RESIGNATION', 'RETIREMENT', 'EMPLOYEE_RETIREMENT', 'MISCONDUCT_DISMISSAL'].includes(
		get(employment, 'exit_ground', '')
	)
)
	return false;
// legacy rows may carry the extension boolean; keep it as a fallback only
if (get(employment, 'employee_extension_data.misconduct_dismissal', false) === true) return false;
```

Keep `UNILATERAL` and `BREACH_BY_EMPLOYER` eligible: the Regulations exclude resignation, retirement and misconduct after due inquiry, not every employer termination. A retirement below 60 needs the `RETIREMENT_AGE_REVIEW` before final pay; if the review finds it was not a genuine retirement, correct the ground before the run.

Path: `seed/public/jurisdiction/MY/version_8/adhoc_catalog.json`, row `TERMINATION_BENEFIT`, `eligibility`.

### 1.5 Test scenario — leaver

Add to `tests/statute_my.test.ts` (the existing `pack` / `catalogRow` kit).

Inputs:

- Monthly wage RM3,000; employment 2023-07-01 to 2026-06-30 (36 completed months); `statutory_work_category = NON_MANUAL`.
- One `TERMINATION_BENEFIT` adhoc entry dated 2026-06-30, `quantity = 1` (a nominal entered amount; the conversion pays the higher of the entry and the statutory floor). `quantity = 0` would fail the existing `quantity > 0` eligibility gate before the formula.
- Formula: day wage = `3,000 × 12 ÷ 365 = 98.6301369863`; 36 months is the 15-day band; `15 × 3 = 45` days; `98.6301369863 × 45 = 4,438.356164…` → **4,438.36**.

Expected:

| `exit_ground` / fact                                    | Eligible | Amount   |
| ------------------------------------------------------- | -------- | -------- |
| `RETRENCHMENT`                                          | yes      | 4,438.36 |
| `RESIGNATION`                                           | no       | 0        |
| `RETIREMENT` (date of birth 1966-06-30; age 60 at exit) | no       | 0        |
| `MISCONDUCT_DISMISSAL`                                  | no       | 0        |
| `DISMISSAL` + legacy `misconduct_dismissal = true`      | no       | 0        |
| `UNILATERAL`                                            | yes      | 4,438.36 |

This is a red test today for the refusal rows; it becomes green after the eligibility check. The `UNILATERAL` row follows the seed’s own regs. 3–4 reading; if the owner reads the Regulations as redundancy/closure only, drop that row from the test and keep `RETRENCHMENT` as the only positive case.

---

## 2. Work pass expiry

### 2.1 Law

- Immigration Act 1959/63 s.55B: employing a non-citizen or non-entry-permit holder who does not hold a valid pass is an offence. The Immigration Department’s enforcement page states the offence.
  <https://www.imi.gov.my/index.php/en/enforcement>
- The pass is issued by the Immigration Department. For the Visitor’s Pass (Temporary Employment), the Department states that the pass is valid for 12 months, an extension application may be made **three months before** the expiry date, and the application must be made **before** the pass expires; a late application is referred to the Enforcement Division.
  <https://www.imi.gov.my/index.php/en/main-services/foreign-worker>
- The three-month figure is the VP(TE) application window, not a universal statutory notice period. `terms.work_authorisation_category` records the pass type; for an Employment Pass, use the Expatriate Services Division renewal window rather than assuming the VP(TE) window.
- Employment Act 1955 s.60KA(1)(b): if a foreign employee’s service is terminated by reason of the **expiry of the employment pass**, the employer must inform the Director General within **30 days**. The existing `FOREIGN_EMPLOYEE_TERMINATION_NOTICE` effect covers that event.
  <https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1744567_BI/Reprint%20Act%20265%20(Final).pdf>

There is **no statutory 90-day renewal notice**. The 90 days in the seed matches the VP(TE) three-month application window; it is an operational lead time, not a legal deadline. The hard legal boundary is the pass expiry date.

### 2.2 Decision

**Add `employee_contract.work_pass_valid_until` as a native date, top-level (not inside `terms`, not in `employee_extension_data`).**

Why native:

- It is a document fact that changes on renewal, not a jurisdiction declaration.
- It must be editable while the contract is SEALED. `terms` and `employee_extension_data` are not editable when SEALED; editing `terms` would open every term, and editing `employee_extension_data` would open every statutory declaration.
- A top-level field can join the SEALED edit list beside `reason` without opening other facts.

Field path:

- `+model.ts`: add `work_pass_valid_until: { kind: 'date', optional: true }` to `fields`, to `columns`, and to the `SEALED` `edit` list.
- Representation/editor: show it next to `terms.work_authorisation_category`; the existing category remains the pass type.
- Only MY currently needs the reminder, but the field is harmless on any contract and avoids a MY-only extension. The renewal effect reads the contract row directly; `SUBJECT_CONTRACT` needs the field only if a payroll formula later reads it.

Effect change in `registered_effect.json`:

```js
// condition
const r = ctx.entry;
if (r.status !== 'SEALED') return false;
if (get(r, 'terms.residency_status', '') !== 'FOREIGNER') return false;
return get(r, 'work_pass_valid_until', null) != null;

// effects
const key = 'MY:WORK_PASS_RENEWAL:' + r.id + ':' + get(r, 'work_pass_valid_until', '');
if (get(ctx, 'reads.obligation', []).some((o) => o.occurrence_key === key)) return [];
return [
	{
		entity_id: r.entity_id,
		employee_id: r.employee_id,
		employment_id: r.id,
		title: 'Start work pass renewal (pass expires ' + get(r, 'work_pass_valid_until', '') + ')',
		due_on: add_days(get(r, 'work_pass_valid_until', ''), -ctx.lookup.advance_notice_days),
		occurrence_key: key
	}
];
```

Keep `advance_notice_days: 90` for the VP(TE) window and document it as “start of the Immigration Department’s three-month renewal window”, not a statutory deadline. For another pass type, set the lead time the issuer applies. The key includes the expiry date so a renewed pass raises a new reminder and a corrected date does not dedupe against the old one. The effect has one lead time for all pass types; if a tenant uses pass types with different windows, the lookup needs a per-category map later. That is not needed for the minimal fix.

Options and recommendation:

| Option                                                                | Fit                                                                                                                                                   | Recommendation                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Native `employee_contract.work_pass_valid_until`                      | Correct for a mid-contract renewal; readable by any effect                                                                                            | **Recommended**                    |
| MY `employee_extension_schema` top-level date                         | Seed-only, but `employee_extension_data` is frozen when SEALED; a renewal needs a new contract version, and the mid-month contract rule may refuse it | Fallback only                      |
| New `work_authorisation` record (number, kind, valid from/to, status) | Correct if pass history or multiple passes must be kept                                                                                               | Later, if renewals become frequent |

Do not call the 90 days a statutory notice period. If the owner wants the task due at the hard boundary, set `due_on = work_pass_valid_until`; that is the last lawful day, not a renewal window. The recommended lead time is the window start with the expiry in the title.

The pass number and pass type are not needed for the reminder. `terms.work_authorisation_category` already records the category; `payroll.passport_number` records the travel document. Do not add another string field.

---

## 3. EPF / SOCSO / EIS employer registration

### 3.1 Law

**EPF.** Employees Provident Fund Act 1991 (Act 452) s.41(1):

> Every employer shall, unless he is already registered with the Board, before the end of the first week in the first month in which he is paying wages in respect of which he is required to pay contributions under this Act, register with the Board in the manner as may be prescribed by the Board.

s.41(2) makes contravention an offence.

<https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1736246_BI/Act%20452%20(Online%202022).pdf>

The seed’s reference “within seven days from hiring the first employee” is a paraphrase. The statutory anchor is the **first month in which contribution-liable wages are paid**, not the hire date. The KWSP registration page is the official summary:
<https://www.kwsp.gov.my/en/employer/responsibilities/registration>

**SOCSO.** Employees’ Social Security Act 1969 (Act 4) s.4: every industry to which the Act applies shall be registered within the time specified in the regulations. The Employees’ Social Security (General) Regulations 1971 reg. 3(3) requires the employer’s registration form not later than **30 days from the date the Act becomes applicable** to the industry. PERKESO states “within 30 days upon hiring a new employee.”

<https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/3226981_BI/Act%204%20(Online%202026).pdf>
<https://www.perkeso.gov.my/en/our-services/employer-employee/employer-registration.html>

**EIS.** Employment Insurance System Act 2017 (Act 800) s.14(1) requires an employer to register his industry. s.15 deems an employer already registered under the Employees’ Social Security Act 1969 before the EIS commencement to be registered under the EIS; for a new employer, PERKESO’s single employer registration (Form 1) covers both schemes. There is therefore **one PERKESO employer registration for SOCSO and EIS**, not two. The existing combined `SOCSO_EIS_EMPLOYER_REGISTRATION` is correct.

<https://www.perkeso.gov.my/images/imej/akta_dan_peraturan/EMPLOYMENT_INSURANCE_SYSTEM_ACT_2017_Act_800.pdf>

Registration is a one-time duty. There is no recurring employer registration obligation. The `obligation` dedupe key (`occurrence_key = scheme + entity_id`) prevents duplicate rows, but it cannot tell “already registered” from “not recorded”; that is why the reminder is unconditional.

### 3.2 Decision

**Declare two registration dates on the mutable `entity`, not the frozen entity profile version:**

- `entity.epf_registered_on` — date, optional.
- `entity.socso_registered_on` — date, optional; this also covers EIS through the single PERKESO employer registration.

Why the `entity`:

- They are one-time company facts, not law versions. The entity is the stable company identity and is mutable.
- `entity_profile_version.entity_extension_data` is frozen when SEALED (only `effective_range` and `reason` are editable). A registration learned after setup could not be recorded there without opening the whole extension blob or creating a new version.
- A missing date means “not recorded”, not “unregistered”. The obligation title should say **Confirm/record** the registration, not assert a breach.

Field paths:

- `src/data/model/entity/+model.ts`: add both dates to `fields`, `create.columns` and `update.columns`.
- `src/data/model/entity/+representation.svelte`: show them in the company/statutory section.
- `registered_effect.json` for `EPF_EMPLOYER_REGISTRATION` and `SOCSO_EIS_EMPLOYER_REGISTRATION`: add a declared read:

```json
"reads": {
  "obligation": { "where": { "occurrence_key": { "eq": { "var": "'MY:EPF_EMPLOYER_REGISTRATION:' + ctx.entry.entity_id" } } }, "limit": 10 },
  "entity": { "where": { "id": { "eq": { "var": "ctx.entry.entity_id" } } }, "limit": 1 }
}
```

and condition:

```js
const r = ctx.entry;
if (r.status !== 'SEALED') return false;
const employer = get(ctx, 'reads.entity', [])[0] ?? {};
return get(employer, 'epf_registered_on', null) == null;
```

Repeat with `socso_registered_on` for the SOCSO/EIS effect. Keep them separate: EPF and PERKESO are separate registrations under separate statutes. Use titles “Confirm the employer’s EPF registration” and “Confirm the employer’s SOCSO/EIS registration”; the task records the date or leads to registration, it does not assert a breach.

Due date: the lawful anchors are the first contribution month (EPF) and the first employee/30 days (SOCSO/EIS). The entity profile version’s `effective_range.from` is not that anchor. **Remove `due_on`** for these two reminders (the model makes it optional) and remove the now-unused `offset_days` lookup key. The task is a prompt to record/confirm the registration, not a statement that the statutory deadline falls seven or thirty days after the entity profile version. If the owner wants a real deadline, add a `first_employee_on` fact to the entity and, for EPF, the first contribution month (or derive it from the first payroll run); SOCSO/EIS = `first_employee_on + 30`; EPF = end of the first week of that month. That is a follow-up, not the minimal fix.

Exempt employers use the obligation’s existing `WAIVED` state and `waiver_reason`; no exemption fields are needed.

Acceptance (control, no amount):

- Sealed entity with `epf_registered_on` set → no EPF obligation.
- Sealed entity without it → one EPF obligation; a second entity profile version → still one (occurrence key).
- Same for `socso_registered_on` and the SOCSO/EIS obligation.
- `WAIVED` with a reason removes it from the open list.

---

## 4. SOCSO accident report

### 4.1 Law

Employees’ Social Security Act 1969 (Act 4):

- s.94(e): a person who “fails or refuses to submit any return or accident report required by the regulations” commits an offence.
- s.94A(3): on conviction under s.94(e) for an accident report, the court orders the report to be submitted within the time it determines.
- The report itself is required by the Employees’ Social Security (General) Regulations 1971 reg. 71: after receiving notice under reg. 68, the employer completes the accident report in Form 21 and sends it to the office (and the insurance doctor).
- PERKESO states the employer must report all work-related accidents **within 48 hours of notification**.

<https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/3226981_BI/Act%204%20(Online%202026).pdf>
<https://www.perkeso.gov.my/images/dokumen/SEPT_2020-RISALAH_EN.pdf>

“Employment injury” includes an accident arising out of and in the course of employment, a commuting accident (s.24), an accident while meeting an emergency (s.25), and an occupational disease (s.32A/Fifth Schedule). The current effect is an **accident** report; occupational disease is a separate route and should not be forced into this kind.

### 4.2 Decision

**Add one catalog kind `WORKPLACE_ACCIDENT` and key the effect on the entry’s `kind`, not on an undeclared `inputs.work_injury` boolean.**

Path: `seed/public/jurisdiction/MY/version_8/workplace_case_catalog.json`, new row:

```json
{
	"code": "WORKPLACE_ACCIDENT",
	"lookup": {
		"input_schema": {
			"type": "object",
			"properties": {
				"accident_type": {
					"type": "string",
					"enum": ["INDUSTRIAL", "COMMUTING", "EMERGENCY"],
					"title": "Accident type"
				}
			},
			"required": ["accident_type"],
			"additionalProperties": false,
			"description": "opened_on is the date the employer received notice of the accident; occurred_on is the accident date; severity is the existing injury classification. Do not record a near miss as this kind."
		}
	},
	"subtotal_id": null,
	"references": [
		{
			"title": "Employees' Social Security Act 1969 (Act 4); Employees' Social Security (General) Regulations 1971; PERKESO, Social Security Protection (2020).",
			"locator": "Act 4 ss.24, 25, 94(e), 94A(3); Regulations regs. 68, 71; PERKESO: report within 48 hours of notification.",
			"url": "https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/3226981_BI/Act%204%20(Online%202026).pdf"
		}
	]
}
```

The entry keeps its existing fields: `employment_id` (required), `severity`, `occurred_on`, `opened_on`, `location`, `reference`, `description`, `inputs`, `evidence_file`. `subtotal_id` is null because a workplace case never moves a balance.

Effect change:

```js
// condition
const r = ctx.entry;
return r.kind === 'WORKPLACE_ACCIDENT';
```

Keep `lookup.offset_days: 2` and `due_on: add_days(r.opened_on, 2)`. This is the date-only expression of PERKESO’s 48 hours from notification; the clock actually runs from the time notice is received. Do not add a time field or change the engine for this.

Do **not** put `work_injury` in `inputs`. The kind is the fact; a boolean duplicates it and can drift. Do not gate on `severity`: a `WORKPLACE_ACCIDENT` entry is by definition a reportable injury; near misses and property damage should use a different kind or not be created under this code. If the owner wants a hard rule, add `WORKPLACE_ACCIDENT` to `BUSINESS_CASE_SUBJECT_AND_REFERENCE`’s `kinds` so `employment_id` and `evidence_file` are required; that is optional and may block an urgent report before the medical document exists. The entry model already requires `employment_id`.

Occupational disease: if the owner wants it, add a separate `OCCUPATIONAL_DISEASE` kind with its own form and timeline. Do not widen this effect.

---

## 5. HRD registration mapping

### 5.1 Law

Pembangunan Sumber Manusia Berhad Act 2001 (Act 612):

- s.13(1): every employer to whom the Act applies shall register with the Corporation within the prescribed time; s.13(2): offence.
- s.16(1): no employer who is registered shall be deregistered.
- s.16(2): if the number of employees falls below ten for **three consecutive months**, the employer may apply to the Corporation for deregistration with documents proving the decrease.
- s.17: an employer deregistered under s.16(2) and re-registered within two years keeps its benefit eligibility.

HRD Corp’s employer FAQ and support centre state the same deregistration rule:
<https://hrdcorp.gov.my/faq>
<https://supportcentre.hrdcorp.gov.my/portal/en/kb/articles/cessation-and-deregistration-of-an-employer>

HRD Corp’s registration threshold: 10 or more Malaysian employees in a covered sector is compulsory; 5–9 may register optionally; out-of-scope employers have no duty. The Act’s “employee” is a Malaysian citizen employed for wages, excluding a domestic servant; foreign employees do not count toward the headcount.
<https://hrdcorp.gov.my/registered-employers>

The system does not hold a Malaysian-employee headcount. `hrd_registration_class` is therefore a **declared outcome**, not a computed fact. That is acceptable if the declaration is the gate.

### 5.2 Decision

The current condition reads only the class and raises for every class except `COMPULSORY`/`OPTIONAL`; it does not read `hrd_scope`, so it wrongly raises for `DEREGISTERED`, `OUT_OF_SCOPE` and missing. Replace it with a declared-liability gate:

```js
const r = ctx.entry;
if (r.status !== 'SEALED') return false;
const facts = get(r, 'entity_extension_data', {});
if (get(facts, 'hrd_scope', '') === 'OUT_OF_SCOPE') return false;
if (['COMPULSORY', 'OPTIONAL', 'DEREGISTERED'].includes(get(facts, 'hrd_registration_class', '')))
	return false;
const liabilityOn = get(facts, 'hrd_registration_liability_on', null);
return (
	get(facts, 'hrd_registration_class', '') === 'NOT_REGISTERED' &&
	typeof liabilityOn === 'string' &&
	liabilityOn !== ''
);
```

| Class / scope                                      | Reminder? | Reason                                                                                                                                                                                                                  |
| -------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPULSORY`                                       | no        | Registered; levy at 1%                                                                                                                                                                                                  |
| `OPTIONAL`                                         | no        | Registered voluntarily; levy at 0.5%                                                                                                                                                                                    |
| `NOT_REGISTERED` + `hrd_registration_liability_on` | **yes**   | The employer has declared that it met the compulsory coverage conditions and is not registered                                                                                                                          |
| `NOT_REGISTERED` without the date                  | no        | Liability is not established; a registration duty cannot be asserted                                                                                                                                                    |
| `DEREGISTERED`                                     | no        | Approved under s.16(2); no current registration duty. If the employer again meets the compulsory threshold, the operator changes the class to `NOT_REGISTERED` and sets the new liability date; the reminder then fires |
| missing class                                      | no        | Unknown is not “liable”. A separate data-quality task “Classify HRD coverage” may be raised, but it must not be titled “Register”                                                                                       |
| `OUT_OF_SCOPE`                                     | no        | The Act does not apply                                                                                                                                                                                                  |

Due date: use `hrd_registration_liability_on + 30`. The rule below requires the date for `COMPULSORY` and `NOT_REGISTERED`, so no fallback is needed. Keep the existing `offset_days: 30`; it is the prescribed registration period already encoded in the seed. The liability date is the correct anchor; the entity version date is not.

Path: `seed/public/jurisdiction/MY/version_8/registered_effect.json`, `HRD_EMPLOYER_REGISTRATION` condition and effects. Extend `HRD_LIABILITY_EVENT_DATE_REQUIRED` in `registered_rule.json` to require the date when the class is `COMPULSORY` **or** `NOT_REGISTERED`; otherwise a `NOT_REGISTERED` row with no date silently suppresses the reminder.

Transition note for `DEREGISTERED`: update the field description in `entity_extension_schema` to say “approved deregistration under PSMB Act s.16(2); set `NOT_REGISTERED` and the new liability date if the employer again meets the compulsory threshold.” No new enum value is needed. Because the class and liability date live on the dated entity version, record the change in a new entity profile version; the sealed one is frozen.

Levy note: `HRDF.employer_amount` defaults a missing class to `COMPULSORY` (1%). That is conservative and separate from the reminder; it avoids underpayment while the class is unknown. Do not change it in this fix. If the owner later changes the default to 0, add a test: in-scope employer, one citizen employee, RM3,000 wages, class missing → 0 (not 30); `OPTIONAL` → 15; `COMPULSORY` → 30.

---

## 6. Public holiday in lieu (OIL)

### 6.1 Law

Employment Act 1955 (Act 265) s.60D(1): "If any public holiday falls on a rest day, the working day following immediately thereafter shall be a paid public holiday in substitution therefor." Section 60D(3) prices work done on a public holiday at two days' wages at the ordinary rate, with overtime at three times the hourly rate. The source is recorded on the `PUBLIC_HOLIDAY_IN_LIEU` catalog row in every MY version.

### 6.2 Decision

OIL stays a **manual** leave entry. HR names the employee and the substitution day; no automation scans holidays and grants it. Eligibility is **implicit**, not a field or a list:

- The employee's own normal week supplies the rest days: five days rests on Saturday and Sunday, six on Sunday only, seven has none. The template reads `terms.normal_days_per_week`; it does not read the roster's individual rest pattern yet.
- The entity's published holidays supply the trigger. A holiday that is itself a `SUBSTITUTE` or a `MAKEUP_WORKDAY` does not create another substitution.
- The entry date must be the next working day after the rest-day holiday, skipping other weekly rest days and published holidays. A Saturday holiday substitutes the following Monday for a five-day week; a six-day week works that Saturday, so it substitutes nothing. A Sunday holiday substitutes the Monday for both.
- The check runs on `leave_catalog_entry.create` and on edits that change the slots. Reversals and exit encashments are not checked; they settle an existing position rather than create a new day in lieu.

### 6.3 The four roster cases

| Roster day       | Planned / came        | Behaviour                                                                                                                                                                                                                       |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rest day + PH    | Planned, came         | `HOLIDAY_WORK` pays two days' ordinary wages for normal hours, `HOLIDAY_OVERTIME` three times the hourly rate beyond normal. Rest-day work bands are skipped on a holiday. The monthly basic already includes the paid holiday. |
| Rest day + PH    | Planned, did not come | No work line. Basic is unchanged; the day is a paid holiday, not an absence. OIL remains a manual entry.                                                                                                                        |
| Working day + PH | Planned, came         | Ordinary work bands skip the day; `HOLIDAY_WORK` and `HOLIDAY_OVERTIME` apply as above. Basic includes the paid holiday.                                                                                                        |
| Working day + PH | Planned, did not come | No work line. Basic is unchanged; absence is deducted only when the roster marks `ABS` or unpaid leave is filed.                                                                                                                |

A normal holiday applies by date even on a rest day; the shift-pattern gate is the **substitute holiday** path (`given_to = ONLY_IF_OFF_ON_REPLACED_DATE`), where the weekday in lieu belongs only to people who were off on the replaced date.

### 6.4 Tests

- `tests/my_oil_eligibility.test.ts` 4/4: five-day accepts Monday after a Sunday or Saturday holiday; six-day accepts Monday after Sunday and refuses Monday after Saturday; seven-day has no substitution.
- `tests/holiday_scenarios.test.ts` 5/5: the four roster cases above, plus no automatic OIL entry.
- `tests/holiday_in_lieu.test.ts` 2/2: the substitute-holiday gate for a five-day versus six-day week.

### 6.5 Residual limits

- The weekly rest days come from `terms.normal_days_per_week`, not a rotating roster or an agreed non-Saturday/Sunday week. A four-day week is treated like a five-day week until a roster-aware rule is added.
- The statutory "next working day" is computed against weekly rest days and published holidays only; an approved off day that is not a published holiday does not move the substitution.
- OIL remains manual by decision. Automatic granting would need an effect on holiday publication that creates one entry per eligible employee, which this template does not run.

## Owner decisions and residual limits

1. **`exit_ground` native field** requires a model field, UI field and the SEALED edit-list entry. The seed-only extension fallback is not viable for live exits because `employee_extension_data` is frozen when SEALED. Recommend native.
2. **`work_pass_valid_until` native field** is the only option that records a mid-contract renewal without opening `terms` or the whole extension blob. Recommend native + SEALED edit.
3. **Employer registration facts on `entity`** avoid the frozen entity-version extension. If the owner prefers the extension schema, a new entity version is required each time a registration is learned; state that cost explicitly.
4. **Retrenchment exercise identity** is approximated by entity + action date. If exercises span dates or need a headcount record, add a `RETRENCHMENT_EXERCISE` workplace case. Not in the minimal fix.
5. **MRA non-application** (government, statutory bodies and the other s.2 categories) is not modelled. The retirement review can be `WAIVED` with a reason; do not add employer-type fields for this gap.
6. **HRD headcount** is a declared class, not a computed count. The system cannot decide compulsory vs optional coverage without a Malaysian-employee headcount fact; the declared class is the existing mechanism.

## Sources

| Law / authority                                                   | Locator                                          | URL                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Employment Act 1955 (Act 265)                                     | ss.60K, 60KA, 60N, 60O, 63                       | <https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1744567_BI/Reprint%20Act%20265%20(Final).pdf>                                      |
| JTKSM, Employees’ Retrenchment FAQ                                | Form PK, 30/14/30-day parts; exclusions          | <https://jtksm.mohr.gov.my/en/frequently-asked-questions/employees-retrenchment>                                                                |
| JTKSM, Employees’ Retrenchment service                            | Form PK procedure                                | <https://jtksm.mohr.gov.my/en/services/employees-retrenchment>                                                                                  |
| Employment (Retrenchment) Notification 2004, P.U.(B) 430/2004     | Form PK                                          | <https://jtksm.mohr.gov.my/sites/default/files/2023-01/Pemberitahuan-Pemberhentian-Pekerja-20014-Borang-PK.pdf>                                 |
| Minimum Retirement Age Act 2012 (Act 753)                         | ss.4–8                                           | <https://jtksm.mohr.gov.my/sites/default/files/2023-03/6.%20Minimum%20Retirement%20Age%20Act%202012.pdf>                                        |
| Employment (Termination and Lay-Off Benefits) Regulations 1980    | regs. 3–6                                        | <https://jtksm.mohr.gov.my/sites/default/files/2023-03/8.%20EMPLOYMENT%20(TERMINATION%20%26%20LAY%20OFF%20BENEFITS)%20REGULATIONS%201980_0.pdf> |
| Employees Provident Fund Act 1991 (Act 452)                       | s.41                                             | <https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1736246_BI/Act%20452%20(Online%202022).pdf>                                        |
| KWSP employer registration                                        | registration summary                             | <https://www.kwsp.gov.my/en/employer/responsibilities/registration>                                                                             |
| Employees’ Social Security Act 1969 (Act 4)                       | ss.4, 24, 25, 94, 94A                            | <https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/3226981_BI/Act%204%20(Online%202026).pdf>                                          |
| PERKESO employer registration                                     | 30-day registration                              | <https://www.perkeso.gov.my/en/our-services/employer-employee/employer-registration.html>                                                       |
| Employment Insurance System Act 2017 (Act 800)                    | ss.14–16                                         | <https://www.perkeso.gov.my/images/imej/akta_dan_peraturan/EMPLOYMENT_INSURANCE_SYSTEM_ACT_2017_Act_800.pdf>                                    |
| PERKESO, Social Security Protection (2020)                        | 48-hour accident report                          | <https://www.perkeso.gov.my/images/dokumen/SEPT_2020-RISALAH_EN.pdf>                                                                            |
| Immigration Act 1959/63 s.55B; Immigration Department enforcement | employing without a valid pass                   | <https://www.imi.gov.my/index.php/en/enforcement>                                                                                               |
| Immigration Department, Foreign Worker                            | VP(TE) validity and three-month extension window | <https://www.imi.gov.my/index.php/en/main-services/foreign-worker>                                                                              |
| Pembangunan Sumber Manusia Berhad Act 2001 (Act 612)              | ss.13, 16, 17                                    | <https://lom.agc.gov.my/>                                                                                                                       |
| HRD Corp employer FAQ                                             | registration, s.16 deregistration                | <https://hrdcorp.gov.my/faq>                                                                                                                    |
| HRD Corp support centre, cessation and deregistration             | s.16(1)–(2)                                      | <https://supportcentre.hrdcorp.gov.my/portal/en/kb/articles/cessation-and-deregistration-of-an-employer>                                        |
| HRD Corp registered employers                                     | 10+ compulsory; 1%                               | <https://hrdcorp.gov.my/registered-employers>                                                                                                   |

### Gap 1 implementation status (2026-11-09)

- Added native `employee_contract.exit_ground` (enum), its create/update column and its place in the `SEALED` edit list;
  added it to `SUBJECT_CONTRACT` so payroll formulas see it.
- `RETRENCHMENT_NOTIFICATION` and `RETIREMENT_AGE_REVIEW` read the native field first, with the legacy extension
  `exit_ground` as fallback. The Form PK and s.60N obligations were already merged into one effect with independent keys.
- `TERMINATION_BENEFIT` now refuses `RESIGNATION`, `RETIREMENT`, legacy `EMPLOYEE_RETIREMENT` and
  `MISCONDUCT_DISMISSAL`; `UNILATERAL` and `BREACH_BY_EMPLOYER` stay eligible. The legacy misconduct boolean remains a
  fallback.
- Regression: `tests/my_exit_ground.test.ts` covers eligibility and the 4,438.36 amount, native retrenchment raising
  both duties once, resignation raising none, and retirement below/at 60.
- Fixture note: the research scenario’s 2023-07-01 → 2026-06-30 is 35 completed months, not 36. The test starts
  2023-06-30 so the intended 36-month band and 4,438.36 figure hold.

### Gap 2 implementation status (2026-11-09)

- Added native `employee_contract.work_pass_valid_until`, editable while sealed (field, columns, `SEALED` edit list).
  `WORK_PASS_RENEWAL` reads only the native date; the undeclared legacy extension path is no longer referenced.
- The reminder key now includes the expiry: `MY:WORK_PASS_RENEWAL:<contract>:<expiry>`, so a renewal raises a new
  reminder and a corrected date does not dedupe against the old one. Title names the expiry; due is the expiry minus 90
  days, documented as the Immigration Department's three-month renewal window, not a statutory notice period.
- Regression: `tests/my_work_pass.test.ts` covers the native expiry, a renewed date raising a second reminder, and the
  citizen and missing-expiry passes.

### Gap 3 implementation status (2026-11-09)

- Added `entity.epf_registered_on` and `entity.socso_registered_on` (optional dates; create/update columns and the entity
  representation). The PERKESO date covers SOCSO and EIS.
- `EPF_EMPLOYER_REGISTRATION` and `SOCSO_EIS_EMPLOYER_REGISTRATION` now read the mutable entity and raise only while the
  matching date is missing. No `due_on` is set; titles say “Confirm”, not breach. The unused offset lookup was removed.
- Regression: `tests/my_employer_registration.test.ts` covers both missing dates, both recorded dates, and recording the
  dates on the mutable entity.

### Gap 4 implementation status (2026-11-09)

- Already present in every MY version: `WORKPLACE_ACCIDENT` is a workplace-case catalog kind with a required
  `accident_type` (`INDUSTRIAL`, `COMMUTING`, `EMERGENCY`); `SOCSO_ACCIDENT_REPORT` keys on the case kind, not on an
  `inputs.work_injury` boolean, and dates the report two calendar days after `opened_on`.
- Regression: `tests/my_accident_report.test.ts` covers an industrial accident (due and title), commuting and emergency
  accidents as separate reports, another case kind raising none, and a missing `accident_type` refused.

### Gap 5 implementation status (2026-11-09)

- Already present in every MY version: `HRD_EMPLOYER_REGISTRATION` raises only for a scoped `NOT_REGISTERED` employer
  with a recorded liability date, and due is that date + 30. Registered, optional, deregistered, out-of-scope and unknown
  classes raise none.
- `HRD_LIABILITY_EVENT_DATE_REQUIRED` already requires the date for sealed `COMPULSORY` and `NOT_REGISTERED` classes, so
  an undated sealed `NOT_REGISTERED` version is refused rather than silently suppressing the reminder.
- Regression: `tests/my_hrd_registration.test.ts` covers the dated reminder, the five non-triggering classes, the rule
  refusals, and the rule passing a DRAFT/out-of-scope/optional version.
