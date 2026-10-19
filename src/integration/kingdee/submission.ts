import { Effect, Schema } from 'effect';
import type { ReadCtx } from '@norbital-ai/bolt';
import type { Json } from '@norbital-ai/bolt/engine';
import { agreement, agreementSelect } from '../../lib/agreements.js';
import { type DatabaseContext, SourceRowInvalid } from './cdc.js';
import { sha256Hex } from '../../lib/commercial.js';
import { orderBatch, orderItems } from './order-batch.js';
const Payload = Schema.Struct({
	order_id: Schema.String,
	reference: Schema.String,
	direction: Schema.Literals(['sales', 'purchasing']),
	agreement_hash: Schema.String,
	currency: Schema.String,
	party_code: Schema.String,
	agreement: Schema.String,
	contract: Schema.String,
	items: Schema.String
});
const Result = Schema.Struct({
	rows: Schema.Array(Schema.Struct({ remote: Schema.String, hash: Schema.String }))
});
/**
 * Creates the sealed order in the ledger once per immutable `key`: a lost acknowledgement retries under the same key and
 * finds the same source order; a different payload under that key, or a receipt that does not match it, fails.
 */
export const submitOrder = Effect.fnUntraced(function* (
	payload: Json,
	key: string,
	ctx: DatabaseContext
) {
	const parameters = yield* Schema.decodeUnknownEffect(Payload)(payload).pipe(
		Effect.mapError((cause) => new SourceRowInvalid({ column: '$row', reason: String(cause) }))
	);
	// decoded in the schema's field order: the fingerprint depends on the agreement, never on how the payload was serialized
	const fingerprint = yield* sha256Hex(JSON.stringify(parameters));
	const result = yield* Schema.decodeUnknownEffect(Result)(
		yield* ctx.request({
			transaction: 'serializable',
			maxRows: 1,
			parameters: {
				...parameters,
				key,
				hash: fingerprint,
				resource: `trade:order:${yield* sha256Hex(key)}`
			},
			statement: `DECLARE @lock_result int;
	 EXEC @lock_result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000;
	 IF @lock_result NOT IN (0,1) THROW 51000,'Order submission is busy',1;
	 IF (SELECT COUNT(*) FROM colony.OrderHeader WHERE local_key=@key)>1 THROW 51000,'Ambiguous order identity',1;
	 IF EXISTS(SELECT 1 FROM colony.OrderHeader WHERE local_key=@key AND submission_hash<>@hash) THROW 51000,'Order payload changed',1;
	 IF NOT EXISTS(SELECT 1 FROM colony.OrderHeader WHERE local_key=@key) BEGIN
	 ${orderBatch}
	 END;
	 IF NOT EXISTS(SELECT 1 FROM colony.OrderHeader WHERE local_key=@key AND submission_hash=@hash) THROW 51000,'Order was not created',1;
	 SELECT external_id AS remote,submission_hash AS hash FROM colony.OrderHeader WHERE local_key=@key;`
		})
	).pipe(
		Effect.mapError((cause) => new SourceRowInvalid({ column: '$row', reason: String(cause) }))
	);
	const receipt = result.rows[0];
	if (result.rows.length !== 1 || !receipt?.remote.trim() || receipt.hash !== fingerprint)
		return yield* Effect.fail(
			new SourceRowInvalid({
				column: '$receipt',
				reason: 'Source receipt does not match the immutable submission'
			})
		);
	return receipt.remote;
});
/** The payload must be this ledger's exact approved agreement: a forged or stale header is never sent. */
export const verifyOrder = Effect.fnUntraced(function* (
	payload: Json,
	ctx: Pick<
		ReadCtx<
			'kingdee',
			{
				driver: 'sqlserver';
			}
		>,
		'read' | 'instance'
	>
) {
	const parameters = yield* Schema.decodeUnknownEffect(Payload)(payload).pipe(
		Effect.mapError((cause) => new SourceRowInvalid({ column: '$row', reason: String(cause) }))
	);
	const rows = yield* ctx.read('orders', {
		where: { number: { eq: parameters.reference }, ledger: { eq: ctx.instance } },
		select: { ...agreementSelect, number: true, direction: true },
		limit: 2
	});
	const order = rows.rows[0];
	const approved = order === undefined ? undefined : agreement(order, parameters.agreement_hash);
	if (
		rows.rows.length !== 1 ||
		order?.id !== parameters.order_id ||
		!approved ||
		parameters.direction !== approved.snapshot.direction ||
		parameters.currency !== approved.snapshot.currency ||
		parameters.party_code !== approved.snapshot.party_code ||
		parameters.agreement !== JSON.stringify(approved.snapshot) ||
		parameters.contract !== approved.contract ||
		parameters.items !== orderItems(approved.snapshot.lines)
	)
		return yield* Effect.fail(
			new SourceRowInvalid({
				column: 'agreement',
				reason: 'Submission requires the exact approved local agreement'
			})
		);
});
