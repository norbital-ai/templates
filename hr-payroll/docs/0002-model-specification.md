# HRMS model specification

Status: normative model contract. [The calculation architecture](0001-hrms-calculation-architecture.md) defines the engine, [the seed contract](0003-jurisdiction-seed-specification.md) the seed and [verification](0004-verification-gates.md) the gates.

## 1. Source tree

```text
src/data/model/
  employee_profile/
    employee_contract/
      contract_change/
    employee_balance/
      ledger_entry/
  entity/
    entity_profile_version/
    holiday/
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
        leave_catalog/leave_catalog_entry/
        loan_catalog/loan_catalog_entry/loan_repayment_entry/
        work_interruption_catalog/work_interruption_catalog_entry/
        workplace_case_catalog/workplace_case_catalog_entry/
    rules/
      registered_rule/
      registered_effect/
    subtotal/
  obligation/
  payroll_run/
    payslip/
  roster_entry/
  statutory_finding/
    statutory_change/
  statutory_source/
```

Thirty-seven models, seven apps, one kiosk and five automations (`ledger`, `contract_materialize`, `statutory_research`, `statutory_materialize`, `invitation_profile`). A retired concept gets no compatibility model, alias or JSON bag.

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
4. A payroll run owns coverage, source capture and row locks. No model is sealed by a payslip.
5. The payslip stores totals and `breakdown`, the checkpoints, lines and statutory amounts as calculated. No later run reads a payslip.
6. Values live with their owner: jurisdiction law, employer schedule, contract terms, employee balances.

## 3. Jurisdiction and calculation

### `jurisdiction_settings`

`code`, `name`, `effective_range`, `currency`, `timezone`, `tax_year_start_month`, `conversions`, `ledger`, `employee_extension_schema`, `entity_extension_schema`, `lookup`, lifecycle `status`/`reason`.

`jurisdiction_settings` declares the conversions as one typed `conversions` block: `day` (`basis`, and `days` only on the FIXED arm), `hour` (`basis`, and `hours` only on the FIXED arm), `proration` and `rounding` (`mode`, `scale`). `ledger.ytd_scope` (`JURISDICTION` or `EMPLOYER`) chooses the account scope for pay and statutory totals. `lookup` holds only shared tables and shared constants, each with a declared shape; a row's own lookup is local and wins. A value read by one row lives on that row. A contract's ordinary hours and working days are not stored here.

No `output_bindings`, `minor_units`, `week_start`, `employment_classification`, attendance policy, `negative_net`, `recovery_order` or `coupled_solvers`.

### `subtotal`

`settings_id`, `code`, `name`, `previous_id`, `balance_window` (`MONTH` or `YEAR`, default `YEAR`), optional `calculation`.

The first row (`previous_id = null`) computes base pay. Later rows accumulate employee lines by `subtotal_id`. One chain per settings version, no branch, cycle or cross-version link.

## 4. Catalogues

### Definition shape

| Field                                                      | Applies to                    | Contract                                                                                          |
| ---------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| `code`, `name`                                             | all                           | Unique per `settings_id`; `code` is the accounting code                                           |
| `settings_id`                                              | all                           | Owned sealed jurisdiction version                                                                 |
| `lookup`                                                   | all                           | Constants, rates and tables for this definition                                                   |
| `references`                                               | all                           | Research/legal provenance; never on entries                                                       |
| `off_cycle_eligible`                                       | adhoc                         | An `OFF_CYCLE` run includes the row only when true; every other family is on-cycle only           |
| `balance_window`                                           | subtotal, statutory           | `MONTH` posts to the month as well as the year; `YEAR` (default) posts to the year only           |
| `prorate`                                                  | allowance                     | On: the line takes the share of the period paid. Off: it pays whole                               |
| `include_in_rate`                                          | allowance                     | On: the amount is part of the wage a day or hour rate divides                                     |
| `subtotal_id`                                              | pay producers                 | Nullable: null when the definition creates no pay line                                            |
| `eligibility`, `conversion`, `incurred_on`                 | pay producers                 | JS expressions; `conversion` is a nonnegative monetary magnitude                                  |
| `direction`                                                | overtime, leave, claim, adhoc | `ADD`/`DEDUCT`; omitted where the family has one direction                                        |
| `party`                                                    | allowance, claim, adhoc       | `EMPLOYEE`/`EMPLOYER`; overtime/leave/loan are employee-only                                      |
| `lookup.opened_by`                                         | leave                         | The contract events that open a row, with `days` to override its `grant_days`                     |
| `lookup.accounts`                                          | leave, adhoc                  | What a row moves instead of its default: `account`, `code`, `measure`, `operation`, `period`      |
| `lookup.below_zero`                                        | statutory                     | `REFUND`: a result below zero pays a refund line. Otherwise the row stops at zero                 |
| `lookup.pay_steps`                                         | leave                         | What share of a day each stretch of an event loses, by `until_month` from the day its event began |
| `pay_treatment`                                            | leave                         | `PAID` or `UNPAID`; `UNPAID` prorates base pay                                                    |
| `kind`, `depends_on`, `employee_amount`, `employer_amount` | statutory                     | `CONTRIBUTION`/`TAX`; scheme codes; JS amounts                                                    |
| `employer_cost_subtotal_id`                                | statutory                     | Optional: where the employer amount lands                                                         |

`work_interruption_catalog` and `workplace_case_catalog` carry `events` and a nullable `subtotal_id`. The engine prices neither; a run only seals their entries.

### Families

| Family                 | Location                                | Entry model                                  |
| ---------------------- | --------------------------------------- | -------------------------------------------- |
| allowance              | `static/allowance_catalog`              | none                                         |
| overtime               | `static/overtime_catalog`               | none                                         |
| statutory contribution | `static/statutory_contribution_catalog` | none                                         |
| leave                  | `non_static/leave_catalog`              | `leave_catalog_entry`                        |
| claim                  | `non_static/claim_catalog`              | `claim_catalog_entry`                        |
| adhoc                  | `non_static/adhoc_catalog`              | `adhoc_catalog_entry`                        |
| loan                   | `non_static/loan_catalog`               | `loan_catalog_entry`, `loan_repayment_entry` |
| work interruption      | `non_static/work_interruption_catalog`  | `work_interruption_catalog_entry`            |
| workplace case         | `non_static/workplace_case_catalog`     | `workplace_case_catalog_entry`               |

### Entries

Every entry has `entity_id`, `catalog_id`, optional `payroll_run_id` and `evidence_file`, except a loan repayment, which has its loan instead of a catalogue and no evidence. Leave, claim, adhoc, loan and loan repayment entries add `employment_id`. An entry that needs approval is held by its policy's approval flow, not by a status.

`payroll_run_id` is the capture lock: a run that seals the entry sets it, and update and delete refuse while it is set. `roster_entry` has the same lock.

| Entry             | Fields beyond the shared set                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| leave             | `days` — non-empty `{ date, part: AM \| PM }[]`; `encashment`; `reverses`; admission is `days.length / 2` |
| claim             | `quantity`, `unit`, `incurred_on`, `reverses`                                                             |
| adhoc             | `description`, `quantity`, `unit`, `incurred_on`, `reverses`                                              |
| loan              | `quantity` (principal), `repayment_period`                                                                |
| loan repayment    | `loan_id`, `amount`, `paid_on`, `payment_reference`, `reverses`                                           |
| work interruption | `period`, `worksite`, `reason`; no `employment_id`                                                        |
| workplace case    | `kind`, `opened_on`, `scheduled_on`, `closed_on`, `inputs`; no `employment_id`                            |

## 5. Registrations

`registered_rule` — `settings_id`, `code`, `target_collection`, `events`, `reads`, `condition`, `validate`, `order`, `lookup`, `references`. A model with registry callbacks queries it for its collection and event; a false condition skips the rule, a false validation refuses the write.

`registered_effect` — `settings_id`, `lookup`, `code`, `name`, `references`, `source_collection`, `events`, `reads`, `condition`, `target_collection`, `target_action`, `effects`. After a commit the source model's `tap` queries it; the expression returns the records its `target_action` writes, with no automation or pipeline. No effect targets the ledger or the balance: every seeded effect raises an `obligation`.

```text
write ──► registered_rule (collection, event) ──► refuse | commit
commit ──► registered_effect (collection, event) ──► target_action write
```

## 6. Employer, employee and calendar

- `entity` — `code?`, `name`, `settings_code`, `source_reference?`.
- `entity_profile_version` — `entity_id`, `name`, `effective_range`, `settings_code`, `input_schema_version_id`, `registrations` (each with its own period), `statutory_units`, `payment_schedule`, `pay_cutoff_day`, `bank` (custom field), `time_zone`, `registered_address`, `final_pay_loan_floor_percent`, `overtime_full_award_percent`, `entity_extension_data`, lifecycle `status`/`reason`.
- `employee_profile` — `name`, contact, `source_reference`, `first_hired_on` company service date, `documents` (uploaded by HR or the employee, no payroll reads them), a unique `user_id` that stays empty until the person accepts an invitation, optional invitation link, face enrolment (`face_embedding`, `face_photo`, `face_enrollment_status`, `face_consent_at`, `face_enrolled_at`, `face_match_count`, `face_last_match_at`).
- `employee_contract` — `employee_id`, `entity_id`, `employee_number`, `employee_name`, `engagement` (`EMPLOYEE`, `PART_TIME`, `CONTRACTOR`, `INTERN`, `APPRENTICE`, `CONSULTANT`, `PAYEE`), `effective_range`, `service_started_on`, `signed_contract_period`, `terms`, `payroll`, `bank` (custom field), `final_pay_due_on`, `input_schema_version_id`, `employee_extension_data`, lifecycle `status`/`reason`. `terms` carries one agreed `rate { amount, unit }`, normal hours per day, normal hours and days per week and agreed allowances. `employee_extension_data` holds what the jurisdiction's `employee_extension_schema` declares, including `events`, the dated facts: `kind`, `on`, `opened_on`, `ended_on`, `document`.
- `contract_change` — `employee_id`, `field_path`, `old_value`, `new_value`, `effective_from`, `applied_version_id`, `notes`. One dated change to a contract term or fact, filed ahead of its day. Payroll and the ledger never read it: on its day the `contract_materialize` automation seals it into a new contract version.

`jurisdiction_settings`, `entity_profile_version` and `employee_contract` share a DRAFT → SEALED → VOID lifecycle. A void requires a reason and is irreversible. A record a payroll run already captured may still be voided; the next run excludes it. No delete verb is exposed on these models. Transfer, settlement, service-continuity and void rules are normative in [transfer-semantics.md](transfer-semantics.md).

- `holiday`, `shift_pattern`, `shift_definition` — calendar and shift sources.
- `work_interruption_catalog(_entry)`, `workplace_case_catalog(_entry)` — entity-wide dated source data.

## 7. Balances and ledger

`employee_balance` — `employee_id` (unique), `account` JSON map keyed by family (`leave`, `claim`, `pay`, `statutory`), code, period and measure. One row per employee; projection only. It holds accumulated values and entitlements, and what is left is derived. **The balance follows the person, not the contract.** Payroll reads it by `employee_id`. A transfer never creates a second balance or edits the projection directly. A same-jurisdiction replacement carries the balance unchanged and repoints the loan and its open repayments to the successor contract/entity. A cross-jurisdiction transfer settles the old leave first where the row sets `encash_on_exit`: ending the old contract with a successor in another jurisdiction raises a normal exit encashment, a leave entry with `encashment: true` whose own posting takes the days and whose conversion pays in the old jurisdiction's final run. Loans transfer to the target when the target settings have a catalogue with the same code (new loan and schedule), otherwise they settle from final pay; the old open schedule is removed first. Loans never touch the ledger. A sealed leave entry answers only for its own days in each run, and a sealed claim, adhoc or repayment entry is never paid again.

`ledger_entry` — `balance_id`, `operation` (`CREATE`, `REMOVE`, `ADD`, `DEDUCT`), `account`, `code`, `period`, `measure`, optional `amount` and `unit` (`DAY`, `CALENDAR_DAY`, `HOUR`, `MONEY`, `COUNT`), `effective_on`, `source` (plain text naming what caused the movement). Rows are immutable.

## 8. Payroll and output

- `payroll_run` — `run_number`, `entity_id`, `period`, `kind` (`ON_CYCLE`, `OFF_CYCLE`), `settings_id`, `salary_coverage`, `pay_date`, state `UNPAID → PAID`. `pay_date` is the day the schedule pays. The pay date people see is the moment of the move to `PAID`, the locked row's last write; it is shown only then and never typed. The writer names `entity_id`, `period` and `kind`; the transform fills the rest from the entity's schedule, cutoff day and the law in force. An off-cycle run names the entries it pays through the write-only `attaches` layers, and only those people get a payslip. One on-cycle run per entity and period. Create runs the engine and writes the run, its payslips and what they post as one payload.
- `payroll_run` file syncs — `salary_listing` (xlsx), `ocbc_fast` (txt), `metro_bank` (txt), each with a `payroll_run_id` context. Format modules live under `src/lib/export_format_configuration/` and share one interface.
- `payslip` — `payroll_run_id`, `settings_id`, `employee_id`, `employment_id`, `entity_id`, `period`, `basic_earnings`, `gross_earnings`, `net_pay`, `total_deductions`, `employer_cost`, `ordinary_wages`, `additional_wages`, `employee_statutory`, `employer_statutory`, `tax_withheld`, `breakdown`. No status and no update: a payslip is read-only forever.
- `obligation` — free-form task: `entity_id`, optional `employee_id`/`employment_id`, `title`, optional `due_on`/`fulfilled_on`, `occurrence_key`, optional evidence and `waiver_reason`, state `OPEN → FULFILLED | WAIVED`. No kind, duty code, source entry, amount or settlement list.
- `bank` — a custom field (`bank_name`, `bank_code`, `bank_account_number`, `bank_account_name`) used by the employer version and the contract. File exports are model syncs, not a bank model.

## 9. Roster

`roster_entry` — `employment_id`, optional `payroll_run_id`, `work_date`, optional `shift_definition_id`, `planned_overtime_intervals`, `actual_worked_intervals`, `findings` (the roster warnings stored on the day). One entry per employment and date. The contract's `terms.shift_pattern_id` is the default; an entry exists only for a day that differs or has clock evidence.

A run sets `payroll_run_id` on the entries it captures, and a captured entry refuses create, update and delete.

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
| `ctx.subtotals`     | completed earlier subtotal results only                               |
| `ctx.statutory`     | completed earlier statutory results by scheme code                    |
| `ctx.overtime`      | the run's overtime pay, in statutory evaluation                       |
| `ctx.work`          | the period's roster days and their priced minutes                     |
| `ctx.run`           | payroll frame during a run                                            |
| `ctx.reads`         | declared reads for validation and registered effects                  |
| `ctx.event`         | the write a rule or effect answers to; the fact an entitlement counts |
| `ctx.as_of`         | the date the expression is evaluated for                              |

No `ctx.components`, `ctx.rates`, `ctx.basis`, `ctx.assessment`, `ctx.recovery_budget`, `ctx.references` or `ctx.earlier`.

## 11. Schema and seed constraints

- Schema history is generated by `bolt build`; destructive steps carry an explicit `-- accept:` line inside their block.
- Seed balances are ledger movements, not direct projection writes. Seed no payroll runs, payslips, YTD or per-run statutory results.
- The model tree is final. Do not add compatibility models, aliases, duplicate declarations or history bags in JSON.

## 12. Acceptance

A payroll change is accepted only when the manual probe matrix passes in the running application: twelve consecutive months for every supported jurisdiction, exact employee and employer statutory amounts, net and employer cost, YTD roll-up, leave, claim and loan entries, reversals, statutory dependency order and unchanged salary export output. Each case records expected and actual values, evidence and PASS/FAIL/BLOCKED.
