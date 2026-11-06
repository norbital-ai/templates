# HRMS model specification

Status: normative model contract. [The calculation architecture](0001-hrms-calculation-architecture.md) defines the engine, [the seed contract](0003-jurisdiction-seed-specification.md) seed replacement and [verification](0004-verification-gates.md) the gates.

## 1. Source tree

```text
src/data/model/
  employee_profile/
    employee_contract/
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
  roster/
    roster_entry/
```

Thirty-six models, eight apps and three automations (`statutory_research`, `statutory_materialize`, `invitation_profile`). A retired concept gets no compatibility model, alias or JSON bag.

Custom fields live beside models:

```text
src/data/custom_field/
  bank/
  references/
```

## 2. Invariants

1. One append-only ledger and one rebuildable balance projection; event-time and payroll-time writes never duplicate each other.
2. One linear, cycle-free `subtotal` chain per settings version; producers hold `subtotal_id`; a subtotal holds no catalogue list.
3. Statutory schemes evaluate transiently in `depends_on` order and persist only through ledger rows.
4. A payroll run owns coverage, source capture and row locks. No model is sealed by a payslip.
5. The payslip stores totals only; line and scheme detail is derived from the subtotal chain, entries and ledger.
6. Values live with their owner: jurisdiction law, employer schedule, contract terms, employee balances.

## 3. Jurisdiction and calculation

### `jurisdiction_settings`

`code`, `name`, `effective_range`, `currency`, `timezone`, `tax_year_start_month`, `employee_extension_schema`, `entity_extension_schema`, `lookup`, lifecycle `status`/`reason`.

`lookup` is a flat JSON map. It holds rounding (`rounding`, `rounding_scale`) and any statutory conversion constants the jurisdiction's formulas cite, such as a monthly divisor of 26. Ordinary hours and working days are not stored here.

No `output_bindings`, `minor_units`, `week_start`, `employment_classification`, attendance policy, `negative_net`, `recovery_order` or `coupled_solvers`.

### `subtotal`

`settings_id`, `code`, `name`, `previous_id`, optional `calculation`.

The first row (`previous_id = null`) computes base pay. Later rows accumulate employee lines by `subtotal_id`. One chain per settings version, no branch, cycle or cross-version link.

## 4. Catalogues

### Definition shape

| Field                                                      | Applies to     | Contract                                                                                                                               |
| ---------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `code`, `name`                                             | all            | Unique per `settings_id`; `code` is the accounting code                                                                                |
| `settings_id`                                              | all            | Owned sealed jurisdiction version                                                                                                      |
| `lookup`                                                   | all            | Flat constants and rates for this definition                                                                                           |
| `references`                                               | all            | Research/legal provenance; never on entries                                                                                            |
| `off_cycle_eligible`                                       | all            | An `OFF_CYCLE` run includes optional producers only when true; statutory schemes are not filtered                                      |
| `prorate`                                                  | allowance      | On: the line takes the share of the period paid. Off: it pays whole                                                                    |
| `subtotal_id`                                              | pay producers  | Nullable: null when the definition creates no pay line                                                                                 |
| `eligibility`, `conversion`, `incurred_on`                 | pay producers  | JS expressions; `conversion` is a nonnegative monetary magnitude                                                                       |
| `direction`, `party`                                       | pay producers  | `ADD`/`DEDUCT`; `EMPLOYEE`/`EMPLOYER`                                                                                                  |
| `lookup.grants`                                            | workplace case | The leave rows a confirmed case opens, with `days` to override a row's `grant_days`, and `keep_start` to leave the event's start alone |
| `lookup.pay_steps`                                         | leave          | What share of a day each stretch of an event loses, by `until_month` from the day its case began                                       |
| `pay_treatment`                                            | leave          | `PAID` or `UNPAID`; `UNPAID` prorates base pay                                                                                         |
| `kind`, `depends_on`, `employee_amount`, `employer_amount` | statutory      | `CONTRIBUTION`/`TAX`; scheme codes; JS amounts                                                                                         |

`work_interruption_catalog` and `workplace_case_catalog` carry `events` and a nullable `subtotal_id`; they create a payroll line only when that target is set.

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

Every entry has `entity_id`, `employment_id`, `catalog_id`, optional `payroll_run_id` and `evidence_file`; approval-bearing families add `status`.

`payroll_run_id` is the capture lock: a run that reads the entry sets it, and create/update/delete refuse while it is set. The same lock shape applies to `roster` and `roster_entry`, where the entry inherits the parent's lock.

| Entry             | Fields beyond the shared set                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| leave             | `days` — non-empty `{ date, part: AM \| PM }[]`; `is_reversal`; admission is `days.length / 2` half-days |
| claim             | `quantity`, `unit`, `incurred_on`, `is_reversal`                                                         |
| adhoc             | `description`, `quantity`, `unit`, `incurred_on`, `is_reversal`                                          |
| loan              | `quantity` (principal), `unit`, `repayment_period`                                                       |
| loan repayment    | `loan_id`, `amount`, `paid_on`, `payment_reference`, `is_reversal`                                       |
| work interruption | `kind`, `period`, `worksite`, `reason`                                                                   |
| workplace case    | `kind`, `opened_on`, `scheduled_on`, `closed_on`, `inputs`                                               |

## 5. Registrations

`registered_rule` — `settings_id`, `code`, `target_collection`, `events`, `reads`, `condition`, `validate`, `order`, `lookup`, `references`. A model with registry callbacks queries it for its collection and event; a false condition skips the rule, a false validation refuses the write.

`registered_effect` — `settings_id`, `lookup`, `code`, `name`, `references`, `source_collection`, `events`, `reads`, `condition`, `target_collection`, `target_action`, `effects`. After a commit the target model's `tap` queries it; the expression returns the records its `target_action` writes, with no automation or pipeline.

```text
write ──► registered_rule (collection, event) ──► refuse | commit
commit ──► registered_effect (collection, event) ──► target_action write
```

## 6. Employer, employee and calendar

- `entity` — `code?`, `name`, `settings_code`, `source_reference?`.
- `entity_profile_version` — `entity_id`, `name`, `effective_range`, `settings_code`, `input_schema_version_id`, `registrations` (each with its own period), `statutory_units`, `payment_schedule`, `pay_cutoff_day`, `bank` (custom field), `time_zone`, `registered_address`, `entity_extension_data`, lifecycle.
- `employee_profile` — exactly one required, unique `user_id` identity; `first_hired_on` company service date, contact, optional invitation link, face enrolment (`face_embedding`, `face_photo`, `face_enrollment_status`, `face_consent_at`, `face_enrolled_at`, `face_match_count`, `face_last_match_at`).
- `employee_contract` — `employee_id`, `entity_id`, `employee_number`, `employee_name`, `engagement` (`EMPLOYEE`, `PART_TIME`, `CONTRACTOR`, `INTERN`, `APPRENTICE`, `CONSULTANT`, `PAYEE`), `effective_range`, `service_started_on`, `signed_contract_period`, `terms`, `payroll`, `bank` (custom field), `final_pay_due_on`, `input_schema_version_id`, `employee_extension_data`, lifecycle. `terms` carries one agreed `rate { amount, unit }`, normal hours per day, normal hours and days per week and agreed allowances.

`jurisdiction_settings`, `entity_profile_version` and `employee_contract` share a DRAFT → SEALED → VOID lifecycle. A void requires a reason and is irreversible. A record already captured by a finalised payroll run may still be voided; the next run excludes it. No delete verb is exposed on these models. Transfer, settlement, service-continuity and void rules are normative in [transfer-semantics.md](transfer-semantics.md).

- `holiday`, `shift_pattern`, `shift_definition` — calendar and shift sources.
- `work_interruption_catalog(_entry)`, `workplace_case_catalog(_entry)` — entity-wide dated source data.

## 7. Balances and ledger

`employee_balance` — `employee_id` (unique), `account` JSON map keyed by family then code. One row per employee; projection only. The `leave` family holds what is left; `leave_window` holds the entitlement last applied (architecture section 4.1). **The balance follows the person, not the contract.** Payroll reads it by `employee_id`. A transfer never creates a second balance or edits the projection directly. A same-jurisdiction replacement carries the balance unchanged and repoints the loan and its open repayments to the successor contract/entity. A cross-jurisdiction transfer settles the old leave entitlement first: ending the old contract with a successor in another jurisdiction raises a normal exit encashment, whose approval posts the dated ledger movement and whose conversion pays in the old jurisdiction's final run. Loans transfer to the target when the target settings have a catalogue with the same code (new loan + schedule, dated DEDUCT/ADD `loan` pair), otherwise they settle from final pay; the old open schedule is removed first. Leave encashment is a leave request against the annual-leave catalogue with `encashment: true`; approving it deducts the balance and the payroll engine pays its conversion in `FINAL_PAY` on the next run whose assessment has not closed. A leave entry stamped with a `payroll_run_id` is posted and is never paid again.

`ledger_entry` — `balance_id`, `operation` (`CREATE`, `REMOVE`, `ADD`, `DEDUCT`), `account`, `code`, optional `amount` and `unit` (`DAY`, `CALENDAR_DAY`, `HOUR`, `MONEY`, `COUNT`), `effective_on`, optional `source_id` (`leave`, `claim`, `adhoc`, `loan`, `loan_repayment`, `payroll_run`). Rows are immutable.

## 8. Payroll and output

- `payroll_run` — `run_number`, `entity_id`, `period`, `kind` (`ON_CYCLE`, `OFF_CYCLE`), `settings_id`, `salary_coverage`, `pay_date`, state `UNPAID → PAID`. `pay_date` is the day the schedule pays. The pay date people see is the moment of the move to `PAID`, the locked row's last write; it is shown only then and never typed. The writer names `entity_id`, `period` and `kind`; the transform fills the rest from the entity's schedule, cutoff day and the law in force. An off-cycle run names the entries it pays through the write-only `attaches` layers, and only those people get a payslip. One on-cycle run per entity and period. Create runs the engine and writes payslips and ledger rows as one payload.
- `payroll_run` file syncs — `salary_listing` (xlsx), `ocbc_fast` (txt), `metro_bank` (txt), each with a `payroll_run_id` context. Format modules live under `src/lib/export_format_configuration/` and share one interface.
- `payslip` — `payroll_run_id`, `employee_id`, `employment_id`, `entity_id`, `basic_earnings`, `gross_earnings`, `net_pay`, `total_deductions`, `employer_cost`, `breakdown`. No status and no update: a payslip is read-only forever.
- `obligation` — free-form task: `entity_id`, optional `employee_id`/`employment_id`, `title`, optional `due_on`/`fulfilled_on`, `occurrence_key`, optional evidence and `waiver_reason`, state `OPEN → FULFILLED | WAIVED`. No kind, duty code, source entry, amount or settlement list.
- `bank` — a custom field (`bank_name`, `bank_code`, `bank_account_number`, `bank_account_name`) used by the employer version and the contract. File exports are model syncs, not a bank model.

## 9. Roster

`roster_entry` — `employment_id`, optional `payroll_run_id`, `work_date`, optional `shift_definition_id`, `planned_overtime_intervals`, `actual_worked_intervals`. One entry per employment and date. The contract's `shift_pattern_id` is the default; an entry exists only for a day that differs or has clock evidence.

A run sets `payroll_run_id` on the entries it captures, and a captured entry refuses create, update and delete.

## 10. Expression context

| Context         | Contents                                              |
| --------------- | ----------------------------------------------------- |
| `ctx.subject`   | employee, employment, employer data                   |
| `ctx.entry`     | catalogue entry and admitted quantity/unit            |
| `ctx.lookup`    | the jurisdiction's global lookup under the row's own  |
| `ctx.balances`  | employee balance account map, including `ytd`         |
| `ctx.base_pay`  | the running checkpoint; default base pay at the first |
| `ctx.day_rate`  | the jurisdiction's day rate for this person           |
| `ctx.subtotals` | completed earlier subtotal results only               |
| `ctx.statutory` | completed earlier statutory results by scheme code    |
| `ctx.work`      | the period's roster days and their priced minutes     |
| `ctx.run`       | payroll frame during a run                            |
| `ctx.reads`     | declared reads for validation and registered effects  |

No `ctx.components`, `ctx.rates`, `ctx.basis`, `ctx.assessment`, `ctx.recovery_budget`, `ctx.references` or `ctx.earlier`.

## 11. Migration constraints

- Schema history is generated by `bolt build`; destructive steps carry an explicit `-- accept:` line inside their block.
- Seed balances are ledger movements, not direct projection writes. Seed no payroll runs, payslips, YTD or per-run statutory results.
- The model tree is final. Do not add compatibility models, aliases, duplicate declarations or history bags in JSON.

## 12. Acceptance

A payroll change is accepted only when the manual probe matrix passes in the running application: twelve consecutive months for every supported jurisdiction, exact employee and employer statutory amounts, net and employer cost, YTD roll-up, leave/claim/loan approvals, reversals, statutory dependency order and unchanged salary export output. Each case records expected and actual values, evidence and PASS/FAIL/BLOCKED.
