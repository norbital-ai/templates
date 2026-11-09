# TW compliance gap research

Status: decision record for the five TW gaps in the 2026-11-09 HR/Bolt seed audit. This file is the
only change; no source, seed, test or other document is edited.
Scope: current TW `version_5` seed and the effects/rules named below. Sources read 2026-11-09.
Constraint: every recommendation uses an existing mechanism — model field, `registered_rule`,
`registered_effect`, catalog `lookup`/`input_schema`, declared read, or `obligation`. No engine
semantics change, no new helper or framework. Section 0 of the calculation architecture is the
fixed design; the only model fields proposed are the two the audit questions name
(`terms.worksite`, `representative_name`), and each is read by an effect. No other field is proposed.

| #   | Gap                         | Decision                                                                                                                                              | Field to declare                                                                   |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Work-accident report inputs | Add the three statutory counts; read the catalog code; make `_UPDATED` a transition-only supplemental report.                                         | `deaths`, `injured`, `hospitalised` in the TW `OCCUPATIONAL_ACCIDENT` input schema |
| 2   | Mass-layoff worksite        | Native `terms.worksite`; per-site obligation key; §46 fixed-term exclusion applied to both staff and leavers.                                         | `terms.worksite` on `employee_contract`                                            |
| 3   | Domestic wage floor         | Skip domestic categories in the general floors; keep `DOMESTIC_MIGRANT_WAGE` as the only domestic floor, with a date gate and monthly/full-time gate. | None; add `lookup.regime_from` to the rule                                         |
| 4   | Responsible-person change   | Add a native versioned `representative_name`; compare it in both unit-change effects.                                                                 | `representative_name` on `entity_profile_version`                                  |
| 5   | Reduced-hours notice        | Keep create; add update only for a period extension, keyed by the period end.                                                                         | None                                                                               |

## 1. Occupational accident eight-hour report

### Legal position

職業安全衛生法 §37(2) ([law.moj.gov.tw](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0060001&flno=37)):

> 事業單位勞動場所發生下列職業災害之一者，雇主應於八小時內通報勞動檢查機構：
> 一、發生死亡災害。
> 二、發生災害之罹災人數在三人以上。
> 三、發生災害之罹災人數在一人以上，且需住院治療。
> 四、其他經中央主管機關指定公告之災害。

The implementing rule defines the counts. 職業安全衛生法施行細則 §48
([law.moj.gov.tw](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0060002&flno=48)):

> 本法第三十七條第二項第二款所稱發生災害之罹災人數在三人以上者，指於勞動場所同一災害發生工作者永久全失能、永久部分失能及暫時全失能之總人數達三人以上者。
> 本法第三十七條第二項第三款所稱發生災害之罹災人數在一人以上，且需住院治療者，指於勞動場所發生工作者罹災在一人以上，且經醫療機構診斷需住院治療者。

The clock starts when the employer knows or should know of the reportable fact, not at the accident
date in all cases. 施行細則 §47
([law.moj.gov.tw](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0060002&flno=47)):

> 所稱應於八小時內通報勞動檢查機構，指事業單位明知或可得而知已發生規定之職業災害事實起八小時內，應向其事業單位所在轄區之勞動檢查機構通報。

The `obligation` model stores a date, not a time. `due_on` is therefore a reminder date; the actual
eight-hour timestamp belongs in the evidence/fulfilment record, not in a new field.

### Current defect

`WORK_ACCIDENT_REPORT` and `WORK_ACCIDENT_REPORT_UPDATED` in
`seed/public/jurisdiction/TW/version_5/registered_effect.json` read
`inputs.deaths`, `inputs.hospitalised` and `inputs.injured`, and use
`ctx.lookup.injured_threshold` = 3. The TW `OCCUPATIONAL_ACCIDENT` row in
`seed/public/jurisdiction/TW/version_5/workplace_case_catalog.json` declares none of these, so the
condition sees missing values as `0`, so a normal entry never fires; it can only fire if someone
types an undeclared count into the free-form `inputs` record. The “3+ injured” branch is not
representable at all. The effect also gates on the free-text `kind` field, not the catalog code.

### Decision

1. **Declare the three counts** in the `OCCUPATIONAL_ACCIDENT` `lookup.input_schema` and add them
   to `required` (beside `accident_on`). Missing is unknown, not zero; a required count is the
   simplest way to stop a blank from silently suppressing the duty. The catalog’s
   `CASE_INPUTS_REQUIRED` rule already checks the `required` list, and numeric `0` is not treated as
   empty. Keep the existing `occupational_death`/`death_on` and `disability_grade` facts for the
   compensation case; `deaths`, `injured` and `hospitalised` are the report counts, not a second
   compensation finding.

   ```json
   "deaths": {
     "type": "integer",
     "minimum": 0,
     "title": "Workers killed in this accident",
     "description": "職業安全衛生法 §37(2)(1). Count workers killed in the same accident."
   },
   "injured": {
     "type": "integer",
     "minimum": 0,
     "title": "Workers with permanent total, permanent partial or temporary total disability",
     "description": "職業安全衛生法施行細則 §48: the §37(2)(2) count is the total number of workers in the same accident who suffer 永久全失能、永久部分失能或暫時全失能. Do not include workers who died; use deaths."
   },
   "hospitalised": {
     "type": "integer",
     "minimum": 0,
     "title": "Workers requiring hospital treatment",
     "description": "職業安全衛生法施行細則 §48: a worker injured in the accident and diagnosed by a medical institution as requiring hospital treatment. One is enough under §37(2)(3)."
   }
   ```

2. **Gate on the catalog code, not `kind`.** Add a declared read of
   `workplace_case_catalog` by `ctx.entry.catalog_id`, fields `['code']`, limit 1 — the same pattern
   already used by `REDUCED_HOURS_NOTICE` for `work_event_catalog`. The condition becomes:

   ```js
   const catalog = (ctx.reads.workplace_case_catalog ?? [])[0];
   if (get(catalog, 'code', '') !== 'OCCUPATIONAL_ACCIDENT') return false;
   if (Number(get(ctx.entry, 'inputs.deaths', 0)) >= 1) return true;
   if (Number(get(ctx.entry, 'inputs.hospitalised', 0)) >= 1) return true;
   return Number(get(ctx.entry, 'inputs.injured', 0)) >= ctx.lookup.injured_threshold;
   ```

   `injured_threshold` stays 3; that is the statutory figure.

3. **Make `WORK_ACCIDENT_REPORT_UPDATED` a transition-only supplemental report.** An unrelated edit
   of an already-reportable case must not raise a second task. A first death, a first hospitalisation,
   or a first crossing to 3+ after creation is a new reportable fact and should raise one. Use `ctx.before` and
   `ctx.entry` (both are available to effects) to compare the three branches; raise only for a branch
   that was false before and true after; put the branch in the `occurrence_key` so a second new fact
   can raise a second report, and make the effect’s declared `reads.obligation` use the same computed
   key. The read resolver sees `ctx.entry` and the subject, not `ctx.lookup`; compute the branch with
   the literal 3 in the read key, or read the event’s `_UPDATED` obligations and filter by the
   computed key in the body. Prefer `inputs.death_on` for a death and the update date otherwise over
   reusing `opened_on`.

4. **Severity mapping.** `severity` is a UI classification, not the statutory test. The counts above
   are the facts. Use this mapping for labels and for operator guidance:

   | `severity`                            | Statutory reading                                      | Report?                                                            |
   | ------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
   | `DEATH`                               | §37(2)(1)                                              | Yes when `deaths` ≥ 1. Do not rely on the label alone.             |
   | `PERMANENT_TOTAL_DISABILITY`          | §48 永久全失能; counts in `injured`                    | Only when `injured` ≥ 3 or `hospitalised` ≥ 1.                     |
   | `SERIOUS_INJURY`                      | Likely 永久部分失能 or 暫時全失能; counts in `injured` | Only when `injured` ≥ 3 or `hospitalised` ≥ 1.                     |
   | `MINOR_INJURY`                        | Counts only if it is a 暫時全失能                      | Only when `injured` ≥ 3 or `hospitalised` ≥ 1.                     |
   | `NEAR_MISS`, `PROPERTY_DAMAGE`, `N/A` | Not a §37(2)(1)–(3) case                               | No, unless the central authority has announced it under §37(2)(4). |

   The other `workplace_case_catalog` codes (`EMERGENCY_OVERTIME`, `CROSS_BORDER_WORK_RECORD`,
   `EXTERNAL_WAGE_RECORD`, `BENEFIT_SERVICE_RECORD`, `FOREIGN_WORKER_ABSENCE`) never raise this duty.

### Test scenario (obligation only; no payroll figure)

| Inputs (`deaths`/`injured`/`hospitalised`, severity)       | Expected                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1 / 0 / 0, `DEATH`                                         | 1 `WORK_ACCIDENT_REPORT`; due on the accident/open date                        |
| 0 / 3 / 0, `MINOR_INJURY`                                  | 1 report                                                                       |
| 0 / 2 / 1, `SERIOUS_INJURY`                                | 1 report                                                                       |
| 0 / 2 / 0, `MINOR_INJURY`                                  | 0 reports                                                                      |
| 0 / 0 / 0, `NEAR_MISS`                                     | 0 reports                                                                      |
| create 0 / 2 / 0; update 0 / 2 / 1 (later hospitalisation) | 1 `_UPDATED` report, key includes the branch; description-only update raises 0 |

## 2. Mass-layoff worksite

### Legal position

大量解僱勞工保護法 §2 ([law.moj.gov.tw](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0020012&flno=2)):

> 本法所稱大量解僱勞工，指事業單位有勞動基準法第十一條所定各款情形之一、或因併購、改組而解僱勞工，且有下列情形之一：
> 一、同一事業單位之同一廠場僱用勞工人數未滿三十人者，於六十日內解僱勞工逾十人。
> 二、同一事業單位之同一廠場僱用勞工人數在三十人以上未滿二百人者，於六十日內解僱勞工逾所僱用勞工人數三分之一或單日逾二十人。
> 三、同一事業單位之同一廠場僱用勞工人數在二百人以上未滿五百人者，於六十日內解僱勞工逾所僱用勞工人數四分之一或單日逾五十人。
> 四、同一事業單位之同一廠場僱用勞工人數在五百人以上者，於六十日內解僱勞工逾所僱用勞工人數五分之一或單日逾八十人。
> 五、同一事業單位於六十日內解僱勞工逾二百人或單日逾一百人。
> 前項各款僱用及解僱勞工人數之計算，不包含就業服務法第四十六條所定之定期契約勞工。

§4 requires the plan to be notified 60 days before the qualifying date and posted
([law.moj.gov.tw](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0020012&flno=4)).

「同一廠場」 is defined in MOL 函釋, collected in the MOL
[大量解僱勞工保護法規彙編](https://www.mol.gov.tw/media/nozejbgt/%E5%A4%A7%E9%87%8F%E8%A7%A3%E5%83%B1%E5%8B%9E%E5%B7%A5%E4%BF%9D%E8%AD%B7%E6%B3%95%E8%A6%8F%E5%BD%99%E7%B7%A8-%E8%87%B3111%E5%B9%B411%E6%9C%88.pdf?mediaDL=true):

> 查大量解僱勞工保護法第二條第一項第一款、第二款及第三款所稱「同一廠場」，指經濟活動之構成主體，以備有獨自之經營簿冊或可單獨辦理登記之營業單位者，以為判斷。經濟活動之構成主體例如一家工廠、一家事務所或分支機構等。

The same collection records that a branch which is not a separate 廠場 has its hires and
separations counted into the economic unit it belongs to, and the plan form says different 廠場
file separate plans. The first four thresholds therefore need a plant/establishment identifier, not
the county/city wage region and not the legal entity; the fifth threshold stays on the entity.

### Current defect

`MASS_LAYOFF_PLAN` groups by
`get(ctx.entry.employee_extension_data, 'worksite', '')`. The TW
`employee_extension_schema` declares no `worksite`, and the owner directive says the extension is
not a sink. Every contract therefore groups as `''`; all sites become one, so the per-site
thresholds are lost. The obligation key also omits the site, so two 廠場 qualifying on the same day
would collapse into one task, contrary to the separate-plan rule.

### Decision

1. **Declare a native `terms.worksite` on `employee_contract`.** Not `terms.work_region`: that is a
   wage-table region key (and TW `work_regions` is empty), so one city would merge every plant in it.
   Not the entity: the entity is the 事業單位, while one entity may run several 廠場. Not the TW
   extension: the owner directive puts worksite facts on the native contract, not the extension.

   ```ts
   worksite: {
     kind: 'text',
     optional: true,
     help: 'The 廠場/establishment this employment belongs to. Use the establishment’s registration number (統一編號) where it has its own, otherwise a stable internal code. A branch that is not a separate 廠場 uses its parent’s code. Different 廠場 never share a code.'
   }
   ```

   Because the shared contract model must stay usable in every jurisdiction, keep the field optional
   in the model and enforce it in TW with a `registered_rule` on `employee_contract` (create/update):

   ```js
   const engagement = get(ctx.entry, 'engagement', 'EMPLOYEE');
   if (!['EMPLOYEE', 'PART_TIME', 'INTERN', 'APPRENTICE'].includes(engagement)) return true;
   if (get(ctx.entry, 'terms.worksite', '') !== '') return true;
   throw 'Record the 廠場 this employment belongs to.';
   ```

   This is the smallest way to prevent a blank from silently recreating the one-site bug. Existing
   TW contracts need a one-time backfill before the new version is promoted; their next update is
   refused until the code is present, and until backfill the effect still merges legacy blanks.

2. **Read `terms.worksite` in the effect** (`siteOf`) and **put the site in the obligation key and
   title**:

   ```js
   const site = get(ctx.entry, 'terms.worksite', '');
   const key =
   	'MASS_LAYOFF_PLAN:' +
   	ctx.entry.entity_id +
   	':' +
   	site +
   	':' +
   	add_days(ctx.entry.effective_range.to, -ctx.lookup.window_days);
   ```

   Title: `Mass layoff plan for <site> notified sixty days before`. This is required by the separate
   plan rule; it is not cosmetic. For the fifth, entity-wide threshold (§2(1)(5)), key and title by
   the entity and omit the site: an entity-wide plan must not be labelled as one 廠場’s plan. If a
   site threshold and the entity-wide threshold both fire, raise both obligations.

3. **Apply the §2(2) exclusion correctly.** The statute excludes only 就業服務法 §46 fixed-term
   workers, not every local fixed-term worker. The current leaver filter checks only
   `fixed_term_category != null`, and the staff filter does not check it at all. Use the existing
   TW facts (`migrant_worker` / `foreign_professional` plus `fixed_term_category`) for the §46
   exclusion, apply it to both `staff` and `leavers`, and count local fixed-term workers normally.
   If an exact §46 flag is wanted later, declare one in the TW extension; the worksite gap does not
   require it.

4. **Count 勞工, not every sealed contract.** The effect currently takes every `status === 'SEALED'`
   contract, including `CONTRACTOR`, `CONSULTANT` and `PAYEE`. Restrict `staff` and `leavers` to the
   employment engagements (`EMPLOYEE`, `PART_TIME`, `INTERN`, `APPRENTICE`) so the denominator is
   the 廠場 workforce the statute counts.

### Test scenario (leavers; no payroll figure)

Unless stated otherwise, two 廠場 with 25 staff each (the `<30` band, rolling threshold >10):

| Case                                                        | Expected                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| A: 11 leavers in 60 days; B: 10                             | 1 obligation, key includes A, due `exit - 60`                  |
| A: 10 leavers; B: 10                                        | 0 obligations                                                  |
| A: 11 and B: 11, same exit date                             | 2 obligations, distinct keys and titles                        |
| Any employment contract with blank `terms.worksite`         | contract create/update refused by the TW rule; no silent merge |
| 11 local fixed-term leavers at A                            | counted; 1 obligation                                          |
| 11 §46 fixed-term leavers at A                              | excluded from staff and leavers; 0 obligations                 |
| Entity-wide: 500 staff across sites, 201 leavers in 60 days | 1 entity obligation, key/title without a site label            |

## 3. Domestic wage floor

### Legal position

最低工資法 §3 ([law.moj.gov.tw](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030028)):

> 本法之適用對象為適用勞動基準法之勞工。

§4 divides the minimum wage into monthly and hourly; §5 says an agreed wage may not fall below it.
勞動基準法 §3(3)
([law.moj.gov.tw](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=3)) allows the
central authority to exclude categories where the Act is impracticable. 行政院勞工委員會
87-12-31 台勞動一字第 059604 號公告 excluded 個人服務業中家事服務業之工作者 from 1999-01-01
([MOL 法令查詢](https://laws.mol.gov.tw/FLAW/FLAWDOC03.aspx?datatype=etype&N2=059604&cnt=1&mode=002&now=1&lnabndn=1&recordno=1)).
Household domestic caregivers and helpers are therefore outside the LSA and outside 最低工資法.

The applicable domestic standard is administrative, not the minimum wage. MOL announced on
2022-08-10 that new or renewed household domestic migrant contracts start at NT$20,000/month; the
3-year and 6-year step-ups to NT$21,000/22,000 are expressly recommendations
([MOL 2022-08-10](https://www.mol.gov.tw/1607/1632/1633/54530/post)). WDA states the current
household domestic threshold as “每月不得低於2萬元”
([WDA](https://fw.wda.gov.tw/wda-employer/home/extra-come-to-tw/index/subCategory/2c95efb38e5d7562018e5f76d29a042a?locale=zh)).
Existing contracts keep their agreed wage; the NT$20,000 applies to new/renewed contracts from
2022-08-10.

### Current defect

`MINIMUM_WAGE_FLOOR` skips `PART_TIME` and `SHELTERED_EMPLOYMENT`; `MINIMUM_WAGE_HOURLY` skips
`SHELTERED_EMPLOYMENT`. Both still apply the general floor to `DOMESTIC_CAREGIVER`/`DOMESTIC_HELPER`.
For a full-time monthly domestic contract, the general monthly floor is higher than NT$20,000 and
refuses it before `DOMESTIC_MIGRANT_WAGE` can pass it, so the domestic rule never binds there. The
domestic rule also compares any rate unit to a monthly figure and has no date gate, so it would
refuse a grandfathered pre-2022 contract.

### Decision

1. In `MINIMUM_WAGE_FLOOR`, return `true` immediately for
   `DOMESTIC_CAREGIVER`/`DOMESTIC_HELPER` (before the monthly comparison). In
   `MINIMUM_WAGE_HOURLY`, do the same (before the hourly/daily comparison). No new field.

2. Keep `DOMESTIC_MIGRANT_WAGE` as the only domestic floor, and make it precise:

   ```js
   const worker = get(ctx.entry, 'employee_extension_data.worker_category', null);
   if (!['DOMESTIC_CAREGIVER', 'DOMESTIC_HELPER'].includes(worker)) return true;
   if (get(ctx.entry, 'engagement', 'EMPLOYEE') !== 'EMPLOYEE') return true;
   const rate = get(ctx.entry, 'terms.rate', null);
   if (rate == null) return false;
   if (get(rate, 'unit', null) !== 'MONTHLY') return true;
   if (get(ctx.entry, 'effective_range.from', '') < ctx.lookup.regime_from) return true;
   const amount = get(rate, 'amount', null);
   return amount != null && amount >= ctx.lookup.monthly_wage;
   ```

   Add `lookup.regime_from: '2022-08-10'` beside `monthly_wage: 20000`, and declare the key in
   `params.ts` as the other rule lookup keys are. The rule applies to full-time (`EMPLOYEE`) monthly
   contracts. `PART_TIME` and non-monthly domestic contracts are outside the announced monthly
   full-time standard; do not invent an hourly domestic floor by comparing them to 20,000. Returning
   `false` when the monthly amount is missing is intentional: a blank rate must not bypass the floor.
   The gate assumes a renewal is a new contract row with its new `effective_range.from`; if a renewal
   is instead an edit to the same row, the rule needs the renewal date, not the original start.

3. Do not encode NT$21,000/22,000 as validations. They are recommendations for 3-year/6-year renewals.
   If the owner wants them visible, put them in the rule description, not in `validate`.

4. Keep `worker_category` where it is: a jurisdiction-specific statutory declaration in the TW
   employee extension. No new model field.

### Test scenario (pay amounts included)

Using the sealed TW `version_5` lookup values (general monthly 30,900, hourly 205; these are the
seed’s figures, not a new statutory claim):

| Case                                                                   | Expected                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| Domestic `EMPLOYEE`, monthly 20,000, `effective_range.from` 2027-01-01 | accepted; full-month payslip gross 20,000                   |
| Domestic `EMPLOYEE`, monthly 19,999                                    | refused by `DOMESTIC_MIGRANT_WAGE`                          |
| Domestic `EMPLOYEE`, monthly 17,000, from 2022-07-01                   | accepted as grandfathered                                   |
| Domestic `EMPLOYEE`, monthly 17,000, from 2022-08-10                   | refused                                                     |
| Domestic `EMPLOYEE`, monthly 20,000 at a 3-year renewal                | accepted; 21,000 is a recommendation, not a floor           |
| Domestic `PART_TIME`, monthly 10,000                                   | accepted by these rules; no monthly domestic floor asserted |
| General `EMPLOYEE`, monthly 30,899                                     | refused by `MINIMUM_WAGE_FLOOR`                             |
| General `EMPLOYEE`, monthly 30,900                                     | accepted                                                    |
| General hourly 204                                                     | refused by `MINIMUM_WAGE_HOURLY`                            |
| General hourly 205                                                     | accepted                                                    |

The key amount assertions are the domestic full-month payslip at 20,000 (not a 30,900 top-up) and
the general 30,899 refusal. No encashment or reversal path is touched by this gap.

## 4. Responsible-person change

### Legal position

勞工保險條例施行細則 §17
([law.moj.gov.tw](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0050002&flno=17)):

> 投保單位有下列各款情形之一者，應於三十日內填具投保單位變更事項申請書，連同有關證件送交保險人：
> 一、投保單位之名稱、地址或其通訊地址之變更。
> 二、投保單位負責人之變更。
> 三、投保單位主要營業項目之變更。

全民健康保險法施行細則 §42
([law.moj.gov.tw](https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=L0060002&flno=42)):

> 投保單位之名稱、負責人、地址或其通訊地址變更時，應於十五日內填具投保單位變更事項申報表一份，連同有關證件送交保險人。

### Current defect

Both effects’ references already mention 負責人, but the conditions compare only `name` and
`registered_address`; no field carries the representative, so a change of 負責人 cannot raise either
filing.

### Decision

Add native `representative_name` to `entity_profile_version`, beside `name` and
`registered_address`:

```ts
representative_name: {
  kind: 'text',
  optional: true,
  help: 'The 負責人 recorded on the company registration in force for this version. A change is filed under 勞工保險條例施行細則 §17 (30 days) and 全民健康保險法施行細則 §42 (15 days).'
}
```

Add it to the model’s create/update column lists and to the representation field list. It is
versioned because a change must compare the old and new values; `entity` has no history, and the
entity extension is for jurisdiction-specific declarations, not the registered identity. Keep it
optional so existing sealed versions remain valid; a null means “not recorded”, not “no
representative”.

In both `LI_UNIT_CHANGE` and `NHI_UNIT_CHANGE`, after selecting `previous`, add:

```js
const representative = (version) => get(version, 'representative_name', null);
const before = representative(previous[0]);
const after = representative(ctx.entry);
if (before != null && before !== '' && after != null && after !== '' && before !== after)
	return true;
```

Do not trigger on null→value or value→null; those are data completion/removal, not a proven change
of 負責人. The existing due dates stay: 30 days for LI, 15 days for NHI, from the version’s
`effective_range.from`. The version’s effective date must therefore be the date the change is
effective; if the registration change has a different date, use that date.

### Test scenario (obligation only; no payroll figure)

| Version 1 → version 2, effective 2027-01-01 | Expected                                                    |
| ------------------------------------------- | ----------------------------------------------------------- |
| representative A → B                        | LI obligation due 2027-01-31; NHI obligation due 2027-01-16 |
| representative A → A, address changes       | existing name/address behavior unchanged; no extra rep task |
| representative null → B                     | no representative task                                      |
| representative B → null                     | no representative task                                      |

## 5. Reduced-hours notice

### Legal position

The instrument is 勞動部’s
[因應景氣影響勞雇雙方協商減少工時應行注意事項](https://laws.mol.gov.tw/FLAW/FLAWDAT0202.aspx?id=FL063785),
summarised in the MOL 2019-11-22 clarification
([mol.gov.tw](https://www.mol.gov.tw/1607/1632/1640/12438/post)):

> (一) 與員工簽訂書面協議，並通報當地縣市政府。
> (二) 對於按月計酬全時勞工，其每月工資仍不得低於基本工資。
> (三) 實施減少工時及工資期間，以不超過3個月為原則。如有延長期間之必要，應重行徵得勞工同意。

The 2019 text says 基本工資; the current term is 最低工資, and the catalog’s
`monthly_minimum_wage_floor` already reads the current minimum.

The trigger is the written agreement (the `work_event` with catalog code
`REDUCED_WORK_AGREEMENT`) and its notification to the local authority — not the first reduced day
itself. The `work_event.from`/`to` period is the agreement period; `evidence_file` holds the written
agreement. The 3-month limit is a principle, not an absolute refusal condition; do not hardcode it
as a rule.

### Current defect

The effect now has a `work_event` tap and listens to `create`, which is sufficient for the first
agreement. It is not sufficient if an extension is recorded by editing the existing event’s `to`:
the effect does not listen to `update`, so no second notice is raised. The 注意事項 requires renewed
consent for an extension; an extension is a new agreement period, not a silent edit.

### Decision

Keep the create behavior and add an update branch, using only the existing `ctx.before`/`ctx.after`
effect context:

1. Add `"update"` to the effect’s `events`.
2. Condition: catalog code is `REDUCED_WORK_AGREEMENT`, and either the event is being created, or
   `ctx.before.to` and `ctx.entry.to` are both non-null and `ctx.entry.to > ctx.before.to` (an
   extension). A description-only edit, a shortening, or a catalog change that does not advance `to`
   does not raise. The quoted text expressly requires renewed consent for an extension, not for a
   shortening; if a local authority requires re-filing any period change, widen the comparison to
   `!==`.
3. Use one key shape for both create and extension:
   `REDUCED_HOURS_NOTICE:<id>:<to ?? from>`. The effect’s declared `reads.obligation` computes the
   same key from `ctx.entry`, so the body’s `raised` check sees the create notice and every earlier
   extension. Create is due on `from`; an extension is due on the first day of the extended period
   (`add_days(ctx.before.to, 1)`) and uses the title
   `Reduced-hours agreement extension notified`. A later extension gets a new key; an edit that does
   not advance `to` raises nothing.

This is a small effect-expression change, not an engine change. The alternative — keep create-only
and require a new `work_event` for every extension — is simpler in code but relies on the operator
remembering; the update branch is safer and still small. If the owner chooses the alternative, add
help text on `work_event` saying an extension must be a new event after renewed consent.

### Test scenario (notice and pay)

| Case                                                    | Expected                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| Create `REDUCED_WORK_AGREEMENT` 2027-01-04 → 2027-01-31 | 1 notice due 2027-01-04                                                |
| Update `to` to 2027-02-28                               | 1 extension notice due 2027-02-01; distinct key from the create notice |
| Update description only                                 | 0 new notices                                                          |
| Full-time monthly 30,900, 4 reduced days in January     | payslip gross 30,900 (monthly floor), insurance and pension retained   |
| Extension month February                                | payslip gross 30,900                                                   |
| Part-time/hourly worker                                 | no monthly floor asserted; the reduced-hours catalog does not add one  |

The 30,900 is the sealed `version_5` monthly lookup, not a new statutory figure. The pay assertions
prove the notice gap does not disturb the existing `monthly_minimum_wage_floor` behavior in
`work_event_catalog`.

## Implementation order

1. Source models: `terms.worksite` on `employee_contract`; `representative_name` on
   `entity_profile_version`; create/update columns and representations.
2. Seed: new TW settings version (never edit sealed `version_5`) with the `OCCUPATIONAL_ACCIDENT`
   input fields, the `worksite` rule, the domestic-floor exclusions and date gate, and the two
   unit-change comparisons; update the effects’ reads/keys as above.
3. Tests: one focused TW suite covering the tables above; keep the existing TW suite green.
4. Manual probe: record the five checks in `.agent/TEST_MATRIX.md` after the template rebuild.

## Open owner decisions

- **Accident counts required vs optional.** Recommended: required. If existing open cases make that
  impossible, keep them optional and add a one-time data-quality task; do not let a blank default to
  zero.
- **§37(2)(4) announced disasters.** Not modeled now. If the central authority announces one, add it
  as a catalog/lookup row with its own rule; do not stretch a severity label to cover it.
- **Worksite enforcement.** Recommended: TW rule for all employment engagements. A softer option is
  to require it only when the entity has more than one distinct worksite, but that needs a read of
  other contracts and is more code for the same result.
- **Reduced-hours extension.** Recommended: update branch. The create-only alternative is lawful if
  every extension is recorded as a new event; it is less enforceable.
- **Representative on sealed versions.** Recommended: keep `representative_name` optional now so
  existing sealed versions remain valid. A stronger option is a TW rule requiring it before a new
  version is sealed; that guarantees the filing trigger but blocks sealing a version without it.
- **Domestic step-ups.** Recommended: leave 21,000/22,000 as guidance only. Making them validations
  would treat a recommendation as law.

### Gap 1 implementation status (2026-11-09)

- Already present in every TW version: `OCCUPATIONAL_ACCIDENT` declares and requires `deaths`, `injured` and
  `hospitalised`; `WORK_ACCIDENT_REPORT` gates on the catalog code and the three §37(2) branches;
  `WORK_ACCIDENT_REPORT_UPDATED` compares the before/after counts per branch, keys the report by branch, and dedupes
  repeats.
- Found while testing: `ctx.before` and `ctx.after` were in the effect dispatch context but not in the expression root
  allow-list, so every transition-only effect silently threw and raised nothing. They are now calculation roots; this
  also repairs TW `REDUCED_HOURS_NOTICE` extensions that compare the previous period.
- Regression: `tests/tw_accident_report.test.ts` covers death, 3+ injured, hospitalisation, non-reportable 2 injured,
  near miss, and a later hospitalisation producing one branch-keyed supplemental report with a description-only edit
  adding none.

### Gap 2 implementation status (2026-11-09)

- `terms.worksite` was already on the shared contract model. Added `MASS_LAYOFF_WORKSITE_REQUIRED` to every TW version:
  a site-counted engagement (`EMPLOYEE`, `PART_TIME`, `INTERN`, `APPRENTICE`) must name its establishment; contractors,
  consultants and payees are exempt.
- §46 exclusion and the employment-engagement filter were already correct in `MASS_LAYOFF_PLAN` and are preserved.
- The effect now groups counted contracts by `terms.worksite`, raises one plan per site with the site in the key and
  title, and no longer raises the entity-wide plan itself. A separate `MASS_LAYOFF_PLAN_ENTITY` raises the fifth,
  entity-wide threshold with an entity-only key and title, so both can fire together.
- Split because one expression over 500 staff + 201 leavers exceeded the expression engine’s 50,000-operation limit.
  The optimized bodies precompute the window start and employment list and keep the entity pass separate.
- Regression: `tests/tw_mass_layoff.test.ts` covers 11/10 at two sites, 10/10, 11/11 distinct sites, local fixed-term,
  §46 exclusion, the entity-only plan, and the worksite rule.

### Gap 3 implementation status (2026-11-09)

- Already present in every TW version: `MINIMUM_WAGE_FLOOR` and `MINIMUM_WAGE_HOURLY` return true for
  `DOMESTIC_CAREGIVER`/`DOMESTIC_HELPER`; `DOMESTIC_MIGRANT_WAGE` is the only domestic floor, with `regime_from`
  2022-08-10, the full-time `EMPLOYEE` gate, the `MONTHLY` gate and the grandfathered pre-regime pass.
- Regression: `tests/tw_domestic_wage.test.ts` covers the two general floors skipping domestic work, 20,000 passing
  and 19,999 failing the domestic floor, and the part-time/non-monthly/pre-2022/non-domestic passes.

### Gap 4 implementation status (2026-11-09)

- `representative_name` was already native on `entity_profile_version`. Added the missing comparison to both
  `LI_UNIT_CHANGE` and `NHI_UNIT_CHANGE` in every TW version, between the registered-name and address comparisons.
- Regression: `tests/tw_unit_change.test.ts` raises both reports for a representative-only change, keeps name/address
  changes, ignores unrelated edits and no earlier version, and compares only the immediately preceding version.

### Gap 5 implementation status (2026-11-09)

- The effect already listened to `create` and `update`, used the shared `REDUCED_HOURS_NOTICE:<id>:<to|from>` key and
  titled an extension. It only became effective after `ctx.before`/`ctx.after` were made readable in effect expressions:
  previously every update branch silently threw.
- Regression: `tests/tw_reduced_hours.test.ts` covers the first notice (due 2027-01-04), an extension to 2027-02-28
  (due 2027-02-01, distinct key), a description-only edit (none) and a shortening (none). The reduced-hours catalog still
  declares the full-time monthly minimum floor and insurance/pension retention; the payslip itself is not re-run here.
