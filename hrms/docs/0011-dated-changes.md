# RFC 0011: Dated changes, edited in place

**Status: accepted by the owner on 2026-11-13, on the condition that it simplifies the codebase and the experience of HR. Being built in the order of section 11: the fold and the law have landed (steps 1 and 2); the company and the person have not.** [Section 0 of the architecture](0001-hrms-calculation-architecture.md#0-the-design-is-fixed) describes the source tree as it stands, so its text on contract and employer versions holds until steps 3 to 5 land. Section 9 lists the section 0 text each step replaces.

## 1. Why

Three problems, one cause.

- **The seed repeats itself.** `seed/public/jurisdiction` holds 49 full copies of nine laws: 17 MB, of which about 4 MB is unique. A typical version changes 2 to 7 rows of 120 to 230. A fix to one row is hand-applied to every copy that holds it, and what a version changed cannot be read from its files.
- **Three kinds of record are frozen copies.** A contract, an employer profile and a law are each a chain of sealed full versions with a draft, sealed and void state. A change is a new copy. A mistake is a void and a replacement.
- **A change filed ahead is a fourth kind of record.** `contract_change`, `entity_change` and `statutory_change` each hold a dated delta, and an automation each turns them into the next sealed copy.

The cause: the design treats "this value changes on a date" and "this record is locked" as one thing. They are not. Payroll needs the first. It does not need the second: a correction is worked out as what a period should pay now, less what was paid for it, and that reads the paid payslips, never an old copy of a record.

## 2. The concept

Every value payroll reads is one of three kinds.

| Kind                  | What it is                                       | Examples                                                             | How HR changes it                        |
| --------------------- | ------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------- |
| **Plain field**       | Never changes, so an edit is always a correction | Date of birth, identity number, a company's name                     | Edit in place                            |
| **Self-dated record** | Carries its own real-world date                  | A child, a leave day, a roster day, a holiday                        | Edit, move or delete in place            |
| **Dated change**      | "From this date, these fields are now this"      | A raise, a new tax residency, a new pay method, a new statutory rate | Add, edit, move or delete the change row |

- No record has a draft, sealed or void state. No record is a version of another.
- A change row is **sparse**: it holds only the fields it changes. A raise row holds the new rate and nothing else.
- An empty field on a person's or a company's change row means unchanged: in Bolt an optional field left out and one set to nothing are the same `null`. A value taken away from a date is named in the row's `clears`, a list of field names. A field is replaced whole; a list or a record is not merged.
- A change row has a start date and no end date. The value in force on a day is the **fold**: the change rows dated on or before that day, applied oldest first. The timeline is contiguous and non-overlapping by construction; no constraint keeps it so.
- A change dated in the future is a row not yet in force. Nothing materialises it.
- A value wrong since the start is corrected on the row that set it, and every later day follows.
- The history table is for audit and approvals only. Nothing in payroll, the ledger or a screen reads it.

## 3. The models

### Person

| Model                  | Kind       | Holds                                                                                                                                                                                                                             |
| ---------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `employee_profile`     | Plain      | Name, contact, documents, login, face enrolment, `cumulative_service`, and the person's fixed particulars: date of birth, identity number, gender, bank                                                                           |
| `employment`           | Plain      | One stint with one company: `employee_id`, `entity_id`, employee number, engagement, first day, last day, `service_started_on`, and the exit answers (`exit_ground`, `encash_leave`, `final_pay_due_on`, `reason`)                |
| `contract_terms`       | Dated      | `employment_id`, `effective_from`, `signed_on`, and any of the agreed terms: rate, normal hours and days, allowances, shift pattern, pay group, job title, department, work category, work region and the rest of today's `terms` |
| `statutory_parameters` | Dated      | `employment_id`, `effective_from`, and any of what the law's formulas read of the person: residency, marital status, nationality, `statutory.<SCHEME>` and the other fields the jurisdiction's extension schema declares          |
| `dependant`            | Self-dated | `employee_id`, relation, name, `born_on` or `expected_on`, `has_income`, `disabled`, `studying`, allocations                                                                                                                      |

- Every entry, payslip, obligation and ledger source that names `employment_id` names the stint. Today it names whichever sealed version was current when the row was written.
- A rehire, and a move to another company, is a new stint. Stints of one person do not overlap; that one constraint stays.
- An **exit** is a stint with a last day and no stint under the same law starting the next day. The rule is today's, read from stints instead of versions.
- Terms and statutory parameters are two families because they are two questions: what was agreed, and what the law is told about the person. Only terms carry a signed date.
- `employee_extension_data` becomes `statutory_parameters`, and `entity_extension_data` the company's. The jurisdiction's extension schema still declares them, and a field still exists only because a formula reads it or the salary listing shows it.
- Dated life events (`events[]`) are self-dated and stay a list on the stint.

### Company

| Model           | Kind  | Holds                                                                                                                                       |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity`        | Plain | Code, name, jurisdiction code, representative, registered address, registrations, time zone, bank                                           |
| `entity_change` | Dated | `entity_id`, `effective_from`, and any of: `pay_methods`, the loan floor and overtime award percentages, the company's statutory parameters |

`entity_profile_version` goes. `pay_group`, `holiday`, `shift_pattern` and `shift_definition` are unchanged.

### Law

| Model                 | Kind  | Holds                                                                                                                                                  |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jurisdiction`        | Plain | Code, name, currency, time zone, tax year start                                                                                                        |
| `jurisdiction_change` | Dated | `jurisdiction_code`, `effective_from`, `finding_id` (optional), and `law`: for the first row the whole law as one document, for each later row a patch |

An entry's field is `catalog_code`.

- The law document is keyed by family, then by row code: `conversions`, `ledger`, `lookup`, `work_regions`, the two extension schemas, `subtotal`, the eight catalogue families, `registered_rule`, `registered_effect`. A row's fields are today's.
- A patch has the same keys and holds only what changes. A field set to `null` is removed; a row set to `null` is removed. A table or an expression is replaced whole.
- `jurisdiction_settings`, the twelve tables under it and `statutory_change` go.
- **Every reference into the law is a code.** An entry names its catalogue row by `code`, a subtotal its predecessor, a catalogue row its subtotal, a company its jurisdiction. No row of the law has an id, in the workspace or in the seed, and `catalog_id`, `settings_id`, `subtotal_id`, `previous_id` and `input_schema_version_id` go. The engine already maps entries by code across versions.
- Records that are rows of their own keep Bolt's references to each other: person, stint, company, pay group, shift, run, payslip.
- A run stores the date whose law it priced on (its pay date), not a version id.
- A patch written by statutory research carries its `finding_id` and is in force only while that finding is `CONFIRMED`. That is the one gate left, and it belongs to the approval of the finding, not to the record.

## 4. Reading

- **One fold, used three times.** `inForce(rows, day)` applies the change rows dated on or before `day`, oldest first, and remembers which row set each field. Person, company and law use the same function.
- **A run folds once, at admit.** One law document for its pay date, one company state per company, one state per person. An amended earlier period folds for its own pay date in the same single further request it makes today.
- **Formulas read what they read now.** The fold builds `ctx.subject.employment`, `ctx.subject.employer` and the law's rows in the shape the seeded expressions already use (`terms`, `family`, `payroll`, the statutory parameters, the first and last day), so no formula in the law is rewritten for this change. Renaming a context root is its own change.
- **No stored checkpoint.** The folded state is derived and never written. A chain is a dozen rows at most.
- **Forward only.** The base is the oldest row and patches run forward, so a correction to the base reaches every later day unless a later row set the same field. A reverse chain could not do that.
- **Agreed terms and the signed date.** A `contract_terms` row signed after a period's pay date does not apply to that period. What it adds for earlier periods is back pay of the signing month, on the row the law names in `conversions.back_pay`. A law that names none applies the row from its date. Statutory parameters apply from their date; they have no signed date. This is today's rule; the row is now the raise itself.
- **First of a month.** A change to a person's terms or statutory parameters is dated the first of a month. The first and last day of a stint keep their real dates. A run still never prices a month on two sets of terms. Law and company changes take any date, as now.

## 5. Writing

- **One question on save.** Saving a dated field asks: was it always so, or does it change from a date? The first edits the row that set the value. The second adds a change row.
- **The profile is one screen.** Its first section holds the plain fields. Each dated family has its own tab on the profile's vertical rail, shown as a timeline, newest first: **Contract** (the stints, and under each its terms rows: hired, each change, the last day), **Statutory** (the parameter rows), **Family** (the dependants, by birth date), **Events**. A timeline row shows its date and only what it changed, and is edited, moved or deleted where it stands. The head of each tab shows what is in force today.
- **The company** is the same screen in small: its plain fields, and one timeline of its changes.
- **The jurisdiction screens look as they do now.** The same tabs: lookup, calculation overview, catalogue, registered rules, registered behaviour, compare. The version tab becomes the timeline of the law's changes, a tab shows the law in force on the day chosen there, and compare shows what a change did: the patch.
- **Every write is checked where a seal checked.** A law write validates the folded law on its own date and at every later change date: expressions parse, the subtotal chain is linear, statutory dependencies are acyclic, row params match their family's shape, and no code an entry dated in that span names is removed. A person or company write validates the folded state against the law in force the same way (rate, normal time, category, work region, shift length, registered rules).
- **Every write to a pay input writes its amendment rows in the same write.** The reach of a change row is from its date (the earlier of old and new, when it moves) to the next row that sets the same field, and only for fields payroll reads. So a corrected job title amends nothing, a corrected raise amends the months it governs, and a corrected plain field amends every paid period of its owner. One helper, the one in `src/lib/amendments.ts`.
- **A person held by an unpaid run does not move.** Unchanged.
- **The ledger syncs when an entitlement may have changed:** a change row written, in force today; or, for one dated ahead, on its day. This replaces the sync on seal and the three materialise schedules with one.
- **Deleting.** A change row may be deleted; its reach is amended. A stint with a payslip is never deleted (decision 2).

What HR no longer has to know: what a draft is and when to seal it; that a sealed record cannot be touched; how to void one and why it needs a reason; that a change for next month is filed as a different kind of record; that a version must be ended before its replacement can start; which version an entry was keyed against.

What HR does about a mistake:

| Mistake                                  | Fix                                           |
| ---------------------------------------- | --------------------------------------------- |
| A raise with the wrong amount            | Edit the row                                  |
| A raise dated the wrong month            | Move the row's date                           |
| A raise keyed for the wrong person       | Delete the row                                |
| A salary wrong since the hire            | Edit the first row; every later month follows |
| A child registered late                  | Add the child with the real birth date        |
| A residency keyed a year late            | Add or move the row to its real date          |
| A rate table wrong in the law since 2026 | Edit it on the row that set it                |

In each case the next run pays or takes back the difference, and HR sees it before marking the run paid.

## 6. The seed

```text
seed/public/jurisdiction/
  MY/jurisdiction.json          the `jurisdiction` row
  MY/jurisdiction_change.json   its changes, oldest first
  SG/...
```

- The first change row is the whole law on 1 December 2025. Each later row is the patch a change in law made on its date. A change already enacted with a later date of effect is a row with that date.
- What a change did is the row. What the law says on a day is the fold, which `bolt build` writes into the release pack as it does now.
- A reference's `effective_from` is the date its source took effect and is not rewritten per change. Extension schemas are no longer copied into every version.
- The private bank follows the same shape: `employment`, `contract_terms`, `statutory_parameters`, `dependant`, `entity_change`. Its entries name catalogue rows by code.

## 7. What goes

- The draft, sealed and void states on three models, their lock constraints, and the seal, void and replace forms.
- `contract_change`, `entity_change`, `statutory_change` and the `contract_materialize`, `entity_materialize` and `statutory_materialize` automations, with `sealing.ts`, `version_compare.ts` and the change helpers: about 1,700 lines.
- `jurisdiction_settings`, its twelve tables and their record screens: about 2,300 lines, replaced by one model and views over the folded law.
- `entity_profile_version` and `employee_contract` as versioned records.
- "Void and replace" as a way to correct, and the rule that an entry is priced under the version in force on its date "whatever version it points at".
- 40 of the seed's 49 full law copies: each jurisdiction keeps one base.

## 8. What it costs

- **No foreign key to a catalogue row.** The write-time check and the integrity check hold what the key held.
- **Catalogue screens are views.** Rows of the law are no longer records, so their tables, pickers and search are built over the folded document, to look as they do now.
- **Clearing a value.** A sparse row must tell "set to nothing" from "unchanged". The law's patch does it with `null`; a person's or a company's row does it with `clears`. The fold reads both as one patch.
- **A reach wider than a seal allowed.** A corrected first row can reach every paid period of the tax year. The existing bounds hold: a later tax year is not worked out again, and a run works out at most 240 earlier person-periods.
- **Migration.** Each chain of versions folds mechanically into a base and its differences. Stints take the id of their first version; rows that named a later version are re-pointed.

## 9. What changes in section 0

Only the owner's words change it. Adopted, this RFC replaces:

- **Corrections:** "Contract, employer and law versions stay dated and frozen: a change is a new version from its real date, and a wrong one is voided and replaced, never deleted." → A change is a dated row from its real date; a wrong one is corrected, moved or deleted in place.
- **The contract, by date:** "version" → "change row"; the rule itself stands.
- **Exits:** "a sealed contract version ending with no same-jurisdiction successor" → a stint with a last day and no stint under the same law the next day.
- **Jurisdiction settings and lookup:** "A change of law is a new sealed version", "A version is a change batch: one copy of the whole jurisdiction" and "Pickers list only rows of the sealed version in force on the day" → a change of law is a dated patch; pickers list the rows of the law in force on the day.
- **Company methods:** `entity_profile_version.pay_methods` → the company's pay methods, by date.
- **Configuration ownership:** extension data is named statutory parameters; the flat-schema rule stands.
- **Screens:** "sealing a contract version" in the paid-period question → saving a change that reaches a paid period.

Everything else in section 0 stands: one mechanism for corrections, the amendment row, net pay never below zero, the ledger's three movements, the linear chain, registered rules and effects, runs and pay groups.

## 10. Proof

Tests prove the mechanism with agnostic fixtures.

1. **Parity under random edits.** Random sequences of add, edit, move and delete on a paid person's change rows and dependants; after the next run, what has been paid for each period equals what a never-wrong history pays, line by line, and the balances match. Extends `tests/corrections/parity.test.ts` and `tests/ledger/integrity_random.test.ts`.
2. **The same for a company change and a law patch,** across several people and pay groups.
3. **A field payroll does not read writes no amendment row.**
4. **A dated parameter change leaves earlier periods alone:** worked out again, they come to no difference.
5. **Back pay:** a row signed late, then edited, moved and deleted after its signing month is paid, returns contributions too.
6. **The fold:** order, removal by `null`, a future row not in force, a research patch out of force until its finding is confirmed.
7. **Write checks:** a patch that breaks the chain, a dependency or an expression at any later date is refused; so is one that removes a code a later entry names.
8. **`RUN_INPUTS`:** a run reading a model that is none of the three kinds fails the build.
9. **Migration parity, run once:** the fold at every old version boundary equals that version, for all 49 law versions and every contract and employer chain; every seeded period recomputes to the same lines. Then the old folders go.

## 11. Order of work

Source, then seed, then tests, per the refactor loop.

1. The fold and the reach helper, with their tests.
2. Law: `jurisdiction`, `jurisdiction_change`, entries by code, the engine's read, the settings views. Seed converted and proven by migration parity.
3. Company: `entity_change`.
4. Person: `employment`, `contract_terms`, `statutory_parameters`, `dependant`, the profile screen with its timeline tabs.
5. Delete the change models, the materialise automations and the seal machinery. Rewrite the suites that name seal states (26 of 75 files).
6. Docs: section 0 by the owner's words, then the model, seed and transfer documents.

## 12. Decisions

1. **Sparse typed rows: settled.** A person's and a company's change row keeps typed optional fields, so the row's own form, filters and write checks stay Bolt's, and names what it takes away in `clears` (section 2). The alternative, an untyped patch like the law's, would need a hand-built editor for every field.
2. **A stint that was wholly a mistake and has been paid: settled.** HR deletes its change rows and sets its last day to the day before its first; it then covers no day, the next runs take back what was paid, and the stint stays for its payslips. A stint with no payslip is simply deleted.
3. **How far "by code" goes: settled.** The law and everything inside it (catalogue rows, subtotals, rules, effects) is one stored document, so nothing in it has an id and every reference into it is a code. Records that are rows of their own (person, stint, company, pay group, shift, run, payslip) keep Bolt's references to each other.
4. **Plain or dated, field by field: settled by one test.** A field is dated if it can truly change while the person is employed and a formula or the salary listing reads it: residency, marital status, nationality, work pass, scheme registrations and elections, and every agreed term. A field is plain if a different value can only mean the old one was wrong: date of birth, identity number, gender. Bank is plain: it decides where pay goes, not how much, so a change amends nothing.
5. **Research: settled.** A finding may still carry several patches at several dates; each is its own `jurisdiction_change` row naming the finding, and confirming the finding puts them all in force, each from its date.
