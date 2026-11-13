// An exit is read from the contract chain: a sealed version that ends with no same-jurisdiction successor. The contract's
// write raises `exit` when a save makes one, moves its date or cancels it. Synthetic: whatever exit duties the fixture's
// law pack holds and its encashable annual-leave row prove the mechanism, not the seeded law.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { plain_date } from '../../src/lib/date.ts';
import { Effect, Schema } from 'effect';
import { verify } from '../../src/lib/integrity.ts';
import { isExit } from '../../src/lib/payroll_engine/contract_change.ts';
import { evaluate } from '../../src/lib/payroll_engine/expressions.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	catalogRow,
	pack,
	sealEvents,
	storedQuery,
	storedReader,
	syncAll,
	uuid,
	workspace,
	refusal
} from '../kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const terms = {
	rate: { amount: 3000, unit: 'MONTHLY' },
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], [], '2026-11-15');

/** The first contract as stored now: a write's target at its current revision. */
const contract = (t: Kit) =>
	storedQuery(t, { employee_contract: { where: { id: { eq: CONTRACT } }, limit: 1 } }).pipe(
		Effect.map(({ employee_contract }) => {
			const [row] = employee_contract.rows;
			assert.ok(row !== undefined);
			return row;
		})
	);
/** End the first contract on `to`, with a reason. */
const end = (t: Kit, to: string) =>
	Effect.all([t.as(t.admin), contract(t)]).pipe(
		Effect.andThen(([caller, target]) =>
			caller.act({
				'employee_contract.update': [
					{
						target,
						set: {
							effective_range: { from: '2025-01-01', to: plain_date(to) },
							reason: 'Resignation'
						}
					}
				]
			})
		)
	);
/** The tasks the first contract's exit raised (`…:<contract>:exit:<last day>`), and any cash-out entry keyed for it. */
const held = (t: Kit) =>
	Effect.gen(function* () {
		const { obligation } = yield* storedQuery(t, { obligation: { limit: 200 } });
		const { leave_catalog_entry } = yield* storedQuery(t, {
			leave_catalog_entry: { where: { encashment: { eq: true } }, limit: 10 }
		});
		return {
			duties: obligation.rows.filter((row) => row.occurrence_key.includes(`:${CONTRACT}:exit:`)),
			encashments: leave_catalog_entry.rows.length
		};
	});

describe('an exit', () => {
	it('is the last version of its jurisdiction lineage, whatever the entity in it', () => {
		const version = (
			id: string,
			from: string,
			to: string | null,
			entity: string,
			status = 'SEALED'
		) => ({
			id,
			employee_id: 'p',
			status,
			effective_range: { from, to },
			entity_id: entity
		});
		const lineage = new Map([
			['a-1', 'A'],
			['a-2', 'A'],
			['b-1', 'B']
		]);
		const ended = version('a', '2025-01-01', '2026-10-31', 'a-1');
		assert.equal(isExit(ended, [ended], lineage), true);
		assert.equal(isExit(ended, [ended, version('b', '2026-11-01', null, 'a-2')], lineage), false);
		assert.equal(
			isExit(ended, [ended, version('b', '2026-11-01', null, 'a-2', 'DRAFT')], lineage),
			false
		);
		assert.equal(
			isExit(ended, [ended, version('b', '2026-11-01', null, 'a-2', 'VOID')], lineage),
			true
		);
		assert.equal(isExit(ended, [ended, version('b', '2026-11-01', null, 'b-1')], lineage), true);
		assert.equal(isExit(version('a', '2025-01-01', null, 'a-1'), [], lineage), false);
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
				for (const key of keys) assert.ok(key.endsWith(`:${CONTRACT}:exit:2026-10-31`), key);
				// the last payslip settles the leave itself
				assert.equal(first.encashments, 0);
				yield* end(t, '2026-10-31');
				yield* (yield* t.as(t.admin)).act({
					'employee_contract.update': [
						{ target: yield* contract(t), set: { reason: 'Resignation confirmed' } }
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

	it.live('is not raised when a successor is sealed for the next day', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* sealEvents(t, '2026-11-02', []);
			yield* t.run_due();
			const { duties, encashments } = yield* held(t);
			assert.deepEqual(duties, []);
			assert.equal(encashments, 0);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live(
		'moved, its duties follow the new date; cancelled by a successor, its open duties close',
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
				const [ended] = (yield* storedQuery(t, { employee_contract: { limit: 1 } }))
					.employee_contract.rows;
				assert.ok(ended !== undefined);
				yield* (yield* t.as(t.admin)).act({
					'employee_contract.create': [
						{
							employee_id: ended.employee_id,
							entity_id: ended.entity_id,
							engagement: ended.engagement,
							employee_number: ended.employee_number,
							terms: ended.terms,
							payroll: ended.payroll,
							bank: ended.bank,
							employee_extension_data: ended.employee_extension_data,
							service_started_on: ended.service_started_on,
							effective_range: { from: '2026-10-01', to: null },
							status: 'DRAFT',
							reason: 'Rehired'
						}
					]
				});
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

// A sealed contract adds its exit answers in the save that ends it, as the native exit ground already does: a law's exit
// duties read them from the jurisdiction facts. Facts it already holds stand.
const save = (
	t: Kit,
	answers: Readonly<Record<string, string | boolean>>,
	to: string | null = '2026-06-30'
) =>
	contract(t).pipe(
		Effect.andThen((stored) =>
			t.as(t.admin).pipe(
				Effect.andThen((caller) =>
					caller.act({
						'employee_contract.update': [
							{
								target: stored,
								set: {
									employee_extension_data: { ...stored.employee_extension_data, ...answers },
									...(to === null
										? {}
										: { effective_range: { from: '2025-01-01', to: plain_date(to) } })
								}
							}
						]
					})
				)
			)
		)
	);
// a fact the fixture's law declares, and the one exit duty whose condition reads it
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

describe('exit answers on a sealed contract', () => {
	it.live(
		'the save that ends it states an exit fact, and the exit duty that reads it follows',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* save(t, ANSWER);
				yield* t.run_due();
				assert.equal((yield* reports(t)).length, 1);
			}).pipe(Effect.provide(answering()))
	);

	it.live('a save that does not end it cannot add one', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* refusal(save(t, ANSWER, null));
			assert.equal(refused.key, 'errors.employee_contract_exit_answers');
		}).pipe(Effect.provide(answering()))
	);

	it.live('the ending save cannot rewrite a fact the version holds', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* save(t, ANSWER);
			const refused = yield* refusal(
				save(t, { pregnant_or_pregnancy_illness: false }, '2026-07-31')
			);
			assert.equal(refused.key, 'errors.employee_contract_exit_answers');
		}).pipe(Effect.provide(answering()))
	);

	// someone engaged as a payee leaves the same way: the duty names the employment and the last day
	it('an exit duty is keyed by its employment and last day, whatever the engagement', () => {
		const id = catalogRow(seed, 'registered_effect', 'PERSONAL_DATA_DISPOSAL');
		const row = (seed.registered_effect ?? []).find((effect) => effect.id === id);
		const payee = {
			id: 'contract-1',
			entity_id: 'entity-1',
			employee_id: 'employee-1',
			engagement: 'PAYEE',
			status: 'SEALED',
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
			['MY:PERSONAL_DATA_DISPOSAL:contract-1:exit:2026-06-30']
		);
	});
});
