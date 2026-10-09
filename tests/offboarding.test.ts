/** L-TPL-hr-payroll-034 last-day close with a listed exit ground; L-TPL-hr-payroll-076 the exit facts written. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	closeContractWrites,
	exitGroundRefusal,
	lastDayRefusal,
	refuseClosedUpdate,
	undoExitWrites
} from '../src/lib/payroll_engine/offboarding.ts';
import { kindsOf, refuseUnlistedKind } from '../src/lib/payroll_engine/listed_kinds.ts';
import type { HostRead } from '../src/lib/payroll_engine/foundation.ts';

describe('offboarding', () => {
	it('reads the kinds of an exit_grounds row and refuses a ground the governing version does not list', async () => {
		assert.deepEqual(
			kindsOf({ kinds: [{ code: 'RESIGNATION', name: 'Resignation' }, { name: 'x' }] }),
			[{ code: 'RESIGNATION', name: 'Resignation' }]
		);
		const tables: Record<string, readonly object[]> = {
			entity: [{ id: 'c1', settings_code: 'SG' }],
			jurisdiction_settings: [
				{ id: 'v1', effective_range: { from: '2025-01-01', to: '2025-12-31' } },
				{ id: 'v2', effective_range: { from: '2026-01-01', to: null } }
			],
			rule_set: [
				{ settings_id: 'v2', rules: { kinds: [{ code: 'REDUNDANCY', name: 'Redundancy' }] } }
			]
		};
		// a settings_id filter by `eq` or `in` (the keyed read names the versions it found)
		const read = (async (
			collection: string,
			query: { where?: { settings_id?: { eq?: string; in?: readonly string[] } } }
		) => ({
			rows: (tables[collection] ?? []).filter((row) => {
				const wanted = query.where?.settings_id;
				const held = (row as { settings_id?: string }).settings_id;
				return wanted == null || (wanted.in ?? [wanted.eq]).includes(held);
			})
		})) as unknown as HostRead;
		const refuse = (ground: string, last_day: string) =>
			refuseUnlistedKind(
				{
					rule: 'exit_grounds',
					noun: 'exit ground',
					company_id: 'c1',
					code: ground,
					day: last_day
				},
				read
			);
		assert.equal(await refuse('REDUNDANCY', '2026-03-31'), null);
		assert.equal(
			await refuse('RESIGNATION', '2026-03-31'),
			'SG lists no exit ground RESIGNATION on 2026-03-31.'
		);
		assert.equal(
			await refuse('REDUNDANCY', '2025-06-30'),
			'SG lists no exit ground REDUNDANCY on 2025-06-30.'
		);
	});

	it('L-TPL-hr-payroll-034 refuses a last day before hire and admits the hire day', () => {
		assert.notEqual(lastDayRefusal('2020-01-15', '2020-01-14'), null);
		assert.equal(lastDayRefusal('2020-01-15', '2020-01-15'), null);
		assert.equal(
			lastDayRefusal('2020-01-15', null),
			'Choose a last day of work on or after the hire date (2020-01-15).'
		);
	});

	it('L-TPL-hr-payroll-034 closes the range once with the chosen ground and the schema facts', () => {
		// No ground is defaulted: the version's exit_grounds list is chosen from.
		assert.equal(
			closeContractWrites({ from: '2019-01-01', lastDay: '2026-03-31', ground: null, facts: {} }),
			'Choose the exit ground.'
		);
		const set = closeContractWrites({
			from: '2019-01-01',
			lastDay: '2026-03-31',
			ground: 'REDUNDANCY',
			facts: { notice_served: true }
		});
		assert.ok(typeof set !== 'string');
		assert.deepEqual(set.effective_range, { from: '2019-01-01', to: '2026-03-31' });
		assert.equal(set.exit_ground, 'REDUNDANCY');
		assert.deepEqual(set.exit_facts, { notice_served: true });
		assert.equal(
			refuseClosedUpdate(
				{ effective_range: { from: '2019-01-01', to: null } },
				{ effective_range: { from: '2019-01-01', to: '2026-03-31' } }
			),
			null
		);
	});

	it('a planned end is no departure: a fixed-term contract exits early, and an exit is moved or undone', () => {
		const fixedTerm = { effective_range: { from: '2026-01-01', to: '2026-12-31' } };
		// early exit of a fixed-term contract, and the planned end kept to reopen to
		assert.equal(
			refuseClosedUpdate(fixedTerm, { effective_range: { from: '2026-01-01', to: '2026-06-30' } }),
			null
		);
		const early = closeContractWrites({
			from: '2026-01-01',
			lastDay: '2026-06-30',
			ground: 'RESIGNATION',
			facts: {},
			plannedEnd: '2026-12-31'
		});
		assert.ok(typeof early !== 'string');
		assert.equal(early.signed_contract_end, '2026-12-31');
		// an exit moved later, or retracted to reopen the contract
		const exited = { effective_range: { from: '2019-01-01', to: '2026-03-31' }, exit_ground: 'X' };
		assert.equal(
			refuseClosedUpdate(exited, { effective_range: { from: '2019-01-01', to: '2026-04-30' } }),
			null
		);
		assert.equal(
			refuseClosedUpdate(exited, { effective_range: { from: '2019-01-01', to: null } }),
			null
		);
		assert.deepEqual(undoExitWrites({ from: '2026-01-01', plannedEnd: '2026-12-31' }), {
			effective_range: { from: '2026-01-01', to: '2026-12-31' },
			exit_ground: null,
			exit_facts: null
		});
		// a start never moves once the range has closed; a last day before the start refuses
		assert.equal(
			refuseClosedUpdate(exited, { effective_range: { from: '2019-02-01', to: '2026-03-31' } }),
			'A closed contract keeps its start; rehire on a new contract.'
		);
		assert.notEqual(
			refuseClosedUpdate(exited, { effective_range: { from: '2019-01-01', to: '2018-12-31' } }),
			null
		);
		// a ground stays with a last day
		assert.equal(
			exitGroundRefusal({ ground: 'X', to: null }),
			'An exit ground is written with the last day of work.'
		);
		assert.equal(exitGroundRefusal({ ground: null, to: null }), null);
	});
});
