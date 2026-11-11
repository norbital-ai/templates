// A company's payrolls. A run pays one pay group: its contracts, its schedule, its own order of cycles and its own
// capture of the contracts it paid. Malaysia's public law is only the fixture; nothing here reads an amount.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { cycleOf, payDateOf } from '../src/lib/payroll_engine/pay_cycle.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, PAY_GROUP, catalogRow, ledgerRows, pack, uuid, workspace } from './kit.ts';

const NOW = '2026-03-20T02:00:00.000Z';
const TERMS = {
	rate: { amount: 2800, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'MANUAL_LABOUR',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const A = idOf('pay_group', PAY_GROUP);
const B = idOf('pay_group', uuid(808));
const FIRST = idOf('employee_contract', uuid(6));
const SECOND = idOf('employee_contract', uuid(906));
const SISTER = idOf('entity', uuid(900));
const SISTER_GROUP = idOf('pay_group', uuid(908));
const MONTHLY = {
	frequency: 'MONTHLY',
	business_day: 'PREVIOUS',
	non_working_weekdays: [0, 6],
	short_month: 'LAST_DAY',
	pay_cutoff_day: 1,
	pay_days: [25]
};
const SEMI_MONTHLY = {
	frequency: 'SEMI_MONTHLY',
	business_day: 'PREVIOUS',
	non_working_weekdays: [0, 6],
	short_month: 'LAST_DAY',
	pay_cutoff_day: 1,
	pay_days: [15, 31]
};

const base = () => pack('MY', 'Asia/Kuala_Lumpur', TERMS, {}, [], []);
type Seed = ReturnType<typeof base>;
/** One company, two payrolls: the first person is paid in A (Monthly), the second in B (Executives). */
const twoGroups = (schedule: typeof MONTHLY = MONTHLY): Seed => {
	const seed = base();
	const [group] = seed.pay_group ?? [];
	const [contract] = seed.employee_contract ?? [];
	assert.ok(group !== undefined && contract !== undefined);
	return {
		...seed,
		pay_group: [
			{ ...group, payment_schedule: MONTHLY },
			{ ...group, id: B, name: 'Executives', payment_schedule: schedule }
		],
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
			contract,
			{ ...contract, id: SECOND, employee_id: uuid(904), employee_number: 'W2', pay_group_id: B }
		]
	};
};
/** The two payrolls, and a sister company with its own. */
const withSister = (): Seed => {
	const seed = twoGroups();
	const [group] = seed.pay_group ?? [];
	const [profile] = seed.entity_profile_version ?? [];
	assert.ok(group !== undefined && profile !== undefined);
	return {
		...seed,
		entity: [
			...(seed.entity ?? []),
			{ id: SISTER, code: 'E2', name: 'Sister', settings_code: 'MY' }
		],
		entity_profile_version: [
			...(seed.entity_profile_version ?? []),
			{ ...profile, id: uuid(902), entity_id: SISTER, name: 'Sister' }
		],
		pay_group: [...(seed.pay_group ?? []), { ...group, id: SISTER_GROUP, entity_id: SISTER }]
	};
};

const run = (t: Kit, group: Id<'pay_group'> | null, period: string) =>
	t
		.as(t.admin)
		.act('payroll_run.create', [
			{
				entity_id: ENTITY,
				...(group === null ? {} : { pay_group_id: group }),
				period,
				kind: 'ON_CYCLE'
			}
		])
		.pipe(Effect.andThen(t.runDue()));
const runs = (t: Kit) =>
	t
		.storedQuery({ payroll_run: { limit: 100 } })
		.pipe(
			Effect.map((got) =>
				[...got.payroll_run.rows].sort((a, b) =>
					`${a.period} ${a.pay_group_id}`.localeCompare(`${b.period} ${b.pay_group_id}`)
				)
			)
		);
const slips = (t: Kit) =>
	t.storedQuery({ payslip: { limit: 100 } }).pipe(Effect.map((got) => got.payslip.rows));
/** The contracts a group's run of a period paid. */
const paidBy = (t: Kit, group: Id<'pay_group'>, period: string) =>
	Effect.gen(function* () {
		const ran = (yield* runs(t)).find((row) => row.pay_group_id === group && row.period === period);
		assert.ok(ran !== undefined, `${period} did not run`);
		return (yield* slips(t))
			.filter((slip) => slip.payroll_run_id === ran.id)
			.map((slip) => slip.employment_id)
			.sort();
	});
// each of these workspaces has run once when a contract is refused under it: the refusal names that run
const CAPTURED = /Payroll run 1 already captured this period/;
const failures = (t: Kit) =>
	t
		.storedQuery({ obligation: { limit: 500 } })
		.pipe(
			Effect.map(({ obligation }) =>
				obligation.rows.map((row) => row.title).filter((title) => /failed/i.test(title))
			)
		);
const sealed = (t: Kit) =>
	t
		.storedQuery({ employee_contract: { where: { status: { eq: 'SEALED' } }, limit: 100 } })
		.pipe(Effect.map(({ employee_contract }) => employee_contract.rows));
type Version = Effect.Success<ReturnType<typeof sealed>>[number];
/** A draft successor of a sealed version from `from`, in a named group, one of another company or none. */
const draft = (
	t: Kit,
	held: Version,
	from: string,
	group: Id<'pay_group'> | null,
	entity: Id<'entity'> = ENTITY
) =>
	t.as(t.admin).act('employee_contract.create', [
		{
			employee_id: held.employee_id,
			entity_id: entity,
			...(group === null ? {} : { pay_group_id: group }),
			engagement: held.engagement,
			employee_number: held.employee_number,
			terms: held.terms,
			payroll: held.payroll,
			bank: held.bank,
			family: held.family,
			employee_extension_data: held.employee_extension_data,
			service_started_on: held.service_started_on,
			effective_range: { from: PlainDate(from), to: null },
			status: 'DRAFT',
			reason: 'Moved to another payroll'
		}
	]);
const drafts = (t: Kit) =>
	t
		.storedQuery({ employee_contract: { where: { status: { eq: 'DRAFT' } }, limit: 100 } })
		.pipe(Effect.map(({ employee_contract }) => employee_contract.rows));
const end = (t: Kit, held: Version, to: string) =>
	t.as(t.admin).act('employee_contract.update', [
		{
			target: held.id,
			set: { effective_range: { from: held.effective_range.from, to: PlainDate(to) } }
		}
	]);
const seal = (t: Kit, id: Id<'employee_contract'>) =>
	t.as(t.admin).act('employee_contract.update', [{ target: id, set: { status: 'SEALED' } }]);
const firstOf = (t: Kit) =>
	sealed(t).pipe(
		Effect.map((rows) => {
			const held = rows.find((row) => row.id === FIRST);
			assert.ok(held !== undefined);
			return held;
		})
	);

describe('a run pays one pay group', () => {
	it.live('only the contracts naming it, and the other group’s same period still runs', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, A, '2026-02');
			assert.deepEqual(yield* paidBy(t, A, '2026-02'), [FIRST]);
			assert.equal((yield* slips(t)).length, 1);
			yield* run(t, B, '2026-02');
			assert.deepEqual(yield* paidBy(t, B, '2026-02'), [SECOND]);
			// one payslip a person for the month, and no effect of the second run tripped over the first's
			assert.equal((yield* slips(t)).length, 2);
			assert.deepEqual(yield* failures(t), []);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);

	it.live('with two groups and none named it is refused, and naming one is the way out', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.match(
				String(yield* Effect.flip(run(t, null, '2026-02'))),
				/Choose the pay group this run pays/
			);
			assert.equal((yield* runs(t)).length, 0);
			yield* run(t, A, '2026-02');
			assert.equal((yield* runs(t))[0]?.pay_group_id, A);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);

	it.live('a group of another company is refused', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.match(
				String(yield* Effect.flip(run(t, SISTER_GROUP, '2026-02'))),
				/belongs to another company/
			);
			assert.equal((yield* runs(t)).length, 0);
		}).pipe(Effect.provide(workspace({ seed: withSister(), now: NOW })))
	);

	it.live('the same group and period twice: the second is refused and moves nothing', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, A, '2026-02');
			const posted = (yield* ledgerRows(t)).length;
			assert.ok(posted > 0);
			assert.match(String(yield* Effect.flip(run(t, A, '2026-02'))), /already has this/);
			assert.equal((yield* runs(t)).length, 1);
			assert.equal((yield* slips(t)).length, 1);
			assert.equal((yield* ledgerRows(t)).length, posted);
			// the refusal wedged nothing: the other payroll of the month still runs
			yield* run(t, B, '2026-02');
			assert.deepEqual(yield* paidBy(t, B, '2026-02'), [SECOND]);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);

	it.live('“a later cycle has run” is each group’s own order', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, A, '2026-02');
			// B never ran February, so its January is not behind anything
			yield* run(t, B, '2026-01');
			assert.deepEqual(yield* paidBy(t, B, '2026-01'), [SECOND]);
			assert.match(
				String(yield* Effect.flip(run(t, A, '2026-01'))),
				/2026-02 has already run, so 2026-01 cannot run after it/
			);
			assert.equal((yield* runs(t)).length, 2);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);
});

describe('two schedules in one company', () => {
	it.live('each group runs its own cycles, with its own coverage and pay date', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			// a cycle is a cycle of the group named, not of the company
			assert.match(
				String(yield* Effect.flip(run(t, B, '2026-02'))),
				/2026-02 is not a pay cycle of Executives/
			);
			assert.match(
				String(yield* Effect.flip(run(t, A, '2026-02-1'))),
				/2026-02-1 is not a pay cycle of Monthly/
			);
			yield* run(t, A, '2026-02');
			yield* run(t, B, '2026-02-1');
			yield* run(t, B, '2026-02-2');
			const ran = yield* runs(t);
			assert.deepEqual(
				ran.map((row) => ({
					group: row.pay_group_id,
					period: row.period,
					from: String(row.salary_coverage.from),
					to: String(row.salary_coverage.to),
					pay_date: String(row.pay_date)
				})),
				[
					{ group: A, period: '2026-02', schedule: MONTHLY },
					{ group: B, period: '2026-02-1', schedule: SEMI_MONTHLY },
					{ group: B, period: '2026-02-2', schedule: SEMI_MONTHLY }
				].map(({ group, period, schedule }) => ({
					group,
					period,
					from: cycleOf(schedule, period)?.from,
					to: cycleOf(schedule, period)?.to,
					pay_date: String(payDateOf(schedule, period))
				}))
			);
			assert.deepEqual(yield* paidBy(t, A, '2026-02'), [FIRST]);
			assert.deepEqual(yield* paidBy(t, B, '2026-02-1'), [SECOND]);
			assert.deepEqual(yield* paidBy(t, B, '2026-02-2'), [SECOND]);
			assert.deepEqual(yield* failures(t), []);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(SEMI_MONTHLY), now: NOW })))
	);

	// Break-it: HR changes a payroll's frequency after it has paid a month. The new schedule's cycle keys are new, so
	// neither the one-run-a-period rule nor “a later cycle has run” (`payroll_run` create, `entry.period > row.period`)
	// sees that the month's days are already paid.
	it.live('a group rescheduled after it ran cannot pay the same days again', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, A, '2026-02');
			const rescheduled = yield* Effect.result(
				t.as(t.admin).act('pay_group.update', [
					{
						target: A,
						set: {
							payment_schedule: {
								...SEMI_MONTHLY,
								frequency: 'SEMI_MONTHLY',
								business_day: 'PREVIOUS',
								short_month: 'LAST_DAY'
							}
						}
					}
				])
			);
			const again = yield* Effect.result(run(t, A, '2026-02-1'));
			const covering = (yield* runs(t)).filter(
				(row) => row.pay_group_id === A && String(row.salary_coverage.from) === '2026-02-01'
			);
			assert.equal(
				covering.length,
				1,
				`1–15 February was paid again: reschedule ${rescheduled._tag}, second run ${again._tag}`
			);
			assert.equal((yield* slips(t)).length, 1);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);
});

describe('a contract and its pay group', () => {
	it.live('cannot name a group of another company', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const held = yield* firstOf(t);
			const refused = yield* Effect.flip(draft(t, held, '2026-04-01', SISTER_GROUP));
			assert.match(String(refused), /belongs to another company/);
			assert.deepEqual(yield* drafts(t), []);
		}).pipe(Effect.provide(workspace({ seed: withSister(), now: NOW })))
	);

	it.live('a draft may wait unnamed where there are two groups; sealing needs one', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const held = yield* firstOf(t);
			yield* draft(t, held, '2026-04-01', null);
			const [waiting] = yield* drafts(t);
			assert.ok(waiting !== undefined);
			assert.equal(waiting.pay_group_id, null);
			yield* end(t, held, '2026-03-31');
			assert.match(
				String(yield* Effect.flip(seal(t, waiting.id))),
				/Choose the pay group this person is paid in/
			);
			// the way out the refusal names
			yield* t
				.as(t.admin)
				.act('employee_contract.update', [{ target: waiting.id, set: { pay_group_id: B } }]);
			yield* seal(t, waiting.id);
			const moved = (yield* sealed(t)).find((row) => row.id === waiting.id);
			assert.equal(moved?.pay_group_id, B);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);

	it.live('the capture lock is the group’s: A’s run holds A’s contracts, not B’s', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, A, '2026-02');
			const versions = yield* sealed(t);
			const first = versions.find((row) => row.id === FIRST);
			const second = versions.find((row) => row.id === SECOND);
			assert.ok(first !== undefined && second !== undefined);
			assert.match(String(yield* Effect.flip(end(t, first, '2026-02-13'))), CAPTURED);
			assert.match(String(yield* Effect.flip(draft(t, first, '2026-02-01', A))), CAPTURED);
			// B has not run February: a new version of its person may still start inside it
			yield* draft(t, second, '2026-02-01', B);
			assert.equal((yield* drafts(t)).length, 1);
			yield* run(t, B, '2026-02');
			assert.deepEqual(yield* paidBy(t, B, '2026-02'), [SECOND]);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);

	// Break-it: is the person paid twice, or never?
	it.live('moved to B after A ran the month: refused inside it, and paid once a month after', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, A, '2026-02');
			const held = yield* firstOf(t);
			// B has run nothing, so the draft itself is allowed; the version A's run paid cannot end under it
			yield* draft(t, held, '2026-02-01', B);
			const [moving] = yield* drafts(t);
			assert.ok(moving !== undefined);
			assert.match(String(yield* Effect.flip(end(t, held, '2026-01-31'))), CAPTURED);
			assert.match(String(yield* Effect.flip(seal(t, moving.id))), /overlaps another record/);
			yield* run(t, B, '2026-02');
			assert.deepEqual(yield* paidBy(t, B, '2026-02'), [SECOND]);
			// the way out: the move starts the first month neither payroll has paid them
			yield* t.as(t.admin).act('employee_contract.update', [
				{
					target: moving.id,
					set: { effective_range: { from: PlainDate('2026-03-01'), to: null } }
				}
			]);
			yield* end(t, held, '2026-02-28');
			yield* seal(t, moving.id);
			yield* t.runDue();
			yield* run(t, B, '2026-03');
			assert.deepEqual(yield* paidBy(t, B, '2026-03'), [SECOND, moving.id].sort());
			const periodOf = new Map((yield* runs(t)).map((row) => [row.id, row.period]));
			const theirs = (yield* slips(t))
				.filter((slip) => slip.employee_id === held.employee_id)
				.map((slip) => periodOf.get(slip.payroll_run_id))
				.sort();
			assert.deepEqual(theirs, ['2026-02', '2026-03']);
		}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);

	it.live(
		'cannot join a group for a month that group already ran, and their own group pays it',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* run(t, B, '2026-02');
				const held = yield* firstOf(t);
				assert.match(String(yield* Effect.flip(draft(t, held, '2026-02-01', B))), CAPTURED);
				assert.deepEqual(yield* drafts(t), []);
				yield* run(t, A, '2026-02');
				assert.deepEqual(yield* paidBy(t, A, '2026-02'), [FIRST]);
			}).pipe(Effect.provide(workspace({ seed: twoGroups(), now: NOW })))
	);
});

describe('an off-cycle run and the pay groups', () => {
	const seed = twoGroups();
	const BONUS = idOf('adhoc_catalog', catalogRow(seed, 'adhoc_catalog', 'BONUS'));
	const offCycle = (t: Kit, group: Id<'pay_group'>, entry: Id<'adhoc_catalog_entry'>) =>
		t
			.as(t.admin)
			.act('payroll_run.create', [
				{
					entity_id: ENTITY,
					pay_group_id: group,
					period: '2026-02',
					kind: 'OFF_CYCLE',
					attaches: { adhoc: [entry] }
				}
			])
			.pipe(Effect.andThen(t.runDue()));
	const bonuses = (t: Kit) =>
		slips(t).pipe(
			Effect.map((rows) =>
				rows.flatMap((slip) =>
					Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown)
						.lines.filter((line) => line.code === 'BONUS')
						.map(() => slip.employment_id)
				)
			)
		);

	// Break-it: the entry is of a person the named group does not pay.
	it.live(
		'naming an entry of a person in the other group is refused; their group pays it once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* t.as(t.admin).act('adhoc_catalog_entry.create', [
					{
						entity_id: ENTITY,
						employment_id: SECOND,
						catalog_id: BONUS,
						description: 'Bonus',
						quantity: 500,
						incurred_on: PlainDate('2026-02-10')
					}
				]);
				const [entry] = (yield* t.storedQuery({ adhoc_catalog_entry: { limit: 1 } }))
					.adhoc_catalog_entry.rows;
				assert.ok(entry !== undefined);
				const refused = yield* Effect.flip(offCycle(t, A, entry.id));
				assert.equal((yield* runs(t)).length, 0);
				const [waiting] = (yield* t.storedQuery({ adhoc_catalog_entry: { limit: 1 } }))
					.adhoc_catalog_entry.rows;
				assert.equal(waiting?.payroll_run_id, null);
				// the way out: the run of the group that pays them
				yield* offCycle(t, B, entry.id);
				assert.deepEqual(yield* bonuses(t), [SECOND]);
				// the person is employed all month, so “not employed in its period … their last day” would send HR nowhere
				assert.match(String(refused), /pay group/i);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-02-20T02:00:00.000Z' })))
	);
});
