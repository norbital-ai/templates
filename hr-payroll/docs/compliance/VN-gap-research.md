# VN compliance gap research

Status: research and decision record, 9–10 November 2026. The seed and the models are what is in force; where this record differs, they stand. Seed folders are written `version_<v>`: the lineage has been renumbered since.

Baseline: the VN law researched as it would stand from 2027-01-01, after Decree 393/2026 commenced on 2026-12-05; that change is not seeded (the seed's last VN version is open-ended from 2026-07-01). Where a gap also exists in earlier versions, the decision applies to the next sealed version; sealed versions are not edited.

No statutory figure below is invented. Figures used in test scenarios are fixture inputs unless they are cited to an official instrument.

## Official sources

| Instrument                           | Official URL                                                                                                                                                         | Articles used                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Labour Code 45/2019/QH14             | https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2019/11/30232/29070-1-2019993-99445-2019-qh14.pdf (record: https://vanban.chinhphu.vn/?pageid=27160&docid=198540)    | 90, 91, 107, 111, 112, 113, 114, 115, 137, 156    |
| Decree 145/2020/NĐ-CP                | https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2020/12/32732/33806-1-20201203-1204145-2020-nd-cp.pdf                                                                | 58, 59, 60, 61, 62, 66, 67                        |
| Decree 393/2026/NĐ-CP                | https://vanban.chinhphu.vn/?pageid=27160&docid=220059 ; signed PDF: https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/10/393_2026_nd-cp_20102026-signed.signed.pdf   | 9(8), 17(1), 21(3), 29(1), 30, 31, 32, 33, 34, 35 |
| Decree 399/2026/NĐ-CP                | https://vanban.chinhphu.vn/?pageid=27160&docid=220166 ; signed PDF: https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/11/399_2026_nd-cp_02112026_6-signed.signed.pdf | 3, 4                                              |
| Decree 293/2025/NĐ-CP                | https://vanban.chinhphu.vn/?pageid=27160&docid=215832                                                                                                                | 2026 minimum-wage table                           |
| Law on Social Insurance 41/2024/QH15 | https://xaydungchinhsach.chinhphu.vn/toan-van-luat-so-41-2024-qh15-bao-hiem-xa-hoi-119240723163650489.htm                                                            | 31(3), 33(1)(b), 34(4)(a)                         |
| Decree 158/2025/NĐ-CP                | https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-158-2025-nd-cp-quy-dinh-ve-bao-hiem-xa-hoi-bat-buoc-119250629171336803.htm                                   | 8(1)(a)                                           |

## Summary

| #   | Gap                                                   | Decision                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `ENCASHMENT_PRIOR_WAGE_REVIEW` never fires            | Only annual leave is encashable, only on termination/job loss. Do not set `can_encash`. Declare `encash_on_exit`, a payable conversion and a prior-month wage field; key the review off annual leave plus `encashment === true`.                 |
| 2   | Pregnancy/infant consent has no fact                  | Per roster day, not per work event or contract attestation. Split pregnancy (no consent exception) from infant under 12 months (consent required).                                                                                               |
| 3   | Two return obligations on one termination             | One statutory act. Invalidation effect owns recorded grounds (permit or certificate); termination effect is the fallback only for a permit with no complete invalidation record. Shared key; use `work_authorisation_category`, not `pass_type`. |
| 4   | Two prompts for route/extension count                 | Distinguish. Route is an onboarding fact; extension count is a renewal fact with a legal window. Narrow both conditions and titles.                                                                                                              |
| 5   | Annual overtime prose vs expression                   | The expression is the implementable truth: sum planned overtime intervals. `hours.year` does not exist and must be removed from the prose.                                                                                                       |
| 6   | `entity_profile_version[0]`                           | Select the sealed employer version covering the relevant date (contract start for contract rules, `work_date` for roster rules); fail closed if none.                                                                                            |
| 7   | Contribution correction not closed-month gated        | Required. Raise the fund follow-up only when the corrected month has a paid on-cycle run; otherwise the ordinary run absorbs it.                                                                                                                 |
| 8   | Exit review sees every employee's combining agreement | Scope the read to the exiting employment and entity. The agreement is individual under art. 113(4).                                                                                                                                              |

---

## 1. Encashable leave and `ENCASHMENT_PRIOR_WAGE_REVIEW`

### Legal position

- Labour Code art. 113(3): where an employee leaves or loses the job without taking annual leave, or without taking all annual leave days, the employer pays wages for the untaken days. The right arises on termination/job loss, not during employment. Art. 113(4) allows leave to be taken in parts or combined over at most three years by agreement; it does not allow a cash-out.
- Art. 114 extra days for every five years of service are annual leave, so they follow art. 113(3).
- Art. 115 paid personal leave (marriage, child marriage, bereavement) and unpaid personal leave are not annual leave. Art. 112 public holidays, including the foreign employee's extra traditional New Year and national day under art. 112(2), are not annual leave. Sick, maternity, paternity and other social-insurance benefits are not employer cash-outs under art. 113(3).
- Decree 145/2020 art. 67(3): the wage basis for untaken annual leave is the contractual wage of the month immediately preceding the month of termination/job loss. This is why the seed's review requires the month before exit.
- Art. 113(3) does not exclude a misconduct dismissal. The VN `encash_on_exit` should not carry a `refused_on: [MISCONDUCT_DISMISSAL]` list (unlike the SG/MY rows, which record their own refusal ground).

Sources: Labour Code PDF above, arts. 112–115; Decree 145/2020 PDF above, art. 67(3).

### Engineering decision

1. Set `lookup.encash_on_exit = { allowed: true }` on `ANNUAL_LEAVE` only. This is the field the contract model reads before creating the exit encashment entry.
2. Do **not** set `lookup.can_encash` on any VN leave catalog. It is not the statutory encashment switch. Setting it on `ANNUAL_LEAVE` would imply a mid-employment cash-out the Labour Code does not grant. `can_encash` remains a valid key for a jurisdiction whose law allows conversion during employment (PH); it is not a VN fact.
3. `ANNUAL_LEAVE` currently has `subtotal_id: null` and no `conversion`. The auto-created encashment entry therefore pays nothing under the current catalog. Declare:
   - `subtotal_id`: the version's `FINAL_PAY` subtotal id (v7: `ef16e5c9-f532-5011-88ac-71c7024e59f2`);
   - `conversion`: return `0` unless `ctx.entry.encashment === true`, otherwise `ctx.entry.quantity * <prior-month daily wage>`.
   - A reversal of an encashment entry must carry `encashment: true`; otherwise the conversion returns `0` and the reversal returns the days without recovering the cash. The hidden flag must be copied from the original on the reversal path.
4. Change `ENCASHMENT_PRIOR_WAGE_REVIEW` (v7 id `82923f34-1e36-5993-b281-109f4c88696a`) condition from `lookup.can_encash === true` to `catalog.code === 'ANNUAL_LEAVE' && ctx.entry.encashment === true`; keep the existing `reverses == null` and ended-contract guards. Keep the existing validate: `encashment_review.month` must equal the month before the exit month. This makes the rule fire on the auto-created exit entry and on a manually created annual-leave encashment entry, and stops it firing on ordinary annual-leave entries on a terminated contract.
5. Add `encashment_review.daily_wage_vnd` (number, minimum 0) to the VN `employee_extension_schema` and the shared extension schema. The review's `month` and `reference` remain. The rule requires `daily_wage_vnd > 0`; the conversion reads it. Do not silently fall back to `ctx.day_rate`: that would use the exit month's rate and breach art. 67(3) when the rate changed.
   - If the owner rejects the new field, the conversion can use `ctx.day_rate`, but the deviation must be recorded: a pay change effective in the exit month over- or under-pays the untaken leave.

### Test scenario (pay bump)

- Contract A: `26,000,000` a month through 2027-04-30; fixture April and May each have 26 normal working days under a six-day week.
- Contract B: `30,000,000` a month from 2027-05-01; employee exits 2027-05-31.
- `encashment_review`: `{ month: "2027-04", daily_wage_vnd: 1_000_000, reference: "April contract and fixed allowance" }`.
- Balance: 3 unused `ANNUAL_LEAVE` days.
- Expected: one `ANNUAL_LEAVE` encashment entry, `FINAL_PAY` line `3 * 1,000,000 = 3,000,000`; ledger `leave/ANNUAL_LEAVE/.../used` 3 days.
- Current-rate bug: `3 * 30,000,000 / 26 = 3,461,538.46`, rounded at scale 0 to `3,461,538`. The test must expect `3,000,000`.
- Reversal: a reversal entry carrying `encashment: true` returns the 3 days and recovers `3,000,000` in the next run; no second encashment is raised. If the reversal does not carry the flag, the cash is not recovered; the test must fail that shape.

---

## 2. Pregnancy and infant night-work consent

### Legal position

- Labour Code art. 137(1)(a): the employer must not use the employee for night work, overtime or long business trips from the 7th month of pregnancy (6th in highland, deep, remote, border or island areas). There is **no** consent exception in point (a).
- Art. 137(1)(b): the same prohibition applies while the employee is raising a child under 12 months, **except where the employee agrees**. The exception is only in point (b).
- Labour Code art. 107(2)(a) requires the employee's consent to overtime. Decree 145/2020 art. 59(1) requires that consent to cover the time, place and work of the overtime; art. 59(2) allows a separate written form.
- A contract-wide attestation is not day-specific and does not evidence consent for a particular roster day. A `work_event` is entity-wide and not employee-specific, so it is not a consent record either. The owner's existing rule text already records the ruling that consent is per day, never an employee fact; the model is missing that fact.

Sources: Labour Code PDF above, arts. 107(2)(a), 137(1); Decree 145/2020 PDF above, art. 59.

### Engineering decision

Declare one per-roster-day consent object on `roster_entry` (the roster day already owns the plan, the actuals and the findings):

```text
consent: {
  kind: 'json',
  shape: {
    night_work: boolean,
    overtime: boolean,
    reference: text
  },
  optional: true
}
```

- `night_work` covers night work under art. 137(1)(b).
- `overtime` covers overtime under art. 137(1)(b) and art. 107(2)(a)/Decree 145 art. 59.
- `reference` names the signed form or other evidence.
- Do not put consent on `employee_contract` (blanket attestation) or `work_event` (not personal).

Split the at-risk test in both rules:

- `PREGNANT_OR_INFANT_NIGHT_OVERTIME` (v7 id `4f640eab-9c0f-5626-9fc4-41a1bd33d646`) and `ROSTER_MATERNITY_NIGHT_OVERTIME` (v7 id `00f10253-39a3-522a-a9a0-07f46a360ef7`) currently treat pregnancy and infant care as one `atRisk` boolean.
- Compute `pregnant` (date at or after `add_months(expected_on, -3)`) and `infant` (born, `add_months(born_on, 12) > date`) separately.
- `pregnant`: refuse night work and overtime regardless of `consent`.
- `infant`: refuse night work unless `consent.night_work === true`; refuse overtime unless `consent.overtime === true`.
- Keep the current rule split: the `ROSTER_...` rule checks planned overtime at create/update; the `PREGNANT_OR_INFANT_...` rule checks actual night work and planned overtime at update.

The roster import and month board must carry the same two consent flags; otherwise the fact cannot be entered on the day it is needed.

### Test scenario (night overtime)

- Infant born 2026-12-01; roster day 2027-05-02; planned and actual overtime 22:00–24:00 on a normal working day that also has daytime overtime.
- Monthly wage `26,000,000`; fixture month has 26 normal working days under a six-day week and 8 normal hours a day; hour rate `125,000`.
- Without consent: `ROSTER_MATERNITY_NIGHT_OVERTIME` refuses the create; `PREGNANT_OR_INFANT_NIGHT_OVERTIME` refuses the update.
- With `consent: { night_work: true, overtime: true, reference: "..." }`: accepted.
- Expected pay: overtime `2 * 125,000 * 1.5 = 375,000`; night supplement `2 * 125,000 * 0.2 * 1.5 = 75,000`; total `450,000`. (The 0.2 and 1.5 factors are the existing VN `NIGHT_OVERTIME` conversion, not new figures.)
- A pregnant employee at the 7th month is refused even with the same consent.

---

## 3. Two return obligations on one termination

### Legal position

- Labour Code art. 156(2): a work permit loses effect when the labour contract terminates.
- Decree 393/2026 art. 31(1): a permit is revoked where it loses effect under Labour Code art. 156(2)–(7) (contract termination, contract inconsistent with the permit, work not as permitted, underlying contract ended, foreign employer recall, Vietnamese employer ceased). Art. 32(1): within 10 working days from the date the permit loses effect, the employer collects the permit and submits it to the issuing authority with a report.
- Decree 393/2026 art. 33(1)–(3): a certificate of exemption from the work-permit requirement is revoked on its own grounds (work not as certified, foreign employer notice, Vietnamese or foreign employer ceased). Contract termination is **not** an art. 33 ground. Art. 34(1): within 10 working days from the date the certificate loses effect, the employer collects it and submits it with a report.
- Accordingly, one authorisation produces one return/report act. A termination-caused permit return and an invalidation-ground return are the same act, not two.

Sources: Labour Code PDF above, art. 156(2); Decree 393/2026 page/PDF above, arts. 31(1), 32(1), 33(1)–(3), 34(1).

### Engineering decision

Use one owner per fact, with the other as a fallback:

1. `WORK_AUTHORISATION_INVALIDATION_RETURN_393` (v7 id `2e0e6a73-4a4e-5633-bf68-a648f447e0da`) is the primary owner whenever `work_authorisation_invalidated_on` and `work_authorisation_invalidation_ground` are recorded.
   - Add the category guard: `terms.work_authorisation_category` must be `PERMIT` or `EXEMPTION_CERTIFICATE`. An `EXEMPT_NOTIFICATION` has no physical authorisation to return.
   - Keep the due date from `work_authorisation_invalidated_on` plus 10 working days.
2. `WORK_PERMIT_RETURN` (v7 id `ab68f01b-deab-511c-8162-f5f4816aec78`) is the fallback only when no complete invalidation record is present.
   - Condition: sealed, `effective_range.to != null`, `terms.work_authorisation_category === 'PERMIT'`, and **not** both `work_authorisation_invalidated_on` and `work_authorisation_invalidation_ground` recorded. If only one of the two invalidation facts is present, the primary effect cannot compute its deadline, so the fallback still raises one obligation and the HR controller completes the record.
   - Do not use `pass_type` as the category: `pass_type` is the foreign-worker/SI route and includes `INTRA_COMPANY_TRANSFER` and `OTHER`; it does not prove a permit exists.
   - Do not fire this fallback for `EXEMPTION_CERTIFICATE`: a contract ending is not an art. 33 ground, so no certificate return is due merely because the contract ended.
3. Both effects use the same `occurrence_key`, e.g. `'WORK_AUTHORISATION_RETURN:' + ctx.entry.id`, and the same title, "Return the work authorisation with its invalidation report". The condition split is the primary protection; the shared key is the second line of defence against a duplicate insert.
4. `final_pay_due_on` is an operational exit marker, not the legal trigger. Keeping it avoids firing on internal renewals, but a zero-final-pay exit would miss the fallback. Record the invalidation ground on every termination so the primary effect carries the legally complete path; if the owner wants the fallback to cover zero-final-pay exits too, replace the gate with "no successor contract for the same employee and entity". Do not use both gates.

### Test scenario

- Permit holder; contract ends 2027-03-31; `final_pay_due_on = 2027-04-15`; `work_authorisation_invalidated_on = 2027-03-31`; ground `CONTRACT_ENDED`; no holidays.
- Expected: exactly one obligation, due 2027-04-14 (10 working days after 2027-03-31, weekends excluded). If both effects raise one, the test fails.
- Permit holder; contract ends; no invalidation ground: one fallback obligation, same due date.
- Permit holder; contract ends; `work_authorisation_invalidated_on` recorded but the ground missing: one fallback obligation; the record is incomplete, not a second obligation.
- Exemption-certificate holder; contract ends; no art. 33 ground: zero return obligations. With an art. 33 ground: one obligation from the invalidation effect.

---

## 4. Route review vs extension-count prompt

### Legal position

- Decree 393/2026 art. 29(1): a permit extension application is filed at least 10 working days and no more than 90 days before expiry.
- Art. 30: a permit may be extended only once, for a maximum of 2 years.
- Art. 21(3): after that one extension, an employee who continues in the same job and field must apply for a new permit at least 10 working days and no more than 60 days before expiry.
- Art. 9(8): the same fresh-application rule applies to an exemption certificate after its one extension; art. 17(1) sets the certificate extension window at 10–90 days.
- Art. 35: transition for authorisations issued under the prior decrees.

The route (permit, exemption certificate, exemption notification) is a one-time onboarding fact. The extension count is a renewal fact that decides extension vs fresh application and the 90-day vs 60-day window. They are not the same input even though both effects currently ask for both.

Sources: Decree 393/2026 page/PDF above, arts. 9(8), 17(1), 21(3), 29(1), 30, 35.

### Engineering decision

Distinguish rather than merge:

1. `FOREIGN_WORKER_NEW_DECREE_REVIEW` (v7 id `be2d3cad-fb98-54d4-9c41-49c79367ec20`) is the onboarding route prompt.
   - Condition: sealed, `pass_type != null`, and `terms.work_authorisation_category == null`.
   - Title: "Record the actual work authorisation route".
   - Due on the contract start. It must not fire when the route is already recorded.
   - It may prefill `work_authorisation_extension_count = 0` for a genuinely new authorisation, but it must not assume zero for a transfer-in with an existing authorisation.
2. `WORK_AUTHORISATION_EXPIRY_INPUTS_393` (v7 id `a770de3f-5220-57ee-8314-545ae65d204a`) is the renewal-count prompt.
   - Condition: `terms.work_authorisation_category` in `PERMIT`/`EXEMPTION_CERTIFICATE`, `effective_range.to != null`, `work_authorisation_extension_count == null`, and the run's pay date is on or after `add_days(effective_range.to, -90)`.
   - Title: "Record the extension count used".
   - Due at the first pay date in the 90-day window. It must not fire at onboarding or long before expiry.
3. Keep the existing `WORK_AUTHORISATION_EXTENSION_393` and `WORK_AUTHORISATION_FRESH_ISSUE_393` effects as the application prompts. The onboarding route prompt and the renewal-count prompt feed them; they are not duplicates of them.
4. If the owner insists on one obligation, merge the route and count into the onboarding effect and delete the payroll prompt. That is simpler but loses the safety net for contracts sealed before the count field existed. The two-effect split is safer and still uses only existing mechanisms.

### Test scenario

- Contract sealed 2027-01-05, `pass_type = WORK_PERMIT`, `terms.work_authorisation_category = PERMIT`, `work_authorisation_extension_count = null`, contract end 2027-12-31 (or the separate authorisation expiry if the adjacent-risk field is adopted).
- Expected at sealing: one onboarding obligation (route), no expiry-count obligation.
- Set `work_authorisation_extension_count = 0`: onboarding obligation is resolved; no expiry-count obligation until the first pay date on or after 2027-10-02 (90 days before 2027-12-31).
- At that pay date: one "Record the extension count used" obligation. Setting the count to 0 selects the extension effect; setting it to 1 selects the fresh-issue effect at the 60-day window.

Adjacent risk (not part of the merge/distinguish decision): both the extension/fresh effects and this prompt use the contract's `effective_range.to` as the authorisation expiry. That is the contract end, not the permit or certificate expiry; an indefinite contract has no end date, so the prompts never fire. If the owner wants correct timing, declare `work_authorisation_expires_on` (date) in `employee_extension_data` and use it in `WORK_AUTHORISATION_EXTENSION_393`, `WORK_AUTHORISATION_FRESH_ISSUE_393` and `WORK_AUTHORISATION_EXPIRY_INPUTS_393`. If not, record the contract-end proxy and its limitation.

---

## 5. Annual overtime cap: prose vs expression

### Legal position

- Labour Code art. 107(2)(c): overtime may not exceed 200 hours in a year, except art. 107(3). Art. 107(3): up to 300 hours in the listed sectors and cases. Art. 107(4): written notice to the provincial labour authority before using the 300-hour route; Decree 145/2020 arts. 61–62 detail the sectors and notice.
- Decree 145/2020 art. 60(5): the paid working-time periods in art. 58 are deducted when counting the monthly/yearly overtime total. It does not exclude overtime on public holidays or weekly rest days.
- The cap is on overtime hours. In this engine, overtime is the `planned_overtime_intervals` on a roster entry that the clock covers; time outside the plan never counts (`awardedMinutes`). Holiday or rest-day work therefore counts for this cap only when it is entered as planned overtime; the model has no other overtime fact. So the expression's sum of planned overtime intervals is the only implementable overtime fact in this model.

Sources: Labour Code PDF above, art. 107; Decree 145/2020 PDF above, arts. 58, 60, 61, 62.

### Engineering decision

Keep the expression; fix the prose.

- The current reference says "Counted from hours.year: all overtime (banked included; every hour on a 0-hour rest day) plus the planned hours worked on public, substitute and double holidays, each hour once." `hours.year` is not a declared read, no `hours` balance family exists, and adding one would be a new engine concept. The phrase is stale.
- Replace it with: "Counted from the roster entries' planned overtime intervals in the calendar year, each interval once. Work on a public holiday or rest day counts only where it is entered as planned overtime; the engine recognises no other overtime."
- Do not add a balance, a new read, or a holiday-hours addend. That would change the design and would not match what the engine pays.
- Fix the employer-version selection as in gap 6.

### Test scenario

- Employee with 199 planned overtime hours in 2027 before the entry; add a roster day with 2 planned overtime hours on a public holiday (entered in `planned_overtime_intervals`). Total 201.
- Employer version has `overtime_300h_sector = false`: `OVERTIME_ANNUAL_CAP` refuses (201 > 200).
- Same employee at exactly 200: accepted.
- Same employee with `overtime_300h_sector = true`: 201 accepted; 301 refused. The 200 and 300 figures are the statutory caps, not fixture assumptions.

Adjacent risk: the rule reads roster entries by `employment_id`, so a same-year contract renewal can reset the count. The cap is per employee. If the owner wants strict cross-contract counting, the read must cover the employee's contracts for the year; that is a larger change and is not required by the listed gap.

---

## 6. Effective employer version, not `[0]`

### Legal position

- Minimum wage: Labour Code art. 90(2) requires the job/position wage to be at least the minimum wage; art. 91 establishes the regional monthly/hourly minimum. Decree 399/2026 art. 3 sets the 2027 table and art. 4 the conversion rules; Decree 293/2025 sets the 2026 table. The version in force on the relevant date applies.
- Overtime: the 200/300-hour cap is the version in force on the work date.
- Weekly rest: art. 111 requires at least 24 consecutive hours a week, or an average of at least 4 days a month where the cycle does not allow a weekly rest.
- `entity_profile_version` is an employer-fact version (region, 300-hour sector, rest averaging), not the law version. The law table comes from the contract's `input_schema_version_id`. The employer version in force on the entry date supplies the facts. `[0]` is read/insertion order, not legal order.

Sources: Labour Code PDF above, arts. 90, 91, 107, 111; Decree 399/2026 page/PDF above, arts. 3–4; Decree 293/2025 page above.

### Engineering decision

For each of `MINIMUM_WAGE_FLOOR`, `HOURLY_MINIMUM_WAGE`, `OVERTIME_ANNUAL_CAP` and `WEEKLY_REST`, replace `ctx.reads.entity_profile_version[0]` with a version selected by date:

```js
const date = <contract effective start | roster work_date>;
const employer = ctx.reads.entity_profile_version.find((version) => {
  const from = get(version, 'effective_range.from', '');
  const to = get(version, 'effective_range.to', null);
  return from <= date && (to == null || to >= date);
});
if (employer == null) return false;
```

- Contract rules (`MINIMUM_WAGE_FLOOR`, `HOURLY_MINIMUM_WAGE`): `date = ctx.entry.effective_range.from`.
- Roster rules (`OVERTIME_ANNUAL_CAP`, `WEEKLY_REST`): `date = ctx.entry.work_date`.
- Add `status: { eq: 'SEALED' }` to the `entity_profile_version` reads in `OVERTIME_ANNUAL_CAP` and `WEEKLY_REST`; the minimum-wage reads already have it.
- If no sealed version covers the date, refuse (return `false` from validate) rather than defaulting. A missing employer version is a data problem, not a legal default.
- Do not select the `jurisdiction_settings` version by this rule. The settings version is the contract's `input_schema_version_id`; the employer version supplies only the employer facts. Do not conflate the two.
- Seed check: v6 (2026-12-05–2026-12-31) has region IV monthly `3,700,000` and region I `5,310,000`; v7 (2027-01-01–) has region IV `4,040,000` and region I `5,700,000` (Decree 293/2025 and Decree 399/2026).

### Test scenario

Minimum wage:

- Employer version A: effective 2026-01-01–2026-12-31, `entity_extension_data.region = "IV"`.
- Employer version B: effective 2027-01-01–, `region = "I"`; create B first so `[0]` is the wrong one.
- Contract effective 2026-12-20, monthly `4,000,000`, settings v6.
- Correct: A, floor `3,700,000`, pass. `[0]` bug: B, floor `5,310,000`, fail. Expected pass.
- Second case: contract effective 2027-02-01, monthly `5,000,000`, settings v7, region I; correct floor `5,700,000`, refuse.

Overtime:

- Version A (2026) `overtime_300h_sector = false`; version B (2027) `true`.
- Roster entries in 2026 totaling 201 planned hours. Correct: A, cap 200, refuse. `[0]` bug: B, cap 300, pass. Expected refuse.

Weekly rest:

- Version A (2026) `rest_averaged_monthly = false`; version B (2027) `true`.
- February 2026 with 28 roster records, all worked, 0 rest days. Correct: A, condition false, pass. `[0]` bug: B, condition true, validate fails (0 < 4). Expected pass.

---

## 7. Contribution correction only for a closed month

### Legal position

- Law on Social Insurance 41/2024 art. 33(1)(b): compulsory SI is paid monthly. Art. 34(4)(a): the employer's deadline is the last day of the month following the contribution month.
- Art. 31(3): the Government regulates retroactive collection (`truy thu, truy đóng`).
- Decree 158/2025 art. 8(1)(a): a retroactive salary increase that raises the insurance salary triggers retroactive collection for the retroactive period.
- If the corrected month is still open, the ordinary payroll run computes the corrected contribution; a separate fund follow-up would double-count. If the month is closed (already declared/paid), the fund follow-up is needed.

Sources: Law 41/2024 page above, arts. 31(3), 33(1)(b), 34(4)(a); Decree 158/2025 page above, art. 8(1)(a).

### Engineering decision

`CONTRIBUTION_CORRECTION` (v7 id `a9aac38b-c3b2-59a9-a17a-8b1db4030c17`) must check the corrected month before raising the obligation.

Add a declared read:

```json
"payroll_run": {
  "where": {
    "entity_id": { "eq": { "var": "ctx.entry.entity_id" } },
    "kind": { "eq": "ON_CYCLE" },
    "state": { "eq": "PAID" }
  },
  "fields": ["period"],
  "limit": 10000
}
```

Condition addition:

```js
const month = String(ctx.entry.incurred_on).slice(0, 7);
if (!ctx.reads.payroll_run.some((run) => String(run.period).startsWith(month))) return false;
```

- "Closed" means a paid on-cycle run for the entity whose `period` covers the correction month. An `UNPAID` run is not closed: it can still be deleted and rerun, so the correction can be absorbed. No run means open. If the owner defines "closed" as "a run exists" (the `NO_PAY_OPEN_PERIOD` convention), drop the `state` filter; the period check alone. The paid-run filter is the recommended minimal because it avoids a fund task for a run that can still be deleted.
- Keep the existing obligation key and the `_REFUND` / arrears title logic.
- No new field: `payroll_run.state`, `payroll_run.period` and `adhoc_catalog_entry.incurred_on` already exist.
- Residual ordering: the effect runs on adhoc entry create. If the entry is created before the run is paid, the run should capture it; the effect not firing is correct. If the entry is created after the run is paid, the effect fires. If the owner needs to catch a correction entered while the run was unpaid but not captured, add the same effect on adhoc update; that is a separate decision.

### Test scenario

- Paid on-cycle run for `2027-01`.
- `SI_ADJUSTMENT` adhoc entry, unit `MONEY`, quantity `1,000,000`, `incurred_on = 2027-01-15`.
- Expected: one obligation, title "Pay 1000000 in arrears to the fund: SI_ADJUSTMENT".
- Same entry with the run `UNPAID` or absent: zero obligations.
- Paid `2027-01` run, `incurred_on = 2027-02-15`: zero obligations.
- `SI_REFUND`, quantity `500,000`, closed month: one "Claim 500000 back from the fund" obligation.

---

## 8. Annual-service exit review must scope its workplace case

### Legal position

- Labour Code art. 113(4): an employee may agree with the employer to take annual leave in several parts or combine leave for at most three years. The agreement is individual to that employee and employer; it is not an entity-wide policy inferable from another employee's record.
- The seed's `ANNUAL_LEAVE_COMBINING_AGREEMENT` workplace-case entry carries `employment_id` and `entity_id`; the rule currently reads every agreement of that kind, so another employee's agreement can make the exit review demand carry fields from the exiting employee.

Sources: Labour Code PDF above, art. 113(4).

### Engineering decision

Scope the `workplace_case_catalog_entry` read in `ANNUAL_SERVICE_EXIT_REVIEW` (v7 id `6483548f-a510-5d97-b052-7cd22fab6acd`):

```json
"workplace_case_catalog_entry": {
  "where": {
    "kind": { "eq": "ANNUAL_LEAVE_COMBINING_AGREEMENT" },
    "employment_id": { "eq": { "var": "ctx.entry.id" } },
    "entity_id": { "eq": { "var": "ctx.entry.entity_id" } }
  }
}
```

- Use the model's `employment_id` ref as the canonical subject. The current `BUSINESS_CASE_SUBJECT_AND_REFERENCE` rule requires `inputs.employment_id` instead; either require both or make the model field the only subject and backfill legacy rows. Do not rely on `inputs.employment_id` for the read.
- The `entity_id` filter prevents a cross-employer match; the `employment_id` filter prevents a cross-employee match. Both are needed.
- If a same-jurisdiction replacement contract must inherit the agreement, scope by the employee's contract lineage (read the employee's contracts and match their ids) rather than entity-wide. That is a larger change; the employment scope is the correct minimal fix for the listed gap.
- No new field.

### Test scenario

- Employee A exits 2027-03-31, `final_pay_due_on` set, review `{ year: 2027, as_of: 2027-03-31, reference: "..." }`, no carry fields.
- Employee B has an `ANNUAL_LEAVE_COMBINING_AGREEMENT` covering 2027-01-01–2027-12-31.
- Expected: A's contract update passes. Without the employment filter, B's agreement makes the rule demand A's carry fields and the update fails.
- Give A its own agreement: A's update now fails until `carry_previous_year_days` and `carry_second_previous_year_days` are set. That proves both the scope and the intended requirement.

---

## Suggested implementation order

1. Gap 1: annual-leave encashment (catalog `encash_on_exit`, `subtotal_id`, `conversion`, review condition, `daily_wage_vnd`).
2. Gap 2: per-day `roster_entry.consent` and the pregnancy/infant split.
3. Gap 3: one return owner and the shared occurrence key.
4. Gap 4: onboarding route vs renewal count conditions.
5. Gap 5: overtime prose correction (with gap 6).
6. Gap 6: effective employer version in the four rules.
7. Gap 7: paid-run gate on contribution corrections.
8. Gap 8: employment/entity scope on the exit review.

Gates after each group: lint → build → the VN payroll/leave suites → the manual probe matrix. Record the scenarios above in `.agent/TEST_MATRIX.md` when they are implemented.

## Implementation status (2026-11-09)

- Gap 1 applied to every VN version in the tree (none has shipped):
  - `ANNUAL_LEAVE` declares `lookup.encash_on_exit.allowed = true`, its version's `FINAL_PAY` subtotal and a conversion
    that returns 0 unless `encashment === true`, else `quantity × encashment_review.daily_wage_vnd`;
  - `ENCASHMENT_PRIOR_WAGE_REVIEW` fires on `ANNUAL_LEAVE` with `encashment === true` on an ended contract, and its
    validate requires the prior month plus a positive `daily_wage_vnd`;
  - `daily_wage_vnd` is in every VN `employee_extension_schema` and the shared VN extension schema.
- The leave reversal form carries the original entry's `encashment` flag, so a reversal of a cash-out recovers the cash,
  not only the days.
- Regression: `tests/vn_encashment.test.ts` refuses a wrong review month and a zero daily wage, and pays two days at
  500,000 as 1,000,000 under `FINAL_PAY`.
- Gaps 2–8 are not implemented in this change.

### Gap 2 implementation status (2026-11-09)

- `roster_entry.consent` is a per-day object `{ night_work, overtime, reference }`; create/update columns carry it.
- Both rules now split pregnancy from infant care in every VN version:
  - pregnancy: night work and overtime refused regardless of consent;
  - infant under 12 months: night work needs `consent.night_work`, overtime needs `consent.overtime`.
- The month board reads and edits `consent`; the roster workbook Plan sheet accepts optional
  `consent_night_work`, `consent_overtime` and `consent_reference` columns, requiring the signed reference when a
  flag is used.
- Not tested for this jurisdiction: the row is seed data, and tests prove the rule and effect mechanism on agnostic fixtures. The roster import test covers consent parsing and the missing-reference refusal.

### Gap 3 implementation status (2026-11-09)

- `WORK_AUTHORISATION_INVALIDATION_RETURN_393` is the owner: it requires `terms.work_authorisation_category` to be
  `PERMIT` or `EXEMPTION_CERTIFICATE`, and both invalidation facts.
- `WORK_PERMIT_RETURN` is the fallback only for a `PERMIT` with an incomplete record (date missing, ground missing, or
  both missing); it never fires for an exemption certificate on contract end.
- Both use `WORK_AUTHORISATION_RETURN:<contract_id>` and the same title, so one authorisation raises one act.
- Not tested for this jurisdiction: the row is seed data, and tests prove the rule and effect mechanism on agnostic fixtures.
- Found while testing: effect contexts read a stored half-open daterange's exclusive end as `effective_range.to`, one day
  after the model's inclusive end. `rangeObject` now subtracts the day; this corrects every jurisdiction effect that
  dates from a contract end, not only VN.

### Gap 4 implementation status (2026-11-09)

- `FOREIGN_WORKER_NEW_DECREE_REVIEW` is the onboarding route prompt: sealed, `pass_type` present, and
  `terms.work_authorisation_category` still missing. Title "Record the actual work authorisation route", due on the
  contract start. It ends once the route is recorded.
- `WORK_AUTHORISATION_EXPIRY_INPUTS_393` is the renewal-count prompt: route `PERMIT`/`EXEMPTION_CERTIFICATE`, contract
  end present, count missing, and the run pay date at or after `end − 90 days`. Title "Record the extension count used",
  due at that pay date. It no longer fires at onboarding or long before expiry.
- `WORK_AUTHORISATION_EXTENSION_393` and `WORK_AUTHORISATION_FRESH_ISSUE_393` remain the application prompts, selected
  by the recorded count (0 = extension, 1+ = fresh issue).
- Not tested for this jurisdiction: the row is seed data, and tests prove the rule and effect mechanism on agnostic fixtures.

### Gap 5 implementation status (2026-11-09)

- Already present in every VN version: the cap sums the roster entries' `planned_overtime_intervals` for the calendar
  year, so a public-holiday or rest-day hour counts only when it is entered as planned overtime; the employer version is
  selected by the one sealed version covering the roster day, not `[0]`; the reference prose now says planned overtime
  intervals and no longer mentions `hours.year`.
- Not tested for this jurisdiction: the row is seed data, and tests prove the rule and effect mechanism on agnostic fixtures.

### Gap 6 implementation status (2026-11-09)

- Already present in every VN version: `MINIMUM_WAGE_FLOOR`, `HOURLY_MINIMUM_WAGE`, `OVERTIME_ANNUAL_CAP` and
  `WEEKLY_REST` select the `SEALED` `entity_profile_version` covering the contract start or roster day, and refuse when
  none covers it. No `[0]` read remains.
- Regression: `tests/vn_employer_version.test.ts` puts the wrong version first for all three testable rules and proves
  the covering version wins; the overtime boundary lives in `tests/vn_overtime_cap.test.ts`.
- Note on the research scenario: “February 2026, 28 records all worked, correct version passes” conflicts with the
  non-averaged validate and with art.111 — seven worked days in the window is the violation. The test uses one rest day
  in the final seven (correct version passes, wrong version's monthly averaging fails) and separately asserts that an
  all-worked window is refused.

### Gap 7 implementation status (2026-11-09)

- Already present in every VN version: `CONTRIBUTION_CORRECTION` reads on-cycle `PAID` runs for the entity and raises
  only when one covers the correction month. An unpaid or absent run, a later month and a reversal raise nothing.
- Not tested for this jurisdiction: the row is seed data, and tests prove the rule and effect mechanism on agnostic fixtures.

### Gap 8 implementation status (2026-11-09)

- Already present in every VN version: `ANNUAL_SERVICE_EXIT_REVIEW` reads
  `ANNUAL_LEAVE_COMBINING_AGREEMENT` rows filtered by `employment_id = ctx.entry.id` and
  `entity_id = ctx.entry.entity_id`.
- Regression: the read declaration is asserted, and the validate cases prove that a covering agreement demands both
  carry fields while no covering agreement passes.

## Seed round 3 decision record (2026-11-10)

Scope: `seed/public/jurisdiction/VN/**` and this note only. No source, schema, test or migration change; no model field. The seven seed versions in the tree (v1–v7) are not released, so the seed-round rule is an edit in place across all seven, not a new sealed version.

### Annual leave in the joining year (Labour Code art.113(1)–(2); Decree 145/2020 arts.66(1)–(2))

The predecessor seed used `lookup.proration = COMPLETED_MONTHS`. The generic `entitlementOf` branch prorated only the opening band (`first.days`, 12) and dropped `lookup.extra_days`, so a joiner entitled to 14 or 16 days was prorated on 12. The row now declares one `lookup.entitlement` expression in every version:

- `days` is the service band (12 plus the art.114 seniority increment) plus the largest matching `extra_days` (+2 for a minor, a disabled worker or arduous/toxic/dangerous work; +4 for especially arduous/toxic/dangerous work). Art.113(1) sets 14 and 16; art.114 adds one day for every full five years.
- In the joining calendar year only, it returns `days / 12 × months worked in the year`; in a later calendar year it returns `days`. The reference cites Decree 145 art.66(1). The seed uses `employment_started_on` (the current unbroken stint), not `service_started_on`: credited service raises the band, but the months prorated are the months actually worked here in the year.
- A month counts when the working days from the join date reach 50% of that month's normal working days, and only once the month's last day is served. The window is `CALENDAR_YEAR`, not `SERVICE_YEAR`.

**The art.66(1) reading.** “Số tháng làm việc thực tế trong năm” is the months actually worked in the calendar year, not the first twelve months of service. A person who joined on 2025-07-01 therefore closes 2025 at 6 days (July–December) and opens 2026 at the full 12, because 2026 is a full calendar year of work. `tests/leave_settlement.test.ts` line 92 in this tree still expects 6 for the 2026 window; that is the stale pre-fix expectation. The reading is 12. This round does not edit tests; the test round must update that assertion.

**The art.66(2) gap.** The expression counts _scheduled_ working days from the join date to month end against the month's normal working days, using the contract's `terms.normal_days_per_week` and the standard VN week (Sunday off; Saturday too at five days). It cannot see attendance: the entitlement context exposes `subject.employment` and the sealed employer's `entity_extension_data`, while the ledger sync reads `entity_profile_version` without `payment_schedule`. Exact gap: unpaid absence (or fund-paid sick/maternity) in the joining month is counted as worked, and a non-standard working week changes which days count. The month-end rule also means the joining month's day is not posted until the month ends. HR's manual `entitled` adjustment on the leave row is the correction until a source read for attendance or the agreed week exists; no new field is implied.

### Leave shares and payouts

| Row family                                                                                                                                                   | `paid_share` | Payout                                                                                           | Statute                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `ANNUAL_LEAVE`                                                                                                                                               | empty (1)    | exit cash-out: days × the prior month's contract daily wage (`encashment_review.daily_wage_vnd`) | Labour Code art.113(1), (3); Decree 145 art.67(3) |
| `PUBLIC_HOLIDAY`, `PUBLIC_HOLIDAY_IN_LIEU`, `FOREIGN_NATIONAL_LEAVE`                                                                                         | empty (1)    | none                                                                                             | Labour Code art.111(3), art.112(1)–(2)            |
| `MARRIAGE_LEAVE` (3), `CHILD_MARRIAGE_LEAVE` (1), `BEREAVEMENT_LEAVE` (3)                                                                                    | empty (1)    | none                                                                                             | Labour Code art.115(1)                            |
| `SICK_LEAVE`, `MATERNITY_LEAVE`, `PATERNITY_LEAVE`, `CHILD_SICK_CARE`, `PRENATAL_CHECKUP`, `MISCARRIAGE_LEAVE`, `CONTRACEPTION_LEAVE`, `CONVALESCENCE_LEAVE` | 0            | none; the SI fund pays the benefit, not the employer                                             | Law 41/2024 arts.42–57; Labour Code art.139       |
| `BEREAVEMENT_LEAVE_UNPAID`, `UNPAID_LEAVE`, `STOPPAGE_WORKER_FAULT`                                                                                          | 0            | none                                                                                             | Labour Code art.99(2), art.115(2)–(3)             |
| `OCCUPATIONAL_ACCIDENT_LEAVE`                                                                                                                                | empty (1)    | none                                                                                             | Law 84/2015 art.38(3)                             |
| `SUSPENSION_PENDING_DISCIPLINE`                                                                                                                              | 0.5          | none; the adhoc `SUSPENSION_SETTLEMENT` pays the rest where the worker is not disciplined        | Labour Code art.128(2)                            |

- Every `paid_share` is numeric in 0..1 or empty (=1); no value exceeds a normal day. Only `ANNUAL_LEAVE` carries a `payout`; no other row prices a day off in money.
- **In-lieu row.** `PUBLIC_HOLIDAY_IN_LIEU` cited `art.112(3)` (the Prime Minister's holiday list), which is not the in-lieu rule. It now cites **art.111(3)** (a weekly rest day falling on an art.112(1) holiday is taken on the next working day) and **art.112(1)** (the holiday is off on full pay), with its quote. The description was corrected from “a public holiday worked” to “a public holiday that fell on a weekly rest day”; `lookup.grant_days` is 0, so the calendar row that `replaces` it or HR's manual adjustment supplies the day, and it is not encashable. No other leave row lacks a citation.
- The owner's 2026-11-10 design made the presence of `payout` the encashment switch. `encash_on_exit` is gone from `ANNUAL_LEAVE`; the exit automation reads `payout`, so gap 1's substantive decision (annual leave only; no mid-employment cash-out) still stands.

### Statutes added to rules and effects that had no reference

- `ENCASHMENT_PRIOR_WAGE_REVIEW` and `encash-leave-on-exit`: Labour Code art.113(3) and Decree 145 art.67(3).
- `ANNUAL_LEAVE_COMBINING_MAXIMUM`: Labour Code art.113(4).
- `ANNUAL_SERVICE_EXIT_REVIEW`: Decree 145 arts.65–66 and Labour Code art.113(3)–(4).

`retract-exit-effects` is no longer in the seed (the dependants routine waives exit tasks for every jurisdiction): it implemented the owner's 2026-11-09 decision that a moved or cancelled exit waives its open duties, which is not a statute.

### Open owner questions

1. **Test expectation.** The 2026 window is 12 under the reading above; `tests/leave_settlement.test.ts` still asserts 6. The test round should update it; this round does not.
2. **The 14-day minor leg.** `extra_days` uses `minor_listed_job` — the art.146(1)(b) fact for a job listed for minors' overtime and night work — not every minor. A minor in a non-listed job gets 12, although art.113(1) gives 14 to any “người lao động chưa thành niên”. The expression could read `payroll.date_of_birth` with `age_on(dob, as_of)`, but that would make the entitlement change on the 18th birthday and needs an accrual rule; owner to decide.
3. **Fund-paid leave.** The employer pays no wage for the eight fund rows; the employer submits the SI benefit claim under `SI_BENEFIT_CLAIMS` and the fund pays the employee. If the employer's practice is to advance the fund benefit in payroll, that is a separate payment, not a `paid_share`: paying 0.75 of a normal day would use the contract wage, while the fund uses the contribution salary.
4. **`BEREAVEMENT_LEAVE_UNPAID`.** The row is unpaid (`paid_share` 0), so no wage effect, but its `lookup` is `{}`: the statutory one day per event under art.115(2) is not capped. Capping it needs an event relationship filter so it does not overlap the paid three-day `BEREAVEMENT_LEAVE`; owner to decide.
