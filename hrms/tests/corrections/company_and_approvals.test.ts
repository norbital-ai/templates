// What reaches a paid period besides a person's own entries: a holiday or a shift the company corrects, and a change
// that waits for approval. Each goes through the models' own acts.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { DateTime, Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { amendments, carriedFor, pay, rostered, run } from '../amendment_kit.ts';
import {
	ENTITY,
	WORK,
	leaveCreate,
	pack,
	uuid,
	wholeDays,
	workspace,
	storedQuery
} from '../kit.ts';

const NOW = '2026-03-20T02:00:00.000Z';
const MONTHS = ['2026-02', '2026-03'];
const base = () => rostered(MONTHS);
type Seed = ReturnType<typeof base>;
const FIRST = idOf('employment', uuid(6));
const SECOND = uuid(906);
const DAY = '2026-02-10';

/** A second person in the same company, on the same roster. */
const twoPeople = (): Seed => {
	const seed = base();
	const [profile] = seed.employee_profile ?? [];
	const [stint] = seed.employment ?? [];
	const [terms] = seed.contract_terms ?? [];
	const [parameters] = seed.statutory_parameters ?? [];
	assert.ok(
		profile !== undefined && stint !== undefined && terms !== undefined && parameters !== undefined
	);
	return {
		...seed,
		sys_user: [
			...(seed.sys_user ?? []),
			{ id: uuid(903), name: 'Second', email: 'second@example.test', kind: 'staff' }
		],
		employee_profile: [
			...(seed.employee_profile ?? []),
			{ ...profile, id: uuid(904), user_id: uuid(903), name: 'Second' }
		],
		employee_balance: [
			...(seed.employee_balance ?? []),
			{ id: uuid(905), employee_id: uuid(904), account: {} }
		],
		employment: [
			...(seed.employment ?? []),
			{ ...stint, id: SECOND, employee_id: uuid(904), employee_number: 'W2' }
		],
		contract_terms: [
			...(seed.contract_terms ?? []),
			{ ...terms, id: uuid(914), employment_id: SECOND }
		],
		statutory_parameters: [
			...(seed.statutory_parameters ?? []),
			{ ...parameters, id: uuid(915), employment_id: SECOND }
		],
		roster_entry: [
			...(seed.roster_entry ?? []),
			...(seed.roster_entry ?? []).map((row, index) => ({
				...row,
				id: uuid(5000 + index),
				employment_id: SECOND
			}))
		]
	};
};
const overtimeKeyed = (t: Kit, date: string) =>
	Effect.gen(function* () {
		const { roster_entry } = yield* storedQuery(t, {
			roster_entry: {
				where: { work_date: { eq: date }, employment_id: { eq: FIRST } },
				limit: 1
			}
		});
		const [day] = roster_entry.rows;
		assert.ok(day !== undefined);
		yield* t.as(t.admin).pipe(
			Effect.andThen((caller) =>
				caller.act({
					'roster_entry.update': [
						{
							target: day,
							set: {
								actual_worked_intervals: [
									{
										start: DateTime.formatIso(DateTime.makeUnsafe(`${date}T00:00:00.000Z`)),
										end: DateTime.formatIso(DateTime.makeUnsafe(`${date}T10:00:00.000Z`))
									}
								],
								planned_overtime_intervals: [
									{
										start: DateTime.formatIso(DateTime.makeUnsafe(`${date}T08:00:00.000Z`)),
										end: DateTime.formatIso(DateTime.makeUnsafe(`${date}T10:00:00.000Z`))
									}
								]
							}
						}
					]
				})
			)
		);
		yield* t.run_due();
	});

describe('what the company corrects', () => {
	it.live('a holiday published in a paid month amends everyone the company paid for it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, '2026-02');
			yield* t.as(t.admin).pipe(
				Effect.andThen((caller) =>
					caller.act({
						'holiday.create': [
							{
								entity_id: ENTITY,
								date: DAY,
								name: 'Declared late',
								kind: 'PUBLIC_HOLIDAY',
								given_to: 'EVERYONE',
								published_at: DateTime.formatIso(DateTime.makeUnsafe('2026-03-19T00:00:00.000Z'))
							}
						]
					})
				)
			);
			yield* t.run_due();
			const open = yield* amendments(t);
			assert.deepEqual(
				open.map((row) => row.period),
				['2026-02', '2026-02']
			);
			assert.deepEqual(
				open.map((row) => String(row.employee_id)).toSorted(),
				[uuid(4), uuid(904)].toSorted()
			);
			yield* run(t, '2026-03');
			for (const employee of [uuid(4), uuid(904)])
				assert.ok(
					Object.keys(yield* carriedFor(t, '2026-03', '2026-02', employee)).length > 0,
					'each person is carried the holiday they worked'
				);
			// renaming it moves nobody's pay: with the run paid and its rows taken, none opens
			const march = yield* storedQuery(t, {
				payroll_run: { where: { period: { eq: '2026-03' } }, limit: 1 }
			});
			const { holiday } = yield* storedQuery(t, {
				holiday: { where: { name: { eq: 'Declared late' } }, limit: 1 }
			});
			const [ran] = march.payroll_run.rows;
			const [declared] = holiday.rows;
			assert.ok(ran !== undefined && declared !== undefined);
			const admin = yield* t.as(t.admin);
			yield* admin.act({ 'payroll_run.update': [{ target: ran, set: { state: 'PAID' } }] });
			yield* t.run_due();
			yield* admin.act({
				'holiday.update': [{ target: declared, set: { name: 'Declared late, renamed' } }]
			});
			yield* t.run_due();
			assert.deepEqual(
				(yield* amendments(t)).filter((row) => row.payroll_run_id === null),
				[]
			);
		}).pipe(Effect.provide(workspace({ seed: twoPeople(), now: NOW })))
	);

	it.live('a shift paid days used keeps its hours', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, '2026-02');
			const [shift] = (yield* storedQuery(t, {
				shift_definition: { where: { id: { eq: idOf('shift_definition', WORK) } }, limit: 1 }
			})).shift_definition.rows;
			assert.ok(shift !== undefined);
			const admin = yield* t.as(t.admin);
			const refused = yield* Effect.flip(
				admin.act({
					'shift_definition.update': [
						{
							target: shift,
							set: {
								variant: {
									day_type: 'WORK',
									ends_next_day: false,
									breaks: [],
									untimed_hours: 9
								}
							}
						}
					]
				})
			);
			assert.ok(refused._tag === 'ActRefused');
			assert.equal(refused.key, 'errors.shift_definition_paid');
		}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);
});

describe('a change that waits for approval', () => {
	const staff = (id: number, name: string, team: string) => ({
		id: uuid(id),
		name,
		email: `${name.toLowerCase()}@example.test`,
		kind: 'staff',
		team
	});
	const seed = (): Seed => {
		const packed = base();
		return {
			...packed,
			sys_user: [
				...(packed.sys_user ?? []),
				staff(40, 'Lead', 'supervisor'),
				staff(41, 'Payroll', 'hr_controller')
			]
		};
	};
	const claimed = (t: Kit, quantity: number) =>
		t
			.as(t.member(['employee'], { id: uuid(3) }))
			.pipe(
				Effect.andThen((caller) =>
					caller.act({
						'claim_catalog_entry.create': [
							{
								entity_id: ENTITY,
								employment_id: FIRST,
								catalog_code: 'MEDICAL_CLAIM',
								quantity: String(quantity),
								incurred_on: DAY
							}
						]
					})
				)
			)
			.pipe(
				Effect.map((asked) => {
					assert.ok(asked.kind === 'pending_approval');
					return asked.request_id;
				})
			);

	it.live('its amendment row is written by the approving decision, not by the request', () => {
		const from = seed();
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const lead = yield* t.as(yield* t.sign_in('lead@example.test'));
			const payroll = yield* t.as(yield* t.sign_in('payroll@example.test'));
			yield* pay(t, '2026-02');
			const request = yield* claimed(t, 50);
			assert.deepEqual(yield* amendments(t), [], 'a request amends nothing');
			yield* lead.approvals.decide(request, { decision: 'approve' });
			assert.deepEqual(yield* amendments(t), [], 'nor does a first step');
			yield* payroll.approvals.decide(request, { decision: 'approve' });
			yield* t.run_due();
			const open = yield* amendments(t);
			assert.equal(open.length, 1);
			assert.equal(open[0]?.period, '2026-02');
			yield* run(t, '2026-03');
			assert.deepEqual(yield* carriedFor(t, '2026-03', '2026-02'), {
				'MEDICAL_CLAIM/EMPLOYEE': 50
			});
		}).pipe(Effect.provide(workspace({ seed: from, now: NOW })));
	});

	it.live('a rejected request leaves no row', () => {
		const from = seed();
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const lead = yield* t.as(yield* t.sign_in('lead@example.test'));
			yield* pay(t, '2026-02');
			const request = yield* claimed(t, 50);
			yield* lead.approvals.decide(request, { decision: 'reject', reason: 'No receipt' });
			yield* t.run_due();
			assert.deepEqual(yield* amendments(t), []);
		}).pipe(Effect.provide(workspace({ seed: from, now: NOW })));
	});

	it.live('a request dated under an unpaid run is refused at once', () => {
		const from = seed();
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, '2026-02');
			yield* run(t, '2026-03');
			assert.match(
				String(yield* Effect.flip(claimed(t, 50))),
				/holds this person and is not paid yet/
			);
		}).pipe(Effect.provide(workspace({ seed: from, now: NOW })));
	});

	// a run cannot be made over a request it would pay, so no decision ever comes under an unpaid run that waits for it
	it.live(
		'a request dated in a paid period stops the next run until it is decided, then is carried',
		() => {
			const from = seed();
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const lead = yield* t.as(yield* t.sign_in('lead@example.test'));
				const payroll = yield* t.as(yield* t.sign_in('payroll@example.test'));
				yield* pay(t, '2026-02');
				const request = yield* claimed(t, 50);
				yield* lead.approvals.decide(request, { decision: 'approve' });
				assert.match(
					String(yield* Effect.flip(run(t, '2026-03'))),
					/Under approval: an entry this run would pay still waits for its decision\. Decide it, then run\./
				);
				yield* payroll.approvals.decide(request, { decision: 'approve' });
				yield* t.run_due();
				yield* run(t, '2026-03');
				assert.deepEqual(yield* carriedFor(t, '2026-03', '2026-02'), {
					'MEDICAL_CLAIM/EMPLOYEE': 50
				});
			}).pipe(Effect.provide(workspace({ seed: from, now: NOW })));
		}
	);

	it.live(
		'a period worked out again that holds a record still under approval stops the run',
		() => {
			const from = seed();
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const lead = yield* t.as(yield* t.sign_in('lead@example.test'));
				yield* pay(t, '2026-02');
				// February is amended by HR's own correction, and an employee's claim in it still waits
				yield* overtimeKeyed(t, DAY);
				const request = yield* claimed(t, 50);
				assert.match(
					String(yield* Effect.flip(run(t, '2026-03'))),
					/Under approval: an entry this run would pay still waits for its decision\. Decide it, then run\./
				);
				yield* lead.approvals.decide(request, { decision: 'reject', reason: 'No receipt' });
				yield* t.run_due();
				yield* run(t, '2026-03');
				assert.ok(((yield* carriedFor(t, '2026-03', '2026-02'))['OVERTIME/EMPLOYEE'] ?? 0) > 0);
			}).pipe(Effect.provide(workspace({ seed: from, now: NOW })));
		}
	);

	// a run holds what it priced and everything before it; a day after its window is not its business
	it.live(
		'a decision for a day after an unpaid run goes through, and one inside it never arises',
		() => {
			const from = seed();
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const lead = yield* t.as(yield* t.sign_in('lead@example.test'));
				const payroll = yield* t.as(yield* t.sign_in('payroll@example.test'));
				yield* pay(t, '2026-02');
				// a day of no-pay leave asked for next month: March's run does not pay it, so the run can be made
				const asked = yield* t.as(t.member(['employee'], { id: uuid(3) })).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'leave_catalog_entry.create': [
								leaveCreate({
									entity_id: ENTITY,
									employment_id: FIRST,
									catalog_code: 'NPL',
									days: wholeDays('2026-04-10')
								})
							]
						})
					)
				);
				assert.ok(asked.kind === 'pending_approval');
				yield* lead.approvals.decide(asked.request_id, { decision: 'approve' });
				yield* run(t, '2026-03');
				yield* payroll.approvals.decide(asked.request_id, { decision: 'approve' });
				yield* t.run_due();
				const { leave_catalog_entry } = yield* storedQuery(t, {
					leave_catalog_entry: { limit: 10 }
				});
				assert.equal(leave_catalog_entry.rows.length, 1);
				assert.deepEqual(yield* amendments(t), [], 'April is not paid: nothing to amend');
				// a request dated inside the unpaid run is refused when it is made, so no decision for it can come
				assert.match(
					String(yield* Effect.flip(claimed(t, 50))),
					/holds this person and is not paid yet/
				);
			}).pipe(Effect.provide(workspace({ seed: from, now: NOW })));
		}
	);
});
