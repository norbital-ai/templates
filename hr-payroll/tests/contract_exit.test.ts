// An exit is read from the contract chain: a sealed version that ends with no same-jurisdiction successor. The contract's
// write raises `exit` when a save makes one, moves its date or cancels it. Synthetic: the Philippine exit duties and an
// annual-leave row made encashable prove the mechanism, not the seeded law.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { isExit } from '../src/lib/payroll_engine/contract_change.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { pack, sealEvents, syncAll, uuid, workspace } from './kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const DUTIES = [
	'encash-leave-on-exit',
	'raise-exit-pay',
	'FINAL_PAY_RELEASE',
	'HDMF_SEPARATION_REPORT',
	'PHILHEALTH_SEPARATION_REPORT',
	'PERSONAL_DATA_DISPOSAL'
];
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
/** The exit duties of the first contract, and its encashment requests. */
const held = (t: Kit) =>
	Effect.gen(function* () {
		const { obligation } = yield* t.storedQuery({ obligation: { limit: 200 } });
		const { leave_catalog_entry } = yield* t.storedQuery({
			leave_catalog_entry: { where: { encashment: { eq: true } }, limit: 10 }
		});
		return {
			duties: obligation.rows.filter((row) =>
				DUTIES.some((code) => row.occurrence_key.startsWith(`${code}:`))
			),
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
			assert.deepEqual(
				first.duties.map((row) => row.occurrence_key).sort(),
				DUTIES.map((code) => `${code}:${CONTRACT}:exit:2026-10-31`).sort()
			);
			assert.equal(first.encashments, 1);
			yield* end(t, '2026-10-31');
			yield* t
				.as(t.admin)
				.act('employee_contract.update', [
					{ target: CONTRACT, set: { reason: 'Resignation confirmed' } }
				]);
			yield* t.runDue();
			const second = yield* held(t);
			assert.equal(second.duties.length, DUTIES.length);
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
				yield* end(t, '2026-09-30');
				yield* t.runDue();
				const moved = (yield* held(t)).duties;
				const open = moved.filter((row) => row.state === 'OPEN');
				assert.deepEqual(
					open.map((row) => row.occurrence_key).sort(),
					DUTIES.map((code) => `${code}:${CONTRACT}:exit:2026-09-30`).sort()
				);
				assert.equal(
					String(
						open.find((row) => row.occurrence_key.startsWith('HDMF_SEPARATION_REPORT:'))?.due_on
					),
					'2026-10-30'
				);
				assert.equal(moved.filter((row) => row.state === 'WAIVED').length, DUTIES.length);
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
				assert.equal(cancelled.length, 2 * DUTIES.length);
				assert.deepEqual(
					cancelled.filter((row) => row.state === 'OPEN'),
					[]
				);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

// Vietnam's exit duties listen to the same event, with no final pay date recorded.
const VN_NOW = '2026-11-20T02:00:00.000Z';
const VN_DUTIES = [
	'encash-leave-on-exit',
	'TERMINATION_NOTICE',
	'RESTRUCTURING_LABOUR_PLAN',
	'FINAL_SETTLEMENT',
	'SI_CONFIRMATION_ON_TERMINATION',
	'PIT_WITHHOLDING_CERTIFICATE',
	'PDPL_RECRUITMENT_AND_EMPLOYMENT',
	'PERSONAL_DATA_DISPOSAL'
];
const vnBase = pack(
	'VN',
	'Asia/Ho_Chi_Minh',
	{
		rate: { amount: 30_000_000, unit: 'MONTHLY' },
		statutory_work_category: 'ORDINARY',
		work_classification: 'ORDINARY',
		residency_status: 'RESIDENT',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{},
	[],
	[],
	'2026-11-15'
);
const vnSeed = {
	...vnBase,
	entity_profile_version: (vnBase.entity_profile_version ?? []).map((row) => ({
		...row,
		entity_extension_data: { region: 'I' }
	})),
	employee_contract: (vnBase.employee_contract ?? []).map((row) => ({
		...row,
		signed_contract_period: { from: '2025-01-01', to: null }
	}))
};
const vnDuties = (t: Kit) =>
	t
		.storedQuery({ obligation: { limit: 200 } })
		.pipe(
			Effect.map(({ obligation }) =>
				obligation.rows.filter((row) =>
					VN_DUTIES.some((code) => row.occurrence_key.startsWith(`${code}:`))
				)
			)
		);

describe('a VN exit', () => {
	it.live('an amendment that a successor follows raises no exit duty, final pay date or not', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* sealEvents(t, '2026-11-02', []);
			yield* t.runDue();
			assert.deepEqual(yield* vnDuties(t), []);
		}).pipe(
			Effect.provide(
				workspace({
					seed: {
						...vnSeed,
						employee_contract: (vnSeed.employee_contract ?? []).map((row) => ({
							...row,
							final_pay_due_on: '2026-11-15',
							employee_extension_data: {
								annual_leave_service_review: { year: '2026', as_of: '2026-10-31' }
							}
						}))
					},
					now: VN_NOW
				})
			)
		)
	);

	it.live('raises once, follows a moved date and closes when cancelled', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* end(t, '2026-10-31');
			yield* t.runDue();
			assert.deepEqual(
				(yield* vnDuties(t)).map((row) => row.occurrence_key).sort(),
				VN_DUTIES.map((code) => `${code}:${CONTRACT}:exit:2026-10-31`).sort()
			);
			yield* end(t, '2026-10-31');
			yield* t.runDue();
			assert.equal((yield* vnDuties(t)).length, VN_DUTIES.length);

			yield* end(t, '2026-09-30');
			yield* t.runDue();
			const moved = yield* vnDuties(t);
			const open = moved.filter((row) => row.state === 'OPEN');
			assert.deepEqual(
				open.map((row) => row.occurrence_key).sort(),
				VN_DUTIES.map((code) => `${code}:${CONTRACT}:exit:2026-09-30`).sort()
			);
			assert.equal(
				String(
					open.find((row) => row.occurrence_key.startsWith('PIT_WITHHOLDING_CERTIFICATE:'))?.due_on
				),
				'2026-09-30'
			);
			assert.equal(moved.filter((row) => row.state === 'WAIVED').length, VN_DUTIES.length);

			const [ended] = (yield* t.storedQuery({ employee_contract: { limit: 1 } })).employee_contract
				.rows;
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
					signed_contract_period: ended.signed_contract_period,
					effective_range: { from: PlainDate('2026-10-01'), to: null },
					status: 'DRAFT',
					reason: 'Rehired'
				}
			]);
			yield* t.runDue();
			const cancelled = yield* vnDuties(t);
			assert.equal(cancelled.length, 2 * VN_DUTIES.length);
			assert.deepEqual(
				cancelled.filter((row) => row.state === 'OPEN'),
				[]
			);
		}).pipe(Effect.provide(workspace({ seed: vnSeed, now: VN_NOW })))
	);
});

// Malaysia's exit duties: a moved exit date moves them and a cancelled exit closes them (probe [amount], EMP-REDACTED).
const MY_DUTIES = [
	'encash-leave-on-exit',
	'CP22A_CESSATION_AND_WITHHOLDING',
	'TERMINATION_BENEFITS_FINAL_WAGES',
	'TERMINATION_BENEFIT_PAYMENT',
	'PERSONAL_DATA_DISPOSAL'
];
const mySeed = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	{
		rate: { amount: 3000, unit: 'MONTHLY' },
		statutory_work_category: 'NON_MANUAL',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{},
	[],
	[],
	'2026-11-15'
);
const myDuties = (t: Kit) =>
	t
		.storedQuery({ obligation: { limit: 200 } })
		.pipe(
			Effect.map(({ obligation }) =>
				obligation.rows.filter((row) =>
					MY_DUTIES.some((code) => row.occurrence_key.startsWith(`MY:${code}:`))
				)
			)
		);

describe('a MY exit', () => {
	it.live('raises once, follows a moved date and closes when cancelled', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* end(t, '2026-10-31');
			yield* t.runDue();
			assert.deepEqual(
				(yield* myDuties(t)).map((row) => row.occurrence_key).sort(),
				MY_DUTIES.map((code) => `MY:${code}:${CONTRACT}:exit:2026-10-31`).sort()
			);
			yield* end(t, '2026-10-31');
			yield* t.runDue();
			assert.equal((yield* myDuties(t)).length, MY_DUTIES.length);

			yield* end(t, '2026-09-30');
			yield* t.runDue();
			const moved = yield* myDuties(t);
			const open = moved.filter((row) => row.state === 'OPEN');
			assert.deepEqual(
				open.map((row) => row.occurrence_key).sort(),
				MY_DUTIES.map((code) => `MY:${code}:${CONTRACT}:exit:2026-09-30`).sort()
			);
			assert.equal(
				String(
					open.find((row) => row.occurrence_key.startsWith('MY:TERMINATION_BENEFITS_FINAL_WAGES:'))
						?.due_on
				),
				'2026-10-03'
			);
			assert.equal(moved.filter((row) => row.state === 'WAIVED').length, MY_DUTIES.length);

			const [ended] = (yield* t.storedQuery({ employee_contract: { limit: 1 } })).employee_contract
				.rows;
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
			const cancelled = yield* myDuties(t);
			assert.equal(cancelled.length, 2 * MY_DUTIES.length);
			assert.deepEqual(
				cancelled.filter((row) => row.state === 'OPEN'),
				[]
			);
		}).pipe(Effect.provide(workspace({ seed: mySeed, now: NOW })))
	);
});
