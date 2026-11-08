# Source reference

Checked against this template's source and compiled declaration manifest on 8 November 2026.
This is a local source inventory, not a declaration that a deployed tenant runs these bytes.

24 models, 5 applications, 2 automations.

## Applications and pages

| Source application                                              | Title               | Pages                                                                                                                 | Purpose                                                |
| --------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [operations/analysis](../src/app/operations/analysis/+app.ts)   | Analysis            | reports: Analysis                                                                                                     | Sales, balances and commissions.                       |
| [operations/partners](../src/app/operations/partners/+app.ts)   | Partners            | parties: Partners                                                                                                     | Customers, suppliers and their agreements.             |
| [operations/trade](../src/app/operations/trade/+app.ts)         | Orders              | orders: Orders                                                                                                        | Commercial work within each order.                     |
| [operations/warehouse](../src/app/operations/warehouse/+app.ts) | Warehouse           | stock: Warehouse                                                                                                      | Products, lots and stock.                              |
| [trade_configuration](../src/app/trade_configuration/+app.ts)   | Trade configuration | templates: Document templates; settings: Commercial settings; pricing_floors: Pricing floors; rules: Commission rules | Dated pricing, commission and commercial requirements. |

## Models and exposed operations

Outputs fix field visibility. Policies select outputs and scope rows; write columns and checks constrain mutations. Each row links to its owning declaration.

| Model                                                                                    | Fields | Read outputs        | Writes                 | Syncs                 |
| ---------------------------------------------------------------------------------------- | ------ | ------------------- | ---------------------- | --------------------- |
| [activities](../src/data/model/orders/activities/+model.ts)                              | 5      | default             | create, update         | none                  |
| [commercial_settings](../src/data/model/commercial_settings/+model.ts)                   | 5      | default, logistics  | update                 | none                  |
| [commission_rules](../src/data/model/commercial_settings/commission_rules/+model.ts)     | 10     | default             | create, update         | sheet                 |
| [commission_statements](../src/data/model/commission_statements/+model.ts)               | 8      | default             | create                 | none                  |
| [contacts](../src/data/model/parties/contacts/+model.ts)                                 | 4      | default             | create, update         | none                  |
| [credit_snapshots](../src/data/model/parties/credit_snapshots/+model.ts)                 | 6      | default             | none                   | kingdee               |
| [document_templates](../src/data/model/commercial_settings/document_templates/+model.ts) | 11     | default             | create, update         | none                  |
| [ext_purchase_orders](../src/data/model/orders/ext_purchase_orders/+model.ts)            | 6      | default, logistics  | create, update         | none                  |
| [ext_sales_orders](../src/data/model/orders/ext_sales_orders/+model.ts)                  | 6      | default, logistics  | create, update         | kingdee               |
| [order_files](../src/data/model/orders/order_files/+model.ts)                            | 3      | default             | create                 | none                  |
| [order_lines](../src/data/model/orders/order_lines/+model.ts)                            | 19     | default, logistics  | create, update, delete | none                  |
| [orders](../src/data/model/orders/+model.ts)                                             | 49     | default, logistics  | create, update         | lines, sheet, kingdee |
| [parties](../src/data/model/parties/+model.ts)                                           | 9      | default             | none                   | kingdee, sheet        |
| [pricing_floors](../src/data/model/products/pricing_floors/+model.ts)                    | 8      | default             | create, update         | price_book            |
| [products](../src/data/model/products/+model.ts)                                         | 15     | default, logistics  | update                 | kingdee               |
| [salesperson_signatures](../src/data/model/salesperson_signatures/+model.ts)             | 1      | default             | create                 | none                  |
| [source_lot_costs](../src/data/model/source_lot_costs/+model.ts)                         | 3      | default             | none                   | kingdee               |
| [source_payments](../src/data/model/orders/source_payments/+model.ts)                    | 9      | default             | create, update         | kingdee               |
| [source_receivables](../src/data/model/source_receivables/+model.ts)                     | 3      | default             | none                   | kingdee               |
| [source_sales_lines](../src/data/model/orders/source_sales_lines/+model.ts)              | 19     | default, commercial | none                   | kingdee, invoice_only |
| [source_stock_commitments](../src/data/model/source_stock_commitments/+model.ts)         | 2      | default             | none                   | kingdee               |
| [stock_snapshots](../src/data/model/products/stock_snapshots/+model.ts)                  | 9      | default, logistics  | none                   | kingdee               |
| [transactions](../src/data/model/orders/transactions/+model.ts)                          | 12     | default, logistics  | create, update         | kingdee               |
| [warehouses](../src/data/model/warehouses/+model.ts)                                     | 6      | default             | none                   | kingdee, sheet        |

Upsert is available when both create and update are exposed; it resolves an explicit ID or the model’s natural key and requires an explicit conflict rule. Writes listed on a source mirror are the sync’s path, not a member permission: policies grant those rows read-only. A model with no write exposed has no caller path at all.

## Automations

All named runs use the reserved system identity and the listed policies. A manual-start grant controls who may start a run; cron/webhook/schedules use their declared trigger path. Model effects run as their writer and are separate from these named automations.

| Automation                                                      | Trigger                        | Policies       | Purpose                                                                              |
| --------------------------------------------------------------- | ------------------------------ | -------------- | ------------------------------------------------------------------------------------ |
| [orders_revise](../src/automation/+orders_revise.automation.ts) | started or scheduled from code | order_revision | Start or resume a replacement contract from the current accepted terms.              |
| [source_health](../src/automation/+source_health.automation.ts) | {"cron":"*/5 * * * *"}         | configuration  | Notifies configuration holders when an accounting ledger connection needs attention. |

## Integrations and source roles

- Integration definitions: `kingdee`.
- Named connections: `kingdee`.
- Source policies: `configuration`, `finance`, `logistics`, `manager`, `order_revision`, `procurement`, `sales`.
- Custom datatypes: none.

Pairing and credentials belong to the host's Connections surface; defining a connection does not mean it is paired.

## Browser evidence

![Current local workspace](screenshots/workspace-overview.jpg)

![Representative application](screenshots/application.jpg)

Captured through the browser from a separate local documentation workspace on 30 October 2026. This shows layout and navigation; it does not certify external providers, automation results or deployment.

Next: [Kingdee implementation](0004-kingdee-implementation.md)
