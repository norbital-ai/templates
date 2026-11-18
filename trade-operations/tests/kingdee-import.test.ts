import { importedOrderKey } from '../src/integration/kingdee/order-identity.js';
import { Effect, Schema } from 'effect';
import { expect, it } from '@effect/vitest';
import { randomUUID } from 'node:crypto';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { committed, workspace } from './kit.js';
import { kingdeeDraft, kingdeeFixture, kingdeeSale } from './kingdee-fixture.js';
import { fixtureId, sameDecimal } from './test-runtime.js';

/** A different native SO, created in Kingdee with its own UUID, not submitted by a local order. */
const sourceSale = Effect.fnUntraced(function* () {
	const fixture = kingdeeFixture();
	let interruptLines = false;
	const t = yield* workspace({
		source: (op) => {
			if (
				interruptLines &&
				op.op === 'call' &&
				String(op.arguments.stmt).includes('FROM dbo.SEOrderEntry line')
			) {
				interruptLines = false;
				return Effect.fail(
					new FacilityFailure({
						kind: 'upstream',
						message: 'Connection interrupted during source discovery'
					})
				);
			}
			return fixture.request(op);
		}
	});
	const as = yield* t.as(t.admin);
	const original = yield* kingdeeSale(t, fixture);
	yield* t.deliver();
	const submitted = [...fixture.submissions.values()][0];
	const header = fixture.tables.SEOrder?.find((row) => row.fid === submitted?.remote);
	const line = fixture.tables.SEOrderEntry?.find((row) => row.fid === submitted?.remote);
	if (!submitted || !header || !line) throw new Error('Fixture SO required');
	const uuid = randomUUID(),
		fid = '99000';
	fixture.tables.SEOrder?.push({
		...header,
		__key: fid.padStart(20, '0'),
		fid,
		uuid,
		reference: 'KINGDEE-CREATED',
		employee_id: '701',
		checker: '701',
		checked_on: '2026-10-10'
	});
	for (const entry of ['1', '2'])
		fixture.tables.SEOrderEntry?.push({
			...line,
			__key: `9900${entry}`.padStart(20, '0'),
			detail_id: `9900${entry}`,
			fid,
			entry_id: entry
		});
	fixture.submissions.set(uuid, { ...submitted, remote: fid, hash: 'native-created' });
	// the first order read brings a Kingdee-created SO in as a draft, the second confirms it, then its lines arrive
	const pull = Effect.gen(function* () {
		yield* t.deliver();
		yield* t.pull('orders');
		yield* t.pull('orders');
		yield* t.pull('order_lines');
	});
	const read = () =>
		as.query({ orders: { where: { title: { eq: 'KINGDEE-CREATED' } }, lines: {} } });
	return {
		t,
		as,
		fixture,
		original,
		uuid,
		fid,
		pull,
		read,
		interrupt: () => {
			interruptLines = true;
		}
	};
});

it.live('imports a native multi-line SO once, then both directions retain its original UUID', () =>
	Effect.gen(function* () {
		const s = yield* sourceSale();
		yield* s.pull;
		let orders = (yield* s.read()).orders.rows;
		expect(orders).toHaveLength(1);
		const order = orders[0];
		if (!order) throw new Error('Imported SO required');
		expect(order).toMatchObject({ status: 'confirmed', kingdee: { fid: s.fid, status: 'issued' } });
		expect(order.lines.map((line) => line.source_entry_id).sort()).toEqual(['1', '2']);
		yield* s.pull;
		expect((yield* s.read()).orders.rows[0]?.id).toBe(order.id);
		expect((yield* s.t.deliver()).delivered).toBe(0);
		const line = order.lines[0];
		if (!line) throw new Error('Imported line required');
		committed(
			'order_lines',
			yield* s.as.act({
				'order_lines.update': [
					{ target: yield* s.t.at('order_lines', line.id), set: { quantity: '12' } }
				]
			})
		);
		yield* s.t.deliver();
		expect(s.fixture.tables.SEOrder?.filter((row) => row.uuid === s.uuid)).toHaveLength(1);
		expect(s.fixture.tables.SEOrder?.find((row) => row.uuid === s.uuid)?.version).toBe('001');
		yield* s.pull;
		expect(
			sameDecimal(
				(yield* s.read()).orders.rows[0]?.lines.find((row) => row.id === line.id)?.quantity,
				'12'
			)
		).toBe(true);
		s.fixture.tables.SEOrderEntry = (s.fixture.tables.SEOrderEntry ?? []).map((row) =>
			row.fid === s.fid && row.entry_id === line.source_entry_id
				? { ...row, quantity: '14', net_amount: '28', tax_amount: '3.64', gross_amount: '31.64' }
				: row
		);
		yield* s.pull;
		expect(
			sameDecimal(
				(yield* s.read()).orders.rows[0]?.lines.find((row) => row.id === line.id)?.quantity,
				'14'
			)
		).toBe(true);
		expect((yield* s.t.deliver()).delivered).toBe(0);
	})
);

it.live('a Kingdee-created SO missing its settlement waits instead of failing the read', () =>
	Effect.gen(function* () {
		const s = yield* sourceSale();
		s.fixture.tables.SEOrder = (s.fixture.tables.SEOrder ?? []).map((row) =>
			row.fid === s.fid ? { ...row, settlement: null } : row
		);
		yield* s.t.deliver();
		yield* s.t.pull('orders');
		expect((yield* s.read()).orders.rows).toHaveLength(0);
		const [sync] = yield* s.t.db.rows(Schema.Struct({ health: Schema.String }), {
			text: "SELECT health::text AS health FROM sys_sync WHERE sync='orders.sync.kingdee'",
			params: []
		});
		expect(sync?.health).toContain(`${s.uuid}: Kingdee settlement is incomplete`);
		// the SO this ledger wrote reads on regardless
		yield* s.pull;
		expect((yield* s.read()).orders.rows).toHaveLength(0);
		expect((yield* s.as.query({ orders: {} })).orders.rows).toHaveLength(1);
	})
);

it.live(
	'an imported SO line waits for its item to be synchronized, then arrives without duplicates',
	() =>
		Effect.gen(function* () {
			const s = yield* sourceSale();
			s.fixture.tables.SEOrderEntry = (s.fixture.tables.SEOrderEntry ?? []).map((row) =>
				row.fid === s.fid && row.entry_id === '2' ? { ...row, item_id: '999999' } : row
			);
			yield* s.pull;
			expect(
				(yield* s.read()).orders.rows.map((row) => row.lines.map((line) => line.source_entry_id))
			).toEqual([['1']]);
			s.fixture.tables.SEOrderEntry = (s.fixture.tables.SEOrderEntry ?? []).map((row) =>
				row.fid === s.fid ? { ...row, item_id: '301' } : row
			);
			yield* s.pull;
			yield* s.pull;
			expect((yield* s.read()).orders.rows.map((row) => row.lines.length)).toEqual([2]);
		})
);

it.live('a source interruption commits no import and recovery imports one complete family', () =>
	Effect.gen(function* () {
		const s = yield* sourceSale();
		s.interrupt();
		yield* Effect.exit(s.t.pull('orders'));
		expect((yield* s.read()).orders.rows).toHaveLength(0);
		yield* s.pull;
		expect((yield* s.read()).orders.rows.map((row) => row.lines.length)).toEqual([2]);
		const order = (yield* s.read()).orders.rows[0];
		const line = order?.lines[0];
		if (!order || !line) throw new Error('Imported order required');
		// A disappearing imported SO must never be re-created by the outbound writer.
		s.fixture.tables.SEOrder = (s.fixture.tables.SEOrder ?? []).filter((row) => row.fid !== s.fid);
		committed(
			'order_lines',
			yield* s.as.act({
				'order_lines.update': [
					{ target: yield* s.t.at('order_lines', line.id), set: { quantity: '15' } }
				]
			})
		);
		yield* s.t.deliver();
		expect(s.fixture.tables.SEOrder?.some((row) => row.uuid === s.uuid)).toBe(false);
	})
);

it.live(
	'resumes a staged draft after interruption before confirmation, adding the missing native line once',
	() =>
		Effect.gen(function* () {
			const s = yield* sourceSale();
			const staged = yield* kingdeeDraft(s.t, s.fixture);
			const cfg = s.fixture.configuration(
				(yield* s.as.query({ orders: { where: { id: { eq: staged.order } } } })).orders.rows[0]
					?.owner ?? ''
			);
			yield* s.t.db.write({
				text: 'UPDATE orders SET title = $2, source_order_key = $3, write_target = $4::jsonb WHERE id = $1',
				params: [
					staged.order,
					'KINGDEE-CREATED',
					importedOrderKey(cfg.writeAccount, '0', s.uuid),
					JSON.stringify({ account: cfg.writeAccount, branch: '0' })
				]
			});
			yield* s.t.db.write({
				text: "UPDATE order_lines SET source_entry_id = '1', line_key = 'kingdee:1' WHERE id = $1",
				params: [staged.line]
			});
			yield* s.pull;
			yield* s.pull;
			expect((yield* s.read()).orders.rows).toMatchObject([
				{ id: staged.order, status: 'confirmed' }
			]);
			expect(
				(yield* s.read()).orders.rows[0]?.lines.map((line) => line.source_entry_id).sort()
			).toEqual(['1', '2']);
		})
);

it.live('an imported Kingdee SO keeps the commission rule in force on its order date', () =>
	Effect.gen(function* () {
		const s = yield* sourceSale();
		const rule = committed(
			'commission_rules',
			yield* s.as.act({
				'commission_rules.create': [
					{
						currency: 'CNY',
						effective_on: '2026-01-01',
						basis_unit: 't',
						fixed_rate: '10',
						spread_pct: '20'
					}
				]
			})
		);
		yield* s.as.act({
			'commercial_settings.update': [
				{
					target: yield* s.t.at(
						'commercial_settings',
						fixtureId('commercial_settings', '00000000-0000-4000-8000-000000000401')
					),
					set: { freight_treatment: 'include' }
				}
			]
		});
		yield* s.pull;
		expect((yield* s.read()).orders.rows[0]).toMatchObject({
			status: 'confirmed',
			freight_treatment: 'include',
			commission: { rule_id: rule, currency: 'CNY', fixed_rate: '10' }
		});
	})
);
