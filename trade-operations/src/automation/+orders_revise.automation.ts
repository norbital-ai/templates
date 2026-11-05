import { automation, type Id } from '@norbital-ai/bolt';
import { Effect, Schema } from 'effect';
import { Refusal } from '@norbital-ai/bolt/errors';
import { inputSchema } from '@norbital-ai/std/kind';
import { Decimal, currency } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import { currentAgreement } from '../lib/agreements.js';
import { contractEntryId } from '../lib/contract-draft.js';

const identity = <C extends string>(of: C, value: string) =>
	Schema.decodeUnknownEffect(
		Schema.declare<Id<C>>((input): input is Id<C> =>
			Schema.is(inputSchema({ kind: 'id', of }))(input)
		)
	)(value).pipe(Effect.mapError(() => new Refusal({ message: 'errors.evidence_sealed' })));

export default automation('orders_revise', {
	description: 'Start or resume a replacement contract from the current accepted terms.',
	policies: ['order_revision'],
	input: {
		target: { kind: 'id', of: 'orders' },
		revision: { kind: 'int', optional: true }
	},
	run: function* ({ target, revision }, ctx) {
		const [order] = (yield* ctx.query({ orders: { where: { id: { eq: target } }, limit: 1 } }))
			.orders.rows;
		if (!order) return yield* new Refusal({ message: 'errors.agreement_access' });
		if (order.archived) return yield* new Refusal({ message: 'errors.order_archived' });
		if (order.status !== 'confirmed' && !order.draft_setup)
			return yield* new Refusal({ message: 'errors.transition' });
		const current = currentAgreement(order);
		if (!current) return yield* new Refusal({ message: 'errors.order_not_confirmed' });
		if (current.kingdee?.status === 'void' || current.kingdee?.closed)
			return yield* new Refusal({ message: 'errors.contract_source_closed' });
		if (!current.kingdee?.binding_id || current.kingdee.status !== 'issued')
			return yield* new Refusal({ message: 'errors.contract_pending' });

		// Parent aggregates cannot be read prospectively inside a combined parent/line write.
		const opened = yield* ctx.act(
			'orders.update',
			[
				{
					target,
					set: {
						status: 'draft',
						draft_setup: current.seal_hash,
						currency: currency(current.snapshot.currency),
						tax_inclusive: current.snapshot.tax_inclusive,
						ordered_on: current.ordered_on,
						warehouse: current.snapshot.warehouse
							? yield* identity('warehouses', current.snapshot.warehouse)
							: null,
						valid_from: current.snapshot.valid_from ? PlainDate(current.snapshot.valid_from) : null,
						valid_until: current.snapshot.valid_until
							? PlainDate(current.snapshot.valid_until)
							: null,
						payment_terms: current.snapshot.payment_terms,
						delivery_terms: current.snapshot.delivery_terms || null,
						supporting_documents: current.supporting_documents ?? []
					}
				}
			],
			{ observed: { [target]: revision ?? order.revision } }
		);
		if (opened.kind === 'pendingApproval') return;
		const { rows } = (yield* ctx.query({ order_lines: { where: { order: { eq: target } } } }))
			.order_lines;
		const lines = yield* Effect.forEach(current.snapshot.lines, (line) =>
			Effect.gen(function* () {
				if (!line.product) return yield* new Refusal({ message: 'errors.product_inactive' });
				const source_entry_id = contractEntryId(current, line);
				const existing = rows.find(
					(row) =>
						row.product === line.product &&
						row.unit === line.unit &&
						(row.id === line.id || (source_entry_id && row.source_entry_id === source_entry_id))
				);
				return {
					existing,
					product: yield* identity('products', line.product),
					set: {
						source_entry_id,
						quantity: Decimal.of(line.quantity),
						unit_price: Decimal.of(line.unit_price),
						discount_pct: Decimal.of(line.discount_pct),
						tax_rate: Decimal.of(line.tax_rate)
					}
				};
			})
		);
		const retained = new Set(lines.flatMap((line) => (line.existing ? [line.existing.id] : [])));
		const updates = lines.flatMap((line) =>
			line.existing ? [{ target: line.existing.id, set: line.set }] : []
		);
		const creates = lines.flatMap((line) =>
			line.existing ? [] : [{ order: target, product: line.product, ...line.set }]
		);
		const deletes = rows.filter((line) => !retained.has(line.id)).map((line) => line.id);
		const observed = Object.fromEntries(rows.map((line) => [line.id, line.revision]));
		const copied = yield* ctx.act.many([
			...(updates.length
				? [{ callable: 'order_lines.update' as const, input: updates, observed }]
				: []),
			...(creates.length ? [{ callable: 'order_lines.create' as const, input: creates }] : []),
			...(deletes.length
				? [
						{
							callable: 'order_lines.delete' as const,
							input: deletes.map((id) => ({ target: id })),
							observed
						}
					]
				: [])
		]);
		if (copied.kind === 'pendingApproval') return;
		const [ready] = (yield* ctx.query({ orders: { where: { id: { eq: target } }, limit: 1 } }))
			.orders.rows;
		if (!ready || ready.draft_setup !== current.seal_hash)
			return yield* new Refusal({ message: 'errors.contract_setup' });
		// Clearing the marker validates the complete one-to-one copy before editing or sealing is enabled.
		yield* ctx.act('orders.update', [{ target, set: { draft_setup: null } }], {
			observed: { [target]: ready.revision }
		});
	}
});
