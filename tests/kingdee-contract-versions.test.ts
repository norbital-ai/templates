import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import { agreements, currentAgreement } from '../src/lib/agreements.js';
import { kingdeeFixture, kingdeeSale } from './kingdee-fixture.js';
import { workspace } from './kit.js';
import { fixtureId } from './test-runtime.js';
import type { SqlRow } from '../src/integration/kingdee/polling.js';

const key = (id: string) => id.padStart(20, '0');
const instance = fixtureId('sys_integration', 'kingdee');
it.live('an initial unapproved NULL-checker SO cannot block another contract tracker update', () =>
	Effect.gen(function* () {
		const source = kingdeeFixture();
		const t = yield* workspace({ source: source.request });
		const first = yield* kingdeeSale(t, source);
		yield* t.deliver();
		const existing = source.tables.SEOrder?.[0];
		if (!existing) throw new Error('The first native writer receipt is required');
		source.tables.SEOrder = (source.tables.SEOrder ?? []).map((row) =>
			row === existing ? { ...row, checker: '1', checked_on: '2026-10-10', closed: 1 } : row
		);
		const second = yield* kingdeeSale(t, source);
		yield* t.deliver();
		source.tables.SEOrder = (source.tables.SEOrder ?? []).map((row) =>
			row.fid !== existing.fid ? { ...row, checker: null, checked_on: null } : row
		);
		yield* t.pull('orders');
		yield* t.pull('ext_sales_orders');
		const as = t.as(t.admin);
		const closed = yield* as.query('orders', { id: first.order });
		const unapproved = yield* as.query('orders', { id: second.order });
		if (!closed || !unapproved) throw new Error('Both local SOs must remain available');
		expect(currentAgreement(closed)?.kingdee).toMatchObject({ status: 'issued', closed: true });
		expect(currentAgreement(unapproved)?.kingdee).toMatchObject({ status: 'draft', closed: false });
		expect(
			(yield* as.query('ext_sales_orders', { where: { order: { eq: second.order } }, all: true }))
				.rows
		).toMatchObject([{ status: 'draft' }]);
	})
);
const issued = Effect.fnUntraced(function* () {
	const source = kingdeeFixture();
	const t = yield* workspace({ source: source.request });
	const own = yield* kingdeeSale(t, source);
	yield* t.deliver();
	const head = source.tables.SEOrder?.[0];
	if (!head) throw new Error('Native writer must create the source SO');
	const approved: SqlRow = { ...head, checker: '1', checked_on: '2026-10-10' };
	source.tables.SEOrder = (source.tables.SEOrder ?? []).map((row) =>
		row === head ? approved : row
	);
	return { t, own, source, head: approved, as: t.as(t.admin) };
});
function amend(source: ReturnType<typeof kingdeeFixture>) {
	const head = source.tables.SEOrder?.find((row) => !row.archive);
	if (!head) throw new Error('The live SO is required');
	const old = source.tables.SEOrderEntry?.filter((row) => row.fid === head.fid) ?? [];
	source.tables.SEOrder?.push({
		...head,
		fid: '50001',
		__key: key('50001'),
		uuid: crypto.randomUUID(),
		archive: 1,
		cancelled: true
	});
	for (const [i, line] of old.entries())
		source.tables.SEOrderEntry?.push({
			...line,
			fid: '50001',
			detail_id: String(50001000 + i),
			__key: key(String(50001000 + i))
		});
	source.tables.SEOrder = (source.tables.SEOrder ?? []).map((row) =>
		row === head
			? { ...row, version: '001', changed_at: '2026-10-10T03:00:00', changed_by: '1' }
			: row
	);
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
function delivery(source: ReturnType<typeof kingdeeFixture>, fid: string, order: string) {
	source.tables.ICStockBill?.push({
		__key: key(fid),
		fid,
		reference: `DO-${fid}`,
		type: '21',
		date: '2026-10-10',
		checked_on: '2026-10-10',
		cancelled: false,
		rob: 1
	});
	source.tables.ICStockBillEntry?.push({
		__key: `${key(fid)}:${key('1')}`,
		fid,
		entry_id: '1',
		source_type: '81',
		source_fid: order,
		source_entry: '1',
		item_id: '301',
		unit: 'kg',
		quantity: '4',
		lot: 'A'
	});
}

it.live(
	'formal Kingdee versions retain immutable prior terms and the same local order binding',
	() =>
		Effect.gen(function* () {
			const { t, own, source, as } = yield* issued();
			yield* t.pull('orders');
			const before = yield* as.query('orders', { id: own.order });
			if (!before) throw new Error('The initial local order is required');
			const first = agreements(before)[0];
			if (!first?.kingdee) throw new Error('The tracker must record the initial source identity');
			amend(source);
			source.tables.SEOrder = (source.tables.SEOrder ?? []).map((row) =>
				!row.archive ? { ...row, checker: '0', checked_on: null } : row
			);
			yield* t.pull('orders');
			const pending = yield* as.query('orders', { id: own.order });
			if (!pending) throw new Error('The pending source revision must preserve its local order');
			expect(currentAgreement(pending)?.seal_hash).toBe(first.seal_hash);
			expect(agreements(pending).filter((version) => version.lifecycle === 'current')).toHaveLength(
				1
			);
			expect(agreements(pending).at(-1)?.lifecycle).toBe('pending');
			source.tables.SEOrder = (source.tables.SEOrder ?? []).map((row) =>
				!row.archive ? { ...row, checker: '1', checked_on: '2026-10-10' } : row
			);
			yield* t.pull('orders');
			const after = yield* as.query('orders', { id: own.order });
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
				kingdee: { source_version: '001', archived: false, binding_id: first.kingdee.binding_id },
				snapshot: { lines: [{ quantity: '12', unit_price: '3' }] }
			});
			expect((yield* as.query('orders', { all: true })).rows).toHaveLength(1);
			const captured = versions.map((version) => version.events?.length);
			yield* t.pull('orders');
			const repeated = yield* as.query('orders', { id: own.order });
			if (!repeated) throw new Error('The repeated source read must preserve its order');
			expect(agreements(repeated).map((version) => version.events?.length)).toEqual(captured);
		})
);

it.live(
	'an unversioned source edit before the first poll cannot masquerade as a formal contract version',
	() =>
		Effect.gen(function* () {
			const { t, own, source, as } = yield* issued();
			const line = source.tables.SEOrderEntry?.[0];
			if (!line) throw new Error('The source line is required');
			source.tables.SEOrderEntry = (source.tables.SEOrderEntry ?? []).map((row) =>
				row === line ? { ...row, quantity: '99' } : row
			);
			yield* t.pull('orders');
			const order = yield* as.query('orders', { id: own.order });
			if (!order) throw new Error('The original contract must be retained');
			expect(agreements(order)).toMatchObject([
				{
					snapshot: { lines: [{ quantity: '10' }] },
					events: [{ kind: 'unversionedChange', status: 'changedUnversioned' }]
				}
			]);
			expect(agreements(order)).toHaveLength(1);
			expect(yield* as.query('sys_integration', { id: instance })).toMatchObject({
				status: { health: { state: 'attention', code: 'contractSourceConflict' } }
			});
		})
);

it.live(
	'amendment preserves the physical counterpart and delivery identities and their original contract',
	() =>
		Effect.gen(function* () {
			const { t, own, source, head, as } = yield* issued();
			yield* t.pull('orders');
			yield* t.pull('ext_sales_orders');
			delivery(source, '22001', String(head.fid));
			yield* t.pull('transactions');
			const parent = (yield* as.query('ext_sales_orders', { all: true })).rows[0];
			const transaction = (yield* as.query('transactions', { all: true })).rows[0];
			if (!parent || !transaction) throw new Error('Initial issued evidence is required');
			amend(source);
			yield* t.pull('orders');
			yield* t.pull('ext_sales_orders');
			yield* t.pull('transactions');
			expect(yield* as.query('ext_sales_orders', { id: parent.id })).toMatchObject({
				external_id: parent.external_id,
				agreement_hash: parent.agreement_hash,
				status: 'issued'
			});
			expect(yield* as.query('transactions', { id: transaction.id })).toMatchObject({
				erp_id: transaction.erp_id,
				seal_hash: transaction.seal_hash,
				status: 'issued'
			});
			expect((yield* as.query('transactions', { all: true })).rows).toHaveLength(1);
			delivery(source, '22002', String(head.fid));
			const refused = yield* Effect.flip(t.pull('transactions'));
			expect(refused).toMatchObject({
				_tag: 'BoltError',
				code: 'guestError',
				phase: 'guest',
				cause: { name: 'SourceRowInvalid', message: expect.stringContaining('contractVersion:') }
			});
			expect((yield* as.query('transactions', { all: true })).rows).toHaveLength(1);
		})
);
