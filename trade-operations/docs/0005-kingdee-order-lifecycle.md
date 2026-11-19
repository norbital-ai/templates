# Kingdee order lifecycle

Trade Operations owns the commercial agreement and its approval history. Kingdee owns ERP approval,
fulfillment and accounting evidence. Local confirmation and ERP acceptance are separate states.

## Identities and permissions

Use a read connection for source mirrors and a separately authorized write connection for outbound
sales and purchase orders. Configure database permissions for the selected account set; service-account names and
operator identities belong in deployment configuration, not in template defaults.

The workspace member authorizes the local action. The connector performs the permitted database
operation. Kingdee records its biller and checker identities independently of the workspace member.
Keep those identities in the integration mapping and retain the resulting source identifiers.

## Create and amend

A quotation and the sale synced to Kingdee share one order ID. Syncing happens once: it stamps the commission
rule in force on the order date and queues an idempotent source write, and every later saved change to the
order or its lines queues another. The supported writer creates a saved, unapproved SO or PO and retains its
source identity. A successful write does not imply native Kingdee audit.

Retries read back the stored header and lines before acknowledging the write. While the SO or PO is
unaudited and open its lines are replaced in place, as KIS's own 修改 does. An audited SO is amended: it
keeps its live source identity, archives the version it replaces and logs one 订单变更 row per changed
field. An audited PO refuses the change. Conflicts stay visible for review rather than silently replacing
either side's values.

Validate header and line mappings against the connected account set. Document IDs, entry identifiers
and line ordinals have different meanings; ambiguous or missing identities must be refused before a
write. Use the source's retained identifiers when reconciling a response.

## Read-back and evidence

The read mirrors expose source approval, delivery, invoice, payment and stock facts. They are owned by
the sync and remain read-only to members. Source changes update the mirror; local commercial changes
remain subject to the workspace's policies and floor rule.

Archiving a local order preserves its history and evidence. It does not silently delete a Kingdee SO or PO.
A customer-issued PO, signed return or other supporting file is retained on the order.
Source approval and any required business review remain explicit steps.

## Verify a connection

1. Validate schema and read permissions before enabling a mapping.
2. Rehearse a source write in a disposable account set, then read it back.
3. Repeat the request and verify that it does not create a second order.
4. Exercise amendment, refusal, connection-loss and acknowledgment-replay cases.
5. Confirm that local approval and source approval remain distinguishable throughout.

See [Kingdee implementation](0004-kingdee-implementation.md),
[workspace capabilities](0006-workspace-capabilities.md) and the
[manual probe matrix](0008-manual-probe-matrix.md).
