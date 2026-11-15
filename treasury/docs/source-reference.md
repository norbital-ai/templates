# Source reference

Checked against this template's source on 15 November 2026.

23 models, 2 applications, 11 automations, 1 file sync.

## Applications and pages

| Application  | Pages                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `treasury`   | Dashboard, Drawdowns, Alerts, Bank advices, Limits & terms, Banks, Suppliers, Costs, Charges, Month-end |
| `purchasing` | Purchase orders, Facility forms                                                                         |

Record views: `drawdown` (figures, purchase orders, next steps), `bank_document` (checks, read and
apply), `purchase_order` (invoice checks, LC and financing links), `facility_form` (fill from
attachments).

## Models

| Model                 | Writes                   | Notes                                                                   |
| --------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `bank`                | create, update           | Contacts through its layer; products it offers                          |
| `bank_contact`        | through `bank`           |                                                                         |
| `watch_point`         | create, update           |                                                                         |
| `letter_of_offer`     | create, update           |                                                                         |
| `facility`            | create, update           | Fee rules through its layer                                             |
| `facility_fee`        | through `facility`       |                                                                         |
| `sub_limit`           | create, update           |                                                                         |
| `supplier`            | create, update, import   | Aliases; accepting banks through `eligible_banks`                       |
| `supplier_bank`       | through `supplier`       |                                                                         |
| `drawdown`            | create, update           | Fills tenor, interest to maturity, latest due date; sealed when settled |
| `drawdown_charge`     | through `drawdown`       | Actual charges only; estimates are computed                             |
| `bank_document`       | create, update           | Read figures in `extracted`                                             |
| `month_end`           | create, update           | Locked months are frozen                                                |
| `month_end_line`      | through `month_end`      | Export sync `sheet`                                                     |
| `fx_rate`             | create, update           |                                                                         |
| `purchase_order`      | create, update, import   | Lines and invoices through its layers; roll-ups                         |
| `po_line`             | through `purchase_order` | Invoiced quantity roll-up                                               |
| `invoice`             | through `purchase_order` | Lines through its layer                                                 |
| `invoice_line`        | through `invoice`        |                                                                         |
| `po_document`         | create, update           |                                                                         |
| `po_financing`        | create, delete           | A PO and the line that pays it                                          |
| `facility_form`       | create, update           | Attachments through its layer; an LC form asks for an LC                |
| `facility_attachment` | through `facility_form`  |                                                                         |

## Policies and teams

| Policy           | Held by              |
| ---------------- | -------------------- |
| `treasury`       | team `treasury`      |
| `finance`        | team `finance`       |
| `purchasing`     | team `purchasing`    |
| `viewer`         | team `viewers`       |
| `facility_forms` | `facility_form_read` |
