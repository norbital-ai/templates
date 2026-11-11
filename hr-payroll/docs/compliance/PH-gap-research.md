# PH compliance gaps — research and decisions

Status: research note, 9 November 2026. This file is the only change. No source, seed, test or other document is edited.

Scope: the eight PH findings from the HR/Bolt seed audit. Each section gives the legal position with an official source, the engineering decision, the field or configuration to declare, and a test scenario where the gap can change an amount or a statutory date.

Constraint: every recommendation uses the existing HRMS mechanisms — model fields, registered rules/effects, catalog lookup/conversion, `reads`, obligations. No engine-semantics change and no new helper framework. Where the audit and the implementation disagree, the implementation convention already used by MY/SG/ID/TH/VN is the precedent.

## Decision table

| #   | Finding                                                | Decision                                                                                                                                                                                               | Existing mechanism                       | New field                                                |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------- |
| 1   | Seal-only dispatch never fires                         | `events: ['create','update']` + `reads.obligation` guard on the occurrence key; key one-time duties on the person/entity; suppress exit duties when a same-jurisdiction successor continues employment | `registered_effect`, `reads`, obligation | None                                                     |
| 2   | Annual duties are run-triggered                        | Stay run-triggered: December on-cycle run (13th month: first November/December run); key by entity + covered year; correct the references                                                              | `registered_effect`, `reads`, obligation | None                                                     |
| 3   | Occurrence keys use the run id                         | Key on the statutory period: `CODE:entity_id:YYYY-MM`, `CODE:entity_id:YYYY-Qn`, `CODE:entity_id:YYYY`                                                                                                 | `reads`, obligation key                  | None                                                     |
| 4   | Twin notice fires on every separation                  | Gate on a just-cause dismissal fact                                                                                                                                                                    | PH `employee_extension_schema`           | `employee_extension_data.just_cause_dismissal` (boolean) |
| 5   | NPC full report uses 8 days                            | 5 days from discovery, parallel with the 72-hour notice                                                                                                                                                | lookup `due_days`                        | None                                                     |
| 6   | Workplace-case tasks use `opened_on`                   | Use `scheduled_on` for planned-start duties; `opened_on` only for request/knowledge                                                                                                                    | `scheduled_on`, effect expressions       | None (help text only)                                    |
| 7   | Contribution/loan/1603Q tasks fire without a liability | Gate loans and 1603Q on the actual line; gate contributions on the scheme's presence, never on its amount                                                                                              | `reads.payslip`, `breakdown`             | None                                                     |
| 8   | WAIR illness clock uses the wrong date                 | `occurred_on` is the accident date or the date the illness was established; fall back to `opened_on`; never the exposure date                                                                          | `occurred_on`, `opened_on`               | None (help text only)                                    |

The one new field is in section 4. Sections 6 and 8 need field help, not new fields.

---

## 1. Sealing dispatch for `employee_contract` and `entity_profile_version`

### Finding

All 19 `employee_contract` effects and all 8 `entity_profile_version` effects use `events: ["create"]` and a condition `status === 'SEALED'`. Both models create `DRAFT` and seal through `update` (the UI and the workbook import both call `create` then `update { status: 'SEALED' }`; `contract_materialize` does the same). The `create` dispatch therefore sees `DRAFT` and every condition is false. The 27 effects are dead on every supported write path: no registration, probation, retirement, exit, final-pay, encashment or separation task is raised.

The same repository already has the working pattern: MY, SG, ID, TH and VN use `create,update` (or `update`) plus a `reads.obligation` guard on the occurrence key. PH is the outlier.

### Legal position

The underlying duties are unchanged; only the dispatch is broken. The deadlines the effects represent are set by the agencies, not by the model lifecycle:

- SSS R-1A: report the employee for coverage within 30 days from the hiring date ([SSS, Employers](https://www.sss.gov.ph/employer-er/)).
- PhilHealth ER2: within 30 days of the employee's assumption of duty ([PhilHealth, Reporting Your Employees](https://www.philhealth.gov.ph/partners/employers/report.php)).
- Pag-IBIG: within 30 days from the start of employment ([HDMF Circular 275 §C.2, as amended by Circular 365](https://web.archive.org/web/20211228231909id_/https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/Circular%20No.%20365%20-%20Amended%20HDMF%20Circular%20No.%20275%20on%20the%20Registration%20of%20Employers.pdf)).
- BIR Form 1902: within 10 days from the date of employment ([RR 11-2018](https://bir-cdn.bir.gov.ph/local/pdf/RR%20No.%2011-2018.pdf), s.2.82).
- Final pay: within 30 days from separation; certificate of employment within 3 days from request ([DOLE Labor Advisory 06-20](https://www.dole.gov.ph/php_assets/uploads/2020/02/Labor-Advisory-No.-06-20-Guidelines-on-the-Payment-of-Final-Pay-and-Issuance-of-Certificate-of-Emplo.pdf)).
- BIR Form 2316 to a leaver: on the day of the last compensation payment ([RR 11-2018](https://bir-cdn.bir.gov.ph/local/pdf/RR%20No.%2011-2018.pdf), s.2.83.1).
- Twin notice: DOLE Department Order 147-15 s.5.1(a), discussed in section 4.

A `DRAFT` contract is not an employment fact. The duty begins when the record is sealed. A dispatch that never fires does not remove the legal duty; it removes the reminder and lets the deadline pass.

### Decision

No engine change. Apply the MY/SG data pattern to the 27 PH rows in `seed/public/jurisdiction/PH/version_2/registered_effect.json`:

1. Set `events: ["create", "update"]` on every one of the 27.
2. Keep the `ctx.entry.status === 'SEALED'` condition and the effect-specific condition. Exit effects add `get(ctx.entry, 'effective_range.to', null) !== null`; if the contract was sealed open-ended, the update that records the last day then fires them.
3. Declare `reads.obligation` on the occurrence key and guard both the condition and the effect body:

```js
// condition
const key = 'CODE:' + ctx.entry.id; // see the key scope below
if (get(ctx, 'reads.obligation', []).some((o) => o.occurrence_key === key)) return false;
return ctx.entry.status === 'SEALED'; /* && the effect-specific condition */

// effects
const key = 'CODE:' + ctx.entry.id;
if (get(ctx, 'reads.obligation', []).some((o) => o.occurrence_key === key)) return [];
return [/* the obligation row */];
```

```json
"reads": {
  "obligation": {
    "where": { "occurrence_key": { "eq": { "var": "\"CODE:\" + ctx.entry.id" } } },
    "fields": ["id"],
    "limit": 10
  }
}
```

4. Key scope. The occurrence key must name the subject of the duty, not the row that recorded it:
   - One-time employee registrations (SSS, PhilHealth, HDMF, BIR TIN): `CODE:<employee_id>`.
   - One-time employer registrations (HDMF, BIR withholding agent, SSS, PhilHealth, DOLE, DPO, NPC registration): `CODE:<entity_id>`.
   - NPC registration renewal: `CODE:<entity_id>:<renewal_year>`.
   - Contract-specific duties (probation, probation end, caregiver, kasambahay contract, alien employment permit): `CODE:<contract_id>`.
   - Compulsory retirement: `CODE:<employee_id>`; age follows the person, not the contract.
   - Exit duties (final pay, encashment, separation reports, authorised-cause notice, twin notice, personal-data disposal): `CODE:<contract_id>`.

   Keying a one-time registration on the contract or version id re-raises it when a replacement contract or a new entity version is sealed. Keying it on the person/entity makes the reads guard do what the law expects: one registration per person or employer.

5. Same-jurisdiction replacement. An end date is not always a separation. If a successor contract for the same employee starts after the last day in the same jurisdiction, the employment continues: no final pay, no encashment, no separation reports, no data-disposal clock. The model's `updated` effect already makes this decision for the leave encashment entry (it reads the employee's contracts and compares the jurisdiction code). The six generic exit effects (`encash-leave-on-exit`, `raise-exit-pay`, `FINAL_PAY_RELEASE`, `HDMF_SEPARATION_REPORT`, `PHILHEALTH_SEPARATION_REPORT`, `PERSONAL_DATA_DISPOSAL`) need the same check: read the employee's other contracts and the `jurisdiction_settings.code` for the current and successor versions; if a successor with `effective_range.from > ctx.entry.effective_range.to` has the same code, return `[]`. The authorised-cause and just-cause notices are already gated on their facts. This is the rule in `docs/transfer-semantics.md`.

6. Keep the unique `occurrence_key` as the backstop. The reads guard prevents the normal duplicate; the unique constraint refuses a same-period race.

The update event fires on every later edit, so the reads guard is not optional: without it, a later edit would attempt a duplicate create and the effect run would fail on the unique constraint. With it, sealing raises the task once, later edits skip, and a later exit date can still raise the exit duties because their key was never created while `effective_range.to` was null.

### Source-level alternative (not recommended)

If the owner prefers a single event, the minimal source change is to extend the local `Operation` type and `tap` to accept `'seal'` and `'after_exit'`, then dispatch `seal` from the two models' update effects when `before.status !== 'SEALED' && after.status === 'SEALED'`, and dispatch `after_exit` when a sealed contract's `effective_range.to` is set or changed. Set the 18 on-seal effects to `events: ["seal"]` and the 9 exit effects to `events: ["after_exit"]`. This is more code, adds a second dispatch path, and diverges from the other jurisdictions. The data pattern above is smaller and already proved in the repository.

### Field to declare

None.

### Test scenario — leaver, encashment and pay bump

- Entity E with a sealed first `entity_profile_version`. Expected: exactly one each of the seven one-time employer registrations (HDMF, BIR withholding agent, SSS, PhilHealth, DOLE, DPO, NPC), keyed by `entity_id`; one NPC renewal keyed by `entity_id:<renewal_year>` when `entity_extension_data.npc_registered_on` is recorded.
- True leaver L: monthly basic 30,000, 5-day week, effective 2026-01-01, open-ended, `DRAFT`. Seal L. Expected: exactly one SSS, PhilHealth, HDMF and BIR TIN registration obligation each, keyed by `employee_id`; no exit obligations.
- Edit L's `reason` (a later edit). Expected: no new registration obligations.
- Set L's `effective_range.to = 2026-06-30` with no successor. Expected: exactly one `encash-leave-on-exit`, one `raise-exit-pay`, one `FINAL_PAY_RELEASE`, one HDMF separation, one PhilHealth separation and one personal-data-disposal obligation each, keyed by the contract; one twin-notice only if the just-cause fact is true (section 4).
- Repeat the same update. Expected: no new obligations.
- Void a sealed contract with a reason (`status = VOID`). Expected: no new registration or exit obligations; the void transition is not a seal and not an exit.
- Pay-bump pair A/B: seal A (monthly 30,000, effective 2026-01-01, open-ended), then create B as a draft (same employee, effective 2026-07-01, monthly 35,000) before ending A.
- Set A's `effective_range.to = 2026-06-30`. Expected: no `encash-leave-on-exit`, `raise-exit-pay`, `FINAL_PAY_RELEASE`, HDMF/PhilHealth separation or personal-data-disposal obligation for A; the leave balance carries to B. Seal B. Expected: no new SSS/PhilHealth/HDMF/BIR TIN registration obligations; the contract-specific on-seal tasks fire once; the July run pays 35,000 basic. This is the pay-bump check.
- Encashment amount for the true leaver (synthetic fixture, not a statutory figure): with a 5-day `ANNUAL_LEAVE` balance and the PH `YEAR_REST_DAYS` conversion, the day rate is `30,000 × 12 ÷ (365 − 52×2) = 360,000 ÷ 261 = 1,379.31`; five days is `6,896.55`. The leave entry is created by the contract update effect, not by the registered effect; the test asserts the entry exists once and the obligation exists once.

---

## 2. The nine annual duties: calendar or run?

### Finding

The nine effects (`BIR_YEAR_END_ADJUSTMENT`, `BIR_1604C_ANNUAL_ALPHALIST`, `BIR_2316_CERTIFICATE`, `BIR_2316_SUBSTITUTED_FILING_LIST`, `THIRTEENTH_MONTH_PAYMENT`, `THIRTEENTH_MONTH_DOLE_REPORT`, `ANNUAL_ESTABLISHMENT_REPORT_ON_WAGES`, `DOLE_ANNUAL_EXPOSURE_DATA_REPORT`, `DOLE_ANNUAL_MEDICAL_REPORT`) source `payroll_run`, listen to `create`, and require an `ON_CYCLE` run whose `salary_coverage.to` month is December. Their references say they are "raised by the entity's daily calendar tick, not by a payroll run". No daily/calendar dispatcher exists: `taps.ts` passes only `create`, `update` and `delete`, and the `daily`/`calendar` values in the `registered_effect.events` enum are unused. The reference sentence is false.

### Legal position

The duty belongs to the covered calendar year, not to a payroll run. The due dates:

| Duty                                               | Statutory due date                                                       | Source                                                                                                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13th-month pay                                     | 24 December of the covered year                                          | PD 851; [DOLE Labor Advisory 16-25 §IV](https://bwc.dole.gov.ph/wp-content/uploads/2025/12/Labor-Advisory-No.-16-25-Guidelines-on-the-Payment-of-the-Thirteenth-Month-Pay.pdf)                                             |
| 13th-month compliance report                       | 15 January of the following year                                         | PD 851 IRR s.8; [LA 16-25 §VI](https://bwc.dole.gov.ph/wp-content/uploads/2025/12/Labor-Advisory-No.-16-25-Guidelines-on-the-Payment-of-the-Thirteenth-Month-Pay.pdf)                                                      |
| Year-end adjustment / refund of excess withholding | 25 January of the following year                                         | [RR 11-2018 s.2.79(B)(5)(b)](https://bir-cdn.bir.gov.ph/local/pdf/RR%20No.%2011-2018.pdf)                                                                                                                                  |
| BIR 1604-C and alphalist                           | 31 January of the following year                                         | [BIR 1604-C guidelines](https://bir-cdn.bir.gov.ph/local/pdf/1604-C%20Jan%202018%20Final.pdf); RMC 160-2022                                                                                                                |
| BIR 2316 to employees                              | 31 January of the following year                                         | [RR 11-2018 s.2.83.1](https://bir-cdn.bir.gov.ph/local/pdf/RR%20No.%2011-2018.pdf)                                                                                                                                         |
| Duplicate 2316s with substituted-filing list       | 28 February of the following year                                        | [RR 11-2018 s.2.83.1](https://bir-cdn.bir.gov.ph/local/pdf/RR%20No.%2011-2018.pdf)                                                                                                                                         |
| Annual Establishment Report on Wages               | Closing date of the annual window; 31 August in the 2025/2026 advisories | [NWPC 2025 AERW FAQs](https://nwpc.dole.gov.ph/2025-aerw-faqs/); [Labor Advisory 08-26](https://nwpc.dole.gov.ph/wp-content/uploads/2026/05/Labor-Advisory-No.-08-26-2025-Annual-Establishment-Report-on-Wages-AERW-1.pdf) |
| Annual Work Accident/Illness Exposure Data Report  | 30 January of the following year                                         | [OSH Standards Rule 1054(2)](https://oshc.dole.gov.ph/wp-content/uploads/2020/02/OSH-Standards-2020-Edition.pdf)                                                                                                           |
| Annual Medical Report                              | 31 March of the following year                                           | [OSH Standards Rule 1965.01(4)](https://oshc.dole.gov.ph/wp-content/uploads/2020/02/OSH-Standards-2020-Edition.pdf)                                                                                                        |

The AERW window is announced annually. The 2025 report was open from 15 May 2026 to 31 August 2026 ([NWPC 2025 AERW FAQs](https://nwpc.dole.gov.ph/2025-aerw-faqs/)). Re-read the NWPC page each May; do not treat 31 August as a permanent statutory date.

### Decision

**Stay run-triggered. Do not add a calendar automation.** The `daily`/`calendar` events have no dispatcher; building one would be a new engine concept and a helper framework, which the constraint forbids. The in-repo precedent is SG: its annual return is raised by the December run and keyed by `entity_id:year` (`SG:ANNUAL_EMPLOYMENT_INCOME_RETURN:<entity_id>:<YYYY>`).

Concrete changes:

1. Keep `source_collection: payroll_run` and `events: ["create"]`.
2. Trigger on the **December on-cycle run** — the run whose `salary_coverage.to` is in December, not the calendar month in which the run is created. For `THIRTEENTH_MONTH_PAYMENT`, trigger on the **first on-cycle run in November or December** so the 24 December deadline is actionable; a monthly December run can pay on 31 December. An "January run" that covers January is not the trigger: it is a month late for the 13th-month payment and its covered year is the new year. A December coverage run created or paid in January is the December run and is the correct trigger.
3. Key every annual duty by `entity_id` and the **covered year**: `CODE:<entity_id>:<YYYY>`, where `YYYY = salary_coverage.to.slice(0, 4)`. Add the same key to `reads.obligation` and guard the effect body. A second December run then skips.
4. Correct the reference sentence from "raised by the entity's daily calendar tick" to "raised once per covered year by the December on-cycle run; keyed by entity and covered year." The legal due date stays what it is.
5. AERW: the December run raises the task early (due 31 August of the following year). This is a reminder, not a filing; it is harmless. If the owner wants the task only when the window opens, the first on-cycle run in May of the following year can raise it with the covered year `run_year - 1`; that is a second convention and not worth the extra condition. Keep December for uniformity.

Residual gap: an entity with no December run raises nothing, even if it had employees earlier in the year. The references explicitly mention ended/short-tenure contracts at zero current headcount. Closing that gap needs a calendar hook. The only existing hook is the `ledger` automation on 1 January — already after the 24 December payment — and using it would put jurisdiction-specific annual-duty logic in code and duplicate the seed. Do not do that. Record the residual gap and accept it under the "existing mechanisms only" constraint.

### Field to declare

None.

### Test scenario

- A December 2026 on-cycle run for entity E, with no earlier November run, raises, with keys `...:E:2026`:
  - 13th-month pay due 2026-12-24
  - year-end adjustment due 2027-01-25
  - 1604-C due 2027-01-31
  - 2316 due 2027-01-31
  - substituted-filing list due 2027-02-28
  - 13th-month DOLE report due 2027-01-15
  - AERW due 2027-08-31
  - AEDR due 2027-01-30
  - AMR due 2027-03-31
- A second December run (semi-monthly) raises none.
- A December run in 2027 raises the 2027 keys, not the 2026 keys.

---

## 3. Occurrence keys for semi-monthly and 10-day runs

### Finding

The monthly, quarterly and annual effects key their obligations with `"CODE:" + ctx.entry.id`, where `ctx.entry` is the payroll run. Every run has a new id, so every semi-monthly or 10-day run in the same month/quarter/year creates a new obligation. The `reads` guard queries the same run-id key, so it never sees the earlier run's obligation. The `obligation.occurrence_key` unique constraint does not help because the keys differ.

### Legal position

The statutory period is the month, quarter or year, not the run:

- SSS contributions: monthly, due on or before the last day of the month following the applicable month (SSS Circular 2019-012; [SSS, Pay Contribution](https://www.sss.gov.ph/pay-contribution/)).
- PhilHealth premiums: monthly, within the 11th–15th or 16th–20th of the following month depending on the employer number ([PhilHealth, Pay Procedures](https://www.philhealth.gov.ph/partners/employers/pay_procedures.php)).
- Pag-IBIG contributions: monthly, by the employer-name window of the following month (HDMF Circular 275 §E).
- BIR 1601-C: monthly, on or before the 10th of the following month; December by the 15th ([BIR 1601-C guidelines](https://bir-cdn.bir.gov.ph/local/pdf/1601C%20final%20Jan%202018%20with%20DPA.pdf)).
- BIR 1603-Q: quarterly, not later than the last day of the month following the close of the quarter ([RR 11-2018 s.2.58(A)(2)(b)](https://bir-cdn.bir.gov.ph/local/pdf/RR%20No.%2011-2018.pdf)).
- BIR 1604-C, 2316, and the annual duties: yearly, as in section 2.

One remittance or return covers the period. Two half-month runs do not create two monthly duties.

### Decision

Replace the run id with the statutory period and the entity id:

| Effect family                                                                     | Key                          | Period expression                                                                               |
| --------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| SSS, PhilHealth, HDMF, 1601-C, SSS loan, Pag-IBIG loan                            | `CODE:<entity_id>:<YYYY-MM>` | `salary_coverage.to.slice(0, 7)`                                                                |
| 1603-Q                                                                            | `CODE:<entity_id>:<YYYY-Qn>` | `salary_coverage.to.slice(0, 4) + '-Q' + Math.ceil(Number(salary_coverage.to.slice(5, 7)) / 3)` |
| 1604-C, 2316, 2316 list, year-end, 13th month, 13th-month report, AERW, AEDR, AMR | `CODE:<entity_id>:<YYYY>`    | `salary_coverage.to.slice(0, 4)`                                                                |

Declare the same expression in `reads.obligation` and guard the effect body. Example:

```js
const to = ctx.entry.salary_coverage.to;
const key = 'SSS_CONTRIBUTION_REMITTANCE:' + ctx.entry.entity_id + ':' + to.slice(0, 7);
if (get(ctx, 'reads.obligation', []).some((o) => o.occurrence_key === key)) return [];
return [
	{
		entity_id: ctx.entry.entity_id,
		title: 'SSS contributions (SS, MPF, EC) for the month',
		due_on: month_end(add_months(to, 1)),
		occurrence_key: key
	}
];
```

```json
"reads": {
  "obligation": {
    "where": {
      "occurrence_key": {
        "eq": { "var": "\"SSS_CONTRIBUTION_REMITTANCE:\" + ctx.entry.entity_id + \":\" + ctx.entry.salary_coverage.to.slice(0, 7)" }
      }
    },
    "fields": ["id"],
    "limit": 10
  }
}
```

For 1603-Q, the existing condition `['03','06','09','12'].includes(month)` raises the task on the first run of the quarter's last month, before the quarter closes. The key still prevents duplicates, but the task is early. Tighten it to the quarter-end run if the owner wants the return raised on complete-quarter data: `month_end(to) === to` and the month is 03/06/09/12. This is a timing improvement, not required to fix the duplicate.

The key includes the entity id because `obligation.occurrence_key` is globally unique. Two entities in one workspace must not collide.

### Field to declare

None.

### Test scenario

- Entity E, semi-monthly. Create two on-cycle runs: 2026-11-01..15 and 2026-11-16..30.
- Expected: one SSS obligation with key `SSS_CONTRIBUTION_REMITTANCE:E:2026-11`, due 2026-12-31; one PhilHealth with key `...:E:2026-11`, due 2026-12-15; one HDMF due 2026-12-14; one 1601-C due 2026-12-10. The second run raises none.
- Two December runs (2026-12-01..15, 2026-12-16..31). Expected: one 1603-Q with key `BIR_1603Q_FRINGE_BENEFITS:E:2026-Q4`; one 1604-C and one 2316 with keys `...:E:2026`; the second run raises none.
- A 10-day schedule with three runs in a month behaves the same: one obligation per period, keyed by the period.

---

## 4. `JUST_CAUSE_TWIN_NOTICE` fires on every separation

### Finding

The effect condition is `status === 'SEALED' && effective_range.to !== null`. Every separation — resignation, end of contract, retirement, authorised cause, just cause — satisfies it and raises the twin-notice task. There is no fact that distinguishes a just-cause dismissal.

### Legal position

A dismissal for a just cause under Labor Code art. 297 requires two written notices. The first notice must state the specific grounds and the facts, and give the employee at least five calendar days from receipt to submit a written explanation. After the explanation and any hearing, the employer serves the second notice of termination. This is DOLE Department Order 147-15 s.5.1(a)–(c), and it is the procedure the Supreme Court enforces.

Authorised-cause termination is different: a written notice to the employee and the DOLE regional office at least 30 days before the effective date (Labor Code art. 298; DO 147-15 s.5.3). Resignation, end of contract and retirement are not dismissals and do not require the twin notice.

Source: [DOLE Department Order No. 147-15](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/71535).

The seed's reference cites "Labor Code art.292(b)", which is not the twin-notice provision. Correct it to art. 297 and DO 147-15 s.5.1(a).

### Decision

Add one jurisdiction fact and gate the effect on it.

**Field:** `employee_extension_data.just_cause_dismissal`, boolean, default `false`, in the PH `employee_extension_schema` (`seed/public/jurisdiction/PH/version_2/jurisdiction_settings.json`).

```json
"just_cause_dismissal": {
  "type": "boolean",
  "default": false,
  "title": "Dismissed for a just cause",
  "description": "Labor Code art.297 and DOLE Department Order 147-15 s.5.1: a dismissal for serious misconduct, willful disobedience, gross and habitual neglect, fraud or willful breach of trust, loss of confidence, commission of a crime, or an analogous cause. Raises the twin-notice reminder; it does not by itself prove that due process was observed."
}
```

**Condition:** `status === 'SEALED' && effective_range.to !== null && get(ctx.entry, 'employee_extension_data.just_cause_dismissal', false) === true`.

**Key:** `JUST_CAUSE_TWIN_NOTICE:<contract_id>`, with the reads guard from section 1.

Keep `AUTHORISED_CAUSE_TERMINATION_NOTICE` gated on `termination_cause` as it is. The two facts are mutually exclusive in practice: a just-cause dismissal has `termination_cause` null; an authorised cause has `just_cause_dismissal` false.

Retitle the task to "Serve the first written notice (notice to explain) for a just-cause dismissal". The current title "Twin-notice due process" implies both notices are covered. One task is enough as a reminder of the first notice; the second notice follows the hearing and is a human step. If the owner wants to track the second notice, add a second effect due on the last day, but that is extra noise and is not required for compliance.

Do **not** add a `JUST_CAUSE` value to `termination_cause`: that enum drives separation pay (just cause has no statutory separation pay; authorised causes pay under arts. 298–299) and would conflate two different legal regimes.

### Field to declare

`employee_extension_data.just_cause_dismissal` (boolean, default false). This is the only new field in this report.

### Test scenario

- Sealed contract, `effective_range.to = 2026-06-30`, `termination_cause: null`, `just_cause_dismissal: false`. Expected: no twin-notice obligation.
- Same contract with `just_cause_dismissal: true`. Expected: one `JUST_CAUSE_TWIN_NOTICE` due 2026-06-25 (five days before), keyed by the contract.
- Resignation or end of contract (`just_cause_dismissal: false`). Expected: no twin notice.
- Authorised cause (`termination_cause: 'REDUNDANCY'`). Expected: one `AUTHORISED_CAUSE_TERMINATION_NOTICE`, no twin notice.

---

## 5. NPC full breach report: 5 days, not 8

### Finding

`NPC_BREACH_FULL_REPORT` uses `lookup.due_days: 8` and `due_on: add_days(opened_on, 8)`. The reference says "three for the notice, five for the report". That adds the 72-hour notice to the 5-day report as if the report followed the notice.

### Legal position

NPC Circular 16-03:

- s.17(A): notify the Commission within seventy-two (72) hours upon knowledge of, or reasonable belief that, a personal data breach has occurred.
- s.17(C): "The full report of the personal data breach must be submitted within five (5) days, unless the personal information controller is granted additional time by the Commission to comply."
- s.18(A): notify the affected data subjects within 72 hours.

Source: [NPC Circular 16-03](https://privacy.gov.ph/wp-content/uploads/2022/01/sgd-npc-circular-16-03-personal-data-breach-management.pdf).

The circular's 5-day sentence does not name the start. NPC Advisory No. 2026-02 s.2(C) does: "the PIC shall submit its full breach report within five (5) days from the date of discovery to admindbnms@privacy.gov.ph". Source: [NPC Advisory No. 2026-02](https://privacy.gov.ph/wp-content/uploads/2026/05/Advisory-Clarification-on-the-Submission-of-Personal-Data-Breach-Notification-through-DBNMS_11-May-2026.pdf).

The NPC's breach-reporting page says "within five (5) days from notification", which is the Commission's summary wording ([NPC, Breach Reporting](https://privacy.gov.ph/pips-and-pics/breach-reporting/)). There is a real ambiguity:

- From discovery: the report is due on day 5. This is the 2026 advisory and s.20's five-day presumption ("Failure to notify shall be presumed if the Commission does not receive notification ... within five (5) days from knowledge").
- From notification: the report is due five days after the day-3 notice, i.e. day 8. This is the NPC page's summary.

The conservative date is **5 days from discovery**: filing by day 5 satisfies both readings; filing on day 8 is late under the advisory. The 72-hour notice and the 5-day report run **in parallel from the same knowledge date**; the report is not 72 hours + 5 days.

### Decision

- Set `NPC_BREACH_FULL_REPORT.lookup.due_days = 5` and `due_on = add_days(ctx.entry.opened_on, 5)`.
- Keep `NPC_BREACH_NOTIFICATION.lookup.due_days = 3` and `due_on = add_days(ctx.entry.opened_on, 3)`. The 3 calendar days are the date-only approximation of the 72-hour clock.
- Define `opened_on` for `PERSONAL_DATA_BREACH` as the date of knowledge/discovery, not the date the HR administrator recorded the case. If the case is opened later, the tasks are late; that is accurate.
- Correct the reference: remove "three for the notice, five for the report"; state that both clocks start at knowledge and the full report is due on the fifth day.
- Record the ambiguity and the chosen reading in the reference. If the owner prefers the NPC page's "from notification" reading, 8 days is the alternative; it is less conservative and conflicts with the 2026 advisory. Recommend 5.

The date-only model cannot represent the exact 72nd hour. The obligation's `due_on` is the last date; the UI should treat it as due by the end of that date. Do not invent an hour field.

### Field to declare

None.

### Test scenario

- `PERSONAL_DATA_BREACH` case opened 2026-11-03 (knowledge date).
- Expected: `NPC_BREACH_NOTIFICATION` due 2026-11-06; `NPC_BREACH_FULL_REPORT` due 2026-11-08, **not** 2026-11-11.
- A case opened on 2026-11-30: notification due 2026-12-03; full report due 2026-12-05.

---

## 6. Workplace-case tasks: `opened_on` vs `scheduled_on`

### Finding

The workplace-case effects use `opened_on` for the planned-start and request kinds; the event kinds use `occurred_on` with a fallback to `opened_on`. For duties that run from a planned future start, using `opened_on` makes the due date earlier than the statutory date. Example: a flexible work arrangement opened 2026-11-15 and starting 2026-12-01 gets a notice task due 2026-11-14, before the case was even opened. The task is falsely overdue.

`workplace_case_catalog_entry` already has `scheduled_on` ("Scheduled event date"), optional. No new field is needed.

### Legal position

| Kind / duty                                                                      | Statutory clock                                                                        | Source                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flexible work arrangement: notify the DOLE Regional Office before implementation | Prior to implementation; the 1-day lookup is a recorded buffer, not a statutory period | [DOLE Department Advisory No. 2, s. 2009, Part V](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/11/44022)                                                                          |
| Suspension of employment extension: report to the DOLE Regional Office           | 10 days prior to effectivity                                                           | [DOLE Department Order No. 215-20](https://bwc.dole.gov.ph/issuances/department-orders/); quoted in [Polintan v. Malabanan](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69619) |
| Telecommuting program: notify the DOLE through the Establishment Report System   | On implementation; no fixed advance period                                             | [Revised IRR of RA 11165, s.10](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/96745)                                                                                             |
| Solo parent flexible work schedule                                               | The employer shall provide it; no notice deadline                                      | [RA 8972 s.6](https://pcw.gov.ph/republic-act-8972-solo-parents-welfare-act-of-2000/)                                                                                                        |
| Certificate of employment                                                        | 3 days from the request                                                                | [DOLE Labor Advisory 06-20](https://www.dole.gov.ph/php_assets/uploads/2020/02/Labor-Advisory-No.-06-20-Guidelines-on-the-Payment-of-Final-Pay-and-Issuance-of-Certificate-of-Emplo.pdf)     |
| WAIR                                                                             | 20th day of the month following the accident, or when the illness is established       | [OSH Standards Rule 1053.01(1)](https://oshc.dole.gov.ph/wp-content/uploads/2020/02/OSH-Standards-2020-Edition.pdf)                                                                          |
| Serious accident notice                                                          | 24 hours after occurrence                                                              | OSH Standards Rule 1053.01(2)                                                                                                                                                                |
| Dangerous occurrence                                                             | Upon occurrence                                                                        | OSH Standards Rule 1053.02                                                                                                                                                                   |
| Personal data breach                                                             | 72 hours / 5 days from knowledge                                                       | NPC Circular 16-03 s.17                                                                                                                                                                      |

### Decision

Use the date the duty actually runs from:

- **Planned-start duties** — flexible work arrangement, suspension extension, telecommuting, solo parent schedule: `due_on = add_days(get(ctx.entry, 'scheduled_on', ctx.entry.opened_on), -advance_notice_days)`.
  - FWA: `advance_notice_days: 1` (recorded buffer; the statute says "prior to implementation").
  - Suspension extension: `advance_notice_days: 10` (statutory).
  - Telecommuting: `advance_notice_days: 0`; due on the implementation date.
  - Solo parent: `advance_notice_days: 0`; due on the schedule start; no statutory deadline.
- **Request/knowledge duties** — certificate of employment, personal data breach: keep `opened_on` (the request date or the knowledge date).
- **Event duties** — WAIR, serious accident, dangerous occurrence: keep `occurred_on` with the fallback to `opened_on`.

Add field help:

- `scheduled_on`: "The date a planned arrangement, program or extension takes effect. Notice deadlines that run before implementation use this date."
- `opened_on`: "The date the case, request or breach knowledge was received."
- `occurred_on`: "The date of the accident, or the date an occupational illness was established (diagnosed), not the date of first exposure."

No new field. If the owner wants to refuse a planned-start case without a `scheduled_on`, add a `registered_rule` for those four kinds; that is optional and not needed to fix the false due date.

### Field to declare

None; use `scheduled_on`, `opened_on` and `occurred_on` with the help text above.

### Test scenario

- FWA opened 2026-11-15, `scheduled_on = 2026-12-01`, `advance_notice_days = 1`. Expected: notice due 2026-11-30, not 2026-11-14.
- Suspension extension opened 2026-11-15, `scheduled_on = 2026-12-01`, `advance_notice_days = 10`. Expected: report due 2026-11-21, not 2026-11-05.
- Telecommuting opened 2026-11-15, `scheduled_on = 2026-12-01`. Expected: notice due 2026-12-01, not 2026-11-15.
- Certificate of employment opened 2026-11-15. Expected: due 2026-11-18 (`opened_on + 3`); `scheduled_on` is not used.
- WAIR accident `occurred_on = 2026-11-03`. Expected: due 2026-12-20 (`month_end + 20`).

---

## 7. Payslip gating for contribution, loan and 1603-Q tasks

### Finding

`SSS_CONTRIBUTION_REMITTANCE`, `PHILHEALTH_PREMIUM_REMITTANCE`, `HDMF_CONTRIBUTION_REMITTANCE`, `BIR_1603Q_FRINGE_BENEFITS`, `SSS_LOAN_REMITTANCE` and `PAGIBIG_LOAN_REMITTANCE` fire on every payroll run. A run of only `PAYEE` payslips, or a run with no fringe benefit tax, still raises the corresponding tasks. The current condition only checks whether the obligation already exists.

### Legal position

- SSS, PhilHealth and Pag-IBIG contributions are mandatory for covered employment. The employer is liable for its share and the employee's share; the duty is not contingent on a deduction line appearing on a payslip. If the payroll failed to deduct, the task is a useful signal, not noise. Gate on the **presence of the scheme** in the payslip, never on the amount. Sources: [RA 11199](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/86333) s.22(a); [PhilHealth employer reporting](https://www.philhealth.gov.ph/partners/employers/report.php); [HDMF Circular 275](https://web.archive.org/web/2020id_/https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20275%20-%20Implementing%20Guidelines%20on%20Employer%20Registration%20Contribution%20and%20Remittance.pdf) §E.
- Loan amortisations: the employer must remit what it deducted. If it deducted no loan instalment, there is no loan remittance duty. RA 11199 s.28(h) and HDMF Circular 275 §E.4. Gate on a loan deduction line.
- BIR 1603-Q: the quarterly return covers fringe benefit tax withheld. On these facts, if no FBT was withheld, no FBT return is due; if the owner prefers a nil return, do not gate. [RR 11-2018 s.2.58(A)(2)(b)](https://bir-cdn.bir.gov.ph/local/pdf/RR%20No.%2011-2018.pdf). Gate on the `FBT` statutory line.

So: gating is **optional noise reduction** for contributions (and must not gate on the amount); it is **required for correctness** for loan remittances and a defensible noise reduction for 1603-Q (unless a nil return is required), because the task would otherwise assert a duty that may not exist.

Residual risk: presence is a proxy. A payroll bug that omits a covered employee's scheme entirely would also omit the task; a zero line still raises it. If the owner wants no risk of hiding that bug, leave the contribution effects ungated and accept the `PAYEE`-only noise. The presence gate is the recommended middle ground; the engine's payroll tests remain the guard against a missing scheme.

### Decision

Add a `payslip` read to the affected effects, scoped to the run, and check `breakdown`:

```json
"reads": {
  "payslip": {
    "where": { "payroll_run_id": { "eq": "ctx.entry.id" } },
    "fields": ["breakdown"]
  }
}
```

Conditions:

- SSS: any payslip with a `breakdown.statutory` row whose `code` is `SSS`, `SSS_MPF` or `SSS_EC`. Presence, not amount.
- PhilHealth: any `PHIC` row. Presence.
- HDMF: any `HDMF` row. Presence.
- 1603-Q: any `FBT` row with `employee > 0` or `employer > 0`.
- SSS loan: any `breakdown.lines` row with `source === 'loan_catalog_entry_repayment'`, `direction === 'DEDUCT'` and `amount > 0`.
- Pag-IBIG loan: any `breakdown.lines` row with `source === 'loan_catalog_entry_repayment'`, `direction === 'DEDUCT'`, `amount > 0`, and a `code` starting `LOAN_RECOVERY_PAGIBIG`. The current title also says "voluntary savings deducted", but the PH loan catalog has no voluntary-savings line; drop that phrase or add a line in a future catalog, out of scope here.

The `payslip` rows are committed with the run before the `created` effect runs, so the read sees them. The `batchRead` gathers the run ids into one query.

Leave `BIR_1601C_MONTHLY_REMITTANCE` as it is. Whether a nil 1601-C is required is a separate BIR question; do not gate it on `WTAX > 0` without checking the nil-return rule. The audit did not ask for it.

### Field to declare

None.

### Test scenario

- Run with only `PAYEE` payslips, no statutory rows and no loan repayment. Expected: no SSS, PhilHealth, HDMF, loan or 1603-Q obligations.
- Run with a covered employee and a synthetic zero SSS line (`breakdown.statutory` has `SSS` with 0). Expected: the SSS obligation is still raised; the gate is presence, not amount.
- Run with a loan deduction line. Expected: one SSS or Pag-IBIG loan obligation, matching the loan family.
- Run with only a loan reversal (`direction: 'ADD'`) and no deduction. Expected: no loan remittance obligation; the reversal is a refund, not a remittance.
- Run with `FBT > 0`. Expected: one 1603-Q obligation. Run with no FBT. Expected: none, unless the owner requires a nil return.

---

## 8. WAIR illness date: `occurred_on` or `opened_on`

### Finding

`DOLE_WORK_ACCIDENT_REPORT` computes `due_on = add_days(month_end(get(ctx.entry, 'occurred_on', ctx.entry.opened_on)), 20)`. The formula is the 20th of the month following the date in the field. The question is which date `occurred_on` holds for an occupational illness.

### Legal position

OSH Standards Rule 1053.01(1): the employer's work accident/illness report (WAIR, form DOLE/BWC/HSD-IP-6) "shall be submitted ... on or before the 20th day of the month following the date of occurrence of the accident or when the illness is established."

For an occupational illness, the clock therefore runs from the date the illness is **established** — the diagnosis or the point at which it is recognized as an occupational illness — not from the first exposure. If HR records the exposure date in `occurred_on`, the task is early and falsely overdue. The rule also sets the 24-hour initial notice for death or permanent total disability "after occurrence" (Rule 1053.01(2)); for an occupational illness that ends in death or permanent total disability, the establishment date is the occurrence date for this purpose.

Source: [OSH Standards 2020 Edition](https://oshc.dole.gov.ph/wp-content/uploads/2020/02/OSH-Standards-2020-Edition.pdf), Rule 1053.

### Decision

No new field.

- Keep the expression `occurred_on ?? opened_on`.
- Define `occurred_on` for `WORK_ACCIDENT` as the accident date, or the date the occupational illness was established. Never the first exposure date.
- If the establishment date is not known when the case is created, leave `occurred_on` blank and set `opened_on` to the date it was established. The fallback uses `opened_on`.
- Add help text to `occurred_on` and `opened_on` as in section 6.
- Apply the same convention to `DOLE_SERIOUS_ACCIDENT_NOTICE` and `DOLE_DANGEROUS_OCCURRENCE_REPORT`. For an occupational illness, the 24-hour notice runs from the establishment date, not the exposure.

A separate `exposed_on` field is not needed. If the owner later wants to record exposure for EPI/compensation purposes, that is a different field with a different purpose; do not overload the WAIR clock.

### Field to declare

None; `occurred_on` and `opened_on` with the help text above.

### Test scenario

- Occupational illness: `occurred_on` null, `opened_on = 2026-12-10` (date established). Expected: WAIR due 2027-01-20 (`month_end(2026-12-10) + 20`), not 2026-12-20.
- Accident: `occurred_on = 2026-11-03`, `opened_on = 2026-11-05`. Expected: WAIR due 2026-12-20, not 2027-01-20.
- Serious accident with `occurred_on = 2026-11-03`, severity `DEATH`. Expected: 24-hour notice due 2026-11-04.

---

## Implementation notes

- Apply the data changes to `seed/public/jurisdiction/PH/version_2/` — the current sealed PH seed. Do not rewrite `version_1` (the 2025-12-01..2026-01-05 historical version). A live tenant that already holds version_2 sealed rows keeps them; a source seed edit reaches new tenants and resets. To reach a live tenant without a reset, publish a new jurisdiction version (version_3) through the normal statutory-materialization path.
- The 27-effect fix is mechanical but must be applied to every one of the 27, including the eight `entity_profile_version` effects. A partial fix leaves some registration or exit duties dead.
- Keep the `PH:` prefix out unless the owner wants to match MY/SG style. The existing PH keys have no prefix; `CODE:<subject_id>[:period]` is already globally unique. Adding `PH:` is cosmetic and not required.
- The unique `occurrence_key` is global. Every period key must include `entity_id`; every person key must include `employee_id`. A key that omits both will collide across entities or people.
- The `reads` guard uses `get(ctx, "reads.obligation", [])`, not `ctx.reads.obligation.length`, so an effect with an empty reads declaration cannot throw. This is the MY/SG idiom.
- Do not add a daily/calendar dispatcher, a `seal` event, or a new helper module for this audit. The `daily`/`calendar` enum values are unused; the existing `create,update` pattern is the supported mechanism.

## Sources

| Source                                                                                                                                                                                                                                              | Used for                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [SSS, Employers](https://www.sss.gov.ph/employer-er/)                                                                                                                                                                                               | R-1A within 30 days of hiring                       |
| [SSS, Pay Contribution](https://www.sss.gov.ph/pay-contribution/)                                                                                                                                                                                   | Monthly SSS remittance deadline                     |
| [PhilHealth, Reporting Your Employees](https://www.philhealth.gov.ph/partners/employers/report.php)                                                                                                                                                 | ER2 within 30 days                                  |
| [PhilHealth, Pay Procedures](https://www.philhealth.gov.ph/partners/employers/pay_procedures.php)                                                                                                                                                   | Monthly premium window                              |
| [HDMF Circular 275](https://web.archive.org/web/2020id_/https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20275%20-%20Implementing%20Guidelines%20on%20Employer%20Registration%20Contribution%20and%20Remittance.pdf) | Pag-IBIG registration and remittance                |
| [HDMF Circular 365](https://web.archive.org/web/20211228231909id_/https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/Circular%20No.%20365%20-%20Amended%20HDMF%20Circular%20No.%20275%20on%20the%20Registration%20of%20Employers.pdf)  | Amended Pag-IBIG employer registration, 30 days     |
| [RR 11-2018](https://bir-cdn.bir.gov.ph/local/pdf/RR%20No.%2011-2018.pdf)                                                                                                                                                                           | BIR 1902, 1604-C, 2316, year-end adjustment, 1603-Q |
| [BIR 1604-C guidelines](https://bir-cdn.bir.gov.ph/local/pdf/1604-C%20Jan%202018%20Final.pdf)                                                                                                                                                       | 1604-C and alphalist, 31 January                    |
| [BIR Taxpayer's Guide](https://bir-cdn.bir.gov.ph/BIR/pdf/TAX%20GUIDE%20FOR%20OFW%20AS%20OF%201120.pdf)                                                                                                                                             | 1604-C on or before 31 January                      |
| [BIR 1601-C guidelines](https://bir-cdn.bir.gov.ph/local/pdf/1601C%20final%20Jan%202018%20with%20DPA.pdf)                                                                                                                                           | Monthly 1601-C, 10th/15th                           |
| [DOLE Labor Advisory 06-20](https://www.dole.gov.ph/php_assets/uploads/2020/02/Labor-Advisory-No.-06-20-Guidelines-on-the-Payment-of-Final-Pay-and-Issuance-of-Certificate-of-Emplo.pdf)                                                            | Final pay 30 days; COE 3 days                       |
| [DOLE Labor Advisory 16-25](https://bwc.dole.gov.ph/wp-content/uploads/2025/12/Labor-Advisory-No.-16-25-Guidelines-on-the-Payment-of-the-Thirteenth-Month-Pay.pdf)                                                                                  | 13th-month pay 24 December; report 15 January       |
| [NWPC 2025 AERW FAQs](https://nwpc.dole.gov.ph/2025-aerw-faqs/)                                                                                                                                                                                     | AERW window and 31 August closing                   |
| [Labor Advisory 08-26](https://nwpc.dole.gov.ph/wp-content/uploads/2026/05/Labor-Advisory-No.-08-26-2025-Annual-Establishment-Report-on-Wages-AERW-1.pdf)                                                                                           | 2025 AERW, 15 May–31 August 2026                    |
| [OSH Standards 2020](https://oshc.dole.gov.ph/wp-content/uploads/2020/02/OSH-Standards-2020-Edition.pdf)                                                                                                                                            | Rules 1053.01, 1053.02, 1054(2), 1965.01(4)         |
| [DOLE Department Order 147-15](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/71535)                                                                                                                                                    | Twin notice, authorised cause notice                |
| [DOLE Department Advisory 2, s. 2009](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/11/44022)                                                                                                                                             | Flexible work arrangement prior notice              |
| [DOLE Department Order 215-20](https://bwc.dole.gov.ph/issuances/department-orders/) and [Polintan v. Malabanan](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69619)                                                                   | Suspension extension, 10 days prior                 |
| [Revised IRR of RA 11165](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/96745)                                                                                                                                                          | Telecommuting notice                                |
| [RA 8972](https://pcw.gov.ph/republic-act-8972-solo-parents-welfare-act-of-2000/)                                                                                                                                                                   | Solo parent flexible schedule                       |
| [RA 11199](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/86333)                                                                                                                                                                         | SSS contributions and loan remittance               |
| [NPC Circular 16-03](https://privacy.gov.ph/wp-content/uploads/2022/01/sgd-npc-circular-16-03-personal-data-breach-management.pdf)                                                                                                                  | Breach notification and full report                 |
| [NPC Advisory 2026-02](https://privacy.gov.ph/wp-content/uploads/2026/05/Advisory-Clarification-on-the-Submission-of-Personal-Data-Breach-Notification-through-DBNMS_11-May-2026.pdf)                                                               | Full report 5 days from discovery                   |
| [NPC, Breach Reporting](https://privacy.gov.ph/pips-and-pics/breach-reporting/)                                                                                                                                                                     | The "from notification" alternative reading         |

## Implementation status (2026-11-09)

- Applied in `seed/public/jurisdiction/PH/version_2/registered_effect.json`:
  - employee registrations keyed by `employee_id`, employer registrations by `entity_id`, contract duties by contract id, each with an `obligation` reads guard;
  - exit effects listen to `create,update` and are keyed by contract;
  - remittance effects read the run's payslips and gate on scheme/loan/FBT presence, never amount;
  - `PAYEE` is excluded from the PH SSS/SSS_MPF/SSS_EC/PHIC/HDMF contribution rows.
- `just_cause_dismissal`, NPC 5 days, `scheduled_on` planned duties, WAIR `occurred_on ?? opened_on`, and annual duty keys were already present in version_2; source inspection only.
- **Implemented:** an exit is read from the contract chain: the contract's write raises `exit` when an ended version has no same-jurisdiction successor, or when its date moves or a successor cancels it. The six exit effects run on `employee_contract` `exit`, keyed by the employment and exit date; the dependants routine (`src/lib/dependants.ts`) waives the open ones of a moved or cancelled exit. A pay-bump pair raises no exit duty. The pay-bump pair regression test is in `tests/statute_ph_id.test.ts`.

## Seed round 3 (2026-11-10)

- `ANNUAL_LEAVE` (versions 1 and 2) is encashable: `payout` = the day rate × the days (Labor Code art.95; Omnibus Rules
  Book III Rule V s.5: unused service incentive leave is commutable to cash), paid in `ADDITIONAL_WAGES`, the other-benefits
  pool (NIRC s.32(B)(7)(e)). The exit automation now raises it for HR approval. `ANNUAL_LEAVE_DOMESTIC` stays without one
  (RA 10361 s.29: not convertible to cash); paternity, VAWC, solo-parent and special leave for women are not convertible
  by their own Acts.
- Every other leave row's share stands against its statute: no statute pays medical, emergency, compassionate or
  hospitalisation leave (`paid_share` 0; an employer that pays them sets its own row in Settings); maternity leave is
  paid by the SSS benefit and salary differential adhoc rows (RA 11210 s.5), its extension is unpaid (s.3).
- `NIGHT_SHIFT_DIFFERENTIAL` (versions 1 and 2) reads `pay_methods.night_differential_basis`: `CLOCK_SPAN` pays 10% of the
  ordinary hour on the whole clocked night span, never below art.86 per shift.
- Open: the absence deduction. The DOLE daily rate (monthly × 12 ÷ 313/261, `ctx.day_rate`) is the day an absence
  takes; `conversions.proration` offers only `CALENDAR_DAYS` and `WORKING_DAYS`, so the run deducts the half's
  working-days share (₱601.92 against ₱600 on a 13-day half at ₱15,650). Waiting on the owner.
