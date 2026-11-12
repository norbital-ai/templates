import { JobResult } from '@norbital-ai/bolt-cli/test';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect, Schema } from 'effect';
import { expect, layer } from '@effect/vitest';
import { agreements, currentAgreement, kingdeeAgreement } from '../src/lib/agreements.js';
import { kingdeeFixture, kingdeeSale } from './kingdee-fixture.js';
import { Trade, shared, confirm, type T } from './kit.js';
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
	const local = (yield* (yield* t.as(t.admin)).query({
		orders: { where: { id: { eq: order } }, limit: 1 }
	})).orders.rows[0];
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
		it.effect(
			'a manager can adopt observed terms without duplicating the contract, and later source changes remain conflicts',
			() =>
				Effect.gen(function* () {
					const t = yield* Trade;
					const as = yield* t.as(t.member(['manager'], { teams: ['commercial_managers'] }));
					const actor = as.authority.actor;
					if (actor.kind !== 'member') throw new Error('Member required');
					const { own, fid } = yield* issued(t);
					yield* t.pull('orders');
					amend(fid, '51001');
					yield* t.pull('orders');
					const read = () =>
						as
							.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })
							.pipe(Effect.map((result) => result.orders.rows[0]));
					const before = yield* read();
					const sourceVersion = before && kingdeeAgreement(agreements(before));
					if (!before || !sourceVersion) throw new Error('Observed conflict required');

					const started = yield* as.run(
						'orders_revise',
						{
							orders: [own.order],
							revision: before.revision,
							source: sourceVersion.seal_hash,
							resolution: 'adopt'
						},
						JobResult
					);
					yield* t.run_due();
					if (started.kind !== 'committed') throw new Error('Resolution must start');
					const runs = yield* t.db.rows(
						Schema.Struct({ state: Schema.String, error: Schema.NullOr(Schema.Json) }),
						{
							text: 'SELECT state,error FROM sys_run WHERE id=$1',
							params: [started.output.id]
						}
					);
					expect(runs).toEqual([{ state: 'succeeded', error: null }]);
					const adopted = yield* read();
					if (!adopted) throw new Error('Order required');
					expect(agreements(adopted)).toHaveLength(2);
					expect(currentAgreement(adopted)).toMatchObject({
						seal_hash: sourceVersion.seal_hash,
						lifecycle: 'current',
						events: expect.arrayContaining([
							{
								key: expect.any(String),
								at: expect.any(String),
								actor: actor.id,
								kind: 'adopted',
								status: 'issued',
								source_id: fid,
								source_version: '001'
							}
						])
					});
					expect(adopted.seal_hash).toBe(sourceVersion.seal_hash);
					expect(adopted.agreed_total?.toString()).toBe(sourceVersion.snapshot.total);
					expect(source.tables.SEOrder?.find((row) => row.fid === fid)?.version).toBe('001');
					yield* t.pull('orders');
					const repolled = yield* read();
					if (!repolled) throw new Error('Order required');
					expect(currentAgreement(repolled)?.seal_hash).toBe(sourceVersion.seal_hash);
					// A subsequent native revision must not silently supersede the adopted agreement.
					set(fid, { version: '002' });
					yield* t.pull('orders');
					const later = yield* read();
					if (!later) throw new Error('Order required');
					expect(currentAgreement(later)?.seal_hash).toBe(sourceVersion.seal_hash);
					expect(
						currentAgreement(later)?.events?.some((event) => event.kind === 'sourceConflict')
					).toBe(true);
					yield* as.run(
						'orders_revise',
						{
							orders: [own.order],
							source: sourceVersion.seal_hash,
							resolution: 'adopt'
						},
						JobResult
					);
					yield* t.run_due();
					const stale = yield* read();
					if (!stale) throw new Error('Order required');
					expect(stale.revision).toBe(later.revision);
					yield* as
						.act({
							'orders.update': [
								{
									target: yield* t.at('orders', own.order),
									set: { contract_versions: agreements(stale) }
								}
							]
						})
						.pipe(
							Effect.flip,
							Effect.tap((failure) => Effect.sync(() => expect(failure._tag).toBe('ActRefused')))
						);
				})
		);

		it.effect(
			'a revision copied from Kingdee preserves the current contract until approval and safely writes against that basis',
			() =>
				Effect.gen(function* () {
					const t = yield* Trade;
					const as = yield* t.as(t.admin);
					const { own, fid } = yield* issued(t);
					yield* t.pull('orders');
					amend(fid, '51002');
					yield* t.pull('orders');
					const read = () =>
						as
							.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })
							.pipe(Effect.map((result) => result.orders.rows[0]));
					const before = yield* read();
					const native = before && kingdeeAgreement(agreements(before));
					if (!before || !native) throw new Error('Observed conflict required');
					const started = yield* as.run(
						'orders_revise',
						{
							orders: [own.order],
							revision: before.revision,
							source: native.seal_hash,
							resolution: 'revise'
						},
						JobResult
					);
					yield* t.run_due();
					if (started.kind !== 'committed') throw new Error('Resolution must start');
					const runs = yield* t.db.rows(
						Schema.Struct({ state: Schema.String, error: Schema.NullOr(Schema.Json) }),
						{
							text: 'SELECT state,error FROM sys_run WHERE id=$1',
							params: [started.output.id]
						}
					);
					expect(runs).toEqual([{ state: 'succeeded', error: null }]);
					const draft = yield* read();
					if (!draft) throw new Error('Draft required');
					expect(draft).toMatchObject({
						status: 'draft',
						draft_setup: null,
						draft_basis: native.seal_hash
					});
					expect(currentAgreement(draft)?.seal_hash).toBe(currentAgreement(before)?.seal_hash);
					const lines = (yield* as.query({ order_lines: { where: { order: { eq: own.order } } } }))
						.order_lines.rows;
					expect(lines).toHaveLength(1);
					expect(lines[0]?.quantity.toString()).toBe('12');
					if (!lines[0]) throw new Error('Copied line required');
					yield* as.act({
						'order_lines.update': [
							{ target: yield* t.at('order_lines', lines[0].id), set: { quantity: Decimal.of(14) } }
						]
					});
					yield* confirm(t, own.order);
					const approved = yield* read();
					if (!approved) throw new Error('Approval required');
					expect(currentAgreement(approved)).toMatchObject({
						basis_seal: native.seal_hash,
						lifecycle: 'current'
					});
					yield* t.deliver();
					t.clock.advance('2min');
					yield* t.pull('orders');
					const after = yield* read();
					if (!after) throw new Error('Accepted revision required');
					expect(currentAgreement(after)).toMatchObject({
						seal_hash: approved.seal_hash,
						kingdee: { source_version: '002' },
						snapshot: { lines: [{ quantity: '14' }] }
					});
					expect(agreements(after)).toHaveLength(3);
				})
		);

		it.effect('a formal Kingdee version retains immutable prior terms and the order binding', () =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const as = yield* t.as(t.admin);
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
					lifecycle: 'current',
					kingdee: {
						source_version: '000',
						source_id: '50001',
						archived: true,
						binding_id: first.kingdee.binding_id
					}
				});
				expect(currentAgreement(after)?.seal_hash).toBe(first.seal_hash);
				expect(kingdeeAgreement(versions)).toMatchObject({
					origin: 'kingdee',
					lifecycle: 'superseded',
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
			'an interrupted source-based copy resumes its pinned basis after another native revision',
			() =>
				Effect.gen(function* () {
					const t = yield* Trade,
						as = yield* t.as(t.admin);
					const { own, fid } = yield* issued(t);
					yield* t.pull('orders');
					amend(fid, '51006');
					yield* t.pull('orders');
					const read = () =>
						as
							.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })
							.pipe(Effect.map((answer) => answer.orders.rows[0]));
					const before = yield* read(),
						basis = before && kingdeeAgreement(agreements(before));
					if (!before || !basis) throw new Error('Observed source basis required');
					// Restore the persisted marker at the crash window after opening, before copying the editor lines.
					yield* t.db.write({
						text: "UPDATE orders SET status='draft',draft_setup=$2,draft_basis=$2 WHERE id=$1",
						params: [own.order, basis.seal_hash]
					});
					amend(fid, '51007');
					set(fid, { version: '002' });
					yield* t.pull('orders');
					yield* as.run(
						'orders_revise',
						{
							orders: [own.order],
							source: basis.seal_hash,
							resolution: 'revise'
						},
						JobResult
					);
					yield* t.run_due();
					const ready = yield* read();
					if (!ready) throw new Error('Resumed draft required');
					expect(ready).toMatchObject({
						status: 'draft',
						draft_setup: null,
						draft_basis: basis.seal_hash
					});
					expect(currentAgreement(ready)?.seal_hash).toBe(currentAgreement(before)?.seal_hash);
					expect(kingdeeAgreement(agreements(ready))?.kingdee?.source_version).toBe('002');
					expect(
						(yield* as.query({ order_lines: { where: { order: { eq: own.order } } } })).order_lines
							.rows
					).toMatchObject([{ quantity: Decimal.of(12), unit_price: Decimal.of(3) }]);
				})
		);

		it.effect(
			'an unversioned source edit before the first poll cannot masquerade as a formal contract version',
			() =>
				Effect.gen(function* () {
					const t = yield* Trade;
					const as = yield* t.as(t.admin);
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
