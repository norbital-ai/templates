// The owner's budget (docs 0001, "Simplicity"): about 80 people stay under 2 s of guest CPU, on the fewest round trips.
// Eighty people on the Malaysian law, rostered for two months, February paid; each everyday operation is measured by
// the round trips each of its invocations makes to the host and the guest CPU all of them use.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { DateTime, Effect } from 'effect';
import {
	ENTITY,
	WORK,
	leaveCreate,
	pack,
	packTerms,
	storedQuery,
	uuid,
	wholeDays,
	workspace
} from '../kit.ts';
import { pay, run } from '../amendment_kit.ts';
import { idOf } from '../../src/lib/reads.ts';

const PEOPLE = 80;
const working = (month: string) =>
	Array.from({ length: 31 }, (_, at) => `${month}-${String(at + 1).padStart(2, '0')}`).filter(
		(date) =>
			new Date(`${date}T00:00:00.000Z`).toISOString().startsWith(date) &&
			![0, 6].includes(new Date(`${date}T00:00:00.000Z`).getUTCDay())
	);
const days = [...working('2026-02'), ...working('2026-03')];
const base = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	packTerms(3120, 'MANUAL_LABOUR'),
	{},
	days.map((date) => ({ date, shift: WORK, hours: 8 })),
	[]
);
const [profile] = base.employee_profile ?? [];
const [stint] = base.employment ?? [];
const [terms] = base.contract_terms ?? [];
const [parameters] = base.statutory_parameters ?? [];
const [day] = base.roster_entry ?? [];
const people = Array.from({ length: PEOPLE - 1 }, (_, at) => 1000 + at * 10);
const seed = {
	...base,
	sys_user: [
		...(base.sys_user ?? []),
		...people.map((n) => ({
			id: uuid(n),
			name: `P${n}`,
			email: `p${n}@example.test`,
			kind: 'staff'
		}))
	],
	employee_profile: [
		...(base.employee_profile ?? []),
		...people.map((n) => ({ ...profile, id: uuid(n + 1), user_id: uuid(n), name: `P${n}` }))
	],
	employee_balance: [
		...(base.employee_balance ?? []),
		...people.map((n) => ({ id: uuid(n + 2), employee_id: uuid(n + 1), account: {} }))
	],
	employment: [
		...(base.employment ?? []),
		...people.map((n) => ({
			...stint,
			id: uuid(n + 3),
			employee_id: uuid(n + 1),
			employee_number: `W${n}`
		}))
	],
	contract_terms: [
		...(base.contract_terms ?? []),
		...people.map((n) => ({ ...terms, id: uuid(n + 4), employment_id: uuid(n + 3) }))
	],
	statutory_parameters: [
		...(base.statutory_parameters ?? []),
		...people.map((n) => ({ ...parameters, id: uuid(n + 5), employment_id: uuid(n + 3) }))
	],
	roster_entry: [
		...(base.roster_entry ?? []),
		...people.flatMap((n) =>
			days.map((date, at) => ({
				...day,
				id: uuid(100000 + n * 60 + at),
				employment_id: uuid(n + 3),
				work_date: date
			}))
		)
	]
};
const ONE = idOf('employment', uuid(1003));

/**
 * The budget's 2 s is the reference machine's (one Apple M-series core). Beside each operation this machine times a
 * fixed piece of the guest's kind of work (rows built, copied through JSON, keyed and sorted) on its own thread, as
 * the guest's CPU is metered; a slower machine, or a busier moment, is held to the budget at that pace, never to less
 * than the reference. Integer arithmetic alone does not slow as a guest does on a shared runner.
 */
const REFERENCE_MILLIS = 75;
const pace = () => {
	const from = process.threadCpuUsage();
	let kept = 0;
	for (let round = 0; round < 60; round++) {
		const rows = Array.from({ length: 2000 }, (_, at) => ({
			id: `row-${at}`,
			on: `2026-03-${String((at % 28) + 1).padStart(2, '0')}`,
			amount: at * 1.5
		}));
		const copied: unknown = JSON.parse(JSON.stringify(rows));
		const keyed = new Map(rows.map((row) => [row.id, { ...row, amount: row.amount + 1 }]));
		const sorted = [...keyed.values()].toSorted(
			(left, right) => right.on.localeCompare(left.on) || left.id.localeCompare(right.id)
		);
		kept += sorted.length + (Array.isArray(copied) ? copied.length : 0);
	}
	assert.ok(kept > 0);
	const used = process.threadCpuUsage(from);
	return Math.max(1, (used.user + used.system) / 1000 / REFERENCE_MILLIS);
};
/** Each guest session's round trips (waves of `ctx` calls) and CPU, gathered while one operation runs. */
const sessions = new Map<string, { waves: number; nanos: bigint }>();
const at = (session: string) => {
	const held = sessions.get(session) ?? { waves: 0, nanos: 0n };
	sessions.set(session, held);
	return held;
};
/**
 * One operation as its invocations crossed: the most round trips any one made, and the guest CPU of them all. The
 * design's budget (docs 0001, "Simplicity"): each invocation 1–5 round trips, and about 80 people under 2 s of CPU.
 */
const measured = <A, E, R>(label: string, operation: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		sessions.clear();
		const before = pace();
		const answer = yield* operation;
		const speed = Math.max(before, pace());
		const all = [...sessions.values()];
		const most = Math.max(0, ...all.map((one) => one.waves));
		const cpu = Number(all.reduce((total, one) => total + one.nanos, 0n)) / 1e6;
		assert.ok(most <= 5, `${label}: an invocation made ${most} round trips`);
		assert.ok(
			cpu < 2000 * speed,
			`${label}: ${Math.round(cpu)} ms of guest CPU at ${speed.toFixed(2)} of the reference pace`
		);
		return answer;
	});

describe('eighty people on the Malaysian law', () => {
	it.live(
		'each everyday operation makes at most five round trips per invocation, under 2 s of guest CPU',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				yield* pay(t, '2026-02');
				// March's first day runs its crons (statutory research among them) before anything is measured
				t.clock.set('2026-03-01T02:00:00.000Z');
				yield* t.run_due();
				yield* measured(
					'leave create',
					Effect.gen(function* () {
						yield* admin.act({
							'leave_catalog_entry.create': [
								leaveCreate({
									entity_id: ENTITY,
									employment_id: ONE,
									catalog_code: 'ANNUAL_LEAVE',
									encashment: false,
									days: wholeDays('2026-03-09', '2026-03-10')
								})
							]
						});
						yield* t.run_due();
					})
				);
				yield* measured(
					'claim create',
					Effect.gen(function* () {
						yield* admin.act({
							'claim_catalog_entry.create': [
								{
									entity_id: ENTITY,
									employment_id: ONE,
									catalog_code: 'MEDICAL_CLAIM',
									quantity: '120',
									incurred_on: '2026-03-11'
								}
							]
						});
						yield* t.run_due();
					})
				);
				yield* measured(
					'ad hoc create',
					Effect.gen(function* () {
						yield* admin.act({
							'adhoc_catalog_entry.create': [
								{
									entity_id: ENTITY,
									employment_id: ONE,
									catalog_code: 'INCENTIVE_OT',
									description: 'INCENTIVE_OT',
									quantity: '50',
									incurred_on: '2026-03-12'
								}
							]
						});
						yield* t.run_due();
					})
				);
				yield* measured(
					'roster day update',
					Effect.gen(function* () {
						const { roster_entry } = yield* storedQuery(t, {
							roster_entry: {
								where: { employment_id: { eq: ONE }, work_date: { eq: '2026-03-13' } },
								limit: 1
							}
						});
						const [one] = roster_entry.rows;
						assert.ok(one !== undefined);
						yield* admin.act({
							'roster_entry.update': [
								{
									target: one,
									set: {
										actual_worked_intervals: [
											{
												start: DateTime.formatIso(DateTime.makeUnsafe('2026-03-13T00:00:00.000Z')),
												end: DateTime.formatIso(DateTime.makeUnsafe('2026-03-13T09:00:00.000Z'))
											}
										]
									}
								}
							]
						});
						yield* t.run_due();
					})
				);
				const march = yield* measured('run create', run(t, '2026-03'));
				yield* measured(
					'run paid',
					Effect.gen(function* () {
						const { payroll_run } = yield* storedQuery(t, {
							payroll_run: { where: { id: { eq: march.id } }, limit: 1 }
						});
						const [current] = payroll_run.rows;
						assert.ok(current !== undefined);
						yield* admin.act({
							'payroll_run.update': [{ target: current, set: { state: 'PAID' } }]
						});
						yield* t.run_due();
					})
				);
			}).pipe(
				Effect.provide(
					workspace({
						seed,
						now: '2026-02-01T02:00:00.000Z',
						guest_meter: (session, nanos) => {
							at(session).nanos += nanos;
						},
						guest_crossed: (session) => {
							at(session).waves += 1;
						}
					})
				)
			),
		600_000
	);
});
