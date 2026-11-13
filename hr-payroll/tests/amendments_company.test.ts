// What reaches a paid period besides a person's own entries: a pay group changed, a holiday or a shift the company
// corrects, a child registered late, and a change that waits for approval. Each goes through the models' own acts.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { amendments, carriedFor, pay, run, weekdays, working } from './amendment_kit.ts';
import {
	ENTITY,
	PAY_GROUP,
	WORK,
	catalogRow,
	leaveCreate,
	pack,
	uuid,
	wholeDays,
	workspace,
	storedQuery
} from './kit.ts';

const TERMS = {
	rate: { amount: 2800, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 45,
	normal_days_per_week: 6,
	statutory_work_category: 'MANUAL_LABOUR',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const NOW = '2026-03-20T02:00:00.000Z';
const MONTHS = ['2026-02', '2026-03'];
const base = () =>
	pack(
		'MY',
		'Asia/Kuala_Lumpur',
		TERMS,
		{},
		MONTHS.flatMap(working).map((date) => ({ date, shift: WORK, hours: 8 })),
		[]
	);
type Seed = ReturnType<typeof base>;
const FIRST = idOf('employee_contract', uuid(6));
const SECOND = uuid(906);
const GROUP_B = uuid(908);
const DAY = '2026-02-10';

/** A second person in the same company, on the same roster. */
const twoPeople = (): Seed => {
	const seed = base();
	const [contract] = seed.employee_contract ?? [];
	assert.ok(contract !== undefined);
	return {
		...seed,
		sys_user: [
			...(seed.sys_user ?? []),
			{ id: uuid(903), name: 'Second', email: 'second@example.test', kind: 'staff' }
		],
		employee_profile: [
			...(seed.employee_profile ?? []),
			{ id: uuid(904), user_id: uuid(903), name: 'Second' }
		],
		employee_balance: [
			...(seed.employee_balance ?? []),
			{ id: uuid(905), employee_id: uuid(904), account: {} }
		],
		employee_contract: [
			...(seed.employee_contract ?? []),
			{ ...contract, id: SECOND, employee_id: uuid(904), employee_number: 'W2' }
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
/** The company pays monthly on group A to February, and on a second group from the first of March. */
const movedGroup = (): Seed => {
	const seed = base();
	const [contract] = seed.employee_contract ?? [];
	const [group] = seed.pay_group ?? [];
	assert.ok(contract !== undefined && group !== undefined);
	return {
		...seed,
		pay_group: [group, { ...group, id: GROUP_B, name: 'Monthly, from March' }],
		employee_contract: [
			{ ...contract, effective_range: { from: '2025-01-01', to: '2026-02-28' } },
			{
				...contract,
				id: uuid(907),
				pay_group_id: GROUP_B,
				effective_range: { from: '2026-03-01', to: null }
			}
		]
	};
};
const overtimeKeyed = (t: Kit, date: string) =>
	Effect.gen(function* () {
		const { roster_entry } = yield* storedQuery(t, {
			roster_entry: {
				where: { work_date: { eq: PlainDate(date) }, employment_id: { eq: FIRST } },
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
									{ start: Instant(`${date}T00:00:00.000Z`), end: Instant(`${date}T10:00:00.000Z`) }
								],
								planned_overtime_intervals: [
									{ start: Instant(`${date}T08:00:00.000Z`), end: Instant(`${date}T10:00:00.000Z`) }
								]
							}
						}
					]
				})
			)
		);
		yield* t.run_due();
	});

describe('a change of pay schedule', () => {
	it.live(
		'a period the old group paid is worked out on that group, and the new group carries it',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-02', PAY_GROUP);
				yield* overtimeKeyed(t, DAY);
				const [open] = yield* amendments(t);
				assert.equal(open?.pay_group_id, PAY_GROUP, 'the row names the group that paid the period');
				const march = yield* run(t, '2026-03', GROUP_B);
				assert.ok(((yield* carriedFor(t, '2026-03', '2026-02'))['OVERTIME/EMPLOYEE'] ?? 0) > 0);
				assert.equal((yield* amendments(t))[0]?.payroll_run_id, march.id);
			}).pipe(Effect.provide(workspace({ seed: movedGroup(), now: NOW })))
	);

	it.live('a group that has paid keeps its schedule; its pay day still changes', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, '2026-02');
			const { pay_group } = yield* storedQuery(t, { pay_group: { limit: 1 } });
			const [group] = pay_group.rows;
			assert.ok(group !== undefined);
			const schedule = {
				frequency: 'MONTHLY' as const,
				business_day: 'PREVIOUS' as const,
				non_working_weekdays: [0, 6],
				short_month: 'LAST_DAY' as const,
				pay_cutoff_day: 1,
				pay_days: [25]
			};
			const refused = yield* Effect.flip(
				t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'pay_group.update': [
								{ target: group, set: { payment_schedule: { ...schedule, pay_cutoff_day: 16 } } }
							]
						})
					)
				)
			);
			assert.ok(refused._tag === 'ActRefused');
			assert.equal(refused.key, 'errors.pay_group_paid_schedule');
			yield* t.as(t.admin).pipe(
				Effect.andThen((caller) =>
					caller.act({
						'pay_group.update': [
							{ target: group, set: { payment_schedule: { ...schedule, pay_days: [28] } } }
						]
					})
				)
			);
		}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);
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
								date: PlainDate(DAY),
								name: 'Declared late',
								kind: 'PUBLIC_HOLIDAY',
								given_to: 'EVERYONE',
								published_at: Instant('2026-03-19T00:00:00.000Z')
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

describe('a child registered late', () => {
	const seed = (): Seed => {
		const packed = pack(
			'ID',
			'Asia/Jakarta',
			{
				rate: { amount: 10_000_000, unit: 'MONTHLY' },
				normal_hours_per_day: 8,
				normal_hours_per_week: 40,
				normal_days_per_week: 5,
				statutory_work_category: 'NON_MANUAL',
				work_classification: 'EA_COVERED',
				residency_status: 'CITIZEN',
				wage_payment_method: 'BANK',
				allowances: {}
			},
			{ work_region: 'Provinsi Aceh/Kabupaten Aceh Barat' },
			MONTHS.flatMap(weekdays).map((date) => ({ date, shift: WORK, hours: 8 })),
			[]
		);
		return {
			...packed,
			entity_profile_version: (packed.entity_profile_version ?? []).map((row) => ({
				...row,
				entity_extension_data: { risk_class: 'I' }
			})),
			employee_contract: (packed.employee_contract ?? []).map((row) => ({
				...row,
				effective_range: { from: '2026-01-01', to: null },
				payroll: { date_of_birth: '1990-01-01', gender: 'MALE', marital_status: 'MARRIED' }
			}))
		};
	};
	it.live(
		'the tax of the months since the birth is worked out again, on a version nobody re-signed',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* pay(t, '2026-02');
				const admin = yield* t.as(t.admin);
				const { employee_contract } = yield* storedQuery(t, { employee_contract: { limit: 10 } });
				const [held] = employee_contract.rows;
				assert.ok(held !== undefined);
				yield* admin.act({
					'employee_contract.create': [
						{
							employee_id: held.employee_id,
							entity_id: held.entity_id,
							engagement: held.engagement,
							employee_number: held.employee_number,
							terms: held.terms,
							payroll: held.payroll,
							bank: held.bank,
							family: [{ relation: 'CHILD', born_on: PlainDate('2026-02-05') }],
							employee_extension_data: held.employee_extension_data,
							service_started_on: held.service_started_on,
							effective_range: { from: PlainDate('2026-02-01'), to: null },
							status: 'DRAFT',
							reason: 'A child was born'
						}
					]
				});
				const drafts = yield* storedQuery(t, {
					employee_contract: { where: { status: { eq: 'DRAFT' } }, limit: 1 }
				});
				const [draft] = drafts.employee_contract.rows;
				assert.ok(draft !== undefined);
				yield* admin.act({
					'employee_contract.update': [
						{
							target: held,
							set: {
								effective_range: { from: held.effective_range.from, to: PlainDate('2026-01-31') }
							}
						}
					]
				});
				yield* admin.act({
					'employee_contract.update': [{ target: draft, set: { status: 'SEALED' } }]
				});
				yield* t.run_due();
				yield* run(t, '2026-03');
				const february = yield* carriedFor(t, '2026-03', '2026-02');
				assert.ok(
					(february['PPH21/EMPLOYEE'] ?? 0) > 0,
					'tax withheld without the child comes back'
				);
				assert.equal(february['BASIC/EMPLOYEE'], undefined, 'nothing of the pay itself moved');
			}).pipe(Effect.provide(workspace({ seed: seed(), now: NOW })))
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
	const claimed = (t: Kit, from: Seed, quantity: number) =>
		t
			.as(t.member(['employee'], { id: uuid(3) }))
			.pipe(
				Effect.andThen((caller) =>
					caller.act({
						'claim_catalog_entry.create': [
							{
								entity_id: ENTITY,
								employment_id: FIRST,
								catalog_id: idOf(
									'claim_catalog',
									catalogRow(from, 'claim_catalog', 'MEDICAL_CLAIM')
								),
								quantity,
								incurred_on: PlainDate(DAY)
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
			const request = yield* claimed(t, from, 50);
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
			const request = yield* claimed(t, from, 50);
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
				String(yield* Effect.flip(claimed(t, from, 50))),
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
				const request = yield* claimed(t, from, 50);
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
				const request = yield* claimed(t, from, 50);
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
									catalog_id: idOf('leave_catalog', catalogRow(from, 'leave_catalog', 'NPL')),
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
					String(yield* Effect.flip(claimed(t, from, 50))),
					/holds this person and is not paid yet/
				);
			}).pipe(Effect.provide(workspace({ seed: from, now: NOW })));
		}
	);
});
