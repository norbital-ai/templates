# Objective

Trade Operations is a public Bolt starter for a trading, distribution or manufacturing business. Its job is
to keep one commercial agreement, from quotation to fulfilment, without splitting the same deal across
separate quote, sales-order and contract systems.

The workspace is deliberately **order-centred**:

```text
customer need
   -> quotation / draft agreement
   -> sync to Kingdee
   -> source sales order and customer confirmation
   -> deliveries, invoices and payments
   -> commission and analysis
```

A supplier purchase order uses the same agreement model with `direction = purchasing` and syncs both ways
with its Kingdee PO, as a sales order does with its SO.

## Who it serves

| Team                | What they own                                                                |
| ------------------- | ---------------------------------------------------------------------------- |
| Sales               | Customer quotations, agreements, activities, own financial facts             |
| Procurement         | Supplier purchase orders and their changes                                   |
| Commercial Managers | Below-floor and draft-delete approvals; both sales and purchasing directions |
| Finance             | Payments, invoices, credit evidence, commission statements and reports       |
| Logistics           | Operational quantities and delivery evidence, with commercial values masked  |
| Configurators       | Pricing floors, commission rules, document layouts and commercial settings   |

## What the product must do

1. **One agreement per deal.** A quote, a confirmed sales contract and a supplier purchase order are states of
   one order record. The order holds its terms; native history keeps every earlier value.
2. **Sync once, then stay in step.** Syncing an order to Kingdee happens once and stamps the commission rule in
   force on its order date. A synced order never returns to draft; every later saved change to it or its lines
   follows to its Kingdee order. Approval is for exceptions: a sales line below its floor.
3. **Use the ERP as evidence, not as the workflow.** Kingdee supplies observed sales and purchase orders,
   deliveries, receipts, invoices, payments, stock and AR facts, read-only here. Staff work in Trade
   Operations; the source system remains the authority for what it issued and for credit enforcement.
4. **Price with a dated floor book.** Pricing floors are per product, warehouse group, currency, quantity band
   and effective day. The floor rule warns about a sales line below its floor or with none, sends it to a
   Commercial Manager, or refuses it.
5. **Calculate commission from stamped facts.** A commission rule is a versioned CEL expression. Syncing stamps
   the rule in force on the order date and its parameters; each line keeps the floor basis and conversion facts
   it was priced with.
6. **Generate the document from the order.** The order's terms in its document case's newest published layout
   (quotation, sales contract or purchase contract) and language produce the PDF. The signed copy the customer
   returns, filed on the order, is the evidence of what was signed. Preview and download use the same generated
   file.
7. **Never invent source facts.** A missing cost, credit limit, stock quantity, delivery or payment remains
   missing. It is not zero, and it is not replaced by a local guess.
8. **Keep money and currency together.** Values are never added or compared across currencies. The one
   conversion is a foreign-currency sale's margin, at the exchange rate Kingdee recorded on its order.

## Scope

In scope:

- customer and supplier masters, contacts and credit evidence;
- quotations, sales agreements and supplier purchase orders;
- native approval, archive and history;
- price floors, commission rules and commission statements;
- document layouts per case and language, previews and PDFs;
- Kingdee SQL Server read mirrors and the verified sales- and purchase-order write path;
- stock, AR aging, sales analysis and order/commission reports;
- English and Chinese workspace copy.

Out of scope for the starter:

- replacing Kingdee accounting, credit enforcement or statutory invoicing;
- a second payment, delivery, invoice or stock ledger;
- automatic source repair when a Kingdee mapping is incomplete;
- customer-specific legal wording, letterhead or stamp artwork in the public seed;
- hosted LLM or large model execution (integrations reach third-party providers).

## Design principles

- **One owner per fact.** A value is read from its owner; it is not copied into a second model or JSON bag.
- **Synced is one-way.** A synced order never returns to draft. A later change is a recorded edit of the
  order; Kingdee evidence is never edited.
- **Source mirrors are read-only.** Only the sync writes them; policies grant members read access.
- **Native Bolt controls first.** Use approvals, history, files, runs, policies, kinds and grants before
  adding a parallel mechanism.
- **Fewer, clearer screens.** One Orders table with direction views; configuration lives in one app.
- **The source tree is the final authority.** These documents describe its contracts and gates.

## Success

A salesperson can quote, revise and sync an agreement to Kingdee; a procurement user can sync a supplier purchase
order; a manager can approve an exception; finance can see the invoice, payment and commission evidence; logistics
can see what to ship without seeing commercial values; and an auditor can name the floor and rule behind every
synced figure. The ERP can pause, reconnect or replay without creating duplicate local records or losing
the place it reached.

Next: [architecture](0001-architecture.md) · [integration](0002-integration.md)
