import { automation, type Id } from '@norbital-ai/bolt';
import { Effect, Schema } from 'effect';
import { input_schema } from '@norbital-ai/std/kind';
import { Decimal, currency } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import { agreements, currentAgreement, resolvableKingdee } from '../lib/agreements.js';
import { contractEntryId } from '../lib/contract-draft.js';

const isId = <C extends string>(of: C, value: string): value is Id<C> =>
	Schema.is(input_schema({ kind: 'ref', to: of }))(value);

export default automation({
	description: 'Start or resume a replacement contract from the current accepted terms.',
	policies: ['order_revision'],
	input: {
		orders: { kind: 'rows', of: 'orders' },
		revision: { kind: 'int', optional: true },
		source: { kind: 'text', optional: true },
		resolution: { kind: 'enum', values: ['adopt', 'revise'], optional: true }
	},
	run: function* ({ orders, revision, source, resolution }, ctx) {
		const identity = <C extends string>(of: C, value: string) =>
			isId(of, value) ? Effect.succeed(value) : ctx.refuse('errors.evidence_sealed');
		const [order] = orders;
		if (!order || orders.length !== 1) return yield* ctx.refuse('errors.agreement_access');
		const target = order.id;
		const starter = ctx.run.trigger;
		if (starter.kind !== 'person' || starter.actor.kind !== 'member')
			return yield* ctx.refuse('errors.agreement_access');
		const { actor } = starter;
		const inScope =
			actor.admin ||
			actor.teams.includes('commercial_managers') ||
			(order.direction === 'purchasing'
				? actor.teams.includes('procurement')
				: actor.teams.includes('sales') && order.owner === actor.id);
		if (!inScope) return yield* ctx.refuse('errors.agreement_access');
		if (order.archived) return yield* ctx.refuse('errors.order_archived');
		if (order.status !== 'confirmed' && !order.draft_setup)
			return yield* ctx.refuse('errors.transition');
		const versions = agreements(order);
		if (
			Boolean(source) !== Boolean(resolution) ||
			(source &&
				(!(actor.admin || actor.teams.includes('commercial_managers')) ||
					source !== (order.draft_setup ?? resolvableKingdee(versions)?.seal_hash)))
		)
			return yield* ctx.refuse('errors.contract_source_changed');
		const current = source
			? versions.find((version) => version.seal_hash === source)
			: order.draft_setup
				? versions.find((version) => version.seal_hash === order.draft_setup)
				: currentAgreement(order);
		if (!current) return yield* ctx.refuse('errors.order_not_confirmed');
		if (resolution === 'adopt') {
			if (!current.kingdee || order.status !== 'confirmed')
				return yield* ctx.refuse('errors.contract_source_changed');
			const native = current.kingdee;
			yield* ctx.act({
				'orders.update': [
					{
						target: { id: target, revision: revision ?? order.revision },
						set: {
							contract_versions: versions.map((version) =>
								version.seal_hash === current.seal_hash
									? {
											...version,
											lifecycle: 'current' as const,
											events: [
												...(version.events ?? []),
												{
													key: `adopted:${current.seal_hash}:${order.revision}`,
													at: ctx.now,
													kind: 'adopted',
													actor: actor.id,
													status: native.status ?? 'issued',
													source_version: native.source_version,
													source_id: native.source_id
												}
											]
										}
									: { ...version, lifecycle: 'superseded' as const }
							)
						}
					}
				]
			});
			return;
		}
		// Parent aggregates cannot be read prospectively inside a combined parent/line write.
		const opened = yield* ctx.act({
			'orders.update': [
				{
					target: { id: target, revision: revision ?? order.revision },
					set: {
						status: 'draft',
						draft_setup: current.seal_hash,
						document_template: current.snapshot.document_template_id
							? yield* identity('document_templates', current.snapshot.document_template_id)
							: null,
						print_values: current.snapshot.print_values ?? null,
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
			]
		});
		if (opened.kind === 'pending_approval') return;
		const { rows } = (yield* ctx.query({ order_lines: { where: { order: { eq: target } } } }))
			.order_lines;
		const lines = yield* Effect.forEach(current.snapshot.lines, (line) =>
			Effect.gen(function* () {
				if (!line.product) return yield* ctx.refuse('errors.product_inactive');
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
						print_values: line.print_values ?? null,
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
			line.existing
				? [{ target: { id: line.existing.id, revision: line.existing.revision }, set: line.set }]
				: []
		);
		const creates = lines.flatMap((line) =>
			line.existing ? [] : [{ order: target, product: line.product, ...line.set }]
		);
		const deletes = rows
			.filter((line) => !retained.has(line.id))
			.map((line) => ({ target: { id: line.id, revision: line.revision } }));
		const copied = yield* ctx.act({
			...(updates.length ? { 'order_lines.update': updates } : {}),
			...(creates.length ? { 'order_lines.create': creates } : {}),
			...(deletes.length ? { 'order_lines.delete': deletes } : {})
		});
		if (copied.kind === 'pending_approval') return;
		const [ready] = (yield* ctx.query({ orders: { where: { id: { eq: target } }, limit: 1 } }))
			.orders.rows;
		if (!ready || ready.draft_setup !== current.seal_hash)
			return yield* ctx.refuse('errors.contract_setup');
		// Clearing the marker validates the complete one-to-one copy before editing or sealing is enabled.
		yield* ctx.act({
			'orders.update': [
				{ target: { id: target, revision: ready.revision }, set: { draft_setup: null } }
			]
		});
	}
});
