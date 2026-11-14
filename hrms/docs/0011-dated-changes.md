# Dated changes, edited in place

How a value that changes by date is stored, read and written, for a person, a company and a law. Accepted by the owner on 2026-11-13 and built; [section 0 of the architecture](0001-hrms-calculation-architecture.md#0-the-design-is-fixed) carries its wording. The law's own rules are in [the architecture](0001-hrms-calculation-architecture.md#3-the-law-by-date), each model's fields and write checks in [the model specification](0002-model-specification.md), and what a write does to a paid period in [corrections and integrity](0007-corrections-and-integrity.md).

## 1. The concept

"This value changes on a date" and "this record is locked" are two things. Payroll needs the first only: a correction is what a period should pay now, less what was paid for it, and that reads the paid payslips, never an old copy of a record.

Every value payroll reads is one of three kinds.

| Kind                  | What it is                                       | Examples                                                             | How HR changes it                        |
| --------------------- | ------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------- |
| **Plain field**       | Never changes, so an edit is always a correction | Date of birth, identity number, a company's name                     | Edit in place                            |
| **Self-dated record** | Carries its own real-world date                  | A child, a leave day, a roster day, a holiday                        | Edit, move or delete in place            |
| **Dated change**      | "From this date, these fields are now this"      | A raise, a new tax residency, a new pay method, a new statutory rate | Add, edit, move or delete the change row |

| Owner   | Plain                            | Dated                                    | Self-dated                        |
| ------- | -------------------------------- | ---------------------------------------- | --------------------------------- |
| Person  | `employee_profile`, `employment` | `contract_terms`, `statutory_parameters` | `dependant`, the stint's `events` |
| Company | `entity`                         | `entity_change`                          | `holiday`                         |
| Law     | `jurisdiction`                   | `jurisdiction_change`                    |                                   |

- No record has a draft, sealed or void state. No record is a version of another.
- A change row is **sparse**: it holds only the fields it changes. A raise row holds the new rate and nothing else.
- An empty field on a person's or a company's change row means unchanged: in Bolt an optional field left out and one set to nothing are the same `null`. A value taken away from a date is named in the row's `clears`, a list of field names. The law's patch takes a value away with `null`. The fold reads both as one patch. A field is replaced whole; a list or a record is not merged.
- A change row has a start date and no end date. The value in force on a day is the **fold**: the change rows dated on or before that day, applied oldest first. The timeline is contiguous and non-overlapping by construction; no constraint keeps it so.
- A change dated in the future is a row not yet in force. Nothing materialises it.
- A value wrong since the start is corrected on the row that set it, and every later day follows.
- The history table is for audit and approvals only. Nothing in payroll, the ledger or a screen reads it.
- Terms and statutory parameters are two families because they are two questions: what was agreed, and what the law is told about the person. Only terms carry a signed date ([how a period reads the employment](0007-corrections-and-integrity.md#3-how-a-period-reads-the-employment)).

## 2. Reading

- **One fold, used three times.** `inForce(rows, day)` in `src/lib/dated.ts` applies the change rows dated on or before `day`, oldest first, and remembers which row set each field. Person, company and law use the same function.
- **A run folds once, at admit.** One law document for its pay date, one company state per company, one state per person. An amended earlier period folds for its own pay date in the run's one further request.
- **No stored checkpoint.** The folded state is derived and never written. A chain is a dozen rows at most.
- **Forward only.** The base is the oldest row and patches run forward, so a correction to the base reaches every later day unless a later row set the same field.
- **First of a month.** A change to a person's terms or statutory parameters is dated the first of a month, or the stint's first day, so a run never prices a month on two sets of terms. The first and last day of a stint keep their real dates. Law and company changes take any date.

## 3. Writing

- **One question on save.** Saving a dated field asks: was it always so, or does it change from a date? The first edits the row that set the value. The second adds a change row.
- **Every write is checked on the folded state,** on its own date and at every later change date.
- **Every write to a pay input writes its amendment rows in the same write.** The reach of a change row is from its date (the earlier of old and new, when it moves) to the next row that sets the same field, and only for fields payroll reads. A corrected plain field amends every paid period of its owner.
- **The ledger syncs when an entitlement may have changed:** at once for a change row in force today, otherwise on its day.
- **Deleting.** A change row may be deleted; its reach is amended.

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

## 4. What it costs

- **No foreign key to a catalogue row.** The write-time check and the integrity check hold what the key held.
- **Catalogue screens are views.** Rows of the law are not records, so their tables, pickers and search are built over the folded document.
- **A wide reach.** A corrected first row can reach every paid period of the tax year. Two bounds hold: a later tax year is not worked out again, and a run works out at most 240 earlier person-periods.

## 5. Decisions

1. **Sparse typed rows.** A person's and a company's change row keeps typed optional fields, so the row's own form, filters and write checks stay Bolt's, and names what it takes away in `clears`. An untyped patch like the law's would need a hand-built editor for every field.
2. **A stint that was wholly a mistake and has been paid.** HR deletes its terms rows. With nothing agreed the stint pays nothing, the next runs take back what was paid, and the stint stays for its payslips. A stint with no payslip is simply deleted.
3. **How far "by code" goes.** The law and everything inside it (catalogue rows, subtotals, rules, effects) is one stored document, so nothing in it has an id and every reference into it is a code: an entry names its catalogue row, a subtotal its predecessor, a catalogue row its subtotal, a company its jurisdiction. Records that are rows of their own (person, stint, company, pay group, shift, run, payslip) keep Bolt's references to each other.
4. **Plain or dated, field by field, by one test.** A field is dated if it can truly change while the person is employed and a formula or the salary listing reads it: residency, marital status, nationality, work pass, scheme registrations and elections, and every agreed term. A field is plain if a different value can only mean the old one was wrong: date of birth, identity number, gender. Bank is plain: it decides where pay goes, not how much, so a change amends nothing.
5. **Research.** A finding may carry several patches at several dates; each is its own `jurisdiction_change` row naming the finding, and confirming the finding puts them all in force, each from its date. That is the one gate left, and it belongs to the approval of the finding, not to the record.
