import { Effect, Schema } from 'effect';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { Decimal } from '@norbital-ai/std/decimal';
import { expect, it } from '@effect/vitest';
import { committed, confirm, workspace } from './kit.js';
import { direct } from './synced-kit.js';
import { kingdeeDraft, kingdeeFixture, kingdeeSale } from './kingdee-fixture.js';
import { fixtureId, firstRow } from './test-runtime.js';
import { sourceOrderSql } from '../src/integration/kingdee/submission.js';

it.live.each(['configuration', 'source refusal'] as const)(
	'a failed %s retains the sealed SO through delivery retries',
	(failure) =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({
				source: (operation) =>
					failure === 'source refusal' &&
					operation.op === 'call' &&
					operation.arguments.stmt === sourceOrderSql
						? Effect.fail(
								new FacilityFailure({
									kind: 'invalid',
									message: 'Source order differs from the sealed submission'
								})
							)
						: fixture.request(operation)
			});
			const as = t.as(t.admin);
			const own = yield* kingdeeSale(t, fixture);
			const original = yield* as.query('orders', { id: own.order });
			const line = yield* as.query('order_lines', { id: own.line });
			const instance = fixtureId('sys_integration', 'kingdee');
			if (failure === 'configuration')
				yield* as.act('sys_integration.update', {
					target: instance,
					set: { configuration: { baseCurrency: 'CNY', branchNo: '0' } }
				});
			const delivery = Effect.fnUntraced(function* () {
				return firstRow(
					yield* t.db.rows(
						Schema.Struct({
							status: Schema.String,
							attempts: Schema.Int,
							error: Schema.NullOr(Schema.Json),
							next_attempt_at: Schema.NullOr(Schema.String)
						}),
						{
							text: "SELECT status,attempts,error,next_attempt_at::text FROM sys_outbox WHERE sync='orders.sync.kingdee' AND record=$1 ORDER BY seq",
							params: [own.order]
						}
					)
				);
			});
			const attempts = failure === 'configuration' ? 1 : 8;
			for (let attempt = 1; attempt <= attempts; attempt++) {
				yield* t.deliver();
				const queued = yield* delivery();
				expect(queued).toMatchObject({
					status: attempt < 8 ? 'queued' : 'dead',
					attempts: attempt
				});
				expect(queued.error).not.toBeNull();
				expect(yield* as.query('orders', { id: own.order })).toEqual({
					...original,
					$sync: expect.anything()
				});
				expect(yield* as.query('order_lines', { id: own.line })).toEqual(line);
				if (queued.next_attempt_at) t.clock.set(new Date(queued.next_attempt_at).toISOString());
			}
			if (failure === 'configuration') {
				if (!original) throw new Error('The sealed order must remain available');
				yield* as.act('sys_integration.update', {
					target: instance,
					set: { configuration: fixture.configuration(original.owner) }
				});
				yield* t.deliver();
				expect(yield* delivery()).toMatchObject({ status: 'acked', attempts: 2, error: null });
				expect(fixture.submissions.size).toBe(1);
			}
		})
);

it.live(
	'a quotation remains local until sealing its contract, and archiving does not drop its queued submission',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request });
			const as = t.as(t.admin);
			const own = yield* kingdeeDraft(t, fixture);
			committed(
				'orders',
				yield* as.act('orders.update', {
					target: own.order,
					set: { notes: 'Agreed quotation wording' }
				})
			);
			committed(
				'order_lines',
				yield* as.act('order_lines.update', {
					target: own.line,
					set: { quantity: Decimal.of(11) }
				})
			);
			expect(yield* as.query('orders', { id: own.order })).toMatchObject({
				notes: 'Agreed quotation wording'
			});
			expect((yield* as.query('orders.quotation_export', { order: own.order })).contract).toContain(
				'11 kg'
			);
			yield* t.deliver();
			expect(fixture.submissions.size).toBe(0);
			yield* confirm(t, own.order);
			const original = yield* as.query('orders', { id: own.order });
			const line = yield* as.query('order_lines', { id: own.line });
			expect(
				(yield* as.query('ext_sales_orders', { where: { order: { eq: own.order } }, all: true }))
					.rows
			).toEqual([]);
			// The contract lock applies before delivery or source polling.
			expect(
				yield* Effect.flip(
					as.act('orders.update', {
						target: own.order,
						set: { payment_terms: 'Overwrite sealed terms' }
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* Effect.flip(
					as.act('order_lines.update', {
						target: own.line,
						set: { unit_price: Decimal.of(99) }
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* Effect.flip(
					as.act('order_lines.create', {
						order: own.order,
						product: own.product,
						quantity: Decimal.of(1),
						unit_price: Decimal.of(2),
						tax_rate: Decimal.of(13)
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(yield* Effect.flip(as.act('order_lines.delete', { target: own.line }))).toMatchObject({
				_tag: 'ActRefused'
			});
			expect(yield* as.query('orders', { id: own.order })).toEqual({
				...original,
				$sync: expect.anything()
			});
			expect(yield* as.query('order_lines', { id: own.line })).toEqual(line);
			committed(
				'orders',
				yield* as.act('orders.update', { target: own.order, set: { archived: true } })
			);
			yield* t.deliver();
			expect(fixture.submissions.size).toBe(1);
		})
);

it.live.each(['draft', 'issued', 'void'] as const)(
	'a %s Kingdee counterpart preserves the original seal and cannot be edited locally',
	(status) =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request });
			const as = t.as(t.admin);
			const own = yield* kingdeeSale(t, fixture);
			yield* t.deliver();
			const header = fixture.tables.SEOrder?.[0];
			if (!header) throw new Error('The submitted source SO is missing');
			fixture.tables.SEOrder = (fixture.tables.SEOrder ?? []).map((row) =>
				row === header
					? {
							...row,
							checker: status === 'draft' ? '0' : '1',
							checked_on: status === 'draft' ? null : '2026-10-10',
							cancelled: status === 'void'
						}
					: row
			);
			yield* t.pull('ext_sales_orders');
			const mirror = (yield* as.query('ext_sales_orders', {
				where: { order: { eq: own.order } },
				all: true
			})).rows[0];
			if (!mirror) throw new Error('The readonly source counterpart did not sync');
			const original = yield* as.query('orders', { id: own.order });
			const line = yield* as.query('order_lines', { id: own.line });
			expect(mirror).toMatchObject({ status, agreement_hash: own.seal });
			expect(
				yield* as
					.act('orders.update', {
						target: own.order,
						set: { payment_terms: 'Overwrite approved terms' }
					})
					.pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* direct(t, as.authority, {
					collection: 'ext_sales_orders',
					verb: 'update',
					input: [{ target: mirror.id, set: { status: status === 'void' ? 'issued' : 'void' } }]
				})
			).not.toMatchObject({ kind: 'committed' });
			expect(yield* as.query('orders', { id: own.order })).toEqual(original);
			expect(yield* as.query('order_lines', { id: own.line })).toEqual(line);
			expect(yield* as.query('ext_sales_orders', { id: mirror.id })).toMatchObject({
				status,
				agreement_hash: own.seal
			});
		})
);

it.live('archiving does not void Kingdee and a later source void retains the contract', () =>
	Effect.gen(function* () {
		const fixture = kingdeeFixture();
		const t = yield* workspace({ source: fixture.request });
		const as = t.as(t.admin);
		const own = yield* kingdeeSale(t, fixture);
		yield* t.deliver();
		yield* t.pull('ext_sales_orders');
		const original = yield* as.query('orders', { id: own.order });
		if (!original) throw new Error('Sealed contract required');
		committed(
			'orders',
			yield* as.act('orders.update', { target: own.order, set: { archived: true } })
		);
		yield* t.pull('ext_sales_orders');
		expect(
			(yield* as.query('ext_sales_orders', { where: { order: { eq: own.order } }, all: true })).rows
		).toMatchObject([{ status: 'draft', agreement_hash: own.seal }]);
		const header = fixture.tables.SEOrder?.[0];
		if (!header) throw new Error('The submitted source SO is missing');
		fixture.tables.SEOrder = (fixture.tables.SEOrder ?? []).map((row) =>
			row === header ? { ...row, cancelled: true } : row
		);
		yield* t.pull('ext_sales_orders');
		expect(
			(yield* as.query('ext_sales_orders', { where: { order: { eq: own.order } }, all: true })).rows
		).toMatchObject([{ status: 'void', agreement_hash: own.seal }]);
		expect(yield* as.query('orders', { id: own.order })).toMatchObject({
			archived: true,
			status: 'confirmed',
			seal_hash: original.seal_hash,
			sealed_contract: original.sealed_contract,
			sealed_snapshot: original.sealed_snapshot
		});
		committed(
			'orders',
			yield* as.act('orders.update', { target: own.order, set: { archived: false } })
		);
		expect(yield* as.query('orders', { id: own.order })).toMatchObject({
			archived: false,
			status: 'confirmed',
			seal_hash: original.seal_hash
		});
	})
);
