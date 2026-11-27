import { createHash } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { Effect, Exit } from 'effect';
import type { Json } from '@norbital-ai/bolt';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import {
	kingdeeCreditPolicy,
	kingdeeOrgCreditPolicy
} from '../src/integration/kingdee/configuration.js';
import { workspace } from './kit.js';
import { kingdeeFixture } from './kingdee-fixture.js';
import { firstRow, fixtureId, sameDecimal } from './test-runtime.js';

const credit = {
	customer_id: '101',
	known_customer: true,
	currency: 'CNY',
	credit_limit: '100000.00',
	credit_days: 30,
	invoices_audited: '200.00',
	invoices_paid: '87.00',
	refunds_unsettled: '0',
	receipts_unsettled: '0',
	advances_unsettled: '0',
	stock_out_audited: '0',
	stock_out_hooked: '0',
	oldest_days: null,
	invalid_terms: 0
};
const fields = (
	[
		[1, '当前单据金额', '+'],
		[2, '已审核发票金额', '+'],
		[4, '已审核的已收款发票金额', '-'],
		[8, '已审核未核销的应收退款单金额', '+'],
		[16, '已审核未核销的收款单金额', '-'],
		[32, '已审核未核销的预收单金额', '-'],
		[64, '已审核的销售出库单金额', '+'],
		[128, '已钩稽的销售出库单金额', '-']
	] as const
).map(([bit, caption, operator]) => ({ bit, caption, operator }));
const setup = Effect.fnUntraced(function* () {
	const fixture = kingdeeFixture();
	const state: {
		rows: Json[];
		options: Json[];
		fields: Json[];
		observed: string;
		unavailable: boolean;
		reads: number;
		transfers: number;
	} = {
		rows: [credit],
		options: [{ mask: '255', control_range: '3', control: 2 }],
		fields,
		observed: '2026-11-17T03:00:00.000Z',
		unavailable: false,
		reads: 0,
		transfers: 0
	};
	const t = yield* workspace({
		now: state.observed,
		source: (op) => {
			if (op.op !== 'call' || !String(op.arguments.stmt).includes('kingdee-native-credit'))
				return fixture.request(op);
			expect(String(op.arguments.stmt)).not.toMatch(
				/\bsim\.|TradeOperationsProbe|FIsCreditMgr|FPassword|ICCreditManager/
			);
			for (const table of [
				'ICCreditOption',
				'ICCreditField',
				'ICCreditObject',
				't_Organization',
				't_Currency',
				't_RP_Contact',
				'ICSale',
				't_RP_NewReceiveBill',
				'ICStockBill',
				'ICStockBillEntry'
			])
				expect(String(op.arguments.stmt)).toContain('dbo.' + table);
			state.reads++;
			if (state.unavailable)
				return Effect.fail(
					new FacilityFailure({ kind: 'upstream', message: 'Credit source is offline' })
				);
			expect(op.transaction).toBe('serializable');
			if (op.arguments.read_account !== fixture.configuration('test').writeAccount)
				return Effect.fail(
					new FacilityFailure({ kind: 'invalid', message: 'Wrong source account' })
				);
			// as the SQL does: the payload travels only when its fingerprint differs from the caller's
			const entries = JSON.stringify({
				options: state.options,
				fields: state.fields,
				customers: state.rows
			});
			const fingerprint = createHash('sha256').update(entries).digest('hex').toUpperCase();
			const changed = fingerprint !== op.arguments.prior;
			if (changed) state.transfers++;
			return Effect.succeed({
				rows: [
					{
						fingerprint,
						oversized: false,
						entries: changed ? entries : null,
						observed_at: state.observed
					}
				]
			});
		}
	});
	const as = yield* t.as(t.admin),
		instance = fixtureId('sys_integration', 'kingdee');
	const configuration = {
		...fixture.configuration('credit-test-owner'),
		creditAccount: fixture.configuration('credit-test-owner').writeAccount,
		creditPolicy: kingdeeCreditPolicy
	};
	yield* as.act({
		'sys_integration.update': [{ target: { id: instance }, set: { configuration } }]
	});
	yield* t.pull('parties');
	const read = () => as.query({ credit_snapshots: { where: { source: { eq: instance } } } });
	return { t, as, state, instance, configuration, read };
});

it.live(
	'publishes RMB invoice/payment credit, writes nothing for an unchanged position, and retains the last good position on failure',
	() =>
		Effect.gen(function* () {
			const s = yield* setup();
			yield* s.t.pull('credit_snapshots');
			let row = firstRow((yield* s.read()).credit_snapshots.rows);
			expect(sameDecimal(row.credit_used, '113')).toBe(true);
			expect(sameDecimal(row.credit_available, '99887')).toBe(true);
			const identity = row.id;
			s.state.rows = [{ ...credit, invoices_paid: '112.00' }];
			s.state.observed = '2026-11-17T03:01:00.000Z';
			s.t.clock.advance('1min');
			yield* s.t.run_due();
			row = firstRow((yield* s.read()).credit_snapshots.rows);
			expect(row.id).toBe(identity);
			expect(sameDecimal(row.credit_used, '88')).toBe(true);
			expect(sameDecimal(row.credit_available, '99912')).toBe(true);
			s.state.observed = '2026-11-17T03:02:00.000Z';
			const transfers = s.state.transfers;
			const changed = row;
			yield* s.t.pull('credit_snapshots');
			// an unchanged position does not cross the link again and writes nothing: its row keeps the time it
			// changed, and its freshness is the feed's health on the ledger
			expect(s.state.transfers).toBe(transfers);
			row = firstRow((yield* s.read()).credit_snapshots.rows);
			expect(row).toEqual(changed);
			expect(row.as_of).toBe('2026-11-17T03:01:00.000Z');
			const retained = row;
			for (const broken of [
				[{ ...credit, known_customer: false }],
				[{ ...credit, invoices_paid: '1e3' }],
				[{ ...credit, customer_id: '999' }],
				[{ ...credit, currency: 'USD' }],
				[{ ...credit, credit_days: -1 }],
				[{ ...credit, credit_limit: '-1' }],
				[{ ...credit, invalid_terms: 1 }],
				[credit, credit]
			]) {
				s.state.rows = broken;
				expect(Exit.isFailure(yield* Effect.exit(s.t.pull('credit_snapshots')))).toBe(true);
				expect(firstRow((yield* s.read()).credit_snapshots.rows)).toEqual(retained);
			}
			s.state.rows = [{ ...credit, oldest_days: 31 }];
			s.state.unavailable = true;
			expect(Exit.isFailure(yield* Effect.exit(s.t.pull('credit_snapshots')))).toBe(true);
			expect(firstRow((yield* s.read()).credit_snapshots.rows)).toEqual(retained);
			s.state.unavailable = false;
			yield* s.t.pull('credit_snapshots');
			expect(firstRow((yield* s.read()).credit_snapshots.rows).credit_hold).toBe(true);
		})
);

it.live(
	'refuses an unbound policy, wrong account, account changes and duplicate account ledgers',
	() =>
		Effect.gen(function* () {
			const s = yield* setup();
			yield* s.as.act({
				'sys_integration.update': [
					{
						target: { id: s.instance },
						set: { configuration: { ...s.configuration, creditPolicy: null } }
					}
				]
			});
			expect(Exit.isFailure(yield* Effect.exit(s.t.pull('credit_snapshots')))).toBe(true);
			expect(s.state.reads).toBe(0);
			expect((yield* s.read()).credit_snapshots.rows).toHaveLength(0);
			const wrong = '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002';
			yield* s.as.act({
				'sys_integration.update': [
					{
						target: { id: s.instance },
						set: { configuration: { ...s.configuration, creditAccount: wrong } }
					}
				]
			});
			expect(Exit.isFailure(yield* Effect.exit(s.t.pull('credit_snapshots')))).toBe(true);
			expect((yield* s.read()).credit_snapshots.rows).toHaveLength(0);
			yield* s.as.act({
				'sys_integration.update': [
					{ target: { id: s.instance }, set: { configuration: s.configuration } }
				]
			});
			yield* s.t.pull('credit_snapshots');
			const retained = (yield* s.read()).credit_snapshots.rows;
			yield* s.as.act({
				'sys_integration.update': [
					{
						target: { id: s.instance },
						set: { configuration: { ...s.configuration, creditAccount: wrong } }
					}
				]
			});
			expect(Exit.isFailure(yield* Effect.exit(s.t.pull('credit_snapshots')))).toBe(true);
			expect((yield* s.read()).credit_snapshots.rows).toEqual(retained);
			yield* s.as.act({
				'sys_integration.update': [
					{ target: { id: s.instance }, set: { configuration: s.configuration } }
				],
				'sys_integration.create': [
					{
						integration: 'kingdee',
						name: 'Duplicate credit account',
						configuration: s.configuration
					}
				]
			});
			expect(Exit.isFailure(yield* Effect.exit(s.t.pull('credit_snapshots')))).toBe(true);
			expect((yield* s.read()).credit_snapshots.rows).toEqual(retained);
		})
);

it.live('uses the native selected formula, amount/term controls, and clears a removed limit', () =>
	Effect.gen(function* () {
		const s = yield* setup();
		s.state.rows = [
			{
				...credit,
				refunds_unsettled: '20',
				receipts_unsettled: '10',
				advances_unsettled: '5',
				stock_out_audited: '200',
				stock_out_hooked: '80'
			}
		];
		yield* s.t.pull('credit_snapshots');
		expect(sameDecimal(firstRow((yield* s.read()).credit_snapshots.rows).credit_used, '238')).toBe(
			true
		);
		for (const [mask, used] of [
			['6', '113'],
			['2', '200'],
			['1', '0']
		] as const) {
			s.state.options = [{ mask, control_range: '3', control: 2 }];
			yield* s.t.pull('credit_snapshots');
			expect(sameDecimal(firstRow((yield* s.read()).credit_snapshots.rows).credit_used, used)).toBe(
				true
			);
		}
		for (const [range, oldest, limit, blocked] of [
			['1', 31, '113', false],
			['1', 0, '112', true],
			['2', 30, '1', false],
			['2', 31, '100000', true]
		] as const) {
			s.state.options = [{ mask: '6', control_range: range, control: 2 }];
			s.state.rows = [{ ...credit, credit_limit: limit, oldest_days: oldest }];
			yield* s.t.pull('credit_snapshots');
			expect(firstRow((yield* s.read()).credit_snapshots.rows).credit_hold).toBe(blocked);
		}
		s.state.rows = [];
		yield* s.t.pull('credit_snapshots');
		const row = firstRow((yield* s.read()).credit_snapshots.rows);
		expect(row.credit_limit).toBeNull();
		expect(row.credit_used).toBeNull();
		expect(row.credit_available).toBeNull();
		expect(row.credit_hold).toBe(false);
	})
);

it.live(
	'rejects unsupported native options and catalogue changes without updating any balance or timestamp',
	() =>
		Effect.gen(function* () {
			const s = yield* setup();
			yield* s.t.pull('credit_snapshots');
			const retained = (yield* s.read()).credit_snapshots.rows;
			for (const options of [
				[],
				[{ mask: '255', control_range: '3', control: 1 }],
				[{ mask: '255', control_range: '4', control: 2 }],
				[{ mask: '256', control_range: '3', control: 2 }],
				[{ mask: '2147483648', control_range: '3', control: 2 }],
				[{ mask: '-1', control_range: '3', control: 2 }],
				[
					{ mask: '255', control_range: '3', control: 2 },
					{ mask: '255', control_range: '3', control: 2 }
				]
			]) {
				s.state.options = options;
				expect(Exit.isFailure(yield* Effect.exit(s.t.pull('credit_snapshots')))).toBe(true);
				expect((yield* s.read()).credit_snapshots.rows).toEqual(retained);
			}
			s.state.options = [{ mask: '255', control_range: '3', control: 2 }];
			for (const catalogue of [
				fields.slice(1),
				[...fields, firstRow(fields)],
				fields.map((f) => (f.bit === 4 ? { ...f, operator: '+' } : f)),
				fields.map((f) => (f.bit === 4 ? { ...f, caption: 'unmapped' } : f)),
				fields.map((f) => (f.bit === 4 ? { ...f, caption: '已审核发票金额', operator: '+' } : f))
			]) {
				s.state.fields = catalogue;
				expect(Exit.isFailure(yield* Effect.exit(s.t.pull('credit_snapshots')))).toBe(true);
				expect((yield* s.read()).credit_snapshots.rows).toEqual(retained);
			}
		})
);

it.live(
	'resumes an account-pinned full snapshot when an earlier cursor carries extra profile metadata',
	() =>
		Effect.gen(function* () {
			const s = yield* setup();
			yield* s.t.pull('credit_snapshots');
			yield* s.t.db.write({
				text: 'UPDATE sys_sync SET cursor=$2::jsonb WHERE instance=$1 AND sync=$3',
				params: [
					s.instance,
					JSON.stringify({ account: s.configuration.creditAccount, protocol: 'prior-profile' }),
					'credit_snapshots.sync.kingdee'
				]
			});
			s.state.observed = '2026-11-17T03:03:00.000Z';
			yield* s.t.pull('credit_snapshots');
			const row = firstRow((yield* s.read()).credit_snapshots.rows);
			expect(row.as_of).toBe(s.state.observed);
			expect(sameDecimal(row.credit_used, '113')).toBe(true);
		})
);

it.live(
	'supports kis-org-credit-v1 customer master credit and fails loudly on malformed FCreditLimit',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const state: { rows: Json[]; observed: string } = {
				rows: [
					{
						customer_id: '101',
						currency: 'CNY',
						credit_limit: '100000.00',
						invoices_audited: '150000.00',
						invoices_paid: '20000.00',
						refunds_unsettled: '0',
						receipts_unsettled: '0',
						advances_unsettled: '0',
						stock_out_audited: '0',
						stock_out_hooked: '0'
					}
				],
				observed: '2026-11-17T03:00:00.000Z'
			};
			const t = yield* workspace({
				now: state.observed,
				source: (op) => {
					if (op.op !== 'call' || !String(op.arguments.stmt).includes('kingdee-org-credit'))
						return fixture.request(op);
					expect(String(op.arguments.stmt)).toContain(
						"REPLACE(LTRIM(RTRIM(o.FCreditLimit)),',','')"
					);
					expect(String(op.arguments.stmt)).not.toContain("NOT LIKE '%[^0-9.]%'");
					const entries = JSON.stringify({ customers: state.rows });
					const fingerprint = createHash('sha256').update(entries).digest('hex').toUpperCase();
					const changed = fingerprint !== op.arguments.prior;
					return Effect.succeed({
						rows: [
							{
								fingerprint,
								oversized: false,
								entries: changed ? entries : null,
								observed_at: state.observed
							}
						]
					});
				}
			});
			const as = yield* t.as(t.admin);
			const instance = fixtureId('sys_integration', 'kingdee');
			const configuration = {
				...fixture.configuration('org-credit-owner'),
				creditAccount: fixture.configuration('org-credit-owner').writeAccount,
				creditPolicy: kingdeeOrgCreditPolicy
			};
			yield* as.act({
				'sys_integration.update': [{ target: { id: instance }, set: { configuration } }]
			});
			yield* t.pull('parties');
			yield* t.pull('credit_snapshots');
			const read = () => as.query({ credit_snapshots: { where: { source: { eq: instance } } } });
			const good = firstRow((yield* read()).credit_snapshots.rows);
			expect(sameDecimal(good.credit_used, '130000')).toBe(true);
			expect(good.credit_hold).toBe(true);

			// Non-numeric FCreditLimit fails loudly instead of silently dropping the customer
			state.rows = [
				{
					customer_id: '101',
					currency: 'CNY',
					credit_limit: '50万',
					invoices_audited: '150000.00',
					invoices_paid: '20000.00',
					refunds_unsettled: '0',
					receipts_unsettled: '0',
					advances_unsettled: '0',
					stock_out_audited: '0',
					stock_out_hooked: '0'
				}
			];
			expect(Exit.isFailure(yield* Effect.exit(t.pull('credit_snapshots')))).toBe(true);
			expect(firstRow((yield* read()).credit_snapshots.rows)).toEqual(good);
		})
);
