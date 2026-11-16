import { expect, it } from '@effect/vitest';
import { Effect, Exit } from 'effect';
import type { Json as SourceJson } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { simulatorCreditPolicy } from '../src/integration/kingdee/configuration.js';
import { workspace } from './kit.js';
import { kingdeeFixture } from './kingdee-fixture.js';
import { firstRow, fixtureId, sameDecimal } from './test-runtime.js';

const credit = {
	customer_id: '101',
	policy: simulatorCreditPolicy,
	supported: true,
	currency: 'CNY',
	credit_limit: '100000.00',
	credit_used: '113.00',
	credit_hold: false
};
const setup = Effect.fnUntraced(function* () {
	const fixture = kingdeeFixture();
	const rows: SourceJson[] = [credit];
	const state = { rows, observed: '2026-11-17T03:00:00.000Z', unavailable: false, reads: 0 };
	const t = yield* workspace({
		now: state.observed,
		source: (op) => {
			if (op.op !== 'call' || !String(op.arguments.stmt).includes('kingdee-simulator-credit'))
				return fixture.request(op);
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
			return Effect.succeed({
				rows: [
					{
						fingerprint: 'A'.repeat(64),
						oversized: false,
						entries: JSON.stringify(state.rows),
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
		creditPolicy: simulatorCreditPolicy
	};
	yield* as.act({
		'sys_integration.update': [{ target: { id: instance }, set: { configuration } }]
	});
	yield* t.pull('parties');
	const read = () => as.query({ credit_snapshots: { where: { source: { eq: instance } } } });
	return { t, as, state, instance, configuration, read };
});

it.live(
	'publishes RMB invoice/payment credit, refreshes unchanged observations, and retains the last good position on failure',
	() =>
		Effect.gen(function* () {
			const s = yield* setup();
			yield* s.t.pull('credit_snapshots');
			let row = firstRow((yield* s.read()).credit_snapshots.rows);
			expect(sameDecimal(row.credit_used, '113')).toBe(true);
			expect(sameDecimal(row.credit_available, '99887')).toBe(true);
			const identity = row.id;
			s.state.rows = [{ ...credit, credit_used: '88.00' }];
			s.state.observed = '2026-11-17T03:01:00.000Z';
			s.t.clock.advance('1min');
			yield* s.t.run_due();
			row = firstRow((yield* s.read()).credit_snapshots.rows);
			expect(row.id).toBe(identity);
			expect(sameDecimal(row.credit_used, '88')).toBe(true);
			expect(sameDecimal(row.credit_available, '99912')).toBe(true);
			s.state.observed = '2026-11-17T03:02:00.000Z';
			yield* s.t.pull('credit_snapshots');
			row = firstRow((yield* s.read()).credit_snapshots.rows);
			expect(row.as_of).toBe(s.state.observed);
			const retained = row;
			for (const broken of [
				[{ ...credit, supported: false }],
				[{ ...credit, credit_used: '1e3' }],
				[{ ...credit, customer_id: '999' }],
				[{ ...credit, credit_hold: null }],
				[credit, credit]
			]) {
				s.state.rows = broken;
				expect(Exit.isFailure(yield* Effect.exit(s.t.pull('credit_snapshots')))).toBe(true);
				expect(firstRow((yield* s.read()).credit_snapshots.rows)).toEqual(retained);
			}
			s.state.rows = [{ ...credit, credit_hold: true }];
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
