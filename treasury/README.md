# Treasury

A treasury and purchasing workspace for a business that finances its purchases through bank
facilities. Treasury keeps its bank lines, limits and terms, the drawdowns drawn on them, their
charges and the supplier list; purchasing raises purchase orders on those suppliers and records the
invoices that come back.

## Apps and roles

| App            | Pages                                                                                                   | Who uses it |
| -------------- | ------------------------------------------------------------------------------------------------------- | ----------- |
| **Treasury**   | Dashboard, Drawdowns, Alerts, Bank advices, Limits & terms, Banks, Suppliers, Costs, Charges, Month-end | Treasury    |
| **Purchasing** | Purchase orders                                                                                         | Purchasing  |

Three teams, one per function:

| Team           | May do                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------- |
| **Treasury**   | Read and change banks, facilities, fee rules, drawdowns and their charges, and suppliers |
| **Finance**    | Read everything; plan earmarks, keep the supplier list, record invoices against a PO     |
| **Purchasing** | Raise and change purchase orders with their item lines; read the supplier list           |

Administrators see and change everything. Each record's own history is kept by the workspace, so
there is no separate audit log model.

## Data model

| Model             | Purpose                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `bank`            | A bank, its cut-off time and its facility terms                             |
| `bank_contact`    | A person to call at a bank                                                  |
| `facility`        | A credit line: limit, currency, day basis, rounding, maximum tenor, review  |
| `facility_fee`    | A fee rule: what the bank charges, at which stage, on what base             |
| `supplier`        | A supplier paid through a facility                                          |
| `drawdown`        | One line: earmark → applied → active → settled, with the bank's own numbers |
| `drawdown_charge` | A charge on a line, estimated or as the bank's advice gives it              |
| `purchase_order`  | A PO: supplier, ship-to country, pay by LC, and its item lines              |
| `po_line`         | One item on a PO: description, quantity (kg) and amount                     |
| `invoice`         | A supplier invoice recorded against a PO, optionally tied to a line         |
| `bank_document`   | A bank advice or other document kept with a line                            |
| `fx_rate`         | How many USD a currency buys on a date, month-end rates included            |
| `month_end`       | A month's figures, frozen once locked                                       |
| `month_end_line`  | One line as it stood at a locked month-end                                  |
| `watch_point`     | A bank rule or condition to keep in mind                                    |
| `letter_of_offer` | A letter of offer, its review date and its PDF                              |
| `sub_limit`       | Part of a facility limit reserved for a product or a supplier               |
| `po_document`     | A file kept on a purchase order                                             |

A line's status only moves forward: earmarked → applied → active → settled, with cancellation
available until it settles. A settled line cannot be reopened.

## Automations and integrations

| Automation     | Trigger         | What it does                                                                                                |
| -------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| `daily_alerts` | 08:00 every day | Tells Treasury how many lines fall due in the next 7 days and how many facility reviews fall in the next 60 |

No integrations are declared; nothing leaves the workspace.

## Not included

The month-end lock that calculates and freezes the figures, reading bank advices automatically, a
facility requisition form, spreadsheet import and invoice checks against a purchase order are left
for the workspace to add. Purchasers already see only the purchase orders they raised.

## Seed

The template ships no seed rows; a new workspace starts empty.

## Checks

```bash
bun install --frozen-lockfile
bunx bolt check   # types, Svelte warnings, layout and declarations
bun run test      # bolt test
```

`tests/treasury.test.ts` proves the drawing of a line against a facility with its charge, the
unique bank code, the settled-line refusal, a purchaser's refusal to touch treasury records, a
purchase order with its item lines, and the morning alert running clean.

See [the source reference](docs/source-reference.md) for the applications and pages, model outputs
and writes, automation policies and teams.
