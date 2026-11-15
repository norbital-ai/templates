# Treasury

A treasury and purchasing workspace for a business that finances its purchases through bank
facilities. Treasury keeps its bank lines, limits and terms, and moves each financing line from
earmark to settlement with the bank's advices; purchasing raises purchase orders, records the
invoices that come back and prepares the facility requisition for each PO paid by T/T or LC.

## Apps and roles

| App            | Pages                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| **Treasury**   | Dashboard, Drawdowns, Alerts, Bank advices, Limits & terms, Banks, Suppliers, Costs, Charges, Month-end |
| **Purchasing** | Purchase orders, Facility forms                                                                         |

| Team           | May do                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Treasury**   | Change banks, facilities, fee rules, lines (allocate, advices, settle, cash or convert), suppliers and the banks that finance them, month-end locks, FX rates; key invoices; link POs to lines |
| **Finance**    | Read everything; add, change and cancel earmarks; keep the supplier list; key invoices against POs; keep PO documents                                                                          |
| **Purchasing** | Raise purchase orders (each purchaser sees their own) and change one until it is invoiced; prepare facility forms                                                                              |
| **View**       | Read every page                                                                                                                                                                                |

Administrators see and change everything. Each record's history is the audit trail.

## How a line moves

1. **Earmark**: Finance plans a supplier payment (supplier, requested date, amount, earliest invoice date).
2. **Allocate**: Treasury picks the bank line and product and any agreed rate and charge rate; the line's
   Figures tab shows the room left on every bank line and the latest date the bank finances to.
3. **Record drawdown advice**: the bank's number, dates, rate and charges; the line becomes active.
4. **Settle**, or for an LC, import bill or DA bill **Pay cash or convert**: a conversion closes the bill
   and opens new financing that keeps its POs and invoices. A settled or cancelled line is sealed.

Bank advices can be dropped in, read into their figures, checked against the workspace's own
arithmetic (days, interest with the bank's rounding, total debited) and applied to their line.

## Calculations

`src/lib/calculations.ts`, `src/lib/treasury.ts` and `src/lib/purchasing.ts` hold every figure, shared
by pages, automations and write callbacks:

- interest = amount × rate % × days ÷ day basis (360 or 365 per facility); days = due − start (start
  counts, due does not); rounding per facility (nearest cent or down to the cent);
- accrued interest to a day counts that day, never past the tenor;
- used = applied + active lines in USD; earmarks show apart; banks at 80% are flagged;
- cost of funds is weighted by USD amount (and by amount × days over a period);
- charges are the advice's (or typed in) per stage; a stage without one is estimated from the fee
  rules, an agreed charge rate replacing the commission;
- the month-end report takes every line owed at the close, revalued at the month-end FX rate;
  locking it copies the lines and headline figures so later edits never change it;
- an invoice is checked against its PO: price per kg, kg over the order, currency, total, and the
  financing's supplier and amount.

## Automations

| Automation               | Does                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `drawdown_allocate`      | Puts an earmark on a bank line                              |
| `drawdown_cancel`        | Cancels an earmark                                          |
| `drawdown_record_advice` | Records the drawdown advice; the line becomes active        |
| `drawdown_settle`        | Records the settlement advice; flags a differing interest   |
| `drawdown_close_bill`    | Pays a bill in cash or converts it into financing           |
| `bank_document_read`     | Reads advices into their figures for checking               |
| `bank_document_apply`    | Applies a checked advice to its line                        |
| `month_end_lock`         | Freezes a month's lines and figures                         |
| `month_end_unlock`       | Lets a month follow live data again                         |
| `facility_form_read`     | Fills a facility form from its PO, proforma and customer PO |
| `daily_alerts`           | Every morning, tells Treasury what the Alerts page holds    |

## Seed

`seed/public` holds a small synthetic book (four made-up banks, their facilities and fee rules,
suppliers, lines in every state, two locked month-ends, FX rates, purchase orders with invoices,
facility forms and two sample advices) so every page shows data. Every name and figure is invented.

## Checks

```bash
bun install --frozen-lockfile
bunx bolt check
bun run test
```

`tests/calculations.test.ts` proves interest, rounding, accrual, usage, the cost of funds, FX, fee
estimates, the month-end report and the invoice and advice checks on synthetic figures;
`tests/operations.test.ts` drives a line from earmark to settlement, an LC conversion and a month
lock through the engine; `tests/treasury.test.ts` covers access and the basics.

See [the source reference](docs/source-reference.md) for every model, page, automation and policy.
