# Objective

Trade Operations is a public Bolt starter for a trading, distribution or manufacturing business. Its job is
to keep one commercial agreement, from quotation to fulfilment, without splitting the same deal across
separate quote, sales-order and contract systems.

The workspace is deliberately **order-centred**:

```text
customer need
   -> quotation / draft agreement
   -> approval and seal
   -> source sales order and customer confirmation
   -> deliveries, invoices and payments
   -> commission and analysis
```

A supplier purchase order uses the same agreement model with `direction = purchasing`. A supplier commitment
is recorded and revised locally; it is not a customer sale and does not need Kingdee acceptance.

## Who it serves

| Team                | What they own                                                               |
| ------------------- | --------------------------------------------------------------------------- |
| Sales               | Customer quotations, agreements, activities, own financial facts            |
| Procurement         | Supplier commitments and their revisions                                    |
| Commercial Managers | Confirmation approvals; both sales and purchasing directions                |
| Finance             | Payments, invoices, credit evidence, commission statements and reports      |
| Logistics           | Operational quantities and delivery evidence, with commercial values masked |
| Configurators       | Pricing floors, commission rules, document layouts and commercial settings  |

## What the product must do

1. **One agreement per deal.** A quote, a confirmed sales contract and a supplier commitment are versions of
   one order record. A version retains the header terms, lines, layout, wording and commission basis it was
   approved with.
2. **Seal what was agreed.** Confirmation freezes the terms. A change is a new revision, not an edit of a
   confirmed version. Earlier versions remain readable.
3. **Use the ERP as evidence, not as the workflow.** Kingdee supplies observed sales orders, deliveries,
   invoices, payments, stock and AR facts. Staff work in Trade Operations; the source system remains the
   authority for what it issued and for credit enforcement.
4. **Price with a dated floor book.** Pricing floors are per product, warehouse group, currency, quantity band
   and effective day. A sales confirmation rechecks the floor and can refuse a line with no compatible floor.
5. **Calculate commission from sealed facts.** A commission rule is a versioned CEL expression. Confirmation
   seals the rule, its parameters, the floor basis and conversion facts the calculation used.
6. **Generate the document from the retained version.** A published layout plus the selected order version
   produces the quotation or contract. Preview and download use the same generated file.
7. **Never invent source facts.** A missing cost, credit limit, stock quantity, delivery or payment remains
   missing. It is not zero, and it is not replaced by a local guess.
8. **Keep money and currency together.** Values are never added, compared or converted across currencies.

## Scope

In scope:

- customer and supplier masters, contacts and credit evidence;
- quotations, sales agreements, supplier commitments and revisions;
- native approval, sealing, archive and history;
- price floors, commission rules and commission statements;
- document templates, retained layouts, previews and PDFs;
- Kingdee SQL Server read mirrors and the verified sales-order write path;
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
- **Sealed means sealed.** Confirmed terms never return to draft. Corrections are revisions or new evidence.
- **Source mirrors are read-only.** Only the sync writes them; policies grant members read access.
- **Native Bolt controls first.** Use approvals, history, files, runs, policies, kinds and grants before
  adding a parallel mechanism.
- **Fewer, clearer screens.** One Orders table with direction views; configuration lives in one app.
- **The source tree is the final authority.** These documents describe its contracts and gates.

## Success

A salesperson can quote, revise and seal an agreement; a procurement user can record a supplier commitment; a
manager can approve; finance can see the invoice, payment and commission evidence; logistics can see what to
ship without seeing commercial values; and an auditor can name the exact version, layout, floor and rule behind
every sealed figure. The ERP can pause, reconnect or replay without creating duplicate local records or losing
the place it reached.

Next: [architecture](0001-architecture.md) · [integration](0002-integration.md)
