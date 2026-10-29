import { Effect } from 'effect';
import { expect, layer } from '@effect/vitest';
import { agreements, currentAgreement } from '../src/lib/agreements.js';
import { kingdeeFixture, kingdeeSale } from './kingdee-fixture.js';
import { Trade, shared, type T } from './kit.js';
import { fixtureId } from './test-runtime.js';
import type { Id } from '@norbital-ai/bolt';
import type { SqlRow } from '../src/integration/kingdee/polling.js';

const key = (id: string) => id.padStart(20, '0');
const instance = fixtureId('sys_integration', 'kingdee');
// One source and workspace; each test owns its own SO (`fid`), so table edits stay per test.
const source = kingdeeFixture();
const set = (fid: string, change: SqlRow) => {
	source.tables.SEOrder = (source.tables.SEOrder ?? []).map((row) =>
		row.fid === fid ? { ...row, ...change } : row
	);
};
/** The live source header the writer created for a local order (its bill number is the order number). */
const headOf = Effect.fnUntraced(function* (t: T, order: Id<'orders'>) {
	const local = (yield* t.as(t.admin).query({ orders: { where: { id: { eq: order } }, limit: 1 } }))
		.orders.rows[0];
	const head = source.tables.SEOrder?.find(
		(row) => row.reference === local?.number && !row.archive
	);
	if (!head) throw new Error('Native writer must create the source SO');
	return String(head.fid);
});
/** A sale the writer created in Kingdee and an approver checked: its live source header id. */
const issued = Effect.fnUntraced(function* (t: T) {
	const own = yield* kingdeeSale(t, source);
	yield* t.deliver();
	const fid = yield* headOf(t, own.order);
	set(fid, { checker: '1', checked_on: '2026-10-10' });
	return { own, fid };
});
/** A formal Kingdee amendment: the old version archived under `archive`, the live header bumped to version 001. */
function amend(fid: string, archive: string) {
	const head = source.tables.SEOrder?.find((row) => row.fid === fid);
	if (!head) throw new Error('The live SO is required');
	const old = source.tables.SEOrderEntry?.filter((row) => row.fid === fid) ?? [];
	source.tables.SEOrder?.push({
		...head,
		fid: archive,
		__key: key(archive),
		uuid: crypto.randomUUID(),
		archive: 1,
		cancelled: true
	});
	for (const [i, line] of old.entries())
		source.tables.SEOrderEntry?.push({
			...line,
			fid: archive,
			detail_id: String(Number(archive) * 1000 + i),
			__key: key(String(Number(archive) * 1000 + i))
		});
	set(fid, { version: '001', changed_at: '2026-10-10T03:00:00', changed_by: '1' });
	for (const line of old)
		Object.assign(line, {
			quantity: '12',
			unit_price: '3',
			unit_price_inclusive: '3.39',
			tax_rate: '13',
			net_amount: '36',
			tax_amount: '4.68',
			gross_amount: '40.68'
		});
}

layer(shared({ source: source.request }), { excludeTestServices: true })(
	'kingdee contract versions',
	(it) => {
		it.effect('a formal Kingdee version retains immutable prior terms and the order binding', () =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const as = t.as(t.admin);
				const { own, fid } = yield* issued(t);
				yield* t.pull('orders');
				const read = () =>
					as
						.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })
						.pipe(Effect.map((answer) => answer.orders.rows[0]));
				const before = yield* read();
				const first = before && agreements(before)[0];
				if (!first?.kingdee) throw new Error('The tracker must record the initial source identity');
				amend(fid, '50001');
				yield* t.pull('orders');
				const after = yield* read();
				if (!after) throw new Error('The local order must survive source amendment');
				const versions = agreements(after);
				expect(versions).toHaveLength(2);
				expect(versions[0]).toMatchObject({
					seal_hash: first.seal_hash,
					snapshot: first.snapshot,
					contract: first.contract,
					lifecycle: 'superseded',
					kingdee: {
						source_version: '000',
						source_id: '50001',
						archived: true,
						binding_id: first.kingdee.binding_id
					}
				});
				expect(currentAgreement(after)).toMatchObject({
					origin: 'kingdee',
					lifecycle: 'current',
					kingdee: {
						source_version: '001',
						archived: false,
						binding_id: first.kingdee.binding_id
					},
					snapshot: { lines: [{ quantity: '12', unit_price: '3' }] }
				});
			})
		);

		it.effect(
			'an unversioned source edit before the first poll cannot masquerade as a formal contract version',
			() =>
				Effect.gen(function* () {
					const t = yield* Trade;
					const as = t.as(t.admin);
					const { own, fid } = yield* issued(t);
					source.tables.SEOrderEntry = (source.tables.SEOrderEntry ?? []).map((row) =>
						row.fid === fid ? { ...row, quantity: '99' } : row
					);
					yield* t.pull('orders');
					const order = (yield* as.query({
						orders: { where: { id: { eq: own.order } }, limit: 1 }
					})).orders.rows[0];
					if (!order) throw new Error('The original contract must be retained');
					expect(agreements(order)).toMatchObject([
						{
							snapshot: { lines: [{ quantity: '10' }] },
							events: [{ kind: 'unversionedChange', status: 'changedUnversioned' }]
						}
					]);
					expect(agreements(order)).toHaveLength(1);
					expect(
						(yield* as.query({ sys_integration: { where: { id: { eq: instance } }, limit: 1 } }))
							.sys_integration.rows[0]
					).toMatchObject({
						status: { health: { state: 'attention', code: 'contractSourceConflict' } }
					});
				})
		);
	}
);
