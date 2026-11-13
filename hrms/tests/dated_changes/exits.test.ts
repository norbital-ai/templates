// An exit is read from a person's stints: one with a last day and no later stint of theirs under the same law. The
// stint's write raises `exit` when a save makes one, moves its date or cancels it. Synthetic: whatever exit duties the
// fixture's law pack holds and its encashable annual-leave row prove the mechanism, not the seeded law.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { verify } from '../../src/lib/integrity.ts';
import { isExit } from '../../src/lib/person.ts';
import { evaluate } from '../../src/lib/payroll_engine/expressions.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	EMPLOYMENT,
	ENTITY,
	PAY_GROUP,
	lawAt,
	pack,
	storedQuery,
	storedReader,
	syncAll,
	uuid,
	workspace
} from '../kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const STINT = idOf('employment', EMPLOYMENT);
const PROFILE = idOf('employee_profile', uuid(4));
const agreed = {
	rate: { amount: 3000, unit: 'MONTHLY' as const },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	wage_payment_method: 'BANK' as const,
	allowances: {}
};
const terms = { ...agreed, residency_status: 'CITIZEN' };
const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], []);

/** The first stint as stored now: a write's target at its current revision. */
const stint = (t: Kit) =>
	storedQuery(t, { employment: { where: { id: { eq: STINT } }, limit: 1 } }).pipe(
		Effect.map(({ employment }) => {
			const [row] = employment.rows;
			assert.ok(row !== undefined);
			return row;
		})
	);
/** The first stint's last day is `to`, with a reason. */
const ending = (t: Kit, to: string) =>
	stint(t).pipe(
		Effect.map((target) => ({
			target,
			set: { effective_range: { from: '2025-01-01', to }, reason: 'Resignation' }
		}))
	);
/** End the first stint on `to`, with a reason. */
const end = (t: Kit, to: string) =>
	Effect.all([t.as(t.admin), ending(t, to)]).pipe(
		Effect.andThen(([caller, row]) => caller.act({ 'employment.update': [row] }))
	);
/** A new stint of the same person with the same company from `from`: its first terms and parameters on its first day. */
const next = (from: string) => ({
	employee_id: PROFILE,
	entity_id: ENTITY,
	employee_number: 'W1',
	effective_range: { from, to: null },
	reason: 'Rehired',
	terms: [
		{
			effective_from: from,
			engagement: 'EMPLOYEE' as const,
			pay_group_id: idOf('pay_group', PAY_GROUP),
			...agreed
		}
	],
	parameters: [
		{ effective_from: from, residency_status: 'CITIZEN', marital_status: 'SINGLE' as const }
	]
});
/** The tasks the first stint's exit raised (`…:<stint>:exit:<last day>`), and any cash-out entry keyed for it. */
const held = (t: Kit) =>
	Effect.gen(function* () {
		const { obligation } = yield* storedQuery(t, { obligation: { limit: 200 } });
		const { leave_catalog_entry } = yield* storedQuery(t, {
			leave_catalog_entry: { where: { encashment: { eq: true } }, limit: 10 }
		});
		return {
			duties: obligation.rows.filter((row) => row.occurrence_key.includes(`:${STINT}:exit:`)),
			encashments: leave_catalog_entry.rows.length
		};
	});

describe('an exit', () => {
	it('is the last stint under its law, whatever the company', () => {
		const one = (
			id: string,
			from: string,
			to: string | null,
			entity: string,
			employee_id = 'p'
		) => ({
			id,
			employee_id,
			effective_range: { from, to },
			entity_id: entity
		});
		const lineage = new Map([
			['a-1', 'A'],
			['a-2', 'A'],
			['b-1', 'B']
		]);
		const ended = one('a', '2025-01-01', '2026-10-31', 'a-1');
		assert.equal(isExit(ended, [ended], lineage), true);
		assert.equal(isExit(ended, [ended, one('b', '2026-11-01', null, 'a-2')], lineage), false);
		assert.equal(isExit(ended, [ended, one('b', '2026-11-01', null, 'b-1')], lineage), true);
		// another person's stint continues nothing
		assert.equal(isExit(ended, [ended, one('b', '2026-11-01', null, 'a-2', 'q')], lineage), true);
		assert.equal(isExit(one('a', '2025-01-01', null, 'a-1'), [], lineage), false);
	});

	it.live(
		'raises once: duties appear once, no cash-out is keyed, and saving again adds nothing',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				yield* end(t, '2026-10-31');
				yield* t.run_due();
				const first = yield* held(t);
				const keys = first.duties.map((row) => row.occurrence_key);
				assert.ok(keys.length > 0);
				assert.equal(new Set(keys).size, keys.length);
				for (const key of keys) assert.ok(key.endsWith(`:${STINT}:exit:2026-10-31`), key);
				// the last payslip settles the leave itself
				assert.equal(first.encashments, 0);
				yield* end(t, '2026-10-31');
				yield* (yield* t.as(t.admin)).act({
					'employment.update': [
						{ target: yield* stint(t), set: { reason: 'Resignation confirmed' } }
					]
				});
				yield* t.run_due();
				const second = yield* held(t);
				assert.deepEqual(second.duties.map((row) => row.occurrence_key).sort(), keys.toSorted());
				assert.equal(second.encashments, 0);
				assert.deepEqual((yield* t.run_due()).failed, []);
				assert.deepEqual(
					(yield* verify(storedReader(t), NOW.slice(0, 10)))
						.filter((finding) => finding.invariant !== 'W1')
						.map((finding) => `${finding.invariant} ${finding.message}`),
					[]
				);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('is not raised when the save that ends a stint starts the next one the day after', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* (yield* t.as(t.admin)).act({
				'employment.update': [yield* ending(t, '2026-11-01')],
				'employment.create': [next('2026-11-02')]
			});
			yield* t.run_due();
			const { duties, encashments } = yield* held(t);
			assert.deepEqual(duties, []);
			assert.equal(encashments, 0);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'moved, its duties follow the new date; cancelled by a later stint, its open duties close',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* end(t, '2026-10-31');
				yield* t.run_due();
				const first = (yield* held(t)).duties;
				assert.ok(first.length > 0);
				yield* end(t, '2026-09-30');
				yield* t.run_due();
				const moved = (yield* held(t)).duties;
				const open = moved.filter((row) => row.state === 'OPEN');
				assert.deepEqual(
					open.map((row) => row.occurrence_key).sort(),
					first.map((row) => row.occurrence_key.replace('2026-10-31', '2026-09-30')).sort()
				);
				// a duty counted from the last day is due on a new day
				const due = (rows: typeof first) => rows.map((row) => String(row.due_on)).sort();
				assert.notDeepEqual(due(open), due(first));
				assert.deepEqual(
					moved
						.filter((row) => row.state === 'WAIVED')
						.map((row) => row.id)
						.sort(),
					first.map((row) => row.id).sort()
				);
				yield* (yield* t.as(t.admin)).act({ 'employment.create': [next('2026-10-01')] });
				yield* t.run_due();
				const cancelled = (yield* held(t)).duties;
				assert.equal(cancelled.length, 2 * first.length);
				assert.deepEqual(
					cancelled.filter((row) => row.state === 'OPEN'),
					[]
				);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

// A law's exit duties read what the law was told of the person on the last day: a statutory parameter in force then.
// Here, a fact the fixture's law declares and the one exit duty whose condition reads it.
const ANSWER = { pregnant_or_pregnancy_illness: true };
const DUTY = 'MATERNITY_PROTECTION_REVIEW';
/** The exit duties whose condition reads the answer. */
const reports = (t: Kit) =>
	storedQuery(t, { obligation: { limit: 100 } }).pipe(
		Effect.map(({ obligation }) =>
			obligation.rows.filter((row) => String(row.occurrence_key).startsWith(`MY:${DUTY}:`))
		)
	);
const answering = () => workspace({ seed, now: '2026-07-01T02:00:00.000Z' });

describe('what an exit duty reads of the person', () => {
	it.live('a parameter in force on the last day: the exit duty that reads it follows', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* (yield* t.as(t.admin)).act({
				'statutory_parameters.create': [
					{ employment_id: STINT, effective_from: '2026-06-01', parameters: ANSWER }
				]
			});
			// two saves, each with its own effects: both raise the hire duties, so they run one after the other
			yield* t.run_due();
			yield* end(t, '2026-06-30');
			yield* t.run_due();
			assert.equal((yield* reports(t)).length, 1);
		}).pipe(Effect.provide(answering()))
	);

	it.live('without it the duty is not raised', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* end(t, '2026-06-30');
			yield* t.run_due();
			assert.deepEqual(yield* reports(t), []);
		}).pipe(Effect.provide(answering()))
	);

	// someone engaged as a payee leaves the same way: the duty names the employment and the last day
	it('an exit duty is keyed by its employment and last day, whatever the engagement', () => {
		const row = lawAt('MY', NOW.slice(0, 10)).rows.registered_effect.find(
			(effect) => effect.code === 'PERSONAL_DATA_DISPOSAL'
		);
		const payee = {
			id: 'stint-1',
			entity_id: 'entity-1',
			employee_id: 'employee-1',
			engagement: 'PAYEE',
			effective_range: { from: '2026-01-01', to: '2026-06-30' },
			terms,
			employee_extension_data: {}
		};
		const raised = Schema.decodeUnknownSync(
			Schema.Array(Schema.Struct({ occurrence_key: Schema.String }))
		)(
			evaluate(
				String(row?.effects),
				'CALCULATION',
				{ lookup: row?.lookup ?? {}, entry: payee, after: payee, reads: { obligation: [] } },
				'PERSONAL_DATA_DISPOSAL'
			)
		);
		assert.deepEqual(
			raised.map((task) => task.occurrence_key),
			['MY:PERSONAL_DATA_DISPOSAL:stint-1:exit:2026-06-30']
		);
	});
});
