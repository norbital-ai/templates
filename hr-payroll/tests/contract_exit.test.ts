// An exit is read from the contract chain: a sealed version that ends with no same-jurisdiction successor. The contract's
// write raises `exit` when a save makes one, moves its date or cancels it. Synthetic: whatever exit duties the fixture's
// law pack holds and an annual-leave row made encashable prove the mechanism, not the seeded law.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { isExit } from '../src/lib/payroll_engine/contract_change.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { catalogRow, pack, sealEvents, syncAll, uuid, workspace } from './kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const terms = {
	rate: { amount: 60_000, unit: 'MONTHLY' },
	statutory_work_category: 'NON_FIELD',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const base = pack('PH', 'Asia/Manila', terms, {}, [], [], '2026-11-15');
const seed = {
	...base,
	leave_catalog: (base.leave_catalog ?? []).map((row) =>
		row.code === 'ANNUAL_LEAVE'
			? { ...row, payout: 'return ctx.day_rate * ctx.entry.quantity;' }
			: row
	)
};

/** End the first contract on `to`, with a reason. */
const end = (t: Kit, to: string) =>
	t.as(t.admin).act('employee_contract.update', [
		{
			target: CONTRACT,
			set: {
				effective_range: { from: PlainDate('2025-01-01'), to: PlainDate(to) },
				reason: 'Resignation'
			}
		}
	]);
/** The tasks the first contract's exit raised (`…:<contract>:exit:<last day>`), and its encashment requests. */
const held = (t: Kit) =>
	Effect.gen(function* () {
		const { obligation } = yield* t.storedQuery({ obligation: { limit: 200 } });
		const { leave_catalog_entry } = yield* t.storedQuery({
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
			['ph-1', 'PH'],
			['ph-2', 'PH'],
			['sg-1', 'SG']
		]);
		const ended = version('a', '2025-01-01', '2026-10-31', 'ph-1');
		assert.equal(isExit(ended, [ended], lineage), true);
		assert.equal(isExit(ended, [ended, version('b', '2026-11-01', null, 'ph-2')], lineage), false);
		assert.equal(
			isExit(ended, [ended, version('b', '2026-11-01', null, 'ph-2', 'DRAFT')], lineage),
			false
		);
		assert.equal(
			isExit(ended, [ended, version('b', '2026-11-01', null, 'ph-2', 'VOID')], lineage),
			true
		);
		assert.equal(isExit(ended, [ended, version('b', '2026-11-01', null, 'sg-1')], lineage), true);
		assert.equal(isExit(version('a', '2025-01-01', null, 'ph-1'), [], lineage), false);
	});

	it.live('raises once: duties and encashment appear once, and saving again adds nothing', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* end(t, '2026-10-31');
			yield* t.runDue();
			const first = yield* held(t);
			const keys = first.duties.map((row) => row.occurrence_key);
			assert.ok(keys.length > 0);
			assert.equal(new Set(keys).size, keys.length);
			for (const key of keys) assert.ok(key.endsWith(`:${CONTRACT}:exit:2026-10-31`), key);
			assert.equal(first.encashments, 1);
			yield* end(t, '2026-10-31');
			yield* t
				.as(t.admin)
				.act('employee_contract.update', [
					{ target: CONTRACT, set: { reason: 'Resignation confirmed' } }
				]);
			yield* t.runDue();
			const second = yield* held(t);
			assert.deepEqual(second.duties.map((row) => row.occurrence_key).sort(), keys.toSorted());
			assert.equal(second.encashments, 1);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	it.live('is not raised when a successor is sealed for the next day', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* sealEvents(t, '2026-11-02', []);
			yield* t.runDue();
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
				yield* t.runDue();
				const first = (yield* held(t)).duties;
				assert.ok(first.length > 0);
				yield* end(t, '2026-09-30');
				yield* t.runDue();
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
				const [ended] = (yield* t.storedQuery({ employee_contract: { limit: 1 } }))
					.employee_contract.rows;
				assert.ok(ended !== undefined);
				yield* t.as(t.admin).act('employee_contract.create', [
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
						effective_range: { from: PlainDate('2026-10-01'), to: null },
						status: 'DRAFT',
						reason: 'Rehired'
					}
				]);
				yield* t.runDue();
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
const answersBase = pack(
	'ID',
	'Asia/Jakarta',
	{
		rate: { amount: 11_000_000, unit: 'MONTHLY' },
		statutory_work_category: 'NON_MANUAL',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{ work_region: 'Provinsi Aceh/Kabupaten Aceh Barat' },
	[],
	[],
	'2026-06-15'
);
const answersSeed = {
	...answersBase,
	entity_profile_version: (answersBase.entity_profile_version ?? []).map((row) => ({
		...row,
		entity_extension_data: { risk_class: 'I' }
	})),
	employee_contract: (answersBase.employee_contract ?? []).map((row) => ({
		...row,
		effective_range: { from: '2026-01-01', to: null },
		payroll: { date_of_birth: '1990-01-01', gender: 'FEMALE', marital_status: 'MARRIED' }
	}))
};
const extension = (t: Kit) =>
	t
		.storedQuery({ employee_contract: { where: { id: { eq: CONTRACT } }, limit: 1 } })
		.pipe(
			Effect.map(
				({ employee_contract }) => employee_contract.rows[0]?.employee_extension_data ?? {}
			)
		);
const save = (
	t: Kit,
	answers: Readonly<Record<string, string>>,
	to: string | null = '2026-06-30'
) =>
	extension(t).pipe(
		Effect.andThen((stored) =>
			t.as(t.admin).act('employee_contract.update', [
				{
					target: CONTRACT,
					set: {
						employee_extension_data: { ...stored, ...answers },
						...(to === null
							? {}
							: { effective_range: { from: PlainDate('2026-01-01'), to: PlainDate(to) } })
					}
				}
			])
		)
	);
/** The exit duties whose condition reads the answer. */
const reports = (t: Kit) =>
	t
		.storedQuery({ obligation: { limit: 100 } })
		.pipe(
			Effect.map(({ obligation }) =>
				obligation.rows.filter((row) =>
					String(row.occurrence_key).startsWith('TERMINATION_REPORT:')
				)
			)
		);
const answering = () => workspace({ seed: answersSeed, now: '2026-07-01T02:00:00.000Z' });

describe('exit answers on a sealed contract', () => {
	it.live('the save that ends it states the termination cause, and the exit duty follows', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* save(t, { termination_cause: 'EFFICIENCY_ACTUAL_LOSS' });
			yield* t.runDue();
			assert.equal((yield* reports(t)).length, 1);
		}).pipe(Effect.provide(answering()))
	);

	it.live('a save that does not end it cannot add one', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(
				save(t, { termination_cause: 'EFFICIENCY_ACTUAL_LOSS' }, null)
			);
			assert.match(String(refused), /adds its exit answers in the save that ends it/);
		}).pipe(Effect.provide(answering()))
	);

	it.live('the ending save cannot rewrite a fact the version holds', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* save(t, { termination_cause: 'EFFICIENCY_ACTUAL_LOSS' });
			const refused = yield* Effect.flip(
				save(t, { termination_cause: 'VOLUNTARY_RESIGNATION' }, '2026-07-31')
			);
			assert.match(String(refused), /the facts it holds change only by a new version/);
		}).pipe(Effect.provide(answering()))
	);

	// someone engaged as a payee leaves the same way: the duty names the employment and the last day
	it('an exit duty is keyed by its employment and last day, whatever the engagement', () => {
		const id = catalogRow(answersBase, 'registered_effect', 'PERSONAL_DATA_DISPOSAL');
		const row = (answersBase.registered_effect ?? []).find((effect) => effect.id === id);
		const payee = {
			id: 'contract-1',
			entity_id: 'entity-1',
			employee_id: 'employee-1',
			engagement: 'PAYEE',
			status: 'SEALED',
			effective_range: { from: '2026-01-01', to: '2026-06-30' },
			terms: { residency_status: 'CITIZEN', statutory_work_category: 'NON_MANUAL' },
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
			['PERSONAL_DATA_DISPOSAL:contract-1:exit:2026-06-30']
		);
	});
});
