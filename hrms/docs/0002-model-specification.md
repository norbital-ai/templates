# HRMS model specification

Reference: every model, its fields and its write rules. [The architecture](0001-hrms-calculation-architecture.md) explains how they fit together and [the seed specification](0003-jurisdiction-seed-specification.md) how a law version is authored.

## 1. Source tree

```text
src/data/model/
  employee_profile/
    employee_contract/
      contract_change/
    employee_balance/
      ledger_entry/
  entity/
    entity_change/
    entity_profile_version/
    holiday/
    pay_group/
    shift_pattern/
      shift_definition/
  jurisdiction_settings/
    catalog/
      static/
        allowance_catalog/
        overtime_catalog/
        statutory_contribution_catalog/
      non_static/
        adhoc_catalog/adhoc_catalog_entry/
        claim_catalog/claim_catalog_entry/
        leave_catalog/leave_catalog_entry/leave_catalog_entry_day/
        loan_catalog/loan_catalog_entry/loan_catalog_entry_repayment/
        workplace_case_catalog/workplace_case_catalog_entry/
        work_event_catalog/
    rules/
      registered_rule/
      registered_effect/
    subtotal/
  obligation/
  payroll_run/
    pay_amendment/
    payslip/
  roster_entry/
  statutory_finding/
    statutory_change/
  statutory_source/
  work_event/
    work_event/
```

The automations are `ledger`, `registered_effects`, `contract_materialize`, `entity_materialize`, `statutory_research`, `statutory_materialize` and `invitation_profile`. A retired concept gets no compatibility model, alias or JSON bag.

Custom fields live beside models:

```text
src/data/custom_field/
  bank/
  references/
```

## 2. Invariants

1. One append-only ledger and one rebuildable balance projection, written only through the ledger service: posting rides in the write of the record that posts, sync in the `ledger` automation.
2. One linear, cycle-free `subtotal` chain per settings version; producers hold `subtotal_id`; a subtotal holds no catalogue list.
3. Statutory schemes evaluate transiently in `depends_on` order and persist only through the payslip and ledger rows.
4. A payroll run owns coverage and the seals on what it priced. A seal says a run priced the row; it does not lock it. No model is sealed by a payslip.
5. The payslip stores totals and `breakdown`, the checkpoints, lines and statutory amounts as calculated. A payslip is never rewritten. A later run reads one only to work an amended paid period out again.
6. Values live with their owner: jurisdiction law, employer schedule, contract terms, employee balances.
7. No write reaches a paid period's inputs without its `pay_amendment` row in the same write ([corrections and integrity](0007-corrections-and-integrity.md)).

## 3. Jurisdiction and calculation

### `jurisdiction_settings`

`code`, `name`, `effective_range`, `currency`, `timezone`, `tax_year_start_month`, `conversions`, `ledger`, `employee_extension_schema`, `entity_extension_schema`, `lookup`, `work_regions` (the region keys the law recognises, each with its display name), lifecycle `status`/`reason`.

`conversions` is one typed block: `day` (`basis`, and `days` only on the FIXED arm), `hour` (`basis`, and `hours` only on the FIXED arm), `proration` (`CALENDAR_DAYS`, `WORKING_DAYS` or `DAY_RATE`: a missed day prices at the day rate), `rounding` (`mode`, `scale`, and `day_rate`: `RATE`, the default, rounds the day rate before it multiplies the days; `AMOUNT` rounds only the amount) and an optional `back_pay`: the code of the ad hoc row that prices back pay. Where it is named, a contract version signed after periods it reaches pays what it adds for them on that row, in the period it was signed in; where it is left out, a version applies from its start. `ledger.ytd_scope` (`JURISDICTION` or `EMPLOYER`) chooses the account scope for pay and statutory totals. `lookup` holds only shared tables and shared constants, each with a declared shape; a row's own lookup is local and wins. A value read by one row lives on that row. A contract's ordinary hours and working days are not stored here.

No `output_bindings`, `minor_units`, `week_start`, `employment_classification`, attendance policy, `negative_net`, `recovery_order` or `coupled_solvers`.

### `subtotal`

`settings_id`, `code`, `name`, `previous_id`, `balance_window` (`MONTH` or `YEAR`, default `YEAR`), optional `calculation`.

The first row (`previous_id = null`) computes base pay. Later rows accumulate employee lines by `subtotal_id`. One chain per settings version, no branch, cycle or cross-version link.

## 4. Catalogues

### Definition shape

| Field                                                      | Applies to          | Contract                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`, `description`                                      | all                 | Unique per `settings_id`; `code` is the accounting code; the description is required                                                                                            |
| `settings_id`                                              | all                 | Owned sealed jurisdiction version                                                                                                                                               |
| `lookup`                                                   | all                 | Constants, rates and tables for this definition                                                                                                                                 |
| `references`                                               | all                 | Research/legal provenance; never on entries                                                                                                                                     |
| `off_cycle_eligible`                                       | adhoc               | An `OFF_CYCLE` run includes the row only when true; every other family is on-cycle only                                                                                         |
| `balance_window`                                           | subtotal, statutory | `MONTH` posts to the month as well as the year; `YEAR` (default) posts to the year only                                                                                         |
| allowance amount source                                    | allowance           | Conversion reads `terms.allowances.<CODE>.amount` → flat agreed amount; otherwise the row computes                                                                              |
| `include_in_rate`                                          | allowance           | On: the amount is part of the wage a day or hour rate divides                                                                                                                   |
| `subtotal_id`                                              | pay producers       | Nullable: null when the definition creates no pay line                                                                                                                          |
| `eligibility`, `conversion`                                | pay producers       | JS expressions; `conversion` is a nonnegative monetary magnitude; leave has none; a loan row has `eligibility` only, checked when a loan is created                             |
| `paid_share`                                               | leave               | share of a normal day a day of this leave pays, 0 to 1 (outside is refused): empty 1, no pay 0, or a JS expression per half-day slot                                            |
| `payout`                                                   | leave               | JS: what days paid out pay (`ctx.entry.quantity`); present only on rows that can be cashed out                                                                                  |
| `direction`                                                | overtime, adhoc     | `ADD`/`DEDUCT`; omitted where the family has one direction                                                                                                                      |
| `party`                                                    | adhoc               | `EMPLOYEE`/`EMPLOYER`; every other family is employee-only                                                                                                                      |
| `lookup.opened_by`                                         | leave               | The contract events that open a row, with `days` to override its `grant_days`                                                                                                   |
| `lookup.accounts`                                          | leave, adhoc        | What a row moves instead of its default: `account`, `code`, `measure`, `operation`, `period`                                                                                    |
| `lookup.below_zero`                                        | statutory           | `REFUND`: a result below zero pays a refund line. Otherwise the row stops at zero                                                                                               |
| `lookup.pay_steps`                                         | leave               | What share of a day each stretch of an event loses, by `until_month` from the day its event began                                                                               |
| `kind`, `depends_on`, `employee_amount`, `employer_amount` | statutory           | `CONTRIBUTION`/`TAX`; scheme codes; JS amounts                                                                                                                                  |
| `assessed`                                                 | statutory           | Which month answers for carried pay. `EARNED` (default): worked out again for the earlier period. `PAID`: that charge stands; the pay counts as wages of the month that pays it |
| `employer_cost_subtotal_id`                                | statutory           | Optional: where the employer amount lands                                                                                                                                       |

`work_event_catalog` and `workplace_case_catalog` carry a nullable `subtotal_id`; `workplace_case_catalog` also carries `events`. The engine prices neither; a run only seals their entries.

Every catalog row is identified by `code`; `name` is not a field. A catalog table shows `code` and `description`, and a relation cell (its posting subtotal) renders the target's badge, never a raw id.

### Families

| Family         | Location                                | Entry model                                          |
| -------------- | --------------------------------------- | ---------------------------------------------------- |
| allowance      | `static/allowance_catalog`              | none                                                 |
| overtime       | `static/overtime_catalog`               | none                                                 |
| statutory      | `static/statutory_contribution_catalog` | none                                                 |
| leave          | `non_static/leave_catalog`              | `leave_catalog_entry`, `leave_catalog_entry_day`     |
| claim          | `non_static/claim_catalog`              | `claim_catalog_entry`                                |
| adhoc          | `non_static/adhoc_catalog`              | `adhoc_catalog_entry`                                |
| loan           | `non_static/loan_catalog`               | `loan_catalog_entry`, `loan_catalog_entry_repayment` |
| work event     | `non_static/work_event_catalog`         | `work_event`                                         |
| workplace case | `non_static/workplace_case_catalog`     | `workplace_case_catalog_entry`                       |

### Entries

Every entry has `entity_id`, `catalog_id`, optional `payroll_run_id` and `evidence_file`, except a loan repayment, which has its loan instead of a catalogue and no evidence. Leave, claim, adhoc, loan and loan repayment entries add `employment_id`. An entry that needs approval is held by its policy's approval flow, not by a status.

`payroll_run_id` is the seal: the run that prices the entry sets it, so no other run pays it again. A sealed entry may still be updated or deleted. A write that touches a period the person has a payslip for carries one `pay_amendment` row in the same write, or in the approving decision when it is held for approval, and the next run carries the difference. A record whose date moves loses its seal, so the period it joins prices it. While an unpaid run holds the person the write is refused. `roster_entry` has the same seal and the same rule.

**Three-layer catalog naming (owner directive, 2026-11-08).** A catalog that splits an entry over time has exactly
three models:

- `<family>_catalog` — configuration (eligibility, conversion, lookup).
- `<family>_catalog_entry` — who/why/employment/entity and the request's evidence.
- `<family>_catalog_entry_<part>` — the dated or scheduled child (`leave_catalog_entry_day`,
  `loan_catalog_entry_repayment`). The payroll run stamps `payroll_run_id` here, never on the catalog or the entry.

**Leave slots.** Leave is the one entry family that is changed in part.

- `encashment` (hidden, default false) marks days HR pays out for someone still employed. It is an ordinary entry,
  written directly and corrected or deleted in place. An exit's leave has no entry: the last payslip settles it.
- A leave entry keeps its dated half-day slots as `leave_catalog_entry_day` rows (`leave_entry_id`, `incurred_on`,
  `part`, unique per entry, date and part). The run stamps `payroll_run_id` on each slot it priced; the seal is per slot.
- **A slot removed, added or moved:** the entry is edited. The ledger posts that slot's difference. Where the slot's
  date is in a period the person was paid for, the write carries the amendment row and the next run carries the pay.
- Tests must prove: a slot removed before any run leaves no ledger residue; a paid slot removed posts exactly its
  inverse and leaves one open amendment row; and the leave balance is the correct figure after each step.

| Entry          | Fields beyond the shared set                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| leave          | `days` — non-empty `{ date, part: AM \| PM }[]`; `encashment`; admission is `days.length / 2`                                                           |
| claim          | `quantity`, `unit`, `incurred_on`                                                                                                                       |
| adhoc          | `description`, `quantity`, `unit`, `incurred_on`                                                                                                        |
| loan           | `quantity` (principal), `repayment_period`                                                                                                              |
| loan repayment | `loan_id`, `amount`, `paid_on`, `payment_reference`                                                                                                     |
| work event     | `from`, optional `to`, `location`, `description`, evidence; `employment_id` optional, so an event can be entity-wide                                    |
| workplace case | required `employment_id`; `kind`, `severity`, `occurred_on`, `location`, `reference`, `description`, `opened_on`, `scheduled_on`, `closed_on`, `inputs` |

## 5. Registrations

`registered_rule` — `settings_id`, `code`, `description`, `target_collection`, `events` (`create`, `update`, `delete`), `reads`, `condition`, `validate`, `order`, `lookup`, `references`. A model with registry callbacks queries it for its collection and event; a false condition skips the rule, a false validation refuses the write.

`registered_effect` — `settings_id`, `lookup`, `code`, `name`, `description`, `references`, `source_collection`, `events` (`create`, `update`, `delete`, `seal`, `exit`), `reads`, `condition`, `target_collection`, `target_action`, `effects`. After a commit the source model's `tap` queries it; the expression returns the records its `target_action` writes. A leave or claim entry's effects run in the `registered_effects` automation instead, under `payroll_execution`, once the entry is not pending. No effect targets the ledger or the balance: every seeded effect raises an `obligation`.

```text
write ──► registered_rule (collection, event) ──► refuse | commit
commit ──► registered_effect (collection, event) ──► target_action write
```

## 6. Employer, employee and calendar

- `entity` — stable identity: `code`, `name`, `settings_code`, `source_reference`, `epf_registered_on`, `socso_registered_on`.
- `pay_group` — one payroll of a company: `entity_id`, `name`, `payment_schedule` (frequency, pay days, cutoff). A group with a paid run keeps what moves pay in its schedule; a new schedule is a new group. `employee_contract.pay_group_id` names a person's group and `payroll_run.pay_group_id` the group a run pays; the run reads the schedule and cutoff here, not from the company or a legal version.
- `entity_profile_version` — `entity_id`, `name`, `representative_name`, `effective_range`, `settings_code`, `input_schema_version_id`, `bank` (custom field), `time_zone`, `registered_address`, `final_pay_loan_floor_percent`, `overtime_full_award_percent`, `pay_methods` (the better-than-law methods, each floored at the statute: `overtime_hour_basis` `STATUTORY`/`CONTRACT_WEEKLY`, `rest_day_hourly_multiplier`, `night_differential_basis` `WORKED`/`CLOCK_SPAN`/`WHOLE_NIGHT`, `contribution_split` `EVEN`/`FIRST_RUN`, `benefit_exclusion` `POOLED`/`EXCESS_TAXED`, `health_billing` `CURRENT`/`ARREARS`, `paid_leave`: leave codes the employer pays in full where the law leaves them unpaid), `entity_extension_data`, lifecycle `status`/`reason`.
- `entity_change` — `entity_id`, `field_path`, `old_value`, `new_value`, `effective_from`, `applied_version_id`, `notes`. One employer fact filed ahead of its day: `entity_materialize` seals it into a new version and ends the open one the day before. `old_value` is captured when filed.
- `employee_profile` — `name`, contact, `cumulative_service` (default false: count every stint, rehires included), `source_reference`, `documents` (no payroll reads them), a unique `user_id` (empty until the person accepts an invitation), optional invitation link, face enrolment (`face_embedding`, `face_photo`, `face_enrollment_status`, `face_consent_at`, `face_enrolled_at`).
- `employee_contract` — `employee_id`, `entity_id`, `pay_group_id`, `employee_number`, `engagement` (`EMPLOYEE`, `PART_TIME`, `CONTRACTOR`, `INTERN`, `APPRENTICE`, `CONSULTANT`, `PAYEE`), `effective_range`, `service_started_on` (only a credit from elsewhere; service comes from every stint at the employer), `signed_contract_period`, `terms`, `payroll`, `bank` (custom field), `final_pay_due_on`, `encash_leave` (default true: at an exit the last payslip pays out the leave left; leave taken beyond what the last day earned is taken back either way), `employee_extension_data`, lifecycle `status`/`reason`. No settings version is copied: its law is its entity's `settings_code` lineage on the day (its first day for validation), and the name comes from the profile. `terms` carries one agreed `rate { amount, unit }`, normal hours per day, normal hours and days per week, the worksite `work_region`, agreed allowances and an optional `signed_on`, the day the agreement was signed. A paid period reads its agreed terms from the latest version signed by its pay date; a version with no signed date counts as signed in time. The contract carries the universal facts: `events` (`kind`, `on`, `opened_on`, `ended_on`, `allocated_days`), `family` (one item per member: `relation` `CHILD`/`SPOUSE`/`PARENT`, optional `born_on`, `expected_on`, `has_income`, `disabled`, `studying`, a child's `allocations` per leave code), and `payroll` identity (`date_of_birth`, `gender`, `marital_status`, `nationality`, `birth_city`, `passport_number`). `employee_extension_data` holds only the jurisdiction's declared statutory data, never a universal fact. Every family count or flag (dependants, a spouse's income or disability, births, one child) derives from `family`; a child's `allocations` record HR's transfer of a shared parental pool without editing the ledger. `exit_ground` is native beside it; a work pass's last day is `terms.work_authorisation_expires_on`. A successor version starts on the 1st of a month; a hire, a rehire and an exit keep their real dates. The contract's write checks its terms against the law in force on its first day: the rate and normal time, a `statutory_work_category` the version lists, a `work_region` the version declares, and no shift of its pattern longer than `normal_hours_per_day`.
- `contract_change` — `employee_id`, `field_path`, `old_value`, `new_value`, `effective_from`, `applied_version_id`, `notes`. One dated change to a contract term or fact, filed ahead of its day. Payroll and the ledger never read it: on its day the `contract_materialize` automation seals it into a new contract version. If a paid run already covers its date, it stays filed and raises a task.
- An **exit** is not a record: it is a sealed contract version that ends with no successor of the same jurisdiction lineage. Its facts sit on that version (`effective_range.to`, `reason`, `exit_ground`, `final_pay_due_on`, `encash_leave`); the contract's write raises the `exit` event for the law's exit duties, and its own effect keeps the exit's other tasks and loan in step. The last payslip settles its leave. The save that ends a sealed version, or moves its end, may also add the jurisdiction's exit answers to its `employee_extension_data` (Indonesia's `termination_cause`): keys it did not hold. The facts it holds stand.

`jurisdiction_settings`, `entity_profile_version` and `employee_contract` share a DRAFT → SEALED → VOID lifecycle. A void requires a reason and is irreversible. A record a payroll run priced may still be voided: the void carries the amendment rows of the paid periods it covered, and no later run uses it. A version may be sealed over paid periods the same way. No delete verb is exposed on these models. Transfer, settlement, service-continuity and void rules are normative in [transfer-semantics.md](transfer-semantics.md).

- `holiday`, `shift_pattern`, `shift_definition` — calendar and shift sources. A `holiday` with `employee_id` is one person's holiday; without it, the company's. A holiday written in paid time carries the amendment rows of everyone it reaches. A `shift_pattern` is a `week_start` and either one weekday map (`days`) or a `cycle` of days for a rotation longer than a week; it carries no anchor date, because the contract's `effective_range` dates it. A shift pattern paid periods follow and a shift paid days use refuse a change: make a new one.
- `work_event_catalog` / `work_event`, `workplace_case_catalog(_entry)` — entity-wide dated source data.

## 7. Balances and ledger

`employee_balance` — `employee_id` (unique), `account` JSON map keyed by family (`leave`, `claim`, `pay`, `statutory`), code, period and measure. One row per employee; projection only. It holds accumulated values and entitlements, and what is left is derived. **The balance follows the person, not the contract.** Payroll reads it by `employee_id`. A transfer never creates a second balance or edits the projection directly. A same-jurisdiction replacement carries the balance unchanged and repoints the loan and its open repayments to the successor contract/entity. A cross-jurisdiction transfer settles the old leave first where the row has a `payout`: ending the old contract with a successor in another jurisdiction is an exit, and the old jurisdiction's last payslip settles the leave and posts the days. Loans transfer to the target when the target settings have a catalogue with the same code (new loan and schedule), otherwise they settle from final pay; the old open schedule is removed first. Loans never touch the ledger. A sealed leave entry answers only for its own days in each run, and a sealed claim, adhoc or repayment entry is never paid again.

`ledger_entry` — `balance_id`, `operation` (`ADD`, `DEDUCT`), `account`, `code`, `period`, `measure`, optional `amount` and `unit` (`DAY`, `CALENDAR_DAY`, `HOUR`, `MONEY`, `COUNT`), `effective_on`, `source` (plain text naming what caused the movement), optional `note`. Rows are immutable. Posting and
sync write them; HR writes one by hand on the employee profile as a manual adjustment (`source` `manual:<id>`, signed days
on a leave row's `entitled` or money on a claim row's `limit`, for the window holding `effective_on`, `note` the cause),
corrected only by an opposite row. A leave row that counts in hours (`lookup.unit` `HOUR`) holds hours: its manual
adjustments are hours, and a half day taken on it uses half the contract's `normal_hours_per_day`.

## 8. Payroll and output

- `payroll_run` — `run_number`, `entity_id`, `pay_group_id`, `period`, `kind` (`ON_CYCLE`, `OFF_CYCLE`), `settings_id`, `salary_coverage`, `pay_date`, state `UNPAID → PAID`. `pay_date` is the day the schedule pays. The pay date people see is the moment of the move to `PAID`, the row's last write; it is shown only then and never typed. The writer names the company, its pay group (where it has more than one), `period` and `kind`; the transform fills the rest from the pay group's schedule, cutoff day and the law in force. Each row a run prices and seals is linked through its link layers (`leave`, `leave_day`, `claim`, `adhoc`, `repayment`, `case`, `roster_entry`, `amendments`) at the revision the run read. An off-cycle run names the entries it pays, and any waiting `amendments` it carries, through those layers; only those people get a payslip. It refuses one another run already took. One on-cycle run per pay group and period. Create runs the engine and writes the run, its payslips and what they post as one payload. An on-cycle run also works out the amended paid periods of the people it pays, carries each difference on their payslip and takes the `pay_amendment` rows through its `amendments` layer. A run reads only its own jurisdiction's rows. An unpaid run can be deleted, and the delete carries the inverse of what it posted in its own write; a paid run cannot.
- `payroll_run` file syncs — `salary_listing` (xlsx), `ocbc_fast` (txt), `metro_bank` (txt), each with a `payroll_run_id` context. Format modules live under `src/lib/export_format_configuration/` and share one interface.
- `payslip` — `payroll_run_id`, `settings_id`, `employee_id`, `employment_id`, `entity_id`, `period`, `basic_earnings`, `gross_earnings`, `net_pay`, `total_deductions`, `employer_cost`, `ordinary_wages`, `employee_statutory`, `tax_withheld`, `breakdown`. No status and no update: a payslip is read-only forever. A breakdown line has `code`, `label`, `subtotal_id`, `amount`, `direction`, `party`, `source` and an optional `period`: the earlier period a carried line belongs to; empty is the payslip's own. The breakdown's `carried` lists where each carried difference posts: `[{ run_id, period, postings }]`, the run it corrects, its period and the ledger rows. The run's ledger plan posts them under its own source.
- `pay_amendment` — `employee_id`, `pay_group_id`, `period`, optional `payroll_run_id` (`on_delete: 'set_null'`). One paid pay period of one person to work out again. Empty `payroll_run_id` is open; set, that run carried it. Unique on person, group and period while open. Nobody keys one: the write that corrects a paid period leaves it, and so does a run that defers a recovery, for its own period.
- `obligation` — free-form task: `entity_id`, optional `employee_id`/`employment_id`, `title`, optional `due_on`/`fulfilled_on`, `occurrence_key`, optional evidence and `waiver_reason`, state `OPEN → FULFILLED | WAIVED`. No kind, duty code, source entry, amount or settlement list.
- `bank` — a custom field (`bank_name`, `bank_code`, `bank_account_number`, `bank_account_name`) used by the employer version and the contract. File exports are model syncs, not a bank model.

## 9. Roster

`roster_entry` — `employment_id`, optional `payroll_run_id`, `work_date`, optional `shift_definition_id`, `planned_overtime_intervals`, `overtime_as_time_off` (the worker takes the day's planned overtime as time off: the run prices none of it, and the payslip posts its hours to the version's one leave row whose lookup says `overtime_as_time_off: true`, an hour-unit row, `unit: 'HOUR'`), `consent` (`night_work`, `overtime`, `reference`), `actual_worked_intervals`, `findings` (the roster warnings stored on the day; a law's `roster_warnings.monthly_overtime_hours` is hours counted on every day, or `{ hours, day_types }` counted on the day types it names). One entry per employment and date. The contract's `terms.shift_pattern_id` supplies the plan; every employee with attendance gets a roster, office staff included, and a paid work day without a clock gets one. The roster is the cycle's source of truth: the planned days and the clock evidence. `ABS` is not a shift code or a roster row: the engine reads a planned work day the roster leaves out (no leave, no published holiday), or a planned `WORK` day with no clock, as an absence. Leave and PH are not absences, and the engine does not infer the worker class.

A run sets `payroll_run_id` on the days it prices. A priced day may be changed or deleted, and a day may be added in a paid period: the write carries the amendment row. A day is priced under the contract version in force on its date, whatever version it points at.

## 10. Expression context

| Context             | Contents                                                              |
| ------------------- | --------------------------------------------------------------------- |
| `ctx.subject`       | employee, employment, employer data                                   |
| `ctx.entry`         | catalogue entry and admitted quantity/unit                            |
| `ctx.lookup`        | the jurisdiction's shared tables and constants under the row's own    |
| `ctx.balances`      | `ytd`, `statutory_contribution`, `month`, `years`                     |
| `ctx.base_pay`      | the running checkpoint; default base pay at the first                 |
| `ctx.day_rate`      | the jurisdiction's day rate for this person                           |
| `ctx.hour_rate`     | the jurisdiction's hour rate for this person                          |
| `ctx.month_wage`    | the person's monthly wage, included allowances with it                |
| `ctx.calendar_days` | calendar days of the salary coverage                                  |
| `ctx.working_days`  | ordinary working days of the salary coverage                          |
| `ctx.paid_share`    | allowance: the share of the period paid, the salary's own             |
| `ctx.subtotals`     | completed earlier subtotal results only                               |
| `ctx.statutory`     | completed earlier statutory results by scheme code                    |
| `ctx.overtime`      | the run's overtime pay, in statutory evaluation                       |
| `ctx.posted`        | what this run's ad hoc entries post to a statutory account            |
| `ctx.work`          | the period's roster days and their priced minutes                     |
| `ctx.leave`         | the run's priced leave slots: `code`, `date`, `part`, `paid_share`    |
| `ctx.run`           | payroll frame during a run                                            |
| `ctx.reads`         | declared reads for validation and registered effects                  |
| `ctx.event`         | the write a rule or effect answers to; the fact an entitlement counts |
| `ctx.used`          | leave `paid_share`: days of the row its window used before the slot   |
| `ctx.work_events`   | applicable work events: entity-wide plus this employment's            |
| `ctx.as_of`         | the date the expression is evaluated for                              |

The employment a run or sync hands to a row (`ctx.subject.employment`), and a registered rule's or effect's contract
read that names either field, carries two worked-out starts: `service_started_on`, the service start
(`cumulative_service` decides whether earlier stints count; a credit from elsewhere wins where earlier), and
`employment_started_on`, the start of the current unbroken stint, for statutes that count employment in the year rather
than service.

No `ctx.components`, `ctx.rates`, `ctx.basis`, `ctx.assessment`, `ctx.recovery_budget`, `ctx.references` or `ctx.earlier`.

## 10.1 Work events

A `work_event_catalog` row is jurisdiction configuration: its code is the event type, with no category enum and no
suspension catalog. A `work_event` records a dated real-world condition — heat period, hurricane, earthquake, epidemic
or suspension — with an entity, optional employment, catalog reference, start, optional end, location and evidence.
The run and the leave sync expose applicable events as `ctx.work_events`. The event pays nothing; an allowance, adhoc
or leave row reads it and remains the thing that posts. Workplace cases stay employee-specific incidents.

## 11. Schema and seed constraints

- Schema history is generated by `bolt build`; destructive steps carry an explicit `-- accept:` line inside their block.
- Seed balances are ledger movements, not direct projection writes. Seed no payroll runs, payslips, YTD or per-run statutory results.
- The model tree is final. Do not add compatibility models, aliases, duplicate declarations or history bags in JSON.

## 12. Acceptance

A payroll change is accepted only when every mechanism it touches has a test. How legal values are verified is in [statutory coverage](0009-statutory-coverage.md#how-it-is-verified).
