# ID compliance gap research

Research date: 2026-11-09. Scope: the ID jurisdiction seed in `seed/public/jurisdiction/ID/version_3/` and the HRMS mechanisms named in the brief (`payroll_run`, `obligation`, registered rules/effects, catalog lookup/conversion, reads). This document proposes no engine change. Where a gap is really an engine defect, it is called out and left outside the rule fix.

## 0. Period model: `period` is not the legal period

`payroll_run.period` is one of:

- `YYYY-MM` for `MONTHLY` and `INTEGER_MONTHS`;
- `YYYY-MM-N` for `SEMI_MONTHLY` (`N` = 1, 2) and `TEN_DAY` (`N` = 1, 2, 3).

`src/lib/payroll_engine/pay_cycle.ts` builds those keys in `cyclesIn`. For `TEN_DAY`, `PARTS = [10, 20]`, so the keys are `YYYY-MM-1` (days 1–10), `YYYY-MM-2` (11–20), `YYYY-MM-3` (21–month end).

The annual effects currently test `ctx.entry.period.endsWith('-01')` or `'-12'`. That only matches `MONTHLY` (`2026-01`, `2026-12`). It never matches `2026-01-1` or `2026-12-2`. The fix is not to add suffix variants. The fix is to read `ctx.entry.salary_coverage`, which is the actual paid window and is the same shape for every frequency.

Use:

```js
const month = ctx.entry.salary_coverage.from.slice(0, 7); // YYYY-MM
const year  = ctx.entry.salary_coverage.from.slice(0, 4); // YYYY
```

Do not key an annual obligation on `ctx.entry.period`. The occurrence key must collapse all parts of the month and all repeated runs of the same year:

```js
occurrence_key(['ID', code, ctx.entry.entity_id, year])
```

That gives one obligation per entity per year, whatever the frequency or part count.

Known limitation of this event-driven design: if the employer runs no payroll with coverage in the target month, no obligation is raised. A scheduler or a “first run after the target month” fallback is a separate feature; it is not needed to fix the frequency bug.

---

## 1. Annual/January effects never fire for `SEMI_MONTHLY` and `TEN_DAY`

### Legal position

| Effect | Legal cadence | Source |
| --- | --- | --- |
| `PPH21_BPA1_YEAR_END` | Annual BPA1 for employees still employed at year end; due one month after December. A leaver's BPA1 is the separate `PPH21_BPA1_EXIT` (gap 2) | PER-11/PJ/2025 art.7(1)(e)–(g), (2), (4); PMK 168/2023 art.21(1). https://jdih.kemenkeu.go.id/dok/per-11pj2025 ; https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf |
| `PTKP_STATUS_ANNUAL` | PTKP is determined by circumstances at the beginning of the calendar year (or the first month of a new resident) | PMK 168/2023 art.9(4)–(5). Same PMK URL |
| `MINIMUM_WAGE_COMPLIANCE` | Minimum wage is adjusted every year and the new provincial rate takes effect 1 January | PP 36/2021 art.26(1), art.29(3), as amended by PP 49/2025. https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf ; https://jdih.kemnaker.go.id/asset/data_puu/2025pp049.pdf |
| `DISABILITY_QUOTA_REVIEW` | Private companies must employ at least 1% persons with disabilities. The statute sets a continuous quota, not an annual filing | UU 8/2016 art.53(2). https://peraturan.bpk.go.id/Details/37251/uu-no-8-tahun-2016 |
| `K3_SMK3_P2K3` | SMK3 applies at ≥100 workers or high hazard; P2K3 must be formed at the same threshold and its activity report is every 6 months | PP 50/2012 art.5(2). https://peraturan.bpk.go.id/Details/5263/pp-no-50-tahun-2012 ; Permenaker 13/2025 art.3(2), art.11(1). https://jdih.kemnaker.go.id/peraturan/detail/2788/peraturan-menteri-ketenagakerjaan-nomor-13-tahun-2025 |
| `WORKER_HEALTH_EXAMINATION` | Periodic health examination at least once a year | Permenakertrans PER.02/MEN/1980 art.3(2). https://jdih.kemnaker.go.id/asset/data_puu/1980PermenakertransPER2MEN%20.pdf |
| `WAGE_STRUCTURE_SCALE` | Employer must compile and apply a wage structure and scale, and notify each worker of the scale for their job group. No annual review is prescribed | PP 36/2021 art.21(1)–(3). https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf |
| `TAX_RECORDS_RETENTION` | Books, records and supporting documents must be kept 10 years. This is a standing retention rule, not an annual return | UU KUP (UU 28/2007) art.28(11). https://www.pajak.go.id/id/undang-undang-nomor-28-tahun-2007 |

Notes that matter:

- **`K3_SMK3_P2K3` cites a revoked regulation.** The seed cites Permenaker PER.04/MEN/1987. That regulation was revoked by Permenaker 13/2025 (dated 17 November 2025, promulgated 19 November 2025; in force November 2025). Permenaker 13/2025 art.3(2) keeps the ≥100/high-risk threshold. P2K3 activity reporting is every 6 months under art.11(1), not January annually. Update the reference regardless of what is decided about the trigger. The 6-month P2K3 report is not modelled by `K3_SMK3_P2K3`; if the product tracks it, that is a separate registered effect, not part of the trigger fix.
- **`DISABILITY_QUOTA_REVIEW` has a non-statutory threshold.** UU 8/2016 art.53(2) says 1%, not “100 employees”. The seed's `employee_count_threshold: 100` is a rounding convention (1% of 100 = one person), not statutory text. Keep it as a declared assumption, or compute the duty from the actual PWD headcount; do not present 100 as the statutory threshold.
- **`TAX_RECORDS_RETENTION` has no annual due date.** A January task is legally meaningless.
- **`WORKER_HEALTH_EXAMINATION` is per worker.** The statute requires each worker to be examined at least once a year; an entity-level January task is a programme reminder, not the legal due date for each person.

### Engineering decision

Replace the `endsWith` conditions with coverage-month conditions and year-based keys.

| Effect | New condition (conceptually) | Key | Due |
| --- | --- | --- | --- |
| `PPH21_BPA1_YEAR_END` | `salary_coverage.from.slice(0,7) === taxYear + '-12'` | `['ID', code, entity, taxYear]` | `month_end(add_months(taxYear + '-12-01', 1))` = 31 January next year |
| `PTKP_STATUS_ANNUAL` | `salary_coverage.from.slice(0,7) === year + '-01'` | `['ID', code, entity, year]` | `year + '-01-01'` (status date) |
| `MINIMUM_WAGE_COMPLIANCE` | same January condition | `['ID', code, entity, year]` | `year + '-01-01'` |
| `DISABILITY_QUOTA_REVIEW` | same January condition | `['ID', code, entity, year]` | `month_end(year + '-01-01')` = 31 January |
| `WORKER_HEALTH_EXAMINATION` | same January condition | `['ID', code, entity, year]` | `month_end(year + '-01-01')` = 31 January |
| `K3_SMK3_P2K3` | first run where the threshold is met and no entity obligation exists | `['ID', code, entity]` | run `salary_coverage.to` |
| `WAGE_STRUCTURE_SCALE` | first run for the entity (no entity obligation exists) | `['ID', code, entity]` | run `salary_coverage.to` |
| `TAX_RECORDS_RETENTION` | delete the effect | — | — |

Due-date labels: only BPA1 (31 January after the tax year) and the minimum-wage effective date (1 January) come from the statute. The PTKP 1 January date is the statutory status date, not a filing deadline. The 31 January dates for disability and health are internal review dates; do not present them as statutory filing deadlines. WLKP's anniversary month comes from UU 7/1981, but its month-end day is an administrative convention.

Why these choices:

- **BPA1 stays on December coverage.** A December run created in January still has December coverage, so the task is raised for the right tax year. The task is due 31 January; raising it on the first December part is early but harmless. If you prefer “last part of December”, require `salary_coverage.to === month_end(salary_coverage.from)`; that can miss the task if the last part is never run, so it is not recommended.
- **The other annual duties use January coverage, any part.** That is the first run that can carry the new year's status. It works identically for one, two or three parts.
- **K3 and wage structure are one-time, not annual.** K3 is triggered by the headcount/hazard threshold; the wage structure must exist and be applied from the start (and be attached to company-regulation/collective-agreement applications), not on a January calendar. A one-time entity key also avoids a false “annual filing” signal. If the product wants a periodic K3 review, add it as a separate internal review, not as `K3_SMK3_P2K3`.
- **Tax retention is deleted.** The 10-year rule is satisfied by keeping the records; an annual task adds noise and implies a filing that does not exist. If a reminder is required, make it a one-time entity setup task.

### Fact/field to declare

None new. The facts are already in `payroll_run.salary_coverage`, `payroll_run.period`, `payment_schedule`, and the existing extension fields. For K3, the existing `entity_extension_data.k3_high_hazard` and headcount from sealed contracts are the facts. For disability, the existing headcount from sealed contracts is the fact; the 1% ratio is the rule.

### Test

Obligation-level, no payroll amount. Fixtures meet the K3/disability thresholds where those effects are asserted.

- `SEMI_MONTHLY` January 2026, runs `2026-01-1` and `2026-01-2`: exactly one `PTKP_STATUS_ANNUAL`, one `MINIMUM_WAGE_COMPLIANCE`, one `DISABILITY_QUOTA_REVIEW`, one `WORKER_HEALTH_EXAMINATION`; none duplicated by the second part.
- `TEN_DAY` January 2026, runs `2026-01-1`, `-2`, `-3`: the same four obligations, once each.
- `TEN_DAY` December 2026, runs `2026-12-1`, `-2`, `-3`: exactly one `PPH21_BPA1_YEAR_END` with tax year 2026 and due 2027-01-31.
- `K3_SMK3_P2K3` and `WAGE_STRUCTURE_SCALE`: exactly one entity obligation across all parts and years; no second obligation on a later run.
- `TAX_RECORDS_RETENTION`: no obligation is created.

No payroll-amount test is needed here: these effects create reminders. The substantive floor/tax calculations are separate and already covered by `tests/minimum_wage.test.ts` and `tests/pph21_year_end.test.ts`. A pay-bump scenario belongs to `MINIMUM_WAGE_FLOOR` (a contract update at/under the new floor), not to this reminder.

---

## 2. December leaver gets two BPA1 tasks

### Legal position

A BPA1 is issued **per recipient, per tax object code, per tax year or part of a tax year**. For an employee who stops working in December, December is the last tax period; the BPA1 for that employee is the annual BPA1. There is no second annual BPA1 for the same employee and year.

Sources: PER-11/PJ/2025 art.7(1)(e)–(g), art.7(2), art.7(4). https://jdih.kemenkeu.go.id/dok/per-11pj2025 ; PMK 168/2023 art.21(1) and the Lampiran examples for a leaver. https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf

### Engineering decision

**Do not suppress the annual effect.** The two obligations are different things:

- `PPH21_BPA1_EXIT` is employee-scoped (`employee_id` and `employment_id` set). It is the leaver's one BPA1.
- `PPH21_BPA1_YEAR_END` is entity-scoped (`employee_id` null). It is a batch reminder for the employees who remain employed at year end.

Suppressing the annual task because one employee left in December would hide the batch task for everyone else. The real defect is the title: “Bukti potong 1721-A1 (BPA1) for the tax year” reads like a form for every employee, including the leaver. Rename it to a batch task, for example “BPA1 batch for the tax year — leavers are covered by their exit task”.

If the product ever changes `PPH21_BPA1_YEAR_END` to create per-employee obligations, then exclude employees who already have a `PPH21_BPA1_EXIT` for December, and exclude `PAYEE` (gap 3). That is the only case where suppression is correct. Do not add that exclusion to the current entity-level effect.

### Fact/field to declare

Existing `employee_extension_data.termination_cause` and `effective_range.to` are the facts that make someone a leaver. No new field.

### Test

Reuse `tests/pph21_year_end.test.ts`.

- Input: the existing `pph21_year_end` fixture (the 12-month Rp10,000,000 + JHT/JP/JKK/JKM/Kesehatan case) with an exit on 2026-12-31.
- Expected: December PPh 21 settlement is unchanged at **501,475** (the existing test's figure); exactly one employee-scoped `PPH21_BPA1_EXIT` for the person; exactly one entity-scoped `PPH21_BPA1_YEAR_END`; no second employee-scoped BPA1.
- A leaver in June must also keep the December entity batch task; only the June employee task belongs to them.

This is a documentation/obligation test, not a new payroll formula.

---

## 3. PAYEE contracts raise employee statutory duties

### Legal position

`PAYEE` is defined by the model as “paid without employment (a commission agent), outside the headcount and separations” (`src/data/model/employee_profile/employee_contract/+model.ts`). In tax terms that is a **Bukan Pegawai**, not a Pegawai Tetap or Pegawai Tidak Tetap:

- PMK 168/2023 definitions 9–12 (Pegawai, Pegawai Tetap, Pegawai Tidak Tetap, Bukan Pegawai); art.12(3) taxes a Bukan Pegawai on 50% of gross. https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf
- PER-11/PJ/2025 art.7(1)(c): a non-employee receives Formulir BP21, not BPA1. https://jdih.kemenkeu.go.id/dok/per-11pj2025

The employee duties in the seed attach to an employment relationship:

- BPJS Ketenagakerjaan: employer must register its **Pekerja** within 30 days (PP 45/2015 art.4(1)–(2) for JP; PP 44/2015 arts.6–7 for JKK/JKM/JHT). https://www.bpjsketenagakerjaan.go.id/assets/uploads/peraturan/15122015_104556_PP%2045%20Tahun%202015.pdf ; https://www.bpjsketenagakerjaan.go.id/assets/uploads/peraturan/15122015_104557_PP%2044%20Tahun%202015.pdf (the same official files the seed uses). A genuinely self-employed payee is a Pekerja Bukan Penerima Upah (BPU), not an employer-registered Pekerja Penerima Upah; if they are a worker in substance, the engagement is misclassified.
- BPJS Kesehatan: employer-registered workers are Pekerja Penerima Upah under Perpres 82/2018 arts.13–14, 17. https://jdih.kemenkeu.go.id/api/download/FullText/2018/82TAHUN2018PERPRES.pdf
- JKP: an employment-relationship benefit for a PHK (PP 37/2021 art.20 as amended by PP 6/2025). A PAYEE has no PHK. https://jdih.kemnaker.go.id/asset/data_puu/PP372021.pdf
- Wage-scale notice: PP 36/2021 art.21(2) says “seluruh Pekerja/Buruh”. A PAYEE is not a Pekerja/Buruh. https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf
- Pre-employment health examination: PER.02/MEN/1980 art.2(2) applies to “tenaga kerja” received by the company. A genuine non-employee is outside; a payee working on site under the company's control is a K3 risk that should be assessed separately. https://jdih.kemnaker.go.id/asset/data_puu/1980PermenakertransPER2MEN%20.pdf
- PKWT registration/compensation and termination report: these presuppose a PKWT/employment relationship (UU 13/2003 art.57; PP 35/2021). A commission-agent agreement is not a PKWT. https://jdih.kemnaker.go.id/peraturan/detail/27/undang-undang-nomor-13-tahun-2003
- BPA1 exit: a Bukan Pegawai gets BP21, not BPA1 (PER-11/PJ/2025 art.7(1)(c)). https://jdih.kemenkeu.go.id/dok/per-11pj2025

The payroll engine already implements the tax/BPJS side: the ID statutory catalog excludes `engagement === 'PAYEE'` from JKK/JKM/JHT/JP/Kesehatan/JKP and applies `PPH21_BUKAN_PEGAWAI` instead. So this gap is in the **obligation effects**, not the payroll amounts.

### Engineering decision

Add the same guard to the employee-duty effects sourced from `employee_contract`:

```js
if (ctx.entry.engagement === 'PAYEE') return false;
```

Apply it to:

- `BPJS_KETENAGAKERJAAN_REGISTRATION`
- `BPJS_KESEHATAN_REGISTRATION`
- `PTKP_STATUS_AT_HIRE`
- `PKWT_REGISTRATION`
- `PPH21_BPA1_EXIT`
- `JKP_PHK_NOTIFICATION`
- `TERMINATION_REPORT`
- `PKWT_TERM_END_COMPENSATION`
- `WAGE_SCALE_NOTICE_AT_HIRE`
- `BPJS_KETENAGAKERJAAN_WAGE_CHANGE`
- `BPJS_KETENAGAKERJAAN_EXIT_REPORT`
- `BPJS_KETENAGAKERJAAN_FAMILY_DATA_CHANGE`
- `PRE_EMPLOYMENT_HEALTH_EXAMINATION`

Do **not** apply it to:

- `PERSONAL_DATA_DISPOSAL` — a payee is still a data subject.
- `PPH21_BUKAN_PEGAWAI` / the payroll tax catalog — withholding still applies.
- `FOREIGN_WORKER_RPTKA_DKPTKA` and `FOREIGN_WORKER_COMPANION_TRAINING` without separate review: a foreign payee's immigration/permit regime is not the same as an employment duty. This is an open question, not a blanket exemption.

`PTKP_STATUS_AT_HIRE` is the awkward one: its title combines PTKP and tax identity. PTKP is employee-only; tax identity is needed for the BP21 too. Minimal choice: exclude PAYEE from the PTKP effect and rely on the payroll engine's `tax_id_validated` / missing-tax-id multiplier for tax identity. If a visible tax-identity task is required, split the effect into a tax-identity obligation for all engagements and a PTKP obligation for employees. Do not leave the current title on a payee task.

Do not broaden the guard to `CONSULTANT` in this change. The payroll engine currently excludes only `PAYEE`; broadening the effects while the engine still treats `CONSULTANT` as an employee for BPJS/PPh 21 would make the system inconsistent. Treat `CONSULTANT` as a separate classification review.

### Fact/field to declare

The existing `engagement` enum is the declaration. `PAYEE` is only valid if there is genuinely no employment relationship: no control over hours/place/method, no integration into the payroll headcount, no employment benefits. If those facts are present, the person is an employee and the duties apply; the field must not be used to opt out. The existing help text on `engagement` already says this in substance; keep it.

### Test

- Create a `PAYEE` contract with `termination_cause`, an exit date, a signed term, and a pre-employment exam date: no BPJS registration, no PTKP task, no wage-scale notice, no BPA1 exit, no JKP/termination/PKWT/health-exam obligations.
- Pay a Rp10,000,000 commission in a whole-month run: no JKK/JKM/JHT/JP/Kesehatan lines; `PPH21_BUKAN_PEGAWAI` = **250,000** (50% × 10,000,000 × 5%, the engine's current bracket), net **9,750,000**. This is an engine regression figure, not a new statutory calculation.
- A `PERSONAL_DATA_DISPOSAL` still appears for the payee on exit.

---

## 4. `PKWT_WRITTEN_INDONESIAN` skips when the boolean is absent

### Legal position

UU 13/2003 art.57:

- (1) A fixed-term employment agreement (PKWT) must be made in writing and must use the Indonesian language and Latin script.
- (2) A PKWT made orally is a PKWTT (permanent).
- (3) If the agreement is in Indonesian and a foreign language, the Indonesian version prevails on differences.

Source: https://jdih.kemnaker.go.id/peraturan/detail/27/undang-undang-nomor-13-tahun-2003

The statute does not create a “missing field” exception. If the signed PKWT is not evidenced as Indonesian, the compliance fact is not established.

### Engineering decision

Change the rule to fail closed:

Current condition:

```js
return get(ctx.entry, 'employee_extension_data.written_in_indonesian', null) != null;
```

New condition: remove the field-presence test; return true for every employee-like fixed-term contract. New validate:

```js
return get(ctx.entry, 'employee_extension_data.written_in_indonesian', null) === true;
```

That makes absent and `false` both fail. Keep `signed_contract_period.to != null` as the fixed-term test and the engagement whitelist as it is.

Do not make the field `required` in the JSON Schema. The schema cannot see `signed_contract_period`, so a global required flag would also block permanent contracts. The registered rule is the correct conditional gate.

Update the field help text: “Declare true only if the signed PKWT is in Indonesian and Latin script. A bilingual agreement is acceptable only if the Indonesian version governs (UU 13/2003 art.57(3)).”

### Fact/field to declare

Existing `employee_extension_data.written_in_indonesian` (boolean). No new field.

### Test

- Fixed-term contract, `written_in_indonesian` absent → `PKWT_WRITTEN_INDONESIAN` validate false; create/update refused.
- Fixed-term contract, `written_in_indonesian: true` → accepted.
- Fixed-term contract, `written_in_indonesian: false` → refused.
- Permanent contract (`signed_contract_period.to == null`) with the field absent → rule not applicable, accepted.

No payroll-amount test; this is a contract gate.

---

## 5. `WORK_ACCIDENT_REPORT` can be created with a null due date

### Legal position

PP 44/2015 art.43(1)–(2): the employer must report a work accident or occupational disease to BPJS Ketenagakerjaan and the local labour office; the stage I report is due within **2 × 24 hours** from the accident or diagnosis.

Source: https://www.bpjsketenagakerjaan.go.id/assets/uploads/peraturan/15122015_104557_PP%2044%20Tahun%202015.pdf (official PP 44/2015 PDF; the seed uses the same file).

A leave entry with no dated slot has no accident date. There is no lawful way to set the 2 × 24-hour deadline, and a null `due_on` hides the breach.

### Engineering decision

Refuse the slotless entry at the model, not only in the effect.

In `src/data/model/jurisdiction_settings/catalog/non_static/leave_catalog/leave_catalog_entry/+model.ts`:

- On `create`, after `slotsOf(row)` is computed, refuse if any entry has zero days.
- On `update`, after the proposed `days` array is built, refuse if it is empty. Keep the existing early return for the “only `payroll_run_id` changed” case.
- The error should name the fix: “A leave request needs at least one dated slot.”

Also harden the effect: if `days.length === 0`, return `[]` rather than creating an obligation with `due_on: null`. The model check should prevent this for new rows; the guard protects legacy rows.

Do not fall back to `opened_on` or `ctx.today`. That would invent an accident date and could make a late report look timely.

### Fact/field to declare

Existing child rows `leave_catalog_entry_day.incurred_on` and `.part`. The first chronological slot is the accident date. No new field.

### Test

- Create a `WORK_ACCIDENT_LEAVE` entry with zero slots → refused at the model.
- Create one with a single slot on 2026-06-10 → accepted; `WORK_ACCIDENT_REPORT` due **2026-06-12** (2 × 24 hours).
- Update an existing entry by deleting its last slot → refused.
- A legacy slotless row (if any) produces no `WORK_ACCIDENT_REPORT` with a null due date.
- An encashment entry created by the final-pay path already carries its half-day slots; the zero-slot refusal must not block it.

No payroll-amount test; the leave entry is rejected before pay.

---

## 6. `WLKP_ANNUAL_REPORT` depends on a field nothing writes

### Legal position

UU 7/1981:

- art.6(1): report on establishment within 30 days.
- art.7(1): after the first report, the employer must report **every year** in writing on employment matters.
- Penjelasan Pasal 7: the annual report is counted from the first report — “if the company was reported in July, the periodic report is submitted again in July the following year, and so on.”
- art.8 is about moving, stopping or dissolving the company, not the annual report.

Sources: https://peraturan.bpk.go.id/Details/47039/uu-no-7-tahun-1981 ; PDF https://peraturan.bpk.go.id/Download/35873/UU%20Nomor%207%20Tahun%201981.pdf

The correct anchor is therefore the **first WLKP report date**, not the company establishment date and not the settings effective date.

Two citation bugs in the seed:

- `WLKP_ANNUAL_REPORT` cites “UU 7/1981 art.8(1)”. The annual duty is **art.7(1)**. Art.8(1) is the 30-day pre-move/stop/dissolve report.
- `WLKP_ESTABLISHMENT_REPORT` cites “arts.6, 8”. The establishment report is **art.6**; art.8 is not part of it.

### Engineering decision

Keep `wlkp_first_reported_on` as the declared anchor. Make it actually resolvable:

1. Prefer `entity_extension_data.wlkp_first_reported_on` when the sealed entity version declares it (companies that reported before this workspace).
2. Otherwise derive the anchor from the **fulfilled** `WLKP_ESTABLISHMENT_REPORT` obligation. The effect already creates that obligation with a stable occurrence key:
   `occurrence_key(['ID', 'WLKP_ESTABLISHMENT_REPORT', entity_id, 'ESTABLISHMENT', effective_range.from])`.
   When the obligation is marked `FULFILLED` with a non-null `fulfilled_on`, that date is the recorded first report date. The annual effect can recompute that key for each sealed entity version and read the matching obligation; if more than one is fulfilled, take the earliest `fulfilled_on`. No new write path and no edit to a sealed entity version.
3. If neither exists, do not raise the annual task. The establishment task is still open; the annual duty has not started.

Trigger:

- Determine the first report date `reported`.
- For a run, compute the most recent anniversary date at or before the run's coverage date. If the run is before the anniversary month in the current year, the due year is the previous year.
- If the due year is after the first report year and no obligation exists for that due year, create one.
- Key: `occurrence_key(['ID', 'WLKP_ANNUAL_REPORT', entity_id, dueYear])`.
- Due: `month_end(dueYear + '-' + reportedMonth + '-01')` — the end of the anniversary month, not the start.

This fixes the second bug in the current condition: `calendar_completed_months(reported, coverage.to)` with `months % 12 === 0` only fires when the run's coverage end is on/after the exact anniversary day in the anniversary month. For a `TEN_DAY` month with only an early part, or a monthly run whose coverage ends before the first-report day, the annual task can be missed for that year. Month-based comparison avoids that.

### Fact/field to declare

Existing `entity_extension_data.wlkp_first_reported_on` (date) and the existing `WLKP_ESTABLISHMENT_REPORT` obligation's `fulfilled_on`. No new field. If the product wants a write path instead of derivation, it would have to create a new entity profile version or loosen the sealed-state edit rule; both are heavier than reading the obligation.

### Test

- Entity first reported **2025-07-15** (either field or fulfilled establishment obligation).
- Run 2026-06 → no `WLKP_ANNUAL_REPORT`.
- Run 2026-07-01 (`TEN_DAY` part 1) → one `WLKP_ANNUAL_REPORT`, key year 2026, due **2026-07-31**.
- Runs 2026-07-2 and 2026-07-3 → no duplicate.
- Run 2027-01 with no July 2026 run in between → one task for due year 2026, due 2026-07-31 (overdue), not a 2027 task.
- A company with no first-report date → no annual task.

No payroll-amount test; this is an obligation.

---

## 7. `NO_PAY_OPEN_PERIOD` and the ten-day run key

### Legal position

Indonesian law does not prescribe a ten-day or semi-monthly payroll period. PP 36/2021 art.55(1), (3), (4):

- wages are paid on the date agreed between employer and worker;
- wages may be paid daily, weekly or monthly;
- the payment interval may not exceed one month.

Source: https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf

So `YYYY-MM-N` is an application convention, not a statutory term. The legally relevant facts are the agreed pay date and the actual salary coverage. The employer's `payment_schedule.frequency` / `pay_cutoff_day` is the declaration.

### What the engine actually does

- `cyclesIn` for `TEN_DAY` produces parts 1–3 as above. The **run key is `YYYY-MM-N`**, parts 1–3.
- `cycleOf` resolves a run key to its salary coverage. That coverage does not depend on the cutoff.
- `attendanceOf` changes the window of days a run prices. For `MONTHLY` and `SEMI_MONTHLY` the cutoff logic is coherent.
- For `TEN_DAY` with `pay_cutoff_day > 1`, `attendanceOf` returns the **same** `[previous month cutoff, current month cutoff − 1]` window for every part of the month. That is not a coherent per-part ten-day cutoff model. It is an engine defect, not a rule bug. It also interacts badly with `unpaidRefund`, which prices a reversal over the whole calendar month, not the ten-day cycle. Do not try to fix either in the registered rule.

### Engineering decision

The run key stays `YYYY-MM-N`, parts 1–3. The cutoff does not change the key. It changes which days the run prices.

`NO_PAY_OPEN_PERIOD` currently computes `Math.ceil(day / 10)` for every ten-day schedule. That is correct only when `pay_cutoff_day <= 1`. With a cutoff, the rule must mirror the engine's attendance window, otherwise it will accept an entry that the earlier run already priced (or refuse one the later run should price).

Minimal branch in the rule, using the existing `cutoff`, `tenDay`, `shifted` variables:

```js
if (tenDay) {
  if (cutoff <= 1) return month + '-' + Math.ceil(dayOf / 10);
  return dayOf < cutoff ? month + '-1' : shifted(month, 1) + '-1';
}
```

This mirrors `attendanceOf` for `TEN_DAY` under the current engine: all parts of month M price `[M−1 cutoff, M cutoff − 1]`, so a day before the cutoff belongs to M's first part and a day on/after it belongs to the next month's first part.

Keep the existing `MONTHLY` and `SEMI_MONTHLY` branches. They already match `attendanceOf`:

- `MONTHLY`: a day on/after the cutoff belongs to the next month.
- `SEMI_MONTHLY`: part 1 dates with a cutoff belong to the previous month's part 2; part 2 dates belong to the next month's part 1.

If the product does not want to encode the current ten-day cutoff behaviour, the alternative is to refuse `TEN_DAY` with `pay_cutoff_day > 1` in the schedule validation. That is a larger product restriction; the branch above is the smaller change and keeps the rule consistent with today's engine. No engine change is proposed either way.

### Fact/field to declare

Existing `payment_schedule.frequency` and `payment_schedule.pay_cutoff_day` on `entity`. No new field. The run's `period` and `salary_coverage` are the execution facts.

### Test scenarios

**A. Ten-day, cutoff 1, timely no-pay and reversal (amount).**

- Contract: monthly Rp10,000,000, no allowances, `TEN_DAY`, `pay_cutoff_day: 1`, February 2026.
- February part 1 is 1–10 February. 1 February 2026 is a Sunday; working days are 2–6 and 9–10 = **7**.
- Enter one full no-pay day on 2026-02-03. Run `2026-02-1`.
- Expected: `BASIC` = 10,000,000 × 6/7 = **8,571,428.57**; no separate `UNPAID_LEAVE` line in ID (ID's no-pay shape reduces the salary basis).
- Before the run, the entry is accepted. After `2026-02-1` has run, a second no-pay entry dated 2026-02-03 is refused (the period has run).

**B. Ten-day, cutoff 25, late entry must be refused.**

- Same contract, `pay_cutoff_day: 25`.
- Run `2026-02-1` (coverage 1–10 February). Its attendance window is 25 January–24 February, so it already prices 2026-02-12.
- After that run, a no-pay entry dated **2026-02-12** must be refused. `Math.ceil(12/10) = 2` would allow it until `2026-02-2` runs; the cutoff branch above refuses it immediately.
- This is the regression test for the ten-day cutoff bug.

**C. Reversal (amount mismatch, known limitation).**

- The same February no-pay day from scenario A is reversed in the next period to run (March part 1).
- Current engine result: `unpaidRefund` prices the refund over the whole calendar month, not the ten-day cycle. February 2026 has **20** working days, so the reversal returns 10,000,000/20 = **500,000**, while the original deduction was **1,428,571.43**.
- The rule change does not alter this, and no engine change is proposed in this task. Do not merge a green test that asserts 500,000 is the correct refund; record the scenario as a known limitation for the owner. The arithmetic that would match the original deduction is **1,428,571.43**, but closing that gap is outside this report.

**D. Key confirmation, no amount.**

- `TEN_DAY` runs exist for `2026-02-1`, `2026-02-2`, `2026-02-3`; `period` values are exactly those strings. A monthly run must not accept `2026-02-1`; `cyclesIn` already refuses it.

---

## 8. Consolidated change list (for the later implementation task)

Only existing mechanisms are used.

1. `seed/public/jurisdiction/ID/version_3/registered_effect.json`
   - `PPH21_BPA1_YEAR_END`: coverage-month December; year key; due 31 January next year; batch title.
   - `PTKP_STATUS_ANNUAL`, `MINIMUM_WAGE_COMPLIANCE`, `DISABILITY_QUOTA_REVIEW`, `WORKER_HEALTH_EXAMINATION`: coverage-month January; year key; fixed due dates.
   - `K3_SMK3_P2K3`: one-time entity key; update reference to Permenaker 13/2025 art.3(2); do not present it as an annual return.
   - `WAGE_STRUCTURE_SCALE`: one-time entity key.
   - `TAX_RECORDS_RETENTION`: remove.
   - `WLKP_ANNUAL_REPORT`: first-report anchor (field or fulfilled establishment obligation); anniversary month; year key; due month end; cite art.7(1).
   - `WLKP_ESTABLISHMENT_REPORT`: citation to art.6.
   - `WORK_ACCIDENT_REPORT`: no null due date; skip if no slots.
   - `PPH21_BPA1_EXIT` and the other employee-duty effects listed in section 3: add the `PAYEE` guard.
2. `seed/public/jurisdiction/ID/version_3/registered_rule.json`
   - `PKWT_WRITTEN_INDONESIAN`: validate `=== true`; no field-presence condition.
   - `NO_PAY_OPEN_PERIOD`: ten-day cutoff branch.
3. `src/data/model/jurisdiction_settings/catalog/non_static/leave_catalog/leave_catalog_entry/+model.ts`
   - Refuse zero-slot create/update.
4. No model field is added. No engine file is changed by this task.
5. Separate engine defect record: `attendanceOf` for `TEN_DAY` with cutoff > 1, and `unpaidRefund` for a ten-day cycle. These affect amounts and must not be papered over by the rule.

## 9. Open questions / risks

- **`CONSULTANT` classification.** The effects currently treat `CONSULTANT` as outside the wage rules but the payroll engine treats it as an employee for BPJS/PPh 21. Resolve the classification before adding a broader non-employee guard.
- **Foreign PAYEE.** RPTKA/DKPTKA and companion-training effects were not included in the PAYEE exclusion. A foreign national providing services without employment may still have an immigration/permit obligation; this needs its own legal review.
- **On-site PAYEE and K3.** Even a genuine non-employee working on the employer's premises may need a K3 risk assessment and, depending on the facts, a health examination. The `engagement` field does not erase the employer's K3 duties.
- **Disability 100 threshold.** The statute says 1%, not 100 employees. The seed's threshold is an assumption; confirm the intended rounding with the product owner before treating a headcount under 100 as compliant.
- **Ten-day reversal.** Under the current engine, a ten-day no-pay reversal will not return the amount taken. Do not advertise ten-day reversal as correct; the limitation is outside the registered-rule change.

## 10. Sources

- UU 7/1981 (WLKP): https://peraturan.bpk.go.id/Details/47039/uu-no-7-tahun-1981
- UU 13/2003 (employment, PKWT art.57): https://jdih.kemnaker.go.id/peraturan/detail/27/undang-undang-nomor-13-tahun-2003
- UU 8/2016 (disability quota art.53): https://peraturan.bpk.go.id/Details/37251/uu-no-8-tahun-2016
- UU 28/2007 (KUP art.28(11)): https://www.pajak.go.id/id/undang-undang-nomor-28-tahun-2007
- PP 35/2021 (PKWT): https://jdih.kemnaker.go.id/asset/data_puu/PP352021.pdf
- PP 36/2021 (wages art.21, 26, 29, 55): https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf
- PP 49/2025 (wage amendment): https://jdih.kemnaker.go.id/asset/data_puu/2025pp049.pdf
- PP 44/2015 (work accident art.43): https://www.bpjsketenagakerjaan.go.id/assets/uploads/peraturan/15122015_104557_PP%2044%20Tahun%202015.pdf
- PP 45/2015 (BPJS registration art.4): https://www.bpjsketenagakerjaan.go.id/assets/uploads/peraturan/15122015_104556_PP%2045%20Tahun%202015.pdf
- PP 50/2012 (SMK3 art.5): https://peraturan.bpk.go.id/Details/5263/pp-no-50-tahun-2012
- Permenaker 13/2025 (P2K3 art.3, 11): https://jdih.kemnaker.go.id/peraturan/detail/2788/peraturan-menteri-ketenagakerjaan-nomor-13-tahun-2025
- Permenakertrans PER.02/MEN/1980 (health examination art.3(2)): https://jdih.kemnaker.go.id/asset/data_puu/1980PermenakertransPER2MEN%20.pdf
- Perpres 82/2018 (BPJS Kesehatan): https://jdih.kemenkeu.go.id/api/download/FullText/2018/82TAHUN2018PERPRES.pdf
- PP 37/2021 (JKP): https://jdih.kemnaker.go.id/asset/data_puu/PP372021.pdf
- PMK 168/2023 (PPh 21): https://jdih.kemenkeu.go.id/api/download/e60a82e0-b218-40f5-9d18-b924aa1e11ce/2023pmkeuangan168.pdf
- PER-11/PJ/2025 (BPA1/BP21): https://jdih.kemenkeu.go.id/dok/per-11pj2025

### Gap 1 implementation status (2026-11-09)

- Already present in `version_3`: every annual/January condition reads `salary_coverage.from` and compares the `YYYY-MM`
  month, so semi-monthly and ten-day parts match; keys are year-based (or entity-based for K3/wage structure); BPA1 is due
  31 January and the January duties carry their documented dates; `TAX_RECORDS_RETENTION` is gone.
- Regression: `tests/annual_effect_periods.test.ts` now covers the conditions and the obligation bodies — one BPA1 per
  entity/year with part dedupe, one each January duty, one-time K3 and wage structure, and no tax-records task.

### Gaps 4–7 implementation status (2026-11-09)

- Gap 4 already fail-closed: `PKWT_WRITTEN_INDONESIAN` applies to every employee-like fixed-term contract and requires
  `written_in_indonesian === true`; absent and false both fail. Regression added.
- Gap 5 already correct: `WORK_ACCIDENT_REPORT` returns no obligation when the leave entry has no dated slot, so it cannot
  create a null deadline. Regression added.
- Gap 6 already correct: `WLKP_ANNUAL_REPORT` derives the first report from `wlkp_first_reported_on` or a fulfilled
  establishment report; it does not read an unwritten field. Regression added.
- Gap 7 fixed in the template invariant: `payPeriodOf` for `TEN_DAY` now mirrors `attendanceOf` when
  `pay_cutoff_day > 1` — a day before the cutoff is in the current month's first part, a day on/after it is in the next
  month's first part. Regression runs a cutoff-25 first part and refuses a 12 February no-pay entry.
