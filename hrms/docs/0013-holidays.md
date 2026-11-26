# Holidays, rest days and days in lieu

HR's procedure for a company's holidays: the calendar, a holiday on a rest or off day, work on a holiday, days off in lieu, one person's own holiday, and correcting a holiday. Each step says what HR does, what the system writes and where it shows. The fixed rules are [section 0](0001-hrms-calculation-architecture.md#holidays); each country's rates are in [statutory coverage](0009-statutory-coverage.md); correcting a paid period is in [corrections and integrity](0007-corrections-and-integrity.md).

## Terms

| Term                             | Meaning                                                                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Holiday calendar**             | A company's `holiday` rows. A day counts only once it is published; an unpublished day is a draft                                                                                      |
| **Holiday kind**                 | `PUBLIC_HOLIDAY`, `SPECIAL_HOLIDAY`, `SUBSTITUTE`, `DOUBLE_HOLIDAY`, `DOUBLE_SPECIAL`, `MAKEUP_WORKDAY`. A makeup workday is an ordinary working day; every other kind is a holiday    |
| **Day type**                     | A person's day is a work day (`WORK`), an off day (`OFF`, the spare day of a five-day week) or a rest day (`REST`): their roster for the date, else their shift pattern or agreed week |
| **Substitute holiday**           | A holiday that `replaces` another date. Given to `EVERYONE`, or `ONLY_IF_OFF_ON_REPLACED_DATE`: only to those whose day type on the replaced date is not a work day                    |
| **Personal holiday**             | A holiday naming one person (`employee_id`): theirs alone                                                                                                                              |
| **Holiday work**                 | The law's `HOLIDAY_WORK` row: hours within normal hours on a holiday. `HOLIDAY_OVERTIME`: planned hours beyond them                                                                    |
| **Off in lieu (OIL)**            | The law's `PUBLIC_HOLIDAY_IN_LIEU` leave row. It grants 0 days; HR grants each day by a balance adjustment, and the person takes it as leave                                           |
| **Time off in lieu of overtime** | `overtime_as_time_off` on a roster day: its planned overtime is banked by the hour instead of paid                                                                                     |

## 1. The company's calendar

| HR does                                                                                                           | The system writes                                                               | Where it shows                    |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------- |
| Imports the holidays workbook, one sheet per company (date, name, kind, optional replaces), or adds a day by hand | `holiday` rows, unpublished. A day the company already has is skipped           | Entities → the company → Holidays |
| Selects the days and chooses Publish in the actions menu                                                          | `published_at` on each draft. From then rosters, leave and payroll runs read it | Holidays: Publication date        |

What to expect:

- **Only a published day counts.** A draft is no holiday for rosters, leave or a run. Publish skips a day already published, and asks first when a day falls in a paid period (section 6).
- **A calendar is one company's.** Everyone the company employs gets every published day, except a substitute given only to those off on the replaced date (section 2) and a personal holiday (section 5).

## 2. A holiday on a rest day or off day

The example: a public holiday falls on Saturday. Five-day staff, off on Saturdays, take Monday instead; six-day staff work Saturdays and keep the Saturday.

| HR does                                                                                                            | The system writes                       | Where it shows |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------------- |
| Keeps Saturday as published, given to Everyone                                                                     | —                                       | Holidays       |
| Adds Monday: kind Substitute, Replaces the Saturday, Given to "Only if off on the replaced date", and publishes it | A `holiday` with `replaces`, `given_to` | Holidays       |

Who gets which day:

| Person                                        | Saturday                                                 | Monday                                                   |
| --------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Six-day staff: Saturday is a work day         | Their holiday: paid off, or holiday work if they work it | An ordinary work day                                     |
| Five-day staff: Saturday is an off day        | A holiday on their off day                               | Their holiday: paid off, or holiday work if they work it |
| Five-day staff rostered to work that Saturday | Holiday work                                             | An ordinary work day                                     |

What to expect:

- **Who is off reads each person's plan** for the replaced date: the roster day, else the shift pattern or agreed week. An off day and a rest day are both off.
- **The same for a Sunday holiday.** The substitute replaces the Sunday. Someone whose rest day falls on another weekday works the Sunday, keeps it as their holiday and does not get the substitute.
- **A rostered person** who is not given the Monday and does not clock is absent that day. Staff with no roster in the cycle are never absent.
- **Leave is not taken on a person's holiday or rest day.** Five-day staff cannot book leave on the Monday; six-day staff can.
- **An imported substitute is given to Everyone**: the workbook has no Given to column. Open each one and set "Only if off on the replaced date", or six-day staff get both days.

## 3. Someone works a holiday and is paid

| HR or the employee does                                                        | The system writes                                                                                                                                  | Where it shows |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| HR rosters a work shift on the holiday, with any overtime beyond it as planned | A `roster_entry`                                                                                                                                   | Events → Work  |
| The employee clocks in and out                                                 | `actual_worked_intervals` on the day                                                                                                               | Events → Work  |
| HR runs payroll                                                                | The day carries its holiday kind. `HOLIDAY_WORK` pays the hours within normal hours; `HOLIDAY_OVERTIME` pays the planned overtime the clock covers | The payslip    |

What to expect:

- **No clock on a holiday is no absence.** The salary already pays the day.
- **Holiday overtime is planned.** Clocked time outside the plan pays nothing, as on any day.
- **A holiday on a rest day is priced by the law's rows**: Malaysia's holiday rows; Singapore's rest-day row; the Philippines' holiday row at its rest-day multiple.
- **The company's methods** (`overtime_hour_basis`, `rest_day_hourly_multiplier`) apply where they pay at least the law.

## 4. Days off in lieu (OIL)

HR grants a day when the law owes one person a day the calendar cannot express, as the law's row describes (Malaysia: a holiday during their sick leave, annual leave or temporary disablement), or a day agreed in place of a holiday.

| HR or the employee does                                                                                             | The system writes                                                         | Where it shows                      |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| HR, on the employee profile, Adjust balance: `PUBLIC_HOLIDAY_IN_LIEU`, +1 day, the holiday's date, a note naming it | A manual ledger row adding 1 to `entitled` in the window holding the date | The profile's balance; self-service |
| The employee requests the day off on `PUBLIC_HOLIDAY_IN_LIEU`, or HR keys it                                        | A leave entry; on approval `used +1`                                      | Events → Leave; the balance         |
| HR finds a grant was wrong                                                                                          | An opposite adjustment, −1 day. An adjustment is never edited or deleted  | The balance's ledger                |

What to expect:

- **The day off is paid as a normal day** and makes no payslip line.
- **It is refused** on a rest day or holiday, or when the balance has no day left.
- **At an exit** a row with a `payout` pays out the days left on the last payslip (Malaysia: the month's wages ÷ 26 a day), unless HR switched leave encashment off.

## 5. One person's own holiday

| HR does                                            | The system writes              | Where it shows                   |
| -------------------------------------------------- | ------------------------------ | -------------------------------- |
| Adds a holiday with the person named, publishes it | A `holiday` with `employee_id` | Holidays, with the person's name |

For a person whose shift puts the holiday on another date, such as a night guard whose holiday shift starts as the holiday ends. It counts for that person only. It adds a day; it does not take the company's day away.

## 6. Correcting a holiday

| HR does                                                                                        | The system writes                                                                                                                                                                                          | Where it shows                                 |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Changes a day's date, kind, Replaces, Given to, person or company, publishes it, or deletes it | The holiday. For a day in paid time, in the same write, one `pay_amendment` row for each person the company paid in the periods of the old and the new date (only the named person for a personal holiday) | Holidays                                       |
| Creates the next on-cycle run                                                                  | It works those periods out again on the calendar as it stands and puts each difference on the payslip as a line tagged with its period                                                                     | The payslip: "Adjustments for earlier periods" |

What to expect:

- **A name change moves no pay.**
- **An unpaid run** holding the date, or a later period, refuses the change. Delete the run first.
- **A paid period** asks first: "This period is already paid". The paid payslip never changes.
- **Moved away from a date:** rostered staff who stayed home that day are now absent, and the day comes off their pay; holiday work paid there is taken back. What net pay cannot take is "Recovery carried forward" to the next run.
- **Moved onto a date:** work there now pays holiday work, and a day off there is no longer an absence.
- **Not followed by the change:** OIL grants (correct them with opposite adjustments) and leave already booked on a date that becomes a holiday (move or delete the entry).

## Limits

What has no home today:

- **OIL instead of holiday pay.** A clocked holiday always pays `HOLIDAY_WORK`; an OIL day granted for it comes on top. `overtime_as_time_off` banks only planned overtime, by the hour, on a law's hour-counted leave row; only Taiwan's law has one, and elsewhere the run refuses it.
- **A company holiday for only some staff,** such as another state's holiday. A personal holiday adds a day for one person; nothing takes a company's day away from some of its staff.
