# Source reference

Checked against this template's source and compiled declaration manifest on 15 November 2026.
This is a local source inventory, not a declaration that a deployed tenant runs these bytes.

18 models, 2 applications, 1 automation.

## Applications and pages

| Source application | Title      | Pages                                                                                                   | Purpose                                      |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `treasury`         | Treasury   | Dashboard, Drawdowns, Alerts, Bank advices, Limits & terms, Banks, Suppliers, Costs, Charges, Month-end | Bank facilities, lines, costs and month-ends |
| `purchasing`       | Purchasing | Purchase orders                                                                                         | Purchase orders and the documents on them    |

## Models and exposed operations

| Model                                                                   | Writes         | Notes                                 |
| ----------------------------------------------------------------------- | -------------- | ------------------------------------- |
| [bank](../src/data/model/bank/+model.ts)                                | create, update | Contacts written through its layer    |
| [bank_contact](../src/data/model/bank/bank_contact/+model.ts)           | none           | Written through `bank`                |
| [watch_point](../src/data/model/bank/watch_point/+model.ts)             | create, update |                                       |
| [letter_of_offer](../src/data/model/bank/letter_of_offer/+model.ts)     | create, update | Carries the PDF                       |
| [facility](../src/data/model/facility/+model.ts)                        | create, update | Fee rules written through its layer   |
| [facility_fee](../src/data/model/facility/facility_fee/+model.ts)       | none           | Written through `facility`            |
| [sub_limit](../src/data/model/facility/sub_limit/+model.ts)             | create, update |                                       |
| [supplier](../src/data/model/supplier/+model.ts)                        | create, update |                                       |
| [drawdown](../src/data/model/drawdown/+model.ts)                        | create, update | Charges written through its layer     |
| [drawdown_charge](../src/data/model/drawdown/drawdown_charge/+model.ts) | none           | Written through `drawdown`            |
| [bank_document](../src/data/model/drawdown/bank_document/+model.ts)     | create, update | The advice PDF                        |
| [month_end](../src/data/model/month_end/+model.ts)                      | create, update | Lines written through its layer       |
| [month_end_line](../src/data/model/month_end/month_end_line/+model.ts)  | none           | Written through `month_end`           |
| [fx_rate](../src/data/model/fx_rate/+model.ts)                          | create, update |                                       |
| [purchase_order](../src/data/model/purchase_order/+model.ts)            | create, update | Lines and invoices through its layers |
| [po_line](../src/data/model/purchase_order/po_line/+model.ts)           | none           | Written through `purchase_order`      |
| [invoice](../src/data/model/purchase_order/invoice/+model.ts)           | none           | Written through `purchase_order`      |
| [po_document](../src/data/model/purchase_order/po_document/+model.ts)   | create, update | The PO's files                        |

`bank`, `supplier` and `purchase_order` mark their unique constraint `import_key`, so they can be imported.

## Automations

| Automation     | Trigger          | Policies   | Purpose                                                             |
| -------------- | ---------------- | ---------- | ------------------------------------------------------------------- |
| `daily_alerts` | cron `0 8 * * *` | `treasury` | Lines due within 7 days and facility reviews within 60, to Treasury |

## Policies and teams

| Policy       | Grants                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `treasury`   | Read all eighteen; change banks, facilities, suppliers, lines, documents, month-ends and FX     |
| `finance`    | Read all eighteen; create and update suppliers and lines; add documents; update purchase orders |
| `purchasing` | Read suppliers; create and update purchase orders and their documents                           |

Teams: `treasury` → `treasury`; `finance` → `finance`; `purchasing` → `purchasing`.

## Integrations and source roles

- Integration definitions: none.
- Named connections: none.
- Custom datatypes: none.
