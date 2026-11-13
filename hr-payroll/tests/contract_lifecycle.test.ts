// The life of a version: DRAFT → SEALED → VOID for a contract, an employer version and a law version; two sealed contracts
// of one person never overlap; an unpaid run holds its people, a paid one is amended; and a move to another jurisdiction settles the old
// leave and opens the new scope. Public law packs are only the fixture: every expected figure is one the test wrote or
// the system itself produced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate, add_days } from '@norbital-ai/std/date';
import { Effect, Option, Schema } from 'effect';
import { verify } from '../src/lib/integrity.ts';
import { isJsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	pack,
	syncAll,
	uuid,
	workspace,
	storedQuery,
	storedReader
} from './kit.ts';

const NOW = '2026-03-20T02:00:00.000Z';
const RATE = 2800;
const RAISED = 3200;
const TERMS = {
	rate: { amount: RATE, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'MANUAL_LABOUR',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const FIRST = idOf('employee_contract', uuid(6));
const SECOND = idOf('employee_contract', uuid(906));
const NEXT = idOf('employee_contract', uuid(907));
const OTHER = idOf('entity', uuid(900));
const PROFILE = idOf('employee_profile', uuid(4));
/** A record as a write targets it: its id at its current revision. */
const at = <C extends string>(t: Kit, model: C, id: Id<C>) =>
	t.db
		.one(Schema.Struct({ revision: Schema.Int }), {
			text: `SELECT revision FROM ${model} WHERE id = $1`,
			params: [id]
		})
		.pipe(
			Effect.map((found) => {
				assert.ok(Option.isSome(found), `No ${model} ${id}`);
				const row = found.value;
				return { id, revision: row.revision };
			})
		);

const base = () => pack('MY', 'Asia/Kuala_Lumpur', TERMS, {}, [], []);
type Seed = ReturnType<typeof base>;
const contractOf = (seed: Seed) => seed.employee_contract?.[0] ?? {};
const employerOf = (seed: Seed) => seed.entity_profile_version?.[0] ?? {};
const groupOf = (seed: Seed) => seed.pay_group?.[0] ?? {};

/** A second person in the same company and payroll. */
const twoPeople = (): Seed => {
	const seed = base();
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
			{ ...contractOf(seed), id: SECOND, employee_id: uuid(904), employee_number: 'W2' }
		]
	};
};
/** A second company under the law `code`, with its own payroll and the employer version given. */
const withCompany = (seed: Seed, code: string, employer: Seed[string][number]): Seed => ({
	...seed,
	entity: [...(seed.entity ?? []), { id: OTHER, code: 'E2', name: 'Other', settings_code: code }],
	entity_profile_version: [
		...(seed.entity_profile_version ?? []),
		{ ...employer, id: uuid(902), entity_id: OTHER, name: 'Other' }
	],
	pay_group: [...(seed.pay_group ?? []), { ...groupOf(seed), id: uuid(908), entity_id: OTHER }]
});

const run = (t: Kit, period: string, entity: Id<'entity'> = ENTITY) =>
	t
		.as(t.admin)
		.pipe(
			Effect.flatMap((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: entity, period, kind: 'ON_CYCLE' }] })
			)
		)
		.pipe(Effect.andThen(t.run_due()));
const runs = (t: Kit) =>
	storedQuery(t, { payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) => [...got.payroll_run.rows].sort((a, b) => a.period.localeCompare(b.period)))
	);
const runOf = (t: Kit, period: string, entity: Id<'entity'> = ENTITY) =>
	runs(t).pipe(
		Effect.map((rows) => {
			const ran = rows.find((row) => row.period === period && row.entity_id === entity);
			assert.ok(ran !== undefined, `${period} did not run`);
			return ran;
		})
	);
const pay = (t: Kit, id: Id<'payroll_run'>) =>
	Effect.all([t.as(t.admin), at(t, 'payroll_run', id)]).pipe(
		Effect.flatMap(([caller, target]) =>
			caller.act({ 'payroll_run.update': [{ target, set: { state: 'PAID' } }] })
		)
	);
const drop = (t: Kit, id: Id<'payroll_run'>) =>
	Effect.all([t.as(t.admin), at(t, 'payroll_run', id)])
		.pipe(Effect.flatMap(([caller, target]) => caller.act({ 'payroll_run.delete': [{ target }] })))
		.pipe(Effect.andThen(t.run_due()));
/** The payslips of a period's run. */
const slipsOf = (t: Kit, period: string, entity: Id<'entity'> = ENTITY) =>
	Effect.gen(function* () {
		const ran = yield* runOf(t, period, entity);
		const { payslip } = yield* storedQuery(t, { payslip: { limit: 100 } });
		return payslip.rows.filter((slip) => slip.payroll_run_id === ran.id);
	});
const breakdown = (slip: { readonly breakdown: unknown } | undefined) =>
	Schema.decodeUnknownSync(PayslipBreakdown)(slip?.breakdown);
/** The contract salary a payslip opened with. */
const basicOf = (slip: { readonly breakdown: unknown } | undefined) =>
	breakdown(slip).checkpoints.find((point) => point.code === 'BASIC')?.value;
// the first run of a workspace: a contract refused under it while it is unpaid is told so by its number
const HELD = /Run 1 holds this person and is not paid yet/;
const amendments = (t: Kit) =>
	storedQuery(t, { pay_amendment: { limit: 100 } }).pipe(
		Effect.map(({ pay_amendment }) => pay_amendment.rows)
	);
const failures = (t: Kit) =>
	storedQuery(t, { obligation: { limit: 500 } }).pipe(
		Effect.map(({ obligation }) =>
			obligation.rows.map((row) => row.title).filter((title) => /failed/i.test(title))
		)
	);

const contracts = (t: Kit, status: 'DRAFT' | 'SEALED' | 'VOID') =>
	storedQuery(t, { employee_contract: { where: { status: { eq: status } }, limit: 100 } }).pipe(
		Effect.map(({ employee_contract }) => employee_contract.rows)
	);
type Version = Effect.Success<ReturnType<typeof contracts>>[number];
/** The person's open sealed version. */
const openOf = (t: Kit) =>
	contracts(t, 'SEALED').pipe(
		Effect.map((rows) => {
			const held = rows.find(
				(row) => row.employee_id === PROFILE && row.effective_range.to === null
			);
			assert.ok(held !== undefined, 'No open contract version');
			return held;
		})
	);
/** A draft successor from `from`, on the same terms or the ones given, in the same company or another. */
const draft = (
	t: Kit,
	held: Version,
	from: string,
	terms: Version['terms'] = held.terms,
	entity: Id<'entity'> = held.entity_id
) =>
	Effect.gen(function* () {
		const before = new Set((yield* contracts(t, 'DRAFT')).map((row) => row.id));
		yield* (yield* t.as(t.admin)).act({
			'employee_contract.create': [
				{
					employee_id: held.employee_id,
					entity_id: entity,
					engagement: held.engagement,
					employee_number: held.employee_number,
					terms,
					payroll: held.payroll,
					bank: held.bank,
					family: held.family,
					employee_extension_data: held.employee_extension_data,
					service_started_on: held.service_started_on,
					effective_range: { from: PlainDate(from), to: null },
					status: 'DRAFT',
					reason: 'A new version'
				}
			]
		});
		const made = (yield* contracts(t, 'DRAFT')).find((row) => !before.has(row.id));
		assert.ok(made !== undefined, 'No draft version');
		return made.id;
	});
const end = (t: Kit, held: Version, to: string) =>
	t.as(t.admin).pipe(
		Effect.flatMap((caller) =>
			caller.act({
				'employee_contract.update': [
					{
						target: held,
						set: {
							effective_range: { from: held.effective_range.from, to: PlainDate(to) },
							reason: 'Replaced'
						}
					}
				]
			})
		)
	);
const seal = (t: Kit, id: Id<'employee_contract'>) =>
	Effect.all([t.as(t.admin), at(t, 'employee_contract', id)]).pipe(
		Effect.flatMap(([caller, target]) =>
			caller.act({ 'employee_contract.update': [{ target, set: { status: 'SEALED' } }] })
		)
	);
const raised = (held: Version): Version['terms'] => ({
	...held.terms,
	rate: { unit: 'MONTHLY', amount: RAISED }
});
/** A raise from the first of a month, the way HR makes a version: the draft, the last version's end, the seal. */
const amend = (t: Kit, from: string) =>
	Effect.gen(function* () {
		const held = yield* openOf(t);
		const next = yield* draft(t, held, from, raised(held));
		yield* end(t, held, String(add_days(PlainDate(from), -1)));
		yield* seal(t, next);
		yield* t.run_due();
		return next;
	});

/** The catalogue key a refused write names; another failure answers its tag. */
const keyOf = (failure: { readonly _tag: string; readonly key?: string | undefined }) =>
	failure.key ?? failure._tag;
describe('two sealed contracts of one person', () => {
	it.live('a draft may overlap the open one; sealing it waits until that one ends', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const held = yield* openOf(t);
			const next = yield* draft(t, held, '2026-04-01');
			assert.match(String(yield* Effect.flip(seal(t, next))), /overlaps another record/);
			assert.deepEqual(
				(yield* contracts(t, 'SEALED')).map((row) => row.id),
				[FIRST]
			);
			// the way out: the earlier one gets its last day
			yield* end(t, held, '2026-03-31');
			yield* seal(t, next);
			assert.deepEqual(
				(yield* contracts(t, 'SEALED')).map((row) => row.id).sort(),
				[FIRST, next].sort()
			);
		}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);

	it.live(
		'the overlap is the person’s: an open contract blocks one in a sister company too',
		() => {
			const seed = base();
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const held = yield* openOf(t);
				const next = yield* draft(t, held, '2026-04-01', held.terms, OTHER);
				assert.match(String(yield* Effect.flip(seal(t, next))), /overlaps another record/);
				yield* end(t, held, '2026-03-31');
				yield* seal(t, next);
				assert.equal((yield* openOf(t)).entity_id, OTHER);
			}).pipe(
				Effect.provide(workspace({ seed: withCompany(seed, 'MY', employerOf(seed)), now: NOW }))
			);
		}
	);
});

describe('a contract under a run', () => {
	it.live('cannot change under an unpaid run, by the run’s number; deleting the run frees it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-02');
			const ran = yield* runOf(t, '2026-02');
			const held = yield* openOf(t);
			assert.match(String(yield* Effect.flip(end(t, held, '2026-01-31'))), HELD);
			assert.match(String(yield* Effect.flip(end(t, held, '2026-02-13'))), HELD);
			assert.deepEqual(yield* amendments(t), []);
			assert.equal(basicOf((yield* slipsOf(t, '2026-02'))[0]), RATE);
			yield* drop(t, ran.id);
			const next = yield* amend(t, '2026-02-01');
			yield* run(t, '2026-02');
			const [slip, ...others] = yield* slipsOf(t, '2026-02');
			assert.deepEqual(others, []);
			assert.equal(slip?.employment_id, next);
			assert.equal(basicOf(slip), RAISED);
		}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);

	it.live(
		'once the run is paid the change seals over it: the payslip stands and the next run takes the period up',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* run(t, '2026-02');
				const ran = yield* runOf(t, '2026-02');
				yield* pay(t, ran.id);
				yield* t.run_due();
				const next = yield* amend(t, '2026-02-01');
				// the change left one open row for the person's February
				const open = yield* amendments(t);
				assert.deepEqual(
					open.map((row) => [row.employee_id, row.period, row.payroll_run_id]),
					[[PROFILE, '2026-02', null]]
				);
				assert.match(
					String(yield* Effect.flip(drop(t, ran.id))),
					/This record is locked and cannot be changed/
				);
				yield* run(t, '2026-03');
				const [february] = yield* slipsOf(t, '2026-02');
				const [march] = yield* slipsOf(t, '2026-03');
				assert.deepEqual(
					[february?.employment_id, basicOf(february)],
					[FIRST, RATE],
					'the paid payslip is not rewritten'
				);
				assert.deepEqual([march?.employment_id, basicOf(march)], [next, RAISED]);
				assert.deepEqual(
					(yield* amendments(t)).map((row) => row.payroll_run_id),
					[(yield* runOf(t, '2026-03')).id]
				);
			}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);
});

// Break-it: a raise filed ahead of its day, and the month it starts is run before that day comes.
describe('a scheduled change and a run that got there first', () => {
	const EARLY = '2026-01-20T02:00:00.000Z';
	const hr = (t: Kit) => t.as(t.member(['hr_controller']));
	const file = (t: Kit) =>
		hr(t).pipe(
			Effect.flatMap((caller) =>
				caller.act({
					'contract_change.create': [
						{
							employee_id: PROFILE,
							field_path: 'terms.rate.amount',
							old_value: RATE,
							new_value: RAISED,
							effective_from: PlainDate('2026-02-01')
						}
					]
				})
			)
		);
	const filed = (t: Kit) =>
		storedQuery(t, { contract_change: { limit: 10 } }).pipe(
			Effect.map(({ contract_change }) => contract_change.rows)
		);
	const reach = (t: Kit, instant: string) =>
		Effect.sync(() => t.clock.set(instant)).pipe(Effect.andThen(t.run_due()));

	it.live(
		'an unpaid run: the change stays filed with a task; delete the run and seal the version',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* file(t);
				yield* run(t, '2026-02');
				const ran = yield* runOf(t, '2026-02');
				yield* reach(t, '2026-02-01T01:00:00.000Z');
				// nothing sealed under the run: the version waits as a draft, and HR is told what stood in the way
				assert.equal((yield* contracts(t, 'SEALED')).length, 1);
				const [waiting, ...more] = yield* contracts(t, 'DRAFT');
				assert.ok(waiting !== undefined);
				assert.deepEqual(more, []);
				assert.equal((yield* filed(t))[0]?.applied_version_id, null);
				const tasks = yield* failures(t);
				assert.equal(tasks.length, 1);
				assert.match(String(tasks[0]), /Contract change failed.*Run 1 holds this person/);
				assert.equal(basicOf((yield* slipsOf(t, '2026-02'))[0]), RATE);
				// the way out: the unpaid run goes, HR seals the waiting version by hand and withdraws the filed change
				yield* drop(t, ran.id);
				yield* end(t, yield* openOf(t), '2026-01-31');
				yield* seal(t, waiting.id);
				yield* t.run_due();
				const next = waiting.id;
				const [change] = yield* filed(t);
				assert.ok(change !== undefined);
				yield* (yield* hr(t)).act({ 'contract_change.delete': [{ target: change }] });
				yield* run(t, '2026-02');
				const [slip] = yield* slipsOf(t, '2026-02');
				assert.deepEqual([slip?.employment_id, basicOf(slip)], [next, RAISED]);
				// nothing is left to fire on a later day
				yield* reach(t, '2026-02-02T01:00:00.000Z');
				assert.equal((yield* failures(t)).length, 1);
				assert.equal((yield* contracts(t, 'SEALED')).length, 2);
			}).pipe(Effect.provide(workspace({ seed: base(), now: EARLY })))
	);

	it.live('a paid run: the change moves to the next month and seals there', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* file(t);
			yield* run(t, '2026-02');
			yield* pay(t, (yield* runOf(t, '2026-02')).id);
			yield* reach(t, '2026-02-01T01:00:00.000Z');
			assert.equal((yield* contracts(t, 'SEALED')).length, 1);
			assert.equal((yield* failures(t)).length, 1);
			const [change] = yield* filed(t);
			assert.ok(change !== undefined);
			yield* (yield* hr(t)).act({
				'contract_change.update': [
					{ target: change, set: { effective_from: PlainDate('2026-03-01') } }
				]
			});
			yield* reach(t, '2026-03-01T01:00:00.000Z');
			const open = yield* openOf(t);
			assert.equal(String(open.effective_range.from), '2026-03-01');
			assert.equal((yield* filed(t))[0]?.applied_version_id, open.id);
			assert.equal((yield* failures(t)).length, 1);
			yield* run(t, '2026-03');
			assert.equal(basicOf((yield* slipsOf(t, '2026-02'))[0]), RATE);
			assert.equal(basicOf((yield* slipsOf(t, '2026-03'))[0]), RAISED);
		}).pipe(Effect.provide(workspace({ seed: base(), now: EARLY })))
	);
});

// transfer-semantics.md §2.6 and §4: a void needs a reason and is final; a record a run captured may still be voided,
// the payslips it left stand, and no later run uses it.
describe('a void contract', () => {
	const voided = (t: Kit, id: Id<'employee_contract'>, reason?: string) =>
		Effect.all([t.as(t.admin), at(t, 'employee_contract', id)]).pipe(
			Effect.flatMap(([caller, target]) =>
				caller.act({
					'employee_contract.update': [
						{
							target,
							set: { status: 'VOID', ...(reason === undefined ? {} : { reason }) }
						}
					]
				})
			)
		);

	it.live('needs a reason, keeps what a paid run paid it, and the next run leaves it out', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-01');
			yield* pay(t, (yield* runOf(t, '2026-01')).id);
			yield* t.run_due();
			assert.equal(
				keyOf(yield* Effect.flip(voided(t, SECOND))),
				'errors.employee_contract_void_reason'
			);
			yield* voided(t, SECOND, 'Entered for the wrong person');
			yield* t.run_due();
			assert.deepEqual(
				(yield* contracts(t, 'VOID')).map((row) => row.id),
				[SECOND]
			);
			assert.deepEqual(
				(yield* slipsOf(t, '2026-01')).map((slip) => slip.employment_id).sort(),
				[FIRST, SECOND].sort()
			);
			yield* run(t, '2026-02');
			assert.deepEqual(
				(yield* slipsOf(t, '2026-02')).map((slip) => slip.employment_id),
				[FIRST]
			);
			assert.deepEqual(yield* failures(t), []);
		}).pipe(Effect.provide(workspace({ seed: twoPeople(), now: NOW })))
	);

	// Break-it: the person's only version is void. The way forward is a new contract for the same dates.
	it.live(
		'the only version: it stays void, and a replacement for its dates seals and is paid',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const held = yield* openOf(t);
				yield* voided(t, FIRST, 'Wrong terms');
				yield* t.run_due();
				assert.deepEqual(yield* contracts(t, 'SEALED'), []);
				const back = yield* Effect.result(seal(t, FIRST));
				assert.equal(back._tag, 'Failure', 'a void contract was sealed again');
				assert.deepEqual(
					(yield* contracts(t, 'VOID')).map((row) => row.id),
					[FIRST]
				);
				const next = yield* draft(t, held, String(held.effective_range.from), raised(held));
				yield* seal(t, next);
				yield* t.run_due();
				yield* run(t, '2026-02');
				const [slip, ...others] = yield* slipsOf(t, '2026-02');
				assert.deepEqual(others, []);
				assert.deepEqual([slip?.employment_id, basicOf(slip)], [next, RAISED]);
				assert.deepEqual(yield* failures(t), []);
			}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);

	// Break-it: void the version a sealed successor follows.
	it.live('a predecessor: its successor stands, pays, and is no exit', () => {
		const seed = base();
		const chain: Seed = {
			...seed,
			employee_contract: [
				{ ...contractOf(seed), effective_range: { from: '2025-01-01', to: '2026-01-31' } },
				{ ...contractOf(seed), id: NEXT, effective_range: { from: '2026-02-01', to: null } }
			]
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* voided(t, FIRST, 'Superseded in error');
			yield* t.run_due();
			assert.equal((yield* openOf(t)).id, NEXT);
			const { leave_catalog_entry } = yield* storedQuery(t, {
				leave_catalog_entry: { where: { encashment: { eq: true } }, limit: 10 }
			});
			assert.deepEqual(leave_catalog_entry.rows, []);
			yield* run(t, '2026-02');
			assert.deepEqual(
				(yield* slipsOf(t, '2026-02')).map((slip) => slip.employment_id),
				[NEXT]
			);
			assert.deepEqual(yield* failures(t), []);
		}).pipe(Effect.provide(workspace({ seed: chain, now: NOW })));
	});
});

describe('a void employer version', () => {
	const EMPLOYER = idOf('entity_profile_version', uuid(2));
	const voided = (t: Kit, id: Id<'entity_profile_version'>, reason?: string) =>
		Effect.all([t.as(t.admin), at(t, 'entity_profile_version', id)]).pipe(
			Effect.flatMap(([caller, target]) =>
				caller.act({
					'entity_profile_version.update': [
						{
							target,
							set: { status: 'VOID', ...(reason === undefined ? {} : { reason }) }
						}
					]
				})
			)
		);
	const stored = (t: Kit) =>
		storedQuery(t, { entity_profile_version: { limit: 10 } }).pipe(
			Effect.map(({ entity_profile_version }) => entity_profile_version.rows)
		);

	it.live('under a paid run: the payslip stands, no later run uses it, a replacement does', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-01');
			yield* pay(t, (yield* runOf(t, '2026-01')).id);
			yield* t.run_due();
			const [paid] = yield* slipsOf(t, '2026-01');
			assert.ok(paid !== undefined);
			assert.equal(
				keyOf(yield* Effect.flip(voided(t, EMPLOYER))),
				'errors.entity_profile_version_void_reason'
			);
			yield* voided(t, EMPLOYER, 'Wrong registration');
			yield* t.run_due();
			const [held] = yield* stored(t);
			assert.ok(held !== undefined);
			assert.equal(held.status, 'VOID');
			assert.deepEqual(
				(yield* slipsOf(t, '2026-01')).map((slip) => [slip.id, String(slip.net_pay)]),
				[[paid.id, String(paid.net_pay)]]
			);
			assert.match(
				String(yield* Effect.flip(run(t, '2026-02'))),
				/No sealed entity version covers 2026-02/
			);
			// the void left the paid month to be worked out again
			assert.deepEqual(
				(yield* amendments(t)).map((row) => [row.period, row.payroll_run_id]),
				[['2026-01', null]]
			);
			// the way out: a replacement for the dates the void one covered, drafted and sealed
			yield* (yield* t.as(t.admin)).act({
				'entity_profile_version.create': [
					{
						entity_id: held.entity_id,
						name: held.name,
						settings_code: held.settings_code,
						input_schema_version_id: held.input_schema_version_id,
						time_zone: held.time_zone,
						entity_extension_data: held.entity_extension_data,
						effective_range: { from: held.effective_range.from, to: null },
						status: 'DRAFT'
					}
				]
			});
			const made = (yield* stored(t)).find((row) => row.status === 'DRAFT');
			assert.ok(made !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'entity_profile_version.update': [{ target: made, set: { status: 'SEALED' } }]
			});
			yield* t.run_due();
			yield* run(t, '2026-02');
			assert.equal((yield* slipsOf(t, '2026-02')).length, 1);
		}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);

	// Break-it: void the version a sealed successor follows.
	it.live('a predecessor: its own months no longer run, the successor’s do', () => {
		const seed = base();
		const chain: Seed = {
			...seed,
			entity_profile_version: [
				{ ...employerOf(seed), effective_range: { from: '2025-01-01', to: '2026-01-31' } },
				{ ...employerOf(seed), id: uuid(902), effective_range: { from: '2026-02-01', to: null } }
			]
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* voided(t, EMPLOYER, 'Superseded in error');
			yield* t.run_due();
			assert.match(
				String(yield* Effect.flip(run(t, '2026-01'))),
				/No sealed entity version covers 2026-01/
			);
			yield* run(t, '2026-02');
			assert.equal((yield* slipsOf(t, '2026-02')).length, 1);
		}).pipe(Effect.provide(workspace({ seed: chain, now: NOW })));
	});
});

describe('a void law version', () => {
	const seed = base();
	/** The MY version in force on a day, from the fixture's own rows. */
	const lawOn = (day: string) => {
		const row = (seed.jurisdiction_settings ?? []).find((version) => {
			const range = version.effective_range;
			return (
				isJsonObject(range) &&
				String(range.from) <= day &&
				(range.to === null || day <= String(range.to))
			);
		});
		assert.ok(row !== undefined, `No law on ${day}`);
		return idOf('jurisdiction_settings', row.id);
	};
	const voided = (t: Kit, id: Id<'jurisdiction_settings'>, reason?: string) =>
		Effect.all([t.as(t.admin), at(t, 'jurisdiction_settings', id)]).pipe(
			Effect.flatMap(([caller, target]) =>
				caller.act({
					'jurisdiction_settings.update': [
						{
							target,
							set: { status: 'VOID', ...(reason === undefined ? {} : { reason }) }
						}
					]
				})
			)
		);

	it.live('under a paid run: the run stands, and the next is refused by law and pay date', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const law = lawOn('2026-02-15');
			yield* run(t, '2026-01');
			const january = yield* runOf(t, '2026-01');
			assert.equal(january.settings_id, law);
			yield* pay(t, january.id);
			yield* t.run_due();
			assert.equal(keyOf(yield* Effect.flip(voided(t, law))), 'errors.jurisdiction_void_reason');
			yield* voided(t, law, 'Sealed with the wrong table');
			yield* t.run_due();
			const after = yield* runOf(t, '2026-01');
			assert.deepEqual([after.state, after.settings_id], ['PAID', law]);
			assert.equal((yield* slipsOf(t, '2026-01')).length, 1);
			const refused = yield* Effect.flip(run(t, '2026-02'));
			assert.match(String(refused), /No sealed MY law covers 2026-02-\d\d/);
			assert.equal((yield* runs(t)).length, 1);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);

	// Break-it: void the version a sealed successor follows.
	it.live('a predecessor: the version in force still covers its runs', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* voided(t, lawOn('2025-12-15'), 'Superseded in error');
			yield* t.run_due();
			yield* run(t, '2026-02');
			assert.equal((yield* runOf(t, '2026-02')).settings_id, lawOn('2026-02-15'));
			assert.equal((yield* slipsOf(t, '2026-02')).length, 1);
			assert.deepEqual(yield* failures(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

// transfer-semantics.md §3.1 and §4. The person moves from the Malaysian company to the Singapore one on 1 November:
// Malaysia's annual leave has a `payout`, so Malaysia's last payslip pays out the days left and Singapore opens its own
// keys.
describe('a transfer across jurisdictions, in one flow', () => {
	const LATE = '2026-11-20T02:00:00.000Z';
	const OFFICE = {
		rate: { amount: 8000, unit: 'MONTHLY' },
		normal_hours_per_day: 8,
		normal_hours_per_week: 40,
		normal_days_per_week: 5,
		statutory_work_category: 'NON_MANUAL',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	};
	const WORKSPACE = new Set([
		'entity',
		'pay_group',
		'entity_profile_version',
		'sys_user',
		'employee_profile',
		'employee_balance',
		'employee_contract',
		'shift_definition',
		'holiday',
		'roster_entry'
	]);
	const my = pack('MY', 'Asia/Kuala_Lumpur', OFFICE, {}, [], [], '2026-11-15');
	const sg = pack('SG', 'Asia/Singapore', OFFICE, {}, [], [], '2026-11-15');
	// both laws' public rows, and the Singapore company beside the Malaysian one
	const seed: Seed = withCompany(
		{
			...my,
			...Object.fromEntries(
				Object.entries(sg)
					.filter(([name]) => !WORKSPACE.has(name))
					.map(([name, rows]) => [name, [...(my[name] ?? []), ...rows]])
			)
		},
		'SG',
		employerOf(sg)
	);
	const cashOuts = (t: Kit) =>
		storedQuery(t, {
			leave_catalog_entry: { where: { encashment: { eq: true } }, limit: 10 }
		}).pipe(Effect.map(({ leave_catalog_entry }) => leave_catalog_entry.rows));
	const annualLines = (slips: readonly { readonly breakdown: unknown }[]) =>
		slips.flatMap((slip) => breakdown(slip).lines.filter((line) => line.code === 'ANNUAL_LEAVE'));
	/** What the annual-leave keys of one scope hold of a measure. */
	const annual = (t: Kit, scope: string, measure: string) =>
		accountsIn(t).pipe(
			Effect.map((accounts) =>
				Object.entries(accounts.leave?.['ANNUAL_LEAVE'] ?? {})
					.filter(([period]) => period.startsWith(`${scope}.`))
					.reduce((total, [, measures]) => total + (measures[measure] ?? 0), 0)
			)
		);
	const netYears = (t: Kit) =>
		accountsIn(t).pipe(Effect.map((accounts) => accounts.pay?.['NET'] ?? {}));

	it.live(
		'the old leave is cashed out in the old law’s last run and the new scope opens empty',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				assert.ok((yield* annual(t, 'MY', 'entitled')) > 0);
				const held = yield* openOf(t);
				// the transfer sheet's three writes: the draft in the new company, the last day, the seal
				yield* (yield* t.as(t.admin)).act({
					'employee_contract.create': [
						{
							employee_id: held.employee_id,
							entity_id: OTHER,
							engagement: held.engagement,
							employee_number: held.employee_number,
							terms: held.terms,
							payroll: held.payroll,
							bank: held.bank,
							employee_extension_data: { race: 'CHINESE' },
							// service the group credits: Singapore's leave needs three months behind it
							service_started_on: held.service_started_on,
							effective_range: { from: PlainDate('2026-11-01'), to: null },
							status: 'DRAFT',
							reason: 'Transfer to Singapore'
						}
					]
				});
				const [moving] = yield* contracts(t, 'DRAFT');
				assert.ok(moving !== undefined);
				yield* end(t, held, '2026-10-31');
				yield* seal(t, moving.id);
				yield* t.run_due();

				// nothing is keyed: Malaysia's last payslip settles what is left of its year itself
				assert.deepEqual(yield* cashOuts(t), []);
				const days = (yield* annual(t, 'MY', 'entitled')) - (yield* annual(t, 'MY', 'used'));
				assert.ok(days > 0);

				// Malaysia's last run pays those days and uses them up; Singapore's first run pays none of them
				yield* run(t, '2026-10');
				const last = yield* slipsOf(t, '2026-10');
				assert.deepEqual(
					last.map((slip) => slip.employment_id),
					[FIRST]
				);
				assert.deepEqual(
					annualLines(last).map((line) => line.direction),
					['ADD']
				);
				assert.deepEqual(
					// under the old scope's window: the new scope's leave is not the old payslip's to settle
					(breakdown(last[0]).cash_out ?? []).map((row) => [
						row.code,
						row.period.split('.')[0],
						row.amount
					]),
					[['ANNUAL_LEAVE', 'MY', days]]
				);
				// the payslip posts the days as used once the run is paid
				yield* pay(t, (yield* runOf(t, '2026-10')).id);
				yield* t.run_due();
				const used = yield* annual(t, 'MY', 'used');
				assert.equal(yield* annual(t, 'MY', 'entitled'), used);
				const before = yield* netYears(t);
				yield* run(t, '2026-11', OTHER);
				const first = yield* slipsOf(t, '2026-11', OTHER);
				assert.deepEqual(
					first.map((slip) => slip.employment_id),
					[moving.id]
				);
				assert.deepEqual(annualLines(first), []);

				// the keys carry the scope: Malaysia's year stops where it was, Singapore's starts with this run alone
				const after = yield* netYears(t);
				const scopes = (years: typeof after, scope: string) =>
					Object.entries(years).filter(([period]) => period.startsWith(`${scope}.`));
				assert.deepEqual(scopes(after, 'MY'), scopes(before, 'MY'));
				assert.deepEqual(scopes(before, 'SG'), []);
				assert.ok(scopes(after, 'SG').some(([, measures]) => (measures['total'] ?? 0) > 0));

				// and the leave: Singapore's own entitlement, with nothing used: Malaysia's days stay under Malaysia's keys
				yield* syncAll(t);
				assert.ok((yield* annual(t, 'SG', 'entitled')) > 0);
				assert.equal(yield* annual(t, 'SG', 'used'), 0);
				assert.equal(yield* annual(t, 'MY', 'used'), used);
				assert.deepEqual(yield* cashOuts(t), []);
				assert.deepEqual(yield* failures(t), []);
				assert.deepEqual((yield* t.run_due()).failed, []);
				assert.deepEqual(
					(yield* verify(storedReader(t), LATE.slice(0, 10)))
						.filter((finding) => finding.invariant !== 'W1')
						.map((finding) => `${finding.invariant} ${finding.message}`),
					[]
				);
			}).pipe(Effect.provide(workspace({ seed, now: LATE })))
	);
});
