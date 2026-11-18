# Workspace capabilities

Trade Operations manages customer and supplier relationships, commercial agreements, document
versions, approvals, pricing and commissions. It connects those records to ERP evidence through a
configured integration, without replacing the ERP's accounting and fulfillment ledgers.

## Commercial records

A draft quotation and confirmed sales agreement keep one order identity. Sealed revisions preserve
the terms that were approved; later corrections use the supported revision workflow. Supplier
commitments use the same agreement model and editor. Supporting customer POs and signed returns
remain attached to their recorded version.

Price rules, effective dates and quantity tiers supply pricing guidance. Commission rules and
statements use the retained commercial facts. Reports must keep date basis, currency and permission
scope explicit so a total can be reconciled with its underlying records.

## Documents

Each printed document (quotation, sales contract, purchase contract) has one layout per language. Its
structure, branding, legal wording and signing details are supplied by the adopting organization.
Previews and downloads render a draft order in its document's current layout and a confirmed order in the
contract version it sealed. A returned signed copy is evidence; workflow state does not rewrite the generated
commercial terms or apply somebody's signature automatically.

## ERP integration

Read mirrors carry source customer, stock, delivery, invoice and receivable facts. The supported
outbound SO flow uses an outbox and idempotent read-back. Native ERP approval remains distinct from
local commercial approval. Mappings, permissions and account-set behavior are validated before use;
no organization's account names, database credentials or legal identity are template assumptions.

The workspace does not create a second ERP accounting ledger. An unsupported source operation must
remain unavailable rather than be presented as a completed write. Integration failures and pending
work remain visible for the operator to reconcile.

## Platform features

Bolt supplies identity, teams and policies, record history, approvals, files, imports, search, agent
tools and durable job execution. Business models define only their domain-specific records and
rules. Configure provider connections on the host and business-specific mappings in the workspace.

## Acceptance

Use the [manual probe matrix](0008-manual-probe-matrix.md) to verify the configured workspace under
its actual roles. Check saved values after reload, retained versions, duplicate requests, denied
operations, source write read-back, document output and report reconciliation. Provider-dependent
checks require an authorized disposable account set and should be recorded separately from unit tests.
