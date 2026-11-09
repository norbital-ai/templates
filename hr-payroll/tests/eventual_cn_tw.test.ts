// China and Taiwan: a wrong payment needs no automatic entry. HR corrects the pay and the next cycle counts the total paid;
// a no-pay day is a catalog line, so a reversal entry after payment pays it back.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, sealedAdhoc, sealedLeave, uuid, workspace, leaveCreate } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const JUNE = '2026-06-20T02:00:00.000Z';
const JULY = '2026-07-20T02:00:00.000Z';
const AUGUST = '2026-08-20T02:00:00.000Z';
const BOTH = ['.employee', '.employer'];
const EMPLOYEE = ['.employee'];

const terms = (
	amount: number,
	residency: string,
	allowances: Record<string, { readonly amount: number }> = {}
) => ({
	rate: { amount, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: residency,
	wage_payment_method: 'BANK',
	allowances
});
type Seed = ReturnType<typeof pack>;
type Facts = Parameters<typeof pack>[3];
type Place = {
	readonly code: string;
	readonly zone: string;
	readonly residency: string;
	readonly item: string;
	readonly noPay: string;
	readonly facts?: Facts;
	readonly entity?: Facts;
	readonly allowances?: Record<string, { readonly amount: number }>;
};
const CHINA: Place = {
	code: 'CN',
	zone: 'Asia/Shanghai',
	residency: 'CITIZEN',
	item: 'BONUS',
	noPay: 'UNPAID_LEAVE',
	entity: {
		region: 'SH',
		hpf_rate_percent: 7,
		work_injury_rate_percent: 0.2,
		union_established: true
	}
};
const CHINA_NON_RESIDENT: Place = { ...CHINA, residency: 'NON_RESIDENT' };
const review = (resident_from: string | null): Facts => ({
	statutory: {
		NHI: { insured_amount: 20_000 },
		INCOME_TAX: {
			tax_residency_reviews: { 2026: { resident_from, valid_through: '2026-12-31' } }
		}
	}
});
const TAIWAN: Place = {
	code: 'TW',
	zone: 'Asia/Taipei',
	residency: 'CITIZEN',
	item: 'bonus',
	noPay: 'PERSONAL_LEAVE',
	facts: review('2025-01-01')
};
const TAIWAN_NON_RESIDENT: Place = {
	...TAIWAN,
	residency: 'PERMANENT_RESIDENT',
	facts: review(null)
};

const seedOf = (place: Place, amount: number): Seed => {
	const seed = pack(
		place.code,
		place.zone,
		terms(amount, place.residency, place.allowances),
		place.facts ?? {},
		[],
		[],
		'2026-06-15'
	);
	return {
		...seed,
		entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
			...row,
			entity_extension_data: place.entity ?? {}
		})),
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from: '2026-01-01', to: null }
		}))
	};
};
const onCycle = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
		.pipe(Effect.andThen(t.runDue()));
const enter = (
	t: Kit,
	seed: Seed,
	item: string,
	quantity: number,
	on: string,
	reverses: Id<'adhoc_catalog_entry'> | null = null
) => {
	const version = seed.employee_contract?.[0]?.input_schema_version_id;
	const row = (seed.adhoc_catalog ?? []).find((r) => r.code === item && r.settings_id === version);
	assert.ok(row !== undefined, item);
	return t.as(t.admin).act('adhoc_catalog_entry.create', [
		{
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: idOf('adhoc_catalog', String(row.id)),
			description: 'Correction',
			quantity,
			incurred_on: PlainDate(on),
			reverses
		}
	]);
};
/** The open entry goes out in its own run. */
const offCycle = (t: Kit, period: string) =>
	Effect.gen(function* () {
		const open = (yield* t.storedQuery({
			adhoc_catalog_entry: { where: { payroll_run_id: { isNull: true } }, limit: 1 }
		})).adhoc_catalog_entry.rows[0];
		assert.ok(open !== undefined);
		yield* t.as(t.admin).act('payroll_run.create', [
			{
				entity_id: ENTITY,
				period,
				kind: 'OFF_CYCLE',
				attaches: { adhoc: [idOf('adhoc_catalog_entry', open.id)] }
			}
		]);
		yield* t.runDue();
	});
const runs = (t: Kit, period: string) =>
	t.storedQuery({ payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) =>
			got.payroll_run.rows
				.filter((row) => row.period.startsWith(period))
				.toSorted((left, right) => right.kind.localeCompare(left.kind))
				.map((run) => {
					const slip = got.payslip.rows.find((row) => row.payroll_run_id === run.id);
					return Schema.decodeUnknownSync(PayslipBreakdown)(slip?.breakdown);
				})
		)
	);
/** Every row a month charged across its runs: a refund counts against it. */
const month = (t: Kit, period: string, codes: readonly string[], sides: readonly string[]) =>
	runs(t, period).pipe(
		Effect.map((slips) => {
			const totals = new Map<string, number>();
			const add = (key: string, value: number) => totals.set(key, (totals.get(key) ?? 0) + value);
			for (const { code, employee, employer } of slips.flatMap((s) => s.statutory)) {
				if (!codes.includes(code)) continue;
				add(`${code}.employee`, employee);
				add(`${code}.employer`, employer);
			}
			return Object.fromEntries(
				[...totals]
					.filter(([key]) => sides.some((side) => key.endsWith(side)))
					.map(([key, value]) => [key, Number(value.toFixed(2))] as const)
					.filter(([, value]) => value !== 0)
					.sort(([left], [right]) => left.localeCompare(right))
			);
		})
	);
const charged = (slip: PayslipBreakdown | undefined, code: string) =>
	slip?.statutory.find((row) => row.code === code);
const figure = (rows: Record<string, number>, key: string) => rows[key] ?? 0;

/** One month in one on-cycle run: the salary and, inside it, the adjustment. */
const oneRun = (
	place: Place,
	paid: number,
	item: string,
	extra: number,
	codes: readonly string[]
) =>
	Effect.gen(function* () {
		const seed = seedOf(place, paid);
		return yield* Effect.gen(function* () {
			const t = yield* TestWorkspace;
			if (extra > 0) yield* enter(t, seed, item, extra, '2026-06-05');
			yield* onCycle(t, '2026-06');
			return yield* month(t, '2026-06', codes, BOTH);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
const topUp = (
	place: Place,
	paid: number,
	short: number,
	codes: readonly string[],
	item = place.item
) =>
	Effect.gen(function* () {
		const seed = seedOf(place, paid);
		const twice = yield* Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, '2026-06');
			yield* enter(t, seed, item, short, '2026-06-15');
			yield* offCycle(t, '2026-06');
			return yield* month(t, '2026-06', codes, BOTH);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
		assert.deepEqual(twice, yield* oneRun(place, paid, item, short, codes));
	});
/** May pays the salary and the extra; HR enters the reversal; June's on-cycle run takes it. */
const twoMonths = (
	place: Place,
	paid: number,
	item: string,
	extra: number,
	codes: readonly string[]
) => {
	const seed = seedOf(place, paid);
	return Effect.gen(function* () {
		const t = yield* TestWorkspace;
		if (extra > 0) yield* enter(t, seed, item, extra, '2026-05-05');
		yield* onCycle(t, '2026-05');
		if (extra > 0) yield* enter(t, seed, item, extra, '2026-06-05', yield* sealedAdhoc(t));
		yield* onCycle(t, '2026-06');
		const [may] = yield* runs(t, '2026-05');
		const [june] = yield* runs(t, '2026-06');
		assert.ok(may !== undefined && june !== undefined);
		for (const { code, amount } of [...may.lines, ...june.lines])
			assert.ok(amount >= 0, `${code} is negative`);
		for (const { code, employee } of [...may.statutory, ...june.statutory])
			assert.ok(employee >= 0, `${code} is negative`);
		const total = (rows: Record<string, number>) =>
			Object.values(rows).reduce((sum, value) => sum + value, 0);
		return {
			may: total(yield* month(t, '2026-05', codes, EMPLOYEE)),
			june: total(yield* month(t, '2026-06', codes, EMPLOYEE))
		};
	}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
};
/** A row with no refund route stops at zero: June repays nothing, shows nothing negative and owes no more than it should. */
const reversed = (
	place: Place,
	paid: number,
	extra: number,
	codes: readonly string[],
	item = place.item
) =>
	Effect.gen(function* () {
		const wrong = yield* twoMonths(place, paid, item, extra, codes);
		const right = yield* twoMonths(place, paid, item, 0, codes);
		assert.ok(wrong.may > right.may);
		assert.ok(wrong.june <= right.june);
	});
const ownLadder = (place: Place, paid: number, extra: number, code: string) =>
	Effect.gen(function* () {
		const { may, june } = yield* twoMonths(place, paid, place.item, extra, [code]);
		const alone = (salary: number) =>
			oneRun(place, salary, place.item, 0, [code]).pipe(
				Effect.map((rows) => figure(rows, `${code}.employee`))
			);
		assert.equal(may, yield* alone(paid + extra));
		assert.equal(june, yield* alone(paid - extra));
		assert.ok(june < may);
	});
const refused = (place: Place, paid: number, extra: number) => {
	const seed = seedOf(place, paid);
	return Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* enter(t, seed, place.item, extra, '2026-06-05');
		yield* onCycle(t, '2026-06');
		yield* enter(t, seed, place.item, extra, '2026-06-15', yield* sealedAdhoc(t));
		const late = yield* Effect.flip(offCycle(t, '2026-06'));
		assert.match(
			String(late),
			/This run would take someone below zero\. A reversal goes in the next on-cycle run\./
		);
	}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
};

describe('paid short, topped up in the same month', () => {
	it.live('China: cumulative tax and the union fund count the month', () =>
		topUp(CHINA, 30_000, 90_000, ['IIT', 'UNION_FUND'])
	);
	it.live('China, a non-resident: the month’s ladder takes the whole pay', () =>
		topUp(CHINA_NON_RESIDENT, 8000, 20_000, ['IIT'])
	);
	it.live('Taiwan: the bonus rows stand on the payment and the year', () =>
		topUp(TAIWAN, 80_000, 240_000, ['INCOME_TAX', 'INCOME_TAX_BONUS', 'NHI_SUPPLEMENT'])
	);
	it.live('Taiwan, a non-resident: past 1.5 minimum wages the whole month is at 18%', () =>
		topUp(TAIWAN_NON_RESIDENT, 40_000, 10_000, ['INCOME_TAX_NON_RESIDENT'])
	);
});

describe('paid too much, reversed in the next on-cycle run', () => {
	it.live('China: cumulative tax stops at zero, no negative line', () =>
		reversed(CHINA, 30_000, 90_000, ['IIT'])
	);
	it.live('China: an annual bonus taxed apart stops at zero', () =>
		reversed(
			{
				...CHINA,
				facts: { statutory: { IIT: { annual_bonus_separate: true } } }
			},
			30_000,
			60_000,
			['IIT', 'IIT_ANNUAL_BONUS'],
			'ANNUAL_BONUS'
		)
	);
	it.live('China: termination pay past the exemption stops at zero', () =>
		reversed(CHINA, 30_000, 600_000, ['IIT', 'IIT_SEVERANCE'], 'PAY_IN_LIEU_OF_NOTICE')
	);
	it.live('Taiwan: what the bonus bore stops at zero, no negative line', () =>
		reversed(TAIWAN, 80_000, 240_000, ['INCOME_TAX', 'INCOME_TAX_BONUS', 'NHI_SUPPLEMENT'])
	);
	// 个人所得税法 第六条第一款第二项 and 所得稅法 §88: a non-resident's month stands alone, so nothing accumulates across two
	it.live('China, a non-resident: June’s ladder takes June’s lower wages', () =>
		ownLadder(CHINA_NON_RESIDENT, 30_000, 20_000, 'IIT')
	);
	it.live('Taiwan, a non-resident: June falls back to 6%', () =>
		ownLadder(TAIWAN_NON_RESIDENT, 40_000, 10_000, 'INCOME_TAX_NON_RESIDENT')
	);
	it.live('China: off-cycle in the same month is refused', () => refused(CHINA, 30_000, 90_000));
	it.live('Taiwan: off-cycle in the same month is refused', () => refused(TAIWAN, 80_000, 240_000));
});

describe('corrected in the next month', () => {
	const months = (
		place: Place,
		paid: number,
		enters: (t: Kit, seed: Seed, period: 'May' | 'June') => Effect.Effect<unknown, unknown>,
		code: string
	) =>
		Effect.gen(function* () {
			const seed = seedOf(place, paid);
			return yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* enters(t, seed, 'May');
				yield* onCycle(t, '2026-05');
				yield* enters(t, seed, 'June');
				yield* onCycle(t, '2026-06');
				const key = `${code}.employee`;
				return {
					may: figure(yield* month(t, '2026-05', [code], EMPLOYEE), key),
					june: figure(yield* month(t, '2026-06', [code], EMPLOYEE), key)
				};
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
		});
	const none = () => Effect.void;
	const once = (when: 'May' | 'June', item: string, amount: number) => {
		const on = when === 'May' ? '2026-05-05' : '2026-06-05';
		return (t: Kit, seed: Seed, period: 'May' | 'June') =>
			period === when ? enter(t, seed, item, amount, on) : Effect.void;
	};

	it.live('China: back pay in June is counted, and two months’ tax is the right total', () =>
		Effect.gen(function* () {
			const late = yield* months(CHINA, 30_000, once('June', 'BONUS', 20_000), 'IIT');
			const right = yield* months(CHINA, 30_000, once('May', 'BONUS', 20_000), 'IIT');
			assert.ok(late.june > late.may);
			assert.equal(late.may + late.june, right.may + right.june);
		})
	);
	it.live('China: a reversal stops June at zero, and July’s cumulative figure counts it', () =>
		Effect.gen(function* () {
			const seed = seedOf(CHINA, 30_000);
			const JULY = '2026-07-28T02:00:00.000Z';
			const iit = (t: Kit, period: string) =>
				month(t, period, ['IIT'], EMPLOYEE).pipe(
					Effect.map((rows) => figure(rows, 'IIT.employee'))
				);
			const taken = (bonus: number) =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					if (bonus > 0) yield* enter(t, seed, 'BONUS', bonus, '2026-05-05');
					yield* onCycle(t, '2026-05');
					if (bonus > 0) yield* enter(t, seed, 'BONUS', bonus, '2026-06-05', yield* sealedAdhoc(t));
					yield* onCycle(t, '2026-06');
					yield* onCycle(t, '2026-07');
					return [yield* iit(t, '2026-05'), yield* iit(t, '2026-06'), yield* iit(t, '2026-07')];
				}).pipe(Effect.provide(workspace({ seed, now: JULY })));
			const [may = 0, june = 0, july = 0] = yield* taken(20_000);
			const [rightMay = 0, rightJune = 0, rightJuly = 0] = yield* taken(0);
			const right = rightMay + rightJune + rightJuly;
			assert.equal(june, 0);
			// tax stands at whichever is higher: what May took, or the right cumulative figure
			assert.equal(Number((may + june + july).toFixed(2)), Number(Math.max(may, right).toFixed(2)));
		})
	);
	it.live('Taiwan: a bonus reversed in June stops at zero: the worker files for the year', () => {
		const seed = seedOf(TAIWAN, 120_000);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, 'bonus', 100_000, '2026-05-05');
			yield* onCycle(t, '2026-05');
			yield* enter(t, seed, 'bonus', 100_000, '2026-06-05', yield* sealedAdhoc(t));
			yield* onCycle(t, '2026-06');
			const [may] = yield* runs(t, '2026-05');
			const [june] = yield* runs(t, '2026-06');
			assert.equal(charged(may, 'INCOME_TAX_BONUS')?.employee, 5000);
			assert.equal(charged(june, 'INCOME_TAX_BONUS')?.employee, 0);
			assert.equal(charged(may, 'NHI_SUPPLEMENT')?.employee, 422);
			assert.equal(charged(june, 'NHI_SUPPLEMENT')?.employee, 0);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
	it.live('Taiwan, a non-resident: two months’ tax is the right total', () =>
		Effect.gen(function* () {
			const code = 'INCOME_TAX_NON_RESIDENT';
			const seed = seedOf(TAIWAN_NON_RESIDENT, 60_000);
			const wrong = yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* enter(t, seed, 'bonus', 10_000, '2026-05-05');
				yield* onCycle(t, '2026-05');
				yield* enter(t, seed, 'bonus', 10_000, '2026-06-05', yield* sealedAdhoc(t));
				yield* onCycle(t, '2026-06');
				return (
					figure(yield* month(t, '2026-05', [code], EMPLOYEE), `${code}.employee`) +
					figure(yield* month(t, '2026-06', [code], EMPLOYEE), `${code}.employee`)
				);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
			const right = yield* months(TAIWAN_NON_RESIDENT, 60_000, none, code);
			assert.equal(wrong, right.may + right.june);
		})
	);
});

describe('Taiwan’s month of salary', () => {
	const schedule = (seed: Seed, payment_schedule: Facts): Seed => ({
		...seed,
		entity: (seed.entity ?? []).map((row) => ({
			...row,
			payment_schedule
		}))
	});
	it.live('two half-month cycles are one 全月給付總額', () => {
		const halves = schedule(seedOf(TAIWAN, 30_000), {
			frequency: 'SEMI_MONTHLY',
			business_day: 'PREVIOUS',
			non_working_weekdays: [0, 6],
			short_month: 'LAST_DAY',
			pay_days: [15, 31]
		});
		const tax = (seed: Seed, cycles: readonly string[]) =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				for (const cycle of cycles) yield* onCycle(t, cycle);
				return yield* month(t, '2026-06', ['INCOME_TAX'], EMPLOYEE);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
		return Effect.gen(function* () {
			assert.deepEqual(yield* tax(halves, ['2026-06-1', '2026-06-2']), {
				'INCOME_TAX.employee': 3000
			});
			assert.deepEqual(yield* tax(seedOf(TAIWAN, 60_000), ['2026-06']), {
				'INCOME_TAX.employee': 3000
			});
		});
	});
	it.live('a second salary in a pay month is another wage month’s, so it stands alone', () => {
		// 1 August 2026 is a Saturday, so August's salary is paid on 31 July
		const seed = schedule(seedOf(TAIWAN, 60_000), {
			frequency: 'MONTHLY',
			business_day: 'PREVIOUS',
			non_working_weekdays: [0, 6],
			short_month: 'LAST_DAY',
			pay_days: [1]
		});
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, '2026-07');
			yield* onCycle(t, '2026-08');
			assert.deepEqual(
				yield* month(t, '2026-08', ['INCOME_TAX'], EMPLOYEE),
				yield* month(t, '2026-07', ['INCOME_TAX'], EMPLOYEE)
			);
		}).pipe(Effect.provide(workspace({ seed, now: AUGUST })));
	});
	it('exit pay in two payments owes what one would, and a reversal gives it back', () => {
		const rows: readonly {
			readonly code: string;
			readonly employee_amount: string;
			readonly lookup?: object;
		}[] = JSON.parse(
			readFileSync(
				'seed/public/jurisdiction/TW/version_3/statutory_contribution_catalog.json',
				'utf8'
			)
		);
		const [settings]: readonly { readonly lookup: object }[] = JSON.parse(
			readFileSync('seed/public/jurisdiction/TW/version_3/jurisdiction_settings.json', 'utf8')
		);
		const row = rows.find((candidate) => candidate.code === 'SEVERANCE_TAX');
		assert.ok(row !== undefined);
		const owed = (now: number, ytd: number, withheld: number) =>
			Number(
				evaluate(
					row.employee_amount,
					'CALCULATION',
					{
						subject: {
							employment: {
								effective_range: { from: '2016-06-01', to: '2026-05-31' },
								employee_extension_data: review('2025-01-01')
							}
						},
						lookup: {
							...((settings?.lookup as Record<string, unknown> | undefined)?.[
								'constants'
							] as object),
							...settings?.lookup,
							...row.lookup
						},
						run: {
							pay_date: '2026-06-25',
							salary_coverage: { from: '2026-06-01', to: '2026-06-30' }
						},
						subtotals: { ADDITIONAL_WAGES: 0, RETIREMENT: now },
						balances: {
							ytd: { RETIREMENT: ytd, ADDITIONAL_WAGES: 0 },
							statutory_contribution: { 'SEVERANCE_TAX.employee': withheld }
						}
					},
					'SEVERANCE_TAX'
				)
			);
		// ten years at NT$206,000 exempt NT$2,060,000
		assert.equal(owed(2_000_000, 0, 0), 0);
		assert.equal(owed(200_000, 2_000_000, 0), 8400);
		assert.equal(owed(-200_000, 2_200_000, 8400), -8400);
	});
});

describe('a no-pay day', () => {
	const itemOf = (seed: Seed, code: string) => {
		const version = seed.employee_contract?.[0]?.input_schema_version_id;
		const row = seed.leave_catalog?.find(
			(item) => item.code === code && item.settings_id === version
		);
		assert.ok(row !== undefined, code);
		return idOf('leave_catalog', String(row.id));
	};
	const whole = (date: string) => [
		{ date: PlainDate(date), part: 'AM' as const },
		{ date: PlainDate(date), part: 'PM' as const }
	];
	const take = (
		t: Kit,
		seed: Seed,
		code: string,
		days: ReturnType<typeof whole>,
		reverses: Id<'leave_catalog_entry'> | null = null
	) =>
		t.as(t.admin).act('leave_catalog_entry.create', [
			leaveCreate({
				entity_id: ENTITY,
				employment_id: CONTRACT,
				catalog_id: itemOf(seed, code),
				days,
				reverses
			})
		]);
	const line = (slip: PayslipBreakdown | undefined, code: string) =>
		slip?.lines.find((row) => row.code === code);
	const checkpoint = (slip: PayslipBreakdown | undefined, code: string) =>
		slip?.checkpoints.find((row) => row.code === code)?.value;
	/** The row as it stood: the salary basis takes the days and the row prices nothing. */
	const asBasis = (seed: Seed, code: string): Seed => ({
		...seed,
		leave_catalog: (seed.leave_catalog ?? []).map((row) =>
			row.code === code ? { ...row, pay_treatment: 'UNPAID' } : row
		)
	});
	const paidOn = (seed: Seed, code: string, days: ReturnType<typeof whole>) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, code, days);
			yield* onCycle(t, '2026-06');
			const [slip] = yield* runs(t, '2026-06');
			const { payslip } = yield* t.storedQuery({ payslip: { limit: 1 } });
			return {
				net: payslip.rows[0]?.net_pay,
				statutory: slip?.statutory,
				ordinary: slip?.checkpoints.find((row) => row.code === 'ORDINARY_WAGES')?.value
			};
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	const same = (place: Place, amount: number, code: string, days: ReturnType<typeof whole>) =>
		Effect.gen(function* () {
			const seed = seedOf(place, amount);
			assert.deepEqual(
				yield* paidOn(seed, code, days),
				yield* paidOn(asBasis(seed, code), code, days)
			);
		});
	/** A checkpoint on a month with a no-pay day. */
	const figureOn = (seed: Seed, code: string, days: ReturnType<typeof whole>, at: string) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, code, days);
			yield* onCycle(t, '2026-06');
			const [slip] = yield* runs(t, '2026-06');
			return checkpoint(slip, at);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));

	describe('China', () => {
		const declared: Place = {
			...CHINA,
			allowances: { FIXED_ALLOWANCE: { amount: 11_000 } },
			facts: { term_facts: { si_contribution_base: 33_000 } }
		};
		const undeclared: Place = { ...CHINA, allowances: { FIXED_ALLOWANCE: { amount: 11_000 } } };
		const seed = seedOf(declared, 33_000);
		const code = 'UNPAID_LEAVE';

		it.live('net pay and every statutory figure are what the salary basis gave', () =>
			Effect.gen(function* () {
				yield* same(CHINA, 33_000, code, whole('2026-06-10'));
				yield* same(declared, 33_000, code, whole('2026-06-10'));
				yield* same(undeclared, 33_000, code, whole('2026-06-10'));
			})
		);
		it.live('with no declared base, BASIC is what the salary basis left', () =>
			Effect.gen(function* () {
				const plain = seedOf(undeclared, 33_000);
				const onLine = yield* figureOn(plain, code, whole('2026-06-10'), 'BASIC');
				assert.equal(onLine, 31_500);
				assert.equal(
					onLine,
					yield* figureOn(asBasis(plain, code), code, whole('2026-06-10'), 'BASIC')
				);
			})
		);
		it.live('a day is the month’s salary, and the fixed allowance falls on its own line', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, seed, code, whole('2026-06-10'));
				yield* onCycle(t, '2026-06');
				const [june] = yield* runs(t, '2026-06');
				assert.equal(line(june, code), undefined);
				assert.equal(line(june, 'BASIC')?.amount, 31_500);
				assert.equal(line(june, 'FIXED_ALLOWANCE')?.amount, 10_500);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })))
		);
		it.live('a half day is half', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, seed, code, [{ date: PlainDate('2026-06-10'), part: 'AM' }]);
				yield* onCycle(t, '2026-06');
				const [june] = yield* runs(t, '2026-06');
				assert.equal(line(june, code), undefined);
				assert.equal(line(june, 'BASIC')?.amount, 32_250);
				assert.equal(line(june, 'FIXED_ALLOWANCE')?.amount, 10_750);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })))
		);
		it.live('reversed after payment, July gives back June’s day, not a July one', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, seed, code, whole('2026-06-10'));
				yield* onCycle(t, '2026-06');
				yield* take(t, seed, code, whole('2026-06-10'), yield* sealedLeave(t));
				yield* onCycle(t, '2026-07');
				const [july] = yield* runs(t, '2026-07');
				// the whole month wage share: BASIC 1,500 plus the fixed allowance's 500
				assert.equal(line(july, code)?.amount, 2000);
				assert.equal(line(july, code)?.direction, 'ADD');
				assert.equal(line(july, 'FIXED_ALLOWANCE')?.amount, 11_000);
			}).pipe(Effect.provide(workspace({ seed, now: JULY })))
		);
		it.live('a date in a period that has run is refused', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, seed, code, whole('2026-06-10'));
				yield* onCycle(t, '2026-06');
				const late = yield* Effect.flip(
					take(t, seed, code, whole('2026-06-11'))
				);
				assert.match(String(late), /already run/);
			}).pipe(Effect.provide(workspace({ seed, now: JULY })))
		);
	});

	describe('Taiwan', () => {
		const code = 'PERSONAL_LEAVE';
		const meal: Place = { ...TAIWAN, allowances: { MEAL_ALLOWANCE: { amount: 3000 } } };
		const overTheExemption: Place = {
			...TAIWAN,
			allowances: { MEAL_ALLOWANCE: { amount: 4000 } }
		};
		const seed = seedOf(meal, 30_000);

		it.live('net pay and every statutory figure are what the salary basis gave', () =>
			Effect.gen(function* () {
				yield* same(TAIWAN, 60_000, code, whole('2026-06-10'));
				yield* same(TAIWAN, 60_000, code, [...whole('2026-06-12'), ...whole('2026-06-15')]);
				yield* same(meal, 30_000, code, whole('2026-06-10'));
				yield* same(overTheExemption, 30_000, code, whole('2026-06-10'));
			})
		);
		it.live('taxable income is what the salary basis left; the exempt meal takes its own day', () =>
			Effect.gen(function* () {
				const days = whole('2026-06-10');
				assert.equal(yield* figureOn(seed, code, days, 'SALARY_INCOME'), 29_000);
				assert.equal(
					yield* figureOn(seed, code, days, 'SALARY_INCOME'),
					yield* figureOn(asBasis(seed, code), code, days, 'SALARY_INCOME')
				);
				const over = seedOf(overTheExemption, 30_000);
				assert.equal(
					yield* figureOn(over, code, days, 'SALARY_INCOME'),
					yield* figureOn(asBasis(over, code), code, days, 'SALARY_INCOME')
				);
			})
		);
		it.live('a day is the month’s wages ÷ its calendar days, the meal on its own line', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, seed, code, whole('2026-06-10'));
				yield* onCycle(t, '2026-06');
				const [june] = yield* runs(t, '2026-06');
				assert.equal(line(june, code), undefined);
				assert.equal(line(june, 'BASIC')?.amount, 29_000);
				assert.equal(line(june, 'MEAL_ALLOWANCE')?.amount, 2900);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })))
		);
		it.live('a half day is half', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, seed, code, [{ date: PlainDate('2026-06-10'), part: 'AM' }]);
				yield* onCycle(t, '2026-06');
				const [june] = yield* runs(t, '2026-06');
				assert.equal(line(june, code), undefined);
				assert.equal(line(june, 'BASIC')?.amount, 29_500);
				assert.equal(line(june, 'MEAL_ALLOWANCE')?.amount, 2950);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })))
		);
		it.live('a weekend between two missed days goes with them', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, seed, code, [...whole('2026-06-12'), ...whole('2026-06-15')]);
				yield* onCycle(t, '2026-06');
				const [june] = yield* runs(t, '2026-06');
				assert.equal(line(june, code), undefined);
				assert.equal(line(june, 'BASIC')?.amount, 26_000);
				assert.equal(line(june, 'MEAL_ALLOWANCE')?.amount, 2600);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })))
		);
		it.live('every work day of a month missed pays nothing, its edge weekends with them', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				// August 2026 opens and closes around weekends
				const weekdays = Array.from({ length: 31 }, (_, index) => index + 1)
					.map((day) => `2026-08-${String(day).padStart(2, '0')}`)
					.filter((date) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()));
				yield* take(t, seed, code, weekdays.flatMap(whole));
				yield* onCycle(t, '2026-08');
				const [august] = yield* runs(t, '2026-08');
				assert.equal(line(august, code), undefined);
				assert.equal(line(august, 'BASIC'), undefined);
				assert.equal(line(august, 'MEAL_ALLOWANCE'), undefined);
			}).pipe(Effect.provide(workspace({ seed, now: AUGUST })))
		);
		it.live('reversed after payment, 31-day July gives back a day of 30-day June', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, seed, code, whole('2026-06-10'));
				yield* onCycle(t, '2026-06');
				yield* take(t, seed, code, whole('2026-06-10'), yield* sealedLeave(t));
				yield* onCycle(t, '2026-07');
				const [july] = yield* runs(t, '2026-07');
				// the whole month wage share: BASIC 1,000 plus the meal allowance's 100
				assert.equal(line(july, code)?.amount, 1100);
				assert.equal(line(july, code)?.direction, 'ADD');
				assert.equal(line(july, 'MEAL_ALLOWANCE')?.amount, 3000);
			}).pipe(Effect.provide(workspace({ seed, now: JULY })))
		);
		it.live('a date in a period that has run is refused', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, seed, code, whole('2026-06-10'));
				yield* onCycle(t, '2026-06');
				const late = yield* Effect.flip(
					take(t, seed, code, whole('2026-06-11'))
				);
				assert.match(String(late), /already run/);
			}).pipe(Effect.provide(workspace({ seed, now: JULY })))
		);
	});
});

describe('CN prior employment in the same tax year', () => {
	/** One prior-employment row, and whether it was withheld by this same agent. */
	const withPrior = (same: boolean) => {
		const seed = seedOf(CHINA, 30_000);
		return {
			...seed,
			employee_contract: (seed.employee_contract ?? []).map((row) => ({
				...row,
				employee_extension_data: {
					prior_employment: [
						{
							tax_year: 2026,
							months: 3,
							gross_income: 90_000,
							iit_withheld: 0,
							employee_social_contributions: 9_000,
							same_withholding_agent: same
						}
					]
				}
			}))
		};
	};
	const taxOf = (same: boolean) =>
		Effect.gen(function* () {
			const seed = withPrior(same);
			return yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* onCycle(t, '2026-06');
				const debug = yield* t.storedQuery({ payslip: { limit: 5 } });
				return figure(yield* month(t, '2026-06', ['IIT'], EMPLOYEE), 'IIT.employee');
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
		});
	it.live('a prior period from the same agent joins the cumulative base', () =>
		Effect.gen(function* () {
			const same = yield* taxOf(true);
			const other = yield* taxOf(false);
			const none = yield* taxOf(false);
			assert.ok(same > other, `${same} should exceed ${other}`);
			assert.equal(other, none);
		})
	);
});
