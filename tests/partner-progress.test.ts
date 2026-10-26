import { localOf } from '@norbital-ai/std/zone';
import { fixtureId, decimalText, firstRow } from './test-runtime.js';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { workspace, draft, confirm, committed, revise } from './kit.js';
import { partnerProgress } from '../src/lib/partner-progress.js';
import { agreements } from '../src/lib/agreements.js';
import { sourceOrder, sourceTransaction } from './synced-kit.js';
import { kingdeeDraft, kingdeeFixture, observeKingdeeOrder } from './kingdee-fixture.js';
test.live(
	'partner quota retains the current contract while a replacement draft is edited and archived',
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
					set: { valid_until: PlainDate('2026-09-30') }
				})
			);
			yield* confirm(t, own.order);
			yield* observeKingdeeOrder(t, fixture, own.order);
			yield* as.act('sys_integration.update', {
				target: fixtureId('sys_integration', 'kingdee'),
				set: { active: false }
			});
			const parent = yield* sourceOrder(t, own.order);
			yield* sourceTransaction(t, own, parent, 'delivery', '4');
			yield* sourceTransaction(t, own, parent, 'invoice', '4');
			expect(
				yield* as.query('parties.progress', {
					as_of: PlainDate(localOf(Date.parse(t.clock.now()), t.manifest.workspace.tz).date),
					party: own.party
				})
			).toMatchObject([
				{
					quota: decimalText('10'),
					delivered: decimalText('4'),
					fulfillment: decimalText('40.00'),
					forecast: decimalText('20.00'),
					actual: null,
					state: 'overdue'
				}
			]);
			const sealed = yield* as.query('orders', { id: own.order });
			yield* revise(t, own.order);
			committed(
				'order_lines',
				yield* as.act('order_lines.update', {
					target: own.line,
					set: { quantity: Decimal.of('20') }
				})
			);
			committed(
				'orders',
				yield* as.act('orders.update', { target: own.order, set: { archived: true } })
			);
			expect(yield* as.query('orders', { id: own.order })).toMatchObject({
				status: 'draft',
				archived: true,
				seal_hash: sealed?.seal_hash,
				sealed_snapshot: sealed?.sealed_snapshot,
				sealed_contract: sealed?.sealed_contract
			});
			expect(
				yield* as.query('parties.progress', {
					as_of: PlainDate(localOf(Date.parse(t.clock.now()), t.manifest.workspace.tz).date),
					party: own.party
				})
			).toMatchObject([
				{ quota: decimalText('10'), delivered: decimalText('4'), fulfillment: decimalText('40.00') }
			]);
		})
);
test.live(
	'historical delivery facts remain attached to the SKU in their original imported seal',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			const own = yield* draft(t);
			yield* confirm(t, own.order);
			const parent = yield* sourceOrder(t, own.order);
			yield* sourceTransaction(t, own, parent, 'delivery', '4');
			const original = yield* as.query('orders', { id: own.order });
			if (!original) throw new Error('Order missing');
			// Historical imported versions are projection fixtures; this does not reopen the native sealed SO.
			const order: Parameters<typeof partnerProgress>[0][number] = original;
			const versions = agreements(order);
			const previous = versions[0];
			if (previous === undefined) throw new Error('Approved agreement required');
			const replacement: ReturnType<typeof agreements>[number] = {
				...previous,
				version: 2,
				seal_hash: 'replacement',
				lifecycle: 'current',
				snapshot: {
					...previous.snapshot,
					lines: previous.snapshot.lines.map((line) => ({
						...line,
						product: 'different-sku',
						product_name: 'Resin B'
					}))
				}
			};
			const revised = {
				...order,
				contract_versions: [{ ...previous, lifecycle: 'superseded' as const }, replacement]
			};
			const documents = (yield* as.query('transactions', {
				all: true,
				select: {
					order: true,
					seal_hash: true,
					status: true,
					kind: true,
					items: true,
					issued_on: true
				}
			})).rows;
			const pending = {
				...order,
				contract_versions: [previous, { ...replacement, lifecycle: 'pending' as const }]
			};
			expect(firstRow(partnerProgress([pending], documents, [], '2026-10-10'))).toMatchObject({
				sku: 'Resin A',
				quota: decimalText('10'),
				delivered: decimalText('4')
			});
			const progress = firstRow(partnerProgress([revised], documents, [], '2026-10-10'));
			expect(progress.sku).toBe('Resin B');
			expect(String(progress.delivered)).toBe('0');
			const source = {
				branch: '0',
				source_id: '34135',
				live_source_id: '34135',
				source_version: '000',
				source_uuid: '00000000-0000-4000-8000-000000034135',
				observed_at: Instant(t.clock.now()),
				content_hash: 'retained-source-terms',
				archived: false
			};
			const fact = {
				order: own.order,
				seal_hash: previous.seal_hash,
				order_line: own.line,
				kind: 'shipment' as const,
				unit: 'kg',
				quantity: Decimal.of('4'),
				net_amount: Decimal.of('8'),
				active: true,
				business_on: PlainDate('2026-10-10')
			};
			for (const [status, closed, state] of [
				['void', false, 'source_void'],
				['issued', true, 'source_closed']
			] as const) {
				const stopped = {
					...order,
					contract_versions: [
						{
							...previous,
							lifecycle: 'current' as const,
							kingdee: { ...source, status, closed }
						}
					]
				};
				expect(firstRow(partnerProgress([stopped], documents, [fact], '2026-10-10'))).toMatchObject(
					{
						quota: decimalText('10'),
						delivered: decimalText('4'),
						forecast: decimalText('0'),
						actual: decimalText('8'),
						state
					}
				);
			}
		})
);
test.live(
	'supplier fulfillment uses captured invoice item values without deriving value from the contract',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			const own = yield* draft(t, 'purchasing');
			yield* confirm(t, own.order);
			const parent = yield* sourceOrder(t, own.order);
			yield* sourceTransaction(t, own, parent, 'delivery', '4');
			yield* sourceTransaction(t, own, parent, 'invoice', '4', {
				items: [
					{
						order_line_id: own.line,
						product_name: 'Resin A',
						unit: 'kg',
						quantity: '4',
						unit_price: '2',
						net_amount: '6.8'
					}
				]
			});
			expect(
				yield* as.query('parties.progress', {
					as_of: PlainDate(localOf(Date.parse(t.clock.now()), t.manifest.workspace.tz).date),
					party: fixtureId('parties', '00000000-0000-4000-8000-000000000102')
				})
			).toMatchObject([
				{
					quota: decimalText('10'),
					delivered: decimalText('4'),
					fulfillment: decimalText('40.00'),
					forecast: decimalText('20.00'),
					actual: decimalText('6.8')
				}
			]);
		})
);
