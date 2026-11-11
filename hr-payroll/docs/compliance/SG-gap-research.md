# SG compliance gap research

Status: research and decision record, 9–10 November 2026. The seed and the models are what is in force; where this record differs, they stand. Seed folders are written `version_<v>`: the lineage has been renumbered since. Scope: `leave_catalog.json` of every SG version. Sources: MOM pages read 2026-11-10 (SSO answers 403 to automated reads).

## Changes

| Row                                                              | Change                                                                                                                                                                                                                                                                            | Statute                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_HOLIDAY_IN_LIEU`                                         | `lookup.window: LIFETIME` (grant stays 0): HR's manual days stand until taken; no window closes them.                                                                                                                                                                             | EA s.88; MOM public holidays page: no deadline to take a substituted day or time off in lieu.                                             |
| `ANNUAL_LEAVE_PART_TIME`                                         | The full-time row's bands (12–84 months) with `proration: COMPLETED_MONTHS` and `first_year_days: 7`, replacing the 3–11-month bands. The first year now settles at 7 × hours ÷ 44 (3.5 days at 22 h) instead of the 11-month band (3).                                           | EA s.88A(1)-(3); Part-Time Regulations: the comparable full-time entitlement in proportion to hours.                                      |
| `WORK_INJURY_MEDICAL_LEAVE`, `WORK_INJURY_HOSPITALISATION_LEAVE` | Were `paid_share` 0, so an injured worker lost salary. Now `opened_by: { WORK_ACCIDENT: { days: 0 } }` (unlimited, counted per accident), `days` 14 / 60, `max_months` 12, and `paid_share`: 1 while `ctx.used` < days, 2/3 after, 0 from 12 completed months after the accident. | WICA 2019 First Schedule para.4(1); MOM types of compensation: full AME to 14 outpatient / 60 hospitalisation days, then 2/3 to one year. |

HR records the accident on the contract as an event `WORK_ACCIDENT` with its date. Without it the rows count used days by
calendar year and apply no one-year stop.

## Confirmed without change

- **Government-paid leave reimbursement** (`GPML`, `GPPL`, `GPCL`, `GPSPL`, adoption): the Government reimburses the
  employer for leave the employer has already paid in full (CDCSA s.9, ss.12AA, 12B, 12DA–12DD, 12H–12J). The
  employee's pay comes from the leave row (`paid_share` empty). No row computes the employer's receivable; the
  `GOVERNMENT_PAID_LEAVE_CLAIM` effect raises the task to claim it.
- **WICA medical recovery**: the employer's recovery from its insurer (WICA ss.7–12, First Schedule). Not enforced: no
  row. An employee who paid a medical bill is reimbursed through `MEDICAL_TREATMENT_REIMBURSEMENT` (NET).
- **Shares**: annual, sick, hospitalisation, maternity, paternity, childcare, adoption and shared parental leave pay a
  normal day (employer pays; GP schemes reimburse). `UNPAID_INFANT_CARE_LEAVE` 0 (CDCSA s.12D), `UNPAID_LEAVE` 0
  (EA s.20A(1)(c)), `NS_LEAVE` 0 (no statutory pay; an employer paying under MINDEF's scheme sets 1 in Settings).
- **Payouts**: `ANNUAL_LEAVE` pays unused days at the gross rate of pay (day rate on 52 contract weeks × (basic + fixed
  allowance) ÷ basic); misconduct forfeits (the encashment automation reads `dismissed_for_misconduct`). MOM termination
  page: unused leave paid at the gross rate except misconduct. `PUBLIC_HOLIDAY_IN_LIEU` has none: MOM says nothing of
  untaken days at exit.
- **Proration basis** `WORKING_DAYS`: EA s.20A prices an incomplete month (no-pay leave included) as monthly gross ×
  days worked ÷ working days; `FIXED_MONTHLY` falls with `ctx.paid_share`, so the gross rate is prorated. Matches.

## Open for the owner

1. **Part-time leave units.** `part_time_pro_rata` scales days by hours ÷ 44, which is a full-time-day figure (7 × 20 ÷
   44 = 3.18 days = 25.5 h), but a slot takes a whole day of the part-timer's own, shorter day (4 h). A 5 × 4 h worker
   gets 3.18 of his days where the Regulations give 25.5 h = 6.4 of them. Affects `ANNUAL_LEAVE_PART_TIME`,
   `SICK_LEAVE_PART_TIME`, `HOSPITALIZATION_LEAVE_PART_TIME`. Hour-unit rows (`unit: 'HOUR'`) already take leave in the
   contract's hours; the entitlement would then be stated in hours.
2. **Part-time payout.** `ANNUAL_LEAVE_PART_TIME` has no `payout`, so a part-timer's unused leave is never paid at exit,
   though MOM's termination rule covers every Employment Act employee. Its day value depends on decision 1.
3. **Leaving year.** MOM prorates the current year's leave by completed months for an employee with over a year of
   service who leaves; the `SERVICE_YEAR` window grants the whole band at its start, so an exit cashes out the full year.
4. **AME.** WICA pays average monthly earnings (regular overtime included); `paid_share` pays at most a normal day. A
   difference is HR's adhoc entry.
5. `src/lib/payroll_engine/params.ts` per-code schemas were not regenerated (out of this round's scope): run
   `node scripts/generate-registries.mjs` once after the seed agents finish. Decoding ignores the new keys meanwhile, and
   every new key is already a declared leave param.

## Follow-up, 2026-11-10

Seed round 3 follow-up. Edits are in place in every version; items 1 and 2 above are closed, item 3 remains.

| Row                                                       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Statute                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ANNUAL_LEAVE_PART_TIME`                                  | `lookup.entitlement` converts the comparable full-time EA s.88A days to the part-timer's own normal days: full-time days × (part-time weekly hours ÷ 44) × (8 ÷ the part-timer's normal hours per day). It reads `normal_hours_per_week`, `normal_hours_per_day` (falling back to weekly ÷ days per week) and `full_time_days_per_week` 5.5. Under 12 months it uses 7 × completed months ÷ 12 without the s.88A(3) rounding, because reg.7(4) disapplies that subsection to part-timers. `payout` and the version's `ADDITIONAL_WAGES` subtotal were added so an exit encashment posts. | Employment (Part-Time Employees) Regulations regs.2(2), 7(1),(2),(4); EA ss.88A(1)–(3),(7)–(8) |
| `SICK_LEAVE_PART_TIME`, `HOSPITALIZATION_LEAVE_PART_TIME` | Same hours-to-own-days conversion on the s.89 bands (5/8/11/14 and 15/30/45/60). No `payout`: reg.8 provides no encashment. The existing reference to reg.7 (annual leave) was corrected to reg.8.                                                                                                                                                                                                                                                                                                                                                                                       | Employment (Part-Time Employees) Regulations regs.2(2), 8(1); EA s.89(1)(a),(b),(2)            |

The balance is kept to the half day the leave slot system can pay, rounded up: a 20 h week over 5 × 4 h days gets 6.5
own days in the first year (25.5 h ÷ 4 = 6.375), 7.5 after 12 months (29.09 h ÷ 4 = 7.27), 13 sick days
(50.9 h ÷ 4 = 12.73) and 55 hospitalisation days (218.2 h ÷ 4 = 54.55). A 3 × 8 h week gets 8.0 sick days
(61.1 h ÷ 8 = 7.64). Rounding up never pays below the statutory hours and keeps an exit encashment exact to the half-day
slots the automation writes; up to half a day more can be paid. Rounding to a finer figure would let the automation's
nearest-half-day cash-out round down and leave statutory hours unpaid.

`part_time_pro_rata` and `full_time_weekly_hours` stay on these rows only because `src/lib/payroll_engine/params.ts` has
not been regenerated; `lookup.entitlement` wins in `entitlementOf`, so the old full-time-day figure is not used. After
the registries are regenerated the inert keys can go.

### Leaving year still needs source

EA s.88A(2)–(3) prorates the current year's annual leave by completed months for an employee with at least 12 months'
service who leaves mid-year. The `SERVICE_YEAR` window grants the whole band at its start, and the leave `payout`
expression reads only `ctx.entry.quantity` — the unused balance, current grant plus carried days — with no split. Paying
the current grant at its completed-month share while paying carried days in full cannot be expressed; reducing the
entitlement at exit would also claw back days already taken and can drive the balance negative. No seed change fakes it.

**Owner decision:** either expose the window's `granted` and `carried` (or its start) to the leave `payout` context, or
have the ledger sync prorate the closing service year on exit. Until then an exit pays the full current service year for
`ANNUAL_LEAVE` and `ANNUAL_LEAVE_PART_TIME`: lawful overpayment, not exact statutory pay. Do not add a second annual-leave
row to work around it.

### Re-checked without change

- **WICA.** `WORK_INJURY_MEDICAL_LEAVE` and `WORK_INJURY_HOSPITALISATION_LEAVE` still pay full for the first 14 outpatient
  / 60 hospitalisation days, two-thirds after, nothing from 12 completed months; `WORK_ACCIDENT` opens each accident and
  `ctx.used` counts its days. WICA 2019 First Schedule para.4(1) and MOM's
  10 outpatient + 71 hospitalisation example (60 full, 11 at two-thirds) match the separate counters.
- **In-lieu.** `PUBLIC_HOLIDAY_IN_LIEU` remains `window: LIFETIME`, grant 0, no payout: HR's manual days stand until taken.
  EA s.88 and MOM's public-holidays page set no deadline.
- **Shares.** Every other SG leave row pays 1 (`paid_share` empty); `UNPAID_INFANT_CARE_LEAVE`, `NS_LEAVE` and
  `UNPAID_LEAVE` pay 0. No leave row prices a day off in money; the only `payout`s are `ANNUAL_LEAVE` and
  `ANNUAL_LEAVE_PART_TIME`.
