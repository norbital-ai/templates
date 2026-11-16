# Source reference

Checked against this template's source on 16 November 2026.

22 models, 4 applications, 12 automations, 1 file sync.

## Applications and pages

| Application         | Pages                                                          |
| ------------------- | -------------------------------------------------------------- |
| `treasury`          | Overview, Financing, Bank advices, Attention, Costs, Month-end |
| `purchasing`        | Purchase orders, Facility forms                                |
| `configuration`     | Banks, Facilities, Exchange rates                              |
| `business_partners` | Business partners                                              |

Record views: `drawdown` (figures, purchase orders, next steps), `bank_document` (checks, read and
apply), `purchase_order` (invoice checks, LC and financing links), `facility_form` (fill from
attachments and download the combined PDF pack).

## Models

| Model                 | Writes                     | Notes                                                                            |
| --------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| `bank`                | create, update             | Contacts as a shaped field; products it offers                                   |
| `watch_point`         | create, update             |                                                                                  |
| `letter_of_offer`     | create, update             |                                                                                  |
| `facility`            | create, update             | Fee rules through its layer                                                      |
| `facility_fee`        | through `facility`         |                                                                                  |
| `sub_limit`           | create, update             |                                                                                  |
| `business_partner`    | create, update, import     | Aliases; accepting banks through `eligible_banks`                                |
| `supplier_bank`       | through `business_partner` |                                                                                  |
| `drawdown`            | create, update             | Calculates tenor, interest and latest due date at read time; sealed when settled |
| `drawdown_charge`     | through `drawdown`         | Actual charges only; estimates are computed                                      |
| `bank_document`       | create, update             | Read figures in `extracted`                                                      |
| `month_end`           | create, update             | Locked months are frozen                                                         |
| `month_end_line`      | through `month_end`        | Export sync `sheet`                                                              |
| `fx_rate`             | create, update             |                                                                                  |
| `purchase_order`      | create, update, import     | Lines and invoices through its layers; roll-ups                                  |
| `po_line`             | through `purchase_order`   | Invoiced quantity roll-up                                                        |
| `invoice`             | through `purchase_order`   | Lines through its layer                                                          |
| `invoice_line`        | through `invoice`          |                                                                                  |
| `po_document`         | create, update             |                                                                                  |
| `po_financing`        | create, delete             | A PO and the line that pays it                                                   |
| `facility_form`       | create, update             | Attachments through its layer; an LC form asks for an LC                         |
| `facility_attachment` | through `facility_form`    |                                                                                  |

## Policies and teams

| Policy           | Held by                                    |
| ---------------- | ------------------------------------------ |
| `treasury`       | team `treasury`                            |
| `finance`        | team `finance`                             |
| `purchasing`     | team `purchasing`                          |
| `viewer`         | team `viewers`                             |
| `facility_forms` | `facility_form_read`, `facility_form_pack` |

Closing reads every source page and is the sole writer of portal snapshot figures. Native model rules reject manual closes, manual reopen attempts and hand-entered ledger figures even for administrators. Imported historical summaries are immutable.
