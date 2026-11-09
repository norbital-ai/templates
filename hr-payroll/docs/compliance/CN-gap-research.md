# CN compliance gaps — legal and engineering decisions

Status: research only. No source, seed, test or other document changed. Every recommendation uses existing
mechanisms (models, registered rules/effects, reads, lookups, obligations); no engine semantics change and no
new engine concept.

Figures below are the CN seed's own: SH 25/h and 2,740/month; KM 21/h and 2,170/month (zones 2 and 3:
20/2,020 and 19/1,870); 21.75 paid days; 174-hour monthly conversion; part-time 4h/day and 24h/week.
No other statutory wage or contribution rate is introduced.

## Summary

| # | Gap | Decision | Payroll amount affected |
|---|---|---|---|
| 1 | Part-time on a monthly rate | derive the hourly equivalent from the agreed hours and check the hourly floor | yes — contract rate |
| 2 | `terms.work_region` ignored | worksite region first, employer region fallback | yes — minimum-wage floor |
| 3 | `NO_PAY_OPEN_PERIOD` create-only | add `update`; check unpaid slots only | yes — no-pay deduction |
| 4 | Consent and work-injury effects create-only | add `update`; keep the per-entry occurrence key | no — obligations |
| 5 | `CN_STANDARD_SHIFT_LIMIT` and comprehensive hours | keep; it is a template guard, the cycle is settled by the review | yes — comprehensive overtime |
| 6 | `LABOUR_CONTRACT` duplicate | keep `WRITTEN_CONTRACT_OVERDUE`, delete `LABOUR_CONTRACT` | no — obligation |

## 1. Part-time work on a monthly rate

| Item | Finding |
|---|---|
| Legal position | 《劳动合同法》第六十八条 defines part-time as mainly hourly-paid, averaging no more than 4 hours a day and 24 hours a week; 第七十二条 requires the hourly rate to be no lower than the local hourly minimum and the settlement period to be at most 15 days. 《最低工资规定》第五条 applies the monthly standard to full-time workers and the hourly standard to part-time workers; 第十二条 is the comparison rule. A monthly label does not remove the hourly floor: the monthly amount must yield at least the hourly minimum for the agreed hours. Sources: [劳动合同法](https://www.gjxfj.gov.cn/gjxfj/xxgk/fgwj/flfg/webinfo/2016/03/1460585589931971.htm), [最低工资规定](https://fgw.sh.gov.cn/ys-laogong-1.5.2.2-h5/20240125/aec0ebbdd6ac4528a636db6eb39aabfb.html). |
| Decision | Extend `MINIMUM_WAGE_HOURLY` (already on `create` and `update`) to accept `MONTHLY` and derive `hourly = amount / (monthly_hours)` where `monthly_hours = weekly_hours * 52 / 12`, `weekly_hours` is `normal_hours_per_week` when it is greater than zero, otherwise `normal_hours_per_day * normal_days_per_week`; refuse the monthly rate when `monthly_hours` is zero. Then compare `hourly` with the regional hourly floor. Do not use the 174-hour conversion: 174 is a full-time month, so it understates a part-timer's hourly rate (2,600/174 = 14.94 against 2,600/104 = 25.00). Keep `MINIMUM_WAGE` excluding `PART_TIME`; its monthly comparison is the full-time floor. The 15-day settlement is already covered by `PART_TIME_PAY_CYCLE`; no change there. Option if strict classification is preferred: refuse `PART_TIME` + `MONTHLY` instead of deriving. That is not required by the wage-floor rule and would reject contracts whose hourly equivalent is lawful. |
| Fields/facts | `engagement`, `terms.rate.unit`, `terms.rate.amount`, `terms.normal_hours_per_week`, fallback `terms.normal_hours_per_day` × `terms.normal_days_per_week`. No new field. |
| Test | SH, `PART_TIME`, 24h/week, `MONTHLY` 2,600 → 2,600 / (24 × 52/12) = 25.00, passes at SH 25; 2,599 → 24.99, refused. A pay bump from 2,599 to 2,600 on the same contract passes on update. Add to `tests/minimum_wage.test.ts`. |

## 2. `work_region` versus employer region

| Item | Finding |
|---|---|
| Legal position | 《劳动合同法实施条例》第十四条: where the place of performance differs from the employer's registered place, the minimum wage, labour protection, working conditions, occupational hazard protection and the local average wage follow the place of performance; if the registered place's standard is higher and the parties agreed to apply it, the agreement governs. Source: [实施条例](https://xzfg.moj.gov.cn/front/law/detail?LawID=284). The worksite therefore governs by default; the employer region is the fallback, not the rule. This includes the probation-wage floor: 《劳动合同法》第二十条's "employer's location" is the default, and 《实施条例》第十四条 resolves the cross-region case. |
| Decision | Resolve the region as `terms.work_region`, falling back to `entity_extension_data.region`, in `MINIMUM_WAGE_HOURLY`, the `MINIMUM_WAGE` effect and `MENSTRUAL_LEAVE_CONDITIONS`; apply the same resolution to every other wage-floor reader: `PROBATION_WAGE`, the `SICK_LEAVE` conversion's 80% floor and Shanghai scale, and the ad-hoc deduction cap. Use the same resolution in local-benefit readers that currently read employer region (for example `HOLIDAY_WORK`'s SH check and the high-temperature allowance's region check). For the zone, use `entity_extension_data.wage_zone` only when the resolved region equals the employer region; otherwise use the worksite region's `default_zone`. The seed has no worksite-zone field, so a KM worksite under a non-KM employer can only use zone 1; declare a worksite zone before relying on KM zones 2 or 3 (do not guess it). Do not move social-insurance or housing-fund contribution lookups to the worksite: those follow the contribution/registration place, and `wage_zone` also drives the KM housing-fund floor. The Article 14 exception has no field: `work_region` is the worksite, not the agreed governing region. Minimal implementation: apply the worksite. If the owner wants the exception, add one optional `terms.agreed_minimum_wage_region` and use it only when the employer table is higher. |
| Fields/facts | `terms.work_region`; `entity_extension_data.region`; `entity_extension_data.wage_zone` only when the regions match. The generic contract editor already renders `terms.work_region`; no new UI control is needed, though a picker over `work_regions` would prevent undeclared keys (the model already refuses them). For menstrual leave, the worksite's `requires_by_region` fact must be declared on the contract (`protected_work` for SH, `severe_dysmenorrhea_diagnosed` for KM); the rule already refuses when it is missing. Optional agreed-region field only for the Article 14 exception. |
| Test | SH employer, KM worksite, full-time `MONTHLY` 2,200, `employee_statutory` 0, full month → no `MINIMUM_WAGE` obligation (KM 2,170). Remove `work_region` → SH 2,740 → one obligation. Repeat the two-region comparison for `PROBATION_WAGE` and the `SICK_LEAVE` 80% floor. Add to `tests/minimum_wage.test.ts` and `tests/statute_cn.test.ts`. |

## 3. `NO_PAY_OPEN_PERIOD` on update

| Item | Finding |
|---|---|
| Legal position | No PRC statute requires this specific refusal; it is a payroll-control invariant, not a wage rule. 《劳动法》第五十条 requires monthly payment in money without unlawful deduction or delay; 《工资支付暂行规定》第六条 requires written payroll records kept for at least two years. A period that has run is closed; a correction is a reversal or adjustment in the next period. The rule's own reference states that policy. Sources: [劳动法](https://www.gjxfj.gov.cn/gjxfj/fgwj/flfg/webinfo/2014/05/1601761496659330.htm), [工资支付暂行规定第六条](https://www.hlj.gov.cn/hlj/c116413/202402/c00_31712524.shtml). |
| Decision | Add `update` to `events`. The model's update transform already builds the resulting slot array at `ctx.entry.leave_catalog_entry_day`: surviving existing slots (with `id` and `payroll_run_id`) plus `create` children. In `validate`, check only slots with `payroll_run_id == null`; on create every slot is unpaid, so one expression covers both. Without that filter, an evidence-file edit on a captured entry would be refused because its already-paid slot is in a run period. Keep the `payroll_run_id`-only early return: the run's capture must not trigger the rule. Align the parent's child update columns (`incurred_on`, `part`) with the child model's (`payroll_run_id` only), or apply child `update` actions to the proposed slots; otherwise the payload is not exhaustive for API clients. |
| Fields/facts | No new field. Uses `leave_catalog_entry_day.payroll_run_id`, `payroll_run.period`, and the employer's `payment_schedule.frequency`/`pay_cutoff_day`. |
| Test | Monthly 8,700 / 21.75 = 400/day. The July run has already run; adding a 2026-07-20 slot to an `UNPAID_LEAVE` entry is refused. Adding an August slot deducts 400 in the August run; a reversal dated in August returns 400 (+400 line). |

## 4. `SENSITIVE_PI_CONSENT_MEDICAL` and `WORK_INJURY_RECOGNITION` on update

| Item | Finding |
|---|---|
| Legal position | 《个人信息保护法》第二十八条 treats medical health as sensitive personal information; 第二十九条 requires separate consent. 第十四条 requires fresh consent if the purpose, method or type changes: switching a leave entry to `SICK_LEAVE`, `WORK_INJURY_LEAVE` or `MATERNITY_LEAVE` changes the type; adding another slot to the same medical entry does not. 《工伤保险条例》第十七条 requires the employer to apply for work-injury recognition within 30 days of the accident or diagnosis. Sources: [个人信息保护法](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm), [工伤保险条例](https://www.cnts.gov.cn/zfgzbm/srlzyhshbzj/sbxxgk/zczy/content/post_708919.html). |
| Decision | Add `update` to both effects. Keep `target_action: create` and the existing `occurrence_key = '<CODE>:' + entry.id`; one obligation per effect per leave entry, regardless of slot count. The effects read after commit, so `ctx.reads.leave_catalog_entry_day` sees the resulting slots. The dedupe must check the key in **every** obligation state, not only `OPEN`: `obligation.occurrence_key` is globally unique, so a fulfilled consent or recognition task would otherwise make the post-commit effect fail on the unique constraint. Drop the `state: OPEN` filter from each effect's `reads.obligation`; the condition's `some(task => task.occurrence_key === key)` then finds the existing task. An entry that starts non-medical and switches to a medical catalog has no key yet, so it raises one task. A switch among medical catalogs on the same entry finds the key and raises no second task; the original task covers the entry. If the owner wants a task per sensitive-data type, add the catalog code to the key, but that raises a new task on every type switch; not recommended. A new entry gets a new id and a new task. `due_on` is fixed at first raise (first slot, or the latest injury event on or before it); adding an earlier slot later does not move an existing obligation. If the owner needs the date to move, read the obligation `id` and target `update`, but that is a second effect; not recommended for the minimal change. |
| Fields/facts | `leave_catalog.code`; `leave_catalog_entry.catalog_id`; `employee_contract.events[]` (`kind: WORK_INJURY`, `on`). No new field. |
| Test | Create `SICK_LEAVE` with one slot → one consent obligation; update adds a slot → still one. Create a separate `ANNUAL_LEAVE` entry and update it to `SICK_LEAVE` → one. Create `WORK_INJURY_LEAVE` with a slot on 2026-06-10 and an injury event on 2026-06-03 → one `WORK_INJURY_RECOGNITION` obligation due 2026-07-03 (the consent effect also raises its own task); update adds 2026-06-11 → still one recognition task. |

## 5. `CN_STANDARD_SHIFT_LIMIT` and comprehensive hours

| Item | Finding |
|---|---|
| Legal position | 《劳动法》第三十六条 sets the 8-hour day and the statutory weekly average; 第三十九条 allows other work/rest systems with approval; 第四十一条 caps extensions at 1 hour a day, 3 hours a day in special cases and 36 hours a month; 第四十四条 sets 150%, 200% and 300%. 《关于企业实行不定时工作制和综合计算工时工作制的审批办法》第五条 allows comprehensive hours by week, month, quarter or year, but the average day and week must be basically the same as the statutory standard. 《工资支付暂行规定》第十三条第三款 treats comprehensive hours above the statutory total as extended hours at 150%. A single shift longer than 8 hours is not per se unlawful under comprehensive hours if the cycle average holds. Sources: [劳动法](https://www.gjxfj.gov.cn/gjxfj/fgwj/flfg/webinfo/2014/05/1601761496659330.htm), [劳部发〔1994〕503号](https://www.gdwc.gov.cn/zjwcrsj/gkmlpt/content/2/2022/post_2022013.html), [工资支付暂行规定第十三条](https://www.bjhr.gov.cn/zt/qwpf/yasf/202009/t20200916_2060920.html). |
| Decision | Keep the rule. It targets `shift_definition`, which has no `statutory_work_category` and is entity-scoped and shared; it cannot exclude a category, and excluding at the template level would remove the only 8-hour guard for `STANDARD` workers using the same template. The category-specific limits already live at the contract/roster level: `ROSTER_OVERTIME_DAILY` (standard only, 3h/day), `COMPREHENSIVE_OVERTIME` + `comprehensive_overtime_review` (reviewed excess hours, 150%) and `HOLIDAY_WORK` (300%). A long comprehensive day is recorded as an 8-hour shift plus `planned_overtime_intervals`; the review settles the cycle. If the owner wants longer templates for comprehensive-only patterns, the category must move to `shift_pattern` (new field) and the check to the roster; not recommended now. |
| Fields/facts | `statutory_work_category` (contract); `shift_definition.variant.day_type` and `breaks`; `roster_entry.planned_overtime_intervals`; `employee_extension_data.comprehensive_overtime_review` (`month`, `settlement_on`, `excess_nonholiday_hours`, `reference`). No new field if keeping. |
| Test | `COMPREHENSIVE`, monthly 8,700 → day 400, hour 50; review `excess_nonholiday_hours` 6 → 6 × 1.5 × 50 = 450. A 10-hour WORK shift template is refused; an 8-hour template plus 2 hours of planned overtime is accepted. A `STANDARD` worker's 3 hours of planned overtime is accepted; 4 hours is refused. |

## 6. `LABOUR_CONTRACT` versus `WRITTEN_CONTRACT_OVERDUE`

| Item | Finding |
|---|---|
| Legal position | 《劳动合同法》第十条第二款 requires a written contract within one month of employment; 第八十二条第一款 requires double wages from the second month. 《劳动合同法实施条例》第六条 fixes the double-wage start as the day after the one-month anniversary. Sources: [劳动合同法](https://www.gjxfj.gov.cn/gjxfj/xxgk/fgwj/flfg/webinfo/2016/03/1460585589931971.htm), [实施条例](https://xzfg.moj.gov.cn/front/law/detail?LawID=284). |
| Decision | Keep `WRITTEN_CONTRACT_OVERDUE`; delete `LABOUR_CONTRACT`. The latter raises a task for every sealed contract even when `terms.signed_on` is set, so it is not a compliance reminder and duplicates the specific task. The specific effect fires only when `signed_on` is null, and its reference carries the double-wage consequence. Keep `due_on = add_months(from, 1)` as the action deadline; if the task is meant to flag exposure rather than the deadline, use `add_days(add_months(from, 1), 1)`. The surviving task is closed manually when the contract is signed; no effect auto-closes it. |
| Fields/facts | `terms.signed_on`; `employee_contract.status`; `effective_range.from`. No new field. |
| Test | A sealed contract with `signed_on` null raises exactly one `WRITTEN_CONTRACT_OVERDUE` and no `LABOUR_CONTRACT`; with `signed_on` set, neither. Caveat: both effects require `status === 'SEALED'`; a contract that never reaches `SEALED` raises neither. If a draft can represent an active unsigned employment, decide whether the surviving effect should key off `effective_range.from` and `signed_on` instead of status. |

## Change surface

| File | Change |
|---|---|
| `seed/public/jurisdiction/CN/<version>/registered_rule.json` | `MINIMUM_WAGE_HOURLY` (1, 2); `MENSTRUAL_LEAVE_CONDITIONS` (2); `PROBATION_WAGE` (2); `NO_PAY_OPEN_PERIOD` (3) |
| `seed/public/jurisdiction/CN/<version>/registered_effect.json` | `MINIMUM_WAGE` (2); `SENSITIVE_PI_CONSENT_MEDICAL` (4); `WORK_INJURY_RECOGNITION` (4); remove `LABOUR_CONTRACT` (6) |
| `seed/public/jurisdiction/CN/<version>/leave_catalog.json` | `SICK_LEAVE` conversion's 80% floor and Shanghai scale (2) |
| `seed/public/jurisdiction/CN/<version>/adhoc_catalog.json` | ad-hoc deduction cap (2) |
| `seed/public/jurisdiction/CN/<version>/overtime_catalog.json` | `HOLIDAY_WORK`'s SH check (2, consistency; optional for the six gaps) |
| `seed/public/jurisdiction/CN/<version>/allowance_catalog.json` | high-temperature allowance region check (2, consistency; optional for the six gaps) |
| `src/data/model/jurisdiction_settings/catalog/non_static/leave_catalog/leave_catalog_entry/+model.ts` | align the child update columns (3) |
| `tests/minimum_wage.test.ts`, `tests/statute_cn.test.ts` | scenarios above |

Land the changes in the CN seed version that is current at implementation; if that version is already sealed, cut the next version. Do not edit a sealed version in place.

## Caveats

- The Article 14 agreed-region exception is not modeled; the worksite default is lawful absent such an agreement. If the registered-place standard is higher and the parties agreed to it, the optional field is required to avoid underpaying.
- An existing consent or recognition obligation keeps its original `due_on`; adding an earlier slot later does not move it.
- `SEALED` is a prerequisite for the contract reminder; a never-sealed contract raises nothing.
- `CN_STANDARD_SHIFT_LIMIT` is a template guard, not a contract-category check; a longer template is refused even for a comprehensive-only pattern.
