# Source reference

Checked against this template's source on 19 November 2026.

26 models, 4 applications, 18 automations, 1 integration, 1 file sync.

## Applications and pages

| Application     | Pages                                                          |
| --------------- | -------------------------------------------------------------- |
| `treasury`      | Overview, Financing, Bank advices, Attention, Costs, Month-end |
| `hedging`       | Overview, Structures, Fixings, Planning                        |
| `purchasing`    | Business partners, Purchase orders, Financing requests         |
| `configuration` | Banks, Facilities, Exchange rates                              |

Record views: `drawdown` (figures, purchase orders, next steps), `bank_document` (automatic extraction and native approval), `purchase_order` (started from its PO PDF, invoice checks, LC and financing links), `facility_form` (filled
from its attachments as they land, and the combined PDF pack).

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
| `bank_document`       | create, update, delete     | Read figures in `extracted`; a submitted advice is never deleted                 |
| `month_end`           | create, update             | Locked months are frozen                                                         |
| `month_end_line`      | through `month_end`        | Export sync `sheet`                                                              |
| `fx_rate`             | create, update             |                                                                                  |
| `purchase_order`      | create, update             | Lines, documents and invoices through its layers; roll-ups                       |
| `po_line`             | through `purchase_order`   | Invoiced quantity roll-up                                                        |
| `invoice`             | through `purchase_order`   | Lines through its layer                                                          |
| `invoice_line`        | through `invoice`          |                                                                                  |
| `po_document`         | create, update, delete     | Filing the PO itself runs `purchase_order_read`                                  |
| `po_financing`        | create, delete             | A PO and the line that pays it                                                   |
| `facility_form`       | create, update             | Attachments through its layer; an LC form asks for an LC                         |
| `facility_attachment` | create, update             | Attaching or replacing one runs `facility_form_read`                             |
| `fx_deal`             | create, update, delete     | Fixings through its layer; status proposal → draft → live; results worked out    |
| `fx_fixing`           | through `fx_deal`          | The bank's fixing rate, and a result a person chooses                            |
| `fx_document`         | create, update, delete     | Uploading runs `fx_document_read`                                                |
| `fx_proposal`         | create, update, delete     | Pasting or attaching runs `fx_proposal_read`                                     |

## Policies and teams

| Policy            | Held by                                    |
| ----------------- | ------------------------------------------ |
| `treasury`        | team `treasury`                            |
| `finance`         | team `finance`                             |
| `purchasing`      | team `purchasing`                          |
| `viewer`          | team `viewers`                             |
| `facility_forms`  | `facility_form_read`, `facility_form_pack` |
| `purchase_orders` | `purchase_order_read`                      |
| `po_earmarks`     | `drawdown_earmark_po`                      |
| `fx_reader`       | `fx_document_read`, `fx_proposal_read`     |
| `fx_rates`        | `fx_rates_fetch`                           |

Closing reads every source page and is the sole writer of closing snapshot figures. Native model rules reject manual closes, manual reopen attempts and hand-entered ledger figures even for administrators. Imported historical summaries are immutable.
