# Attendance

Four inputs per person-day. Each has one job.

| Axis                | Source                                   | Holds                                     |
| ------------------- | ---------------------------------------- | ----------------------------------------- |
| A. Roster           | `Roster` sheet                           | Shift code, `REST` or `OFF`. Never `PH`.  |
| B. Day type         | Derived                                  | Working, rest, off, public holiday, leave |
| C. Planned overtime | `Overtime` sheet, pre-approved           | Hours, split into overtime and incentive  |
| D. Attendance       | `Time entries` sheet, clock-in/clock-out | Proof of presence                         |

## A. Roster: the plan

Every day gets a shift code, `REST` or `OFF`. Holidays come from the worksite's calendar; never
type `PH`.

## B. Day type: derived

| Input                                 | Day type                                 |
| ------------------------------------- | ---------------------------------------- |
| Shift code                            | Working day                              |
| `REST`                                | Rest day                                 |
| `OFF`                                 | Off day                                  |
| Date on the worksite holiday calendar | Public holiday (observed or substituted) |
| Approved leave covers the date        | Leave                                    |

## C. Planned overtime: pre-approved

| Day                                        | Overtime cell holds         |
| ------------------------------------------ | --------------------------- |
| Working day                                | Hours after the shift       |
| `REST`, `OFF`, holiday not normally worked | Total hours worked that day |

Hours above the statutory cap become incentive hours, paid at the rate the overtime band would pay.

## D. Attendance: the clock

| Case                                       | Result               |
| ------------------------------------------ | -------------------- |
| Clocked on a rostered working day          | Present              |
| Rostered working day, no clock entry       | Absence; deducts pay |
| Clocked beyond shift plus planned overtime | Not paid             |

## Examples

Shift `D` is 09:00–18:00.

| Case                     | Roster | Calendar | Overtime | Clock       | Paid                              |
| ------------------------ | ------ | -------- | -------- | ----------- | --------------------------------- |
| Working day + 2 h OT     | `D`    | —        | 2        | 09:00–20:00 | Shift + 2 h overtime              |
| Rest day + 6 h           | `REST` | —        | 6        | 09:00–15:00 | 6 h at the rest-day rate          |
| Holiday on a working day | `D`    | PH       | —        | —           | Holiday pay                       |
| Holiday on a rest day    | `REST` | PH       | —        | —           | Substituted holiday per the rules |
| Absence                  | `D`    | —        | —        | —           | One day deducted                  |

## Cut-off

Each entry (overtime, no-pay leave, leave, work day) is assessed by the run whose attendance
window contains its date, not by calendar month.

| Run      | Window          | Entry dated 21 Jan |
| -------- | --------------- | ------------------ |
| January  | 21 Dec – 20 Jan | No                 |
| February | 21 Jan – 20 Feb | Yes                |

## Lock

A day or entry a run consumed is sealed. Correct it with an adjustment entry in the next cycle.
