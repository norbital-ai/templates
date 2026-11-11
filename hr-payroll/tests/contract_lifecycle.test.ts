// The life of a version: DRAFT → SEALED → VOID for a contract, an employer version and a law version; two sealed contracts
// of one person never overlap; a run holds the contracts it paid; and a move to another jurisdiction settles the old
// leave and opens the new scope. Public law packs are only the fixture: every expected figure is one the test wrote or
// the system itself produced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate, addDays } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { isJsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, accountsIn, pack, syncAll, uuid, workspace } from './kit.ts';

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
		.act('payroll_run.create', [{ entity_id: entity, period, kind: 'ON_CYCLE' }])
		.pipe(Effect.andThen(t.runDue()));
const runs = (t: Kit) =>
	t
		.storedQuery({ payroll_run: { limit: 100 } })
		.pipe(
			Effect.map((got) =>
				[...got.payroll_run.rows].sort((a, b) => a.period.localeCompare(b.period))
			)
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
	t.as(t.admin).act('payroll_run.update', [{ target: id, set: { state: 'PAID' } }]);
const drop = (t: Kit, id: Id<'payroll_run'>) =>
	t
		.as(t.admin)
		.act('payroll_run.delete', [{ target: id }])
		.pipe(Effect.andThen(t.runDue()));
/** The payslips of a period's run. */
const slipsOf = (t: Kit, period: string, entity: Id<'entity'> = ENTITY) =>
	Effect.gen(function* () {
		const ran = yield* runOf(t, period, entity);
		const { payslip } = yield* t.storedQuery({ payslip: { limit: 100 } });
		return payslip.rows.filter((slip) => slip.payroll_run_id === ran.id);
	});
const breakdown = (slip: { readonly breakdown: unknown } | undefined) =>
	Schema.decodeUnknownSync(PayslipBreakdown)(slip?.breakdown);
/** The contract salary a payslip opened with. */
const basicOf = (slip: { readonly breakdown: unknown } | undefined) =>
	breakdown(slip).checkpoints.find((point) => point.code === 'BASIC')?.value;
// the first run of a workspace: a contract refused under it is told so by its number
const CAPTURED = /Payroll run 1 already captured this period/;
const failures = (t: Kit) =>
	t
		.storedQuery({ obligation: { limit: 500 } })
		.pipe(
			Effect.map(({ obligation }) =>
				obligation.rows.map((row) => row.title).filter((title) => /failed/i.test(title))
			)
		);

const contracts = (t: Kit, status: 'DRAFT' | 'SEALED' | 'VOID') =>
	t
		.storedQuery({ employee_contract: { where: { status: { eq: status } }, limit: 100 } })
		.pipe(Effect.map(({ employee_contract }) => employee_contract.rows));
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
		yield* t.as(t.admin).act('employee_contract.create', [
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
		]);
		const made = (yield* contracts(t, 'DRAFT')).find((row) => !before.has(row.id));
		assert.ok(made !== undefined, 'No draft version');
		return made.id;
	});
const end = (t: Kit, held: Version, to: string) =>
	t.as(t.admin).act('employee_contract.update', [
		{
			target: held.id,
			set: {
				effective_range: { from: held.effective_range.from, to: PlainDate(to) },
				reason: 'Replaced'
			}
		}
	]);
const seal = (t: Kit, id: Id<'employee_contract'>) =>
	t.as(t.admin).act('employee_contract.update', [{ target: id, set: { status: 'SEALED' } }]);
const raised = (held: Version): Version['terms'] => ({
	...held.terms,
	rate: { unit: 'MONTHLY', amount: RAISED }
});
/** A raise from the first of a month, the way HR makes a version: the draft, the last version's end, the seal. */
const amend = (t: Kit, from: string) =>
	Effect.gen(function* () {
		const held = yield* openOf(t);
		const next = yield* draft(t, held, from, raised(held));
		yield* end(t, held, String(addDays(PlainDate(from), -1)));
		yield* seal(t, next);
		yield* t.runDue();
		return next;
	});

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
	it.live(
		'cannot change inside the period, by the run’s number; deleting the unpaid run frees it',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* run(t, '2026-02');
				const ran = yield* runOf(t, '2026-02');
				const held = yield* openOf(t);
				assert.match(
					String(yield* Effect.flip(draft(t, held, '2026-02-01', raised(held)))),
					CAPTURED
				);
				assert.match(String(yield* Effect.flip(end(t, held, '2026-02-13'))), CAPTURED);
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

	it.live('once the run is paid nothing frees it, and the change starts after it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-02');
			const ran = yield* runOf(t, '2026-02');
			yield* pay(t, ran.id);
			yield* t.runDue();
			assert.match(String(yield* Effect.flip(amend(t, '2026-02-01'))), CAPTURED);
			assert.match(String(yield* Effect.flip(drop(t, ran.id))), /A paid run is locked/);
			assert.deepEqual(yield* contracts(t, 'DRAFT'), []);
			// the way out: the same raise from the first month the run does not hold
			const next = yield* amend(t, '2026-03-01');
			yield* run(t, '2026-03');
			const [february] = yield* slipsOf(t, '2026-02');
			const [march] = yield* slipsOf(t, '2026-03');
			assert.deepEqual(
				[february?.employment_id, basicOf(february)],
				[FIRST, RATE],
				'the paid payslip is not rewritten'
			);
			assert.deepEqual([march?.employment_id, basicOf(march)], [next, RAISED]);
		}).pipe(Effect.provide(workspace({ seed: base(), now: NOW })))
	);
});

// Break-it: a raise filed ahead of its day, and the month it starts is run before that day comes.
describe('a scheduled change and a run that got there first', () => {
	const EARLY = '2026-01-20T02:00:00.000Z';
	const hr = (t: Kit) => t.as(t.member(['hr_controller']));
	const file = (t: Kit) =>
		hr(t).act('contract_change.create', [
			{
				employee_id: PROFILE,
				field_path: 'terms.rate.amount',
				old_value: RATE,
				new_value: RAISED,
				effective_from: PlainDate('2026-02-01')
			}
		]);
	const filed = (t: Kit) =>
		t
			.storedQuery({ contract_change: { limit: 10 } })
			.pipe(Effect.map(({ contract_change }) => contract_change.rows));
	const reach = (t: Kit, instant: string) =>
		Effect.sync(() => t.clock.set(instant)).pipe(Effect.andThen(t.runDue()));

	it.live(
		'an unpaid run: the change stays filed with a task; delete the run and make the version',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* file(t);
				yield* run(t, '2026-02');
				const ran = yield* runOf(t, '2026-02');
				yield* reach(t, '2026-02-01T01:00:00.000Z');
				// nothing sealed under the run, and HR is told what stood in the way
				assert.equal((yield* contracts(t, 'SEALED')).length, 1);
				assert.deepEqual(yield* contracts(t, 'DRAFT'), []);
				assert.equal((yield* filed(t))[0]?.applied_version_id, null);
				const tasks = yield* failures(t);
				assert.equal(tasks.length, 1);
				assert.match(String(tasks[0]), /Contract change failed.*already captured this period/);
				assert.equal(basicOf((yield* slipsOf(t, '2026-02'))[0]), RATE);
				// the way out: the unpaid run goes, HR makes the version due now by hand and withdraws the filed change
				yield* drop(t, ran.id);
				const next = yield* amend(t, '2026-02-01');
				const [change] = yield* filed(t);
				assert.ok(change !== undefined);
				yield* hr(t).act('contract_change.delete', [{ target: change.id }]);
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
			yield* hr(t).act('contract_change.update', [
				{ target: change.id, set: { effective_from: PlainDate('2026-03-01') } }
			]);
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
		t.as(t.admin).act('employee_contract.update', [
			{
				target: id,
				set: { status: 'VOID', ...(reason === undefined ? {} : { reason }) }
			}
		]);

	it.live('needs a reason, keeps what a paid run paid it, and the next run leaves it out', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-01');
			yield* pay(t, (yield* runOf(t, '2026-01')).id);
			yield* t.runDue();
			assert.match(
				String(yield* Effect.flip(voided(t, SECOND))),
				/Record why this contract is void/
			);
			yield* voided(t, SECOND, 'Entered for the wrong person');
			yield* t.runDue();
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
				yield* t.runDue();
				assert.deepEqual(yield* contracts(t, 'SEALED'), []);
				const back = yield* Effect.result(seal(t, FIRST));
				assert.equal(back._tag, 'Failure', 'a void contract was sealed again');
				assert.deepEqual(
					(yield* contracts(t, 'VOID')).map((row) => row.id),
					[FIRST]
				);
				const next = yield* draft(t, held, String(held.effective_range.from), raised(held));
				yield* seal(t, next);
				yield* t.runDue();
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
			yield* t.runDue();
			assert.equal((yield* openOf(t)).id, NEXT);
			const { leave_catalog_entry } = yield* t.storedQuery({
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
		t.as(t.admin).act('entity_profile_version.update', [
			{
				target: id,
				set: { status: 'VOID', ...(reason === undefined ? {} : { reason }) }
			}
		]);
	const stored = (t: Kit) =>
		t
			.storedQuery({ entity_profile_version: { limit: 10 } })
			.pipe(Effect.map(({ entity_profile_version }) => entity_profile_version.rows));

	it.live('under a paid run: the payslip stands, no later run uses it, a replacement does', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-01');
			yield* pay(t, (yield* runOf(t, '2026-01')).id);
			yield* t.runDue();
			const [paid] = yield* slipsOf(t, '2026-01');
			assert.ok(paid !== undefined);
			assert.match(
				String(yield* Effect.flip(voided(t, EMPLOYER))),
				/Record why this version is void/
			);
			yield* voided(t, EMPLOYER, 'Wrong registration');
			yield* t.runDue();
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
			// the way out: a dated replacement, drafted and sealed
			yield* t.as(t.admin).act('entity_profile_version.create', [
				{
					entity_id: held.entity_id,
					name: held.name,
					settings_code: held.settings_code,
					input_schema_version_id: held.input_schema_version_id,
					time_zone: held.time_zone,
					entity_extension_data: held.entity_extension_data,
					effective_range: { from: PlainDate('2026-02-01'), to: null },
					status: 'DRAFT'
				}
			]);
			const made = (yield* stored(t)).find((row) => row.status === 'DRAFT');
			assert.ok(made !== undefined);
			yield* t
				.as(t.admin)
				.act('entity_profile_version.update', [{ target: made.id, set: { status: 'SEALED' } }]);
			yield* t.runDue();
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
			yield* t.runDue();
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
		t.as(t.admin).act('jurisdiction_settings.update', [
			{
				target: id,
				set: { status: 'VOID', ...(reason === undefined ? {} : { reason }) }
			}
		]);

	it.live('under a paid run: the run stands, and the next is refused by law and pay date', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const law = lawOn('2026-02-15');
			yield* run(t, '2026-01');
			const january = yield* runOf(t, '2026-01');
			assert.equal(january.settings_id, law);
			yield* pay(t, january.id);
			yield* t.runDue();
			assert.match(
				String(yield* Effect.flip(voided(t, law))),
				/Record why this configuration is void/
			);
			yield* voided(t, law, 'Sealed with the wrong table');
			yield* t.runDue();
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
			yield* t.runDue();
			yield* run(t, '2026-02');
			assert.equal((yield* runOf(t, '2026-02')).settings_id, lawOn('2026-02-15'));
			assert.equal((yield* slipsOf(t, '2026-02')).length, 1);
			assert.deepEqual(yield* failures(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

// transfer-semantics.md §3.1 and §4. The person moves from the Malaysian company to the Singapore one on 1 November:
// Malaysia's annual leave has a `payout`, so the days left are cashed out in Malaysia's last run and Singapore opens
// its own keys.
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
	// the cash-out's review names the HR controller team: a member of it decides
	const flow: Seed = {
		...seed,
		sys_user: [
			...(seed.sys_user ?? []),
			{
				id: uuid(41),
				name: 'Payroll',
				email: 'payroll@example.test',
				kind: 'staff',
				team: 'hr_controller'
			}
		]
	};
	const cashOuts = (t: Kit) =>
		t
			.storedQuery({ leave_catalog_entry: { where: { encashment: { eq: true } }, limit: 10 } })
			.pipe(Effect.map(({ leave_catalog_entry }) => leave_catalog_entry.rows));
	const postedBy = (t: Kit, entry: Id<'leave_catalog_entry'>) =>
		t
			.storedQuery({
				ledger_entry: { where: { source: { eq: `leave_catalog_entry:${entry}` } }, limit: 1000 }
			})
			.pipe(Effect.map(({ ledger_entry }) => ledger_entry.rows));
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
				yield* t.as(t.admin).act('employee_contract.create', [
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
				]);
				const [moving] = yield* contracts(t, 'DRAFT');
				assert.ok(moving !== undefined);
				yield* end(t, held, '2026-10-31');
				yield* seal(t, moving.id);
				yield* t.runDue();

				// one cash-out, on the contract that ended, waiting for HR: nothing has posted
				const [request, ...more] = yield* cashOuts(t);
				assert.ok(request !== undefined);
				assert.deepEqual(more, []);
				assert.deepEqual([request.employment_id, request.entity_id], [FIRST, ENTITY]);
				assert.deepEqual(yield* postedBy(t, request.id), []);
				const requestId = request.$approval?.requestId;
				assert.ok(requestId !== undefined);
				yield* t
					.as(yield* t.signIn('payroll@example.test'))
					.approvals.decide(requestId, { decision: 'approve' });
				yield* t.runDue();
				const { leave_catalog_entry_day: slots } = yield* t.storedQuery({
					leave_catalog_entry_day: { where: { leave_entry_id: { eq: request.id } }, limit: 1000 }
				});
				const days = slots.rows.length / 2;
				assert.ok(days > 0);
				const posted = yield* postedBy(t, request.id);
				assert.ok(posted.length > 0);
				assert.ok(
					posted.every((row) => String(row.period).startsWith('MY.')),
					'the cash-out posts under the old scope'
				);
				assert.equal(yield* annual(t, 'MY', 'used'), days);

				// Malaysia's last run pays those days; Singapore's first run pays none of them
				yield* run(t, '2026-10');
				const last = yield* slipsOf(t, '2026-10');
				assert.deepEqual(
					last.map((slip) => slip.employment_id),
					[FIRST]
				);
				assert.deepEqual(
					annualLines(last).map((line) => [line.direction, Number(line.quantity)]),
					[['ADD', days]]
				);
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
				assert.equal(yield* annual(t, 'MY', 'used'), days);
				// a repeat raises nothing twice
				assert.equal((yield* cashOuts(t)).length, 1);
				assert.deepEqual(yield* failures(t), []);
			}).pipe(Effect.provide(workspace({ seed: flow, now: LATE })))
	);
});
