// A no-pay day is a catalog line. One a paid run priced is corrected on the entry itself: the write leaves the month to
// be worked out again, and the next run carries the difference, once. Malaysia's law pack is only the fixture: every
// expected amount is the fixture's own input or what the run itself produced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf, objectValue } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace, leaveCreate, storedQuery } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const NOW = '2026-06-20T02:00:00.000Z';
const SALARY = 3120;
const ALLOWANCE = 300;
const terms = (allowances: Record<string, { readonly amount: number }> = {}) =>
	({
		rate: { amount: SALARY, unit: 'MONTHLY' },
		normal_hours_per_day: 8,
		normal_hours_per_week: 40,
		normal_days_per_week: 5,
		statutory_work_category: 'MANUAL_LABOUR',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances
	}) as const;
type Seed = ReturnType<typeof pack>;
const malaysia = (allowances = {}): Seed =>
	pack('MY', 'Asia/Kuala_Lumpur', terms(allowances), {}, [], [], '2026-06-15');
const noPay = (seed: Seed) => {
	const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
	const row = seed.leave_catalog?.find(
		(item) => item.code === 'NPL' && item.settings_id === version
	);
	assert.ok(row !== undefined);
	return idOf('leave_catalog', String(row.id));
};
const whole = (date: string) => [
	{ date: PlainDate(date), part: 'AM' as const },
	{ date: PlainDate(date), part: 'PM' as const }
];
const entry = (t: Kit, seed: Seed, days: ReturnType<typeof whole>) =>
	t.as(t.admin).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: noPay(seed),
						days
					})
				]
			})
		)
	);
const run = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.pipe(
			Effect.andThen((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
			)
		)
		.pipe(Effect.andThen(t.run_due()));
/** The period's run, paid: a record of the period corrected after it leaves an amendment row. */
const pay = (t: Kit, period: string) =>
	Effect.gen(function* () {
		yield* run(t, period);
		const [ran] = (yield* storedQuery(t, {
			payroll_run: { where: { period: { eq: period } }, limit: 1 }
		})).payroll_run.rows;
		assert.ok(ran !== undefined);
		yield* t
			.as(t.admin)
			.pipe(
				Effect.andThen((caller) =>
					caller.act({ 'payroll_run.update': [{ target: ran, set: { state: 'PAID' } }] })
				)
			);
		yield* t.run_due();
		return ran;
	});
/** Every amendment row: its paid period, and the run that took it (none while it is open). */
const amendments = (t: Kit) =>
	storedQuery(t, { pay_amendment: { limit: 100 } }).pipe(
		Effect.map(({ pay_amendment }) =>
			pay_amendment.rows.map((row) => [row.period, row.payroll_run_id ?? null])
		)
	);
const paid = (t: Kit, period: string) =>
	storedQuery(t, { payslip: { limit: 12 } }).pipe(
		Effect.map((got) => {
			const lines = got.payslip.rows
				.filter((slip) => slip.period === period)
				.flatMap((slip) => Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown).lines);
			return Object.fromEntries(
				lines
					.filter((line) => ['BASIC', 'SUA', 'NPL'].includes(line.code))
					.map((line) => [
						line.code,
						Number(line.amount.toFixed(2)) * (line.direction === 'DEDUCT' ? -1 : 1)
					])
			);
		})
	);

describe('a no-pay day', () => {
	const inMonth = (seed: Seed, now = NOW) => workspace({ seed, now });
	/** What June's run takes for these slots, in a workspace of its own. */
	const taken = (seed: Seed, days: ReturnType<typeof whole>) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* entry(t, seed, days);
			yield* run(t, '2026-06');
			return (yield* paid(t, '2026-06'))['NPL'] ?? 0;
		}).pipe(Effect.provide(inMonth(seed)));

	it.live(
		'comes off as a line, the salary stands, and a fixed allowance loses the same share',
		() => {
			const seed = malaysia({ SUA: { amount: ALLOWANCE } });
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* entry(t, seed, whole('2026-06-10'));
				yield* run(t, '2026-06');
				// BASIC stays the contract salary: the day is the NPL line, and the allowance loses its own share
				const { BASIC, NPL = 0, SUA = 0 } = yield* paid(t, '2026-06');
				assert.equal(BASIC, SALARY);
				assert.ok(NPL < 0 && -NPL < SALARY, String(NPL));
				assert.ok(Math.abs(SUA - ALLOWANCE * (1 + NPL / SALARY)) < 0.01, String(SUA));
			}).pipe(Effect.provide(inMonth(seed)));
		}
	);

	it.live(
		'under an unpaid run the entry does not move; once the run is paid, a day added leaves the month to be worked out again',
		() => {
			const seed = malaysia();
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* entry(t, seed, whole('2026-06-10'));
				yield* run(t, '2026-06');
				const [held] = (yield* storedQuery(t, { leave_catalog_entry: { limit: 1 } }))
					.leave_catalog_entry.rows;
				assert.ok(held !== undefined);
				const add = t.as(t.admin).pipe(
					Effect.andThen((caller) =>
						caller.act({
							'leave_catalog_entry.update': [
								{
									target: held,
									set: {
										leave_catalog_entry_day: {
											create: [{ incurred_on: PlainDate('2026-06-11'), part: 'AM' }]
										}
									}
								}
							]
						})
					)
				);
				assert.match(
					String(yield* Effect.flip(add)),
					/Run \d+ holds this person and is not paid yet\. Delete it, correct this, and run again\./
				);
				const [ran] = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows;
				assert.ok(ran !== undefined);
				yield* t
					.as(t.admin)
					.pipe(
						Effect.andThen((caller) =>
							caller.act({ 'payroll_run.update': [{ target: ran, set: { state: 'PAID' } }] })
						)
					);
				yield* t.run_due();
				assert.deepEqual(yield* amendments(t), []);
				yield* add;
				assert.deepEqual(yield* amendments(t), [['2026-06', null]]);
			}).pipe(Effect.provide(inMonth(seed)));
		}
	);
	it.live('a half day is half, an allowance outside the rate stays out', () =>
		Effect.gen(function* () {
			const day = yield* taken(malaysia(), whole('2026-06-10'));
			const half = yield* taken(malaysia({ ONCALL: { amount: ALLOWANCE } }), [
				{ date: PlainDate('2026-06-10'), part: 'AM' }
			]);
			assert.ok(day < 0, String(day));
			assert.equal(half * 2, day);
		})
	);

	it.live('a weekend between two missed days stays paid', () =>
		Effect.gen(function* () {
			const day = yield* taken(malaysia(), whole('2026-06-10'));
			const friday = whole('2026-06-12');
			const monday = whole('2026-06-15');
			assert.equal(yield* taken(malaysia(), [...friday, ...monday]), day * 2);
		})
	);

	it.live('an entry not yet paid is deleted, and the month pays whole', () => {
		const seed = malaysia();
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* entry(t, seed, whole('2026-06-10'));
			const [open] = (yield* storedQuery(t, { leave_catalog_entry: { limit: 1 } }))
				.leave_catalog_entry.rows;
			assert.ok(open !== undefined);
			yield* t
				.as(t.admin)
				.pipe(
					Effect.andThen((caller) =>
						caller.act({ 'leave_catalog_entry.delete': [{ target: open }] })
					)
				);
			yield* run(t, '2026-06');
			assert.deepEqual(yield* paid(t, '2026-06'), { BASIC: SALARY });
			assert.deepEqual(yield* amendments(t), []);
		}).pipe(Effect.provide(inMonth(seed)));
	});

	it.live('deleted after payment, the next run gives the day back, once', () => {
		const seed = malaysia();
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* entry(t, seed, whole('2026-06-10'));
			yield* pay(t, '2026-06');
			const june = (yield* paid(t, '2026-06'))['NPL'] ?? 0;
			assert.ok(june < 0, String(june));
			const [priced] = (yield* storedQuery(t, { leave_catalog_entry: { limit: 1 } }))
				.leave_catalog_entry.rows;
			assert.ok(priced !== undefined);
			yield* t
				.as(t.admin)
				.pipe(
					Effect.andThen((caller) =>
						caller.act({ 'leave_catalog_entry.delete': [{ target: priced }] })
					)
				);
			yield* t.run_due();
			// the paid payslip stands, and the month waits to be worked out again
			assert.equal((yield* paid(t, '2026-06'))['NPL'], june);
			assert.deepEqual(yield* amendments(t), [['2026-06', null]]);
			const july = yield* pay(t, '2026-07');
			// July gives back what June took, though the month is a day longer
			assert.equal((yield* paid(t, '2026-07'))['NPL'], -june);
			assert.deepEqual(yield* amendments(t), [['2026-06', july.id]]);
			yield* run(t, '2026-08');
			assert.equal((yield* paid(t, '2026-08'))['NPL'], undefined);
		}).pipe(Effect.provide(inMonth(seed, '2026-07-20T02:00:00.000Z')));
	});

	it.live('a late cutoff: the 28th belongs to next month’s run', () => {
		const base = malaysia();
		const seed: Seed = {
			...base,
			pay_group: (base.pay_group ?? []).map((row) => ({
				...row,
				payment_schedule: { ...objectValue(row.payment_schedule), pay_cutoff_day: 25 }
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* pay(t, '2026-06');
			yield* entry(t, seed, whole('2026-06-29'));
			yield* run(t, '2026-07');
			assert.ok(((yield* paid(t, '2026-07'))['NPL'] ?? 0) < 0);
		}).pipe(Effect.provide(inMonth(seed, '2026-07-20T02:00:00.000Z')));
	});
});

// The listing's manual no-pay lines post at REGULAR_PAY, so they move basic-level pay and the EPF wage with it.
describe('no-pay leave settled by hand', () => {
	const seed = malaysia();
	const settled = (code: string, quantity: number) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
			const row = seed.adhoc_catalog?.find(
				(item) => item.code === code && item.settings_id === version
			);
			assert.ok(row !== undefined);
			yield* t.as(t.admin).pipe(
				Effect.andThen((caller) =>
					caller.act({
						'adhoc_catalog_entry.create': [
							{
								entity_id: ENTITY,
								employment_id: CONTRACT,
								catalog_id: idOf('adhoc_catalog', String(row.id)),
								description: 'No-pay leave settled by hand',
								quantity,
								incurred_on: PlainDate('2026-06-10')
							}
						]
					})
				)
			);
			yield* run(t, '2026-06');
			const [slip] = (yield* storedQuery(t, { payslip: { limit: 1 } })).payslip.rows;
			const { checkpoints, lines, statutory } = Schema.decodeUnknownSync(PayslipBreakdown)(
				slip?.breakdown
			);
			const line = lines.find((item) => item.code === code);
			return {
				line: [line?.amount, line?.direction],
				regular: checkpoints.find((point) => point.code === 'REGULAR_PAY')?.value,
				epf: statutory.find((item) => item.code === 'EPF')?.employee
			};
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	it.live(
		'an adjustment takes from basic-level pay and a refund gives it back, and the contribution follows the wage',
		() =>
			Effect.gen(function* () {
				const less = yield* settled('NO_PAY_ADJUSTMENT', 120);
				const more = yield* settled('NO_PAY_REFUND', 120);
				assert.deepEqual([less.line, less.regular], [[120, 'DEDUCT'], SALARY - 120]);
				assert.deepEqual([more.line, more.regular], [[120, 'ADD'], SALARY + 120]);
				assert.ok(
					less.epf !== undefined && more.epf !== undefined && less.epf < more.epf,
					`${less.epf} ${more.epf}`
				);
			})
	);
});

describe('an allowance and the share of the period paid', () => {
	const SUA = { SUA: { amount: ALLOWANCE } };
	/** The share of the month's salary the joiner's payslip pays. */
	const share = (t: Kit) =>
		storedQuery(t, { payslip: { limit: 1 } }).pipe(
			Effect.map(({ payslip }) => {
				const { checkpoints } = Schema.decodeUnknownSync(PayslipBreakdown)(
					payslip.rows[0]?.breakdown
				);
				const at = (code: string) => checkpoints.find((point) => point.code === code)?.value ?? 0;
				return at('PRORATED') / at('BASIC');
			})
		);
	const switched = (prorate: boolean): Seed => {
		const seed = malaysia(SUA);
		return {
			...seed,
			allowance_catalog: (seed.allowance_catalog ?? []).map((row) =>
				row.code === 'SUA' && !prorate
					? { ...row, conversion: String(row.conversion).replace(' * ctx.paid_share', '') }
					: row
			),
			employee_contract: (seed.employee_contract ?? []).map((row) => ({
				...row,
				effective_range: { from: '2026-06-16', to: null }
			}))
		};
	};
	it.live('read, a joiner’s allowance takes the days employed', () => {
		const seed = switched(true);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-06');
			const part = yield* share(t);
			assert.ok(part > 0 && part < 1, String(part));
			assert.equal((yield* paid(t, '2026-06'))['SUA'], ALLOWANCE * part);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
	it.live('unread, it pays whole', () => {
		const seed = switched(false);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-06');
			assert.equal((yield* paid(t, '2026-06'))['SUA'], ALLOWANCE);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
});

describe('an allowance across a month of contracts', () => {
	const SUA = { SUA: { amount: ALLOWANCE } };
	const OTHER = idOf('entity', uuid(900));
	const allowance = (t: Kit) =>
		storedQuery(t, { payslip: { limit: 12 } }).pipe(
			Effect.map((got) =>
				got.payslip.rows.map((slip) =>
					Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown).lines.reduce(
						(total, line) => total + (line.code === 'SUA' ? line.amount : 0),
						0
					)
				)
			)
		);
	const one = (seed: Seed) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-06');
			return yield* allowance(t);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	/** Each part is a share, and the parts make the agreed amount once. */
	const shared = (parts: readonly number[]) => {
		assert.ok(
			parts.every((part) => part > 0 && part < ALLOWANCE),
			String(parts)
		);
		assert.equal(
			parts.reduce((total, part) => total + part, 0),
			ALLOWANCE
		);
	};
	const dated = (seed: Seed, range: { from: string; to: string | null }): Seed => ({
		...seed,
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: range
		}))
	});

	it.live('a joiner and a leaver pay their days', () => {
		const seed = malaysia(SUA);
		return Effect.gen(function* () {
			// one joins the day after the other leaves: between them the month is whole
			const joiner = yield* one(dated(seed, { from: '2026-06-16', to: null }));
			const leaver = yield* one(dated(seed, { from: '2025-01-01', to: '2026-06-15' }));
			assert.equal(joiner.length + leaver.length, 2);
			shared([...joiner, ...leaver]);
		});
	});

	it.live('a new contract in the same company pays the whole month once', () => {
		const seed = malaysia(SUA);
		const contract = seed.employee_contract?.[0] ?? {};
		return one({
			...seed,
			employee_contract: [
				{ ...contract, effective_range: { from: '2025-01-01', to: '2026-06-15' } },
				{ ...contract, id: uuid(907), effective_range: { from: '2026-06-16', to: null } }
			]
		}).pipe(Effect.map((paid) => assert.deepEqual(paid, [ALLOWANCE])));
	});

	it.live('a transfer to a sister company pays each its share, once between them', () => {
		const seed = malaysia(SUA);
		const contract = seed.employee_contract?.[0] ?? {};
		const profile = seed.entity_profile_version?.[0] ?? {};
		const moved: Seed = {
			...seed,
			entity: [
				...(seed.entity ?? []),
				{ id: OTHER, code: 'E2', name: 'Sister', settings_code: 'MY' }
			],
			entity_profile_version: [
				...(seed.entity_profile_version ?? []),
				{ ...profile, id: uuid(902), entity_id: OTHER, name: 'Sister' }
			],
			// the sister company's own payroll, on the same schedule
			pay_group: [
				...(seed.pay_group ?? []),
				...(seed.pay_group ?? []).map((row) => ({ ...row, id: uuid(908), entity_id: OTHER }))
			],
			employee_contract: [
				{ ...contract, effective_range: { from: '2025-01-01', to: '2026-06-15' } },
				{
					...contract,
					id: uuid(907),
					entity_id: OTHER,
					pay_group_id: uuid(908),
					effective_range: { from: '2026-06-16', to: null }
				}
			]
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-06');
			yield* t.as(t.admin).pipe(
				Effect.andThen((caller) =>
					caller.act({
						'payroll_run.create': [{ entity_id: OTHER, period: '2026-06', kind: 'ON_CYCLE' }]
					})
				)
			);
			yield* t.run_due();
			const parts = yield* allowance(t);
			assert.equal(parts.length, 2);
			shared(parts);
		}).pipe(Effect.provide(workspace({ seed: moved, now: NOW })));
	});
});
