// Japan: a wrong payment is corrected by HR's entry, and the rows that follow the month's pay count the total paid.
// A no-pay day is a catalog line, so a reversal after payment pays it back. Tax on the monthly table settles at year end.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const JUNE = '2026-06-20T02:00:00.000Z';
const NO_PAY = [
	'PRENATAL_LEAVE',
	'POSTNATAL_LEAVE',
	'CHILDCARE_LEAVE',
	'POSTNATAL_PATERNITY_LEAVE',
	'FAMILY_CARE_LEAVE',
	'CHILD_NURSING_LEAVE',
	'FAMILY_CARE_DAYS',
	'MENSTRUAL_LEAVE',
	'CIVIC_DUTY_LEAVE',
	'SICKNESS_ABSENCE',
	'OCCUPATIONAL_INJURY_ABSENCE',
	'UNPAID_LEAVE',
	'NURSING_TIME',
	'MATERNAL_HEALTH_CHECK'
];
/** The rows that follow the month's pay. The monthly premiums sit on the grade, fixed here by the election. */
const FOLLOWING = [
	'ASBESTOS_LEVY',
	'CHILD_CONTRIBUTION',
	'CHILD_SUPPORT_BONUS',
	'EI',
	'EI_BONUS',
	'HEALTH_BONUS',
	'INCOME_TAX',
	'PENSION_BONUS',
	'WORKERS_ACCIDENT'
];
const PREMIUMS = ['CHILD_SUPPORT_BONUS', 'EI_BONUS', 'HEALTH_BONUS', 'PENSION_BONUS'];
const FACTS = {
	insured_office_region: 'HOKKAIDO',
	statutory: {
		HEALTH: { elections: { standard_monthly_remuneration: 500_000 } },
		INCOME_TAX: { elections: { dependency_declaration_filed: true } },
		YEAR_END_ADJUSTMENT: { elections: { prior_employer_income: 6_000_000 } }
	}
};
const terms = (amount: number, allowances: Record<string, { readonly amount: number }> = {}) => ({
	rate: { amount, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
	work_classification: 'EMPLOYEE',
	residency_status: 'RESIDENT',
	wage_payment_method: 'BANK',
	allowances
});
type Seed = ReturnType<typeof pack>;
const seedOf = (
	salary: number,
	allowances: Record<string, { readonly amount: number }> = {},
	days: Parameters<typeof pack>[4] = []
): Seed => {
	const seed = pack('JP', 'Asia/Tokyo', terms(salary, allowances), FACTS, days, [], '2026-06-15');
	return {
		...seed,
		entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
			...row,
			entity_extension_data: { workers_accident_rate_per_mille: 3 }
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
	is_reversal = false
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
			unit: 'MONEY',
			incurred_on: PlainDate(on),
			is_reversal
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
/** What a month's runs charged on these rows: a refund counts against it. */
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
					.filter(([key, value]) => value !== 0 && sides.some((side) => key.endsWith(side)))
					.sort(([left], [right]) => left.localeCompare(right))
			);
		})
	);
const BOTH = ['.employee', '.employer'];
const EMPLOYEE = ['.employee'];
const charged = (slip: PayslipBreakdown | undefined, code: string) =>
	slip?.statutory.find((row) => row.code === code);

/** One month of one on-cycle run, with whatever it is told to pay. */
const oneRun = (
	seed: Seed,
	sides: readonly string[],
	pays: (t: Kit) => Effect.Effect<unknown, unknown> = () => Effect.void
) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* pays(t);
		yield* onCycle(t, '2026-06');
		return yield* month(t, '2026-06', FOLLOWING, sides);
	}).pipe(Effect.provide(workspace({ seed, now: JUNE })));

describe('short, then topped up off-cycle in the month', () => {
	it.live('a wage: the two runs owe what one run of the total owes', () => {
		// each share rounds down alone and the total does not
		const seed = seedOf(333_100);
		return Effect.gen(function* () {
			const twice = yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* onCycle(t, '2026-06');
				yield* enter(t, seed, 'WAGE_ADJUSTMENT', 66_900, '2026-06-15');
				yield* offCycle(t, '2026-06');
				return yield* month(t, '2026-06', FOLLOWING, BOTH);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
			assert.deepEqual(twice, yield* oneRun(seedOf(400_000), BOTH));
		});
	});

	it.live('a bonus past the pension ceiling: one standard bonus for the month', () => {
		const seed = seedOf(500_000);
		return Effect.gen(function* () {
			const twice = yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* enter(t, seed, 'BONUS', 1_000_500, '2026-06-10');
				yield* onCycle(t, '2026-06');
				yield* enter(t, seed, 'BONUS', 700_800, '2026-06-15');
				yield* offCycle(t, '2026-06');
				return yield* month(t, '2026-06', FOLLOWING, BOTH);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
			const once = yield* oneRun(seed, BOTH, (t) =>
				enter(t, seed, 'BONUS', 1_701_300, '2026-06-10')
			);
			assert.deepEqual(twice, once);
		});
	});
});

describe('too much, reversed in the next on-cycle run', () => {
	const reversed = (item: string, extra: number) => {
		const seed = seedOf(500_000);
		return Effect.gen(function* () {
			const june = yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* enter(t, seed, item, extra, '2026-05-05');
				yield* onCycle(t, '2026-05');
				yield* enter(t, seed, item, extra, '2026-06-15', true);
				yield* onCycle(t, '2026-06');
				const [may] = yield* runs(t, '2026-05');
				const [slip] = yield* runs(t, '2026-06');
				assert.ok(may !== undefined && slip !== undefined);
				for (const { code, amount } of [...may.lines, ...slip.lines])
					assert.ok(amount >= 0, `${code} is negative`);
				// a row that repays does so on an ADD line, and only that
				for (const { code, employee } of slip.statutory)
					if (employee < 0)
						assert.equal(slip.lines.find((line) => line.code === code)?.direction, 'ADD', code);
				assert.ok(may.statutory.every(({ employee }) => employee >= 0));
				return yield* month(t, '2026-06', FOLLOWING, EMPLOYEE);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
			const total = (rows: Readonly<Record<string, number>>) =>
				Object.values(rows).reduce((sum, value) => sum + value, 0);
			assert.ok(total(june) < total(yield* oneRun(seed, EMPLOYEE)));
		});
	};
	it.live('a wage: June counts the lower pay, no negative line', () =>
		reversed('WAGE_ADJUSTMENT', 200_000)
	);
	it.live('a bonus: June counts the lower pay, no negative line', () =>
		reversed('BONUS', 1_800_000)
	);
	it.live('off-cycle in the same month is refused', () => {
		const seed = seedOf(500_000);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, 'WAGE_ADJUSTMENT', 200_000, '2026-06-05');
			yield* onCycle(t, '2026-06');
			yield* enter(t, seed, 'WAGE_ADJUSTMENT', 200_000, '2026-06-15', true);
			const late = yield* Effect.flip(offCycle(t, '2026-06'));
			assert.match(
				String(late),
				/This run would take someone below zero\. A reversal goes in the next on-cycle run\./
			);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
});

describe('corrected in the next on-cycle run', () => {
	const SALARY = 500_000;
	const WRONG = 300_000;
	it.live('that run’s figures count the correction', () => {
		const seed = seedOf(SALARY);
		return Effect.gen(function* () {
			const corrected = yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* enter(t, seed, 'WAGE_ADJUSTMENT', WRONG, '2026-05-10');
				yield* onCycle(t, '2026-05');
				yield* enter(t, seed, 'WAGE_ADJUSTMENT', WRONG, '2026-06-10', true);
				yield* onCycle(t, '2026-06');
				return yield* month(t, '2026-06', FOLLOWING, BOTH);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
			const { 'ASBESTOS_LEVY.employer': levy } = corrected;
			assert.ok(levy !== undefined);
			assert.deepEqual(corrected, yield* oneRun(seedOf(SALARY - WRONG), BOTH));
		});
	});

	const NOW = '2026-12-20T02:00:00.000Z';
	const CODES = ['INCOME_TAX', 'YEAR_END_ADJUSTMENT'];
	/** Tax the year's last two months took, with what December's adjustment gave back. */
	const taken = (correct: (t: Kit, seed: Seed) => Effect.Effect<unknown, unknown>) => {
		const seed = seedOf(SALARY);
		const late: Seed = {
			...seed,
			employee_contract: (seed.employee_contract ?? []).map((row) => ({
				...row,
				effective_range: { from: '2026-11-01', to: null }
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* correct(t, late);
			const november = yield* month(t, '2026-11', ['INCOME_TAX'], EMPLOYEE);
			const december = yield* month(t, '2026-12', CODES, EMPLOYEE);
			const monthly =
				(november['INCOME_TAX.employee'] ?? 0) + (december['INCOME_TAX.employee'] ?? 0);
			return {
				monthly,
				year: monthly + (december['YEAR_END_ADJUSTMENT.employee'] ?? 0)
			};
		}).pipe(Effect.provide(workspace({ seed: late, now: NOW })));
	};
	it.live('the year-end adjustment settles the tax on the correct total', () =>
		Effect.gen(function* () {
			const right = yield* taken((t) =>
				onCycle(t, '2026-11').pipe(Effect.andThen(onCycle(t, '2026-12')))
			);
			const over = yield* taken((t, seed) =>
				Effect.gen(function* () {
					yield* enter(t, seed, 'WAGE_ADJUSTMENT', WRONG, '2026-11-10');
					yield* onCycle(t, '2026-11');
					yield* enter(t, seed, 'WAGE_ADJUSTMENT', WRONG, '2026-12-10', true);
					yield* onCycle(t, '2026-12');
				})
			);
			// the monthly table is progressive, so the two months alone come out wrong
			assert.notEqual(over.monthly, right.monthly);
			assert.equal(over.year, right.year);
		})
	);
	it.live('a premium collected late counts at year end', () =>
		Effect.gen(function* () {
			const right = yield* taken((t) =>
				onCycle(t, '2026-11').pipe(Effect.andThen(onCycle(t, '2026-12')))
			);
			const late = yield* taken((t, seed) =>
				Effect.gen(function* () {
					yield* onCycle(t, '2026-11');
					yield* enter(t, seed, 'SOCIAL_INSURANCE_ADJUSTMENT', 50_000, '2026-12-10');
					yield* onCycle(t, '2026-12');
				})
			);
			assert.ok(late.year < right.year);
		})
	);
	it.live('a premium paid back on its own item leaves the year-end deduction', () =>
		Effect.gen(function* () {
			const right = yield* taken((t) =>
				onCycle(t, '2026-11').pipe(Effect.andThen(onCycle(t, '2026-12')))
			);
			const back = yield* taken((t, seed) =>
				Effect.gen(function* () {
					yield* onCycle(t, '2026-11');
					yield* enter(t, seed, 'SOCIAL_INSURANCE_REFUND', 50_000, '2026-12-10');
					yield* onCycle(t, '2026-12');
				})
			);
			assert.ok(back.year > right.year);
		})
	);
	it.live('a bonus reversed in December refunds its premiums, and the year stands', () =>
		Effect.gen(function* () {
			const right = yield* taken((t) =>
				onCycle(t, '2026-11').pipe(Effect.andThen(onCycle(t, '2026-12')))
			);
			const refunded = yield* taken((t, seed) =>
				Effect.gen(function* () {
					yield* enter(t, seed, 'BONUS', WRONG, '2026-11-10');
					yield* onCycle(t, '2026-11');
					yield* enter(t, seed, 'BONUS', WRONG, '2026-12-10', true);
					yield* onCycle(t, '2026-12');
					const december = yield* month(t, '2026-12', PREMIUMS, EMPLOYEE);
					assert.ok(Object.values(december).some((value) => value < 0));
				})
			);
			assert.equal(refunded.year, right.year);
		})
	);
});

describe('a second salary in a pay month', () => {
	it.live('August owes what July owed', () => {
		const base = seedOf(500_000);
		const seed: Seed = {
			...base,
			entity_profile_version: (base.entity_profile_version ?? []).map((row) => ({
				...row,
				payment_schedule: {
					frequency: 'MONTHLY',
					business_day: 'PREVIOUS',
					non_working_weekdays: [0, 6],
					short_month: 'LAST_DAY',
					anchors: [{ cycle_part: 1, day: 1, month_offset: 0 }]
				}
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, '2026-07');
			yield* onCycle(t, '2026-08');
			assert.deepEqual(
				yield* month(t, '2026-08', FOLLOWING, BOTH),
				yield* month(t, '2026-07', FOLLOWING, BOTH)
			);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-08-20T02:00:00.000Z' })));
	});
});

describe('a no-pay day', () => {
	const noPay = (seed: Seed) => {
		const version = seed.employee_contract?.[0]?.input_schema_version_id;
		const row = seed.leave_catalog?.find(
			(item) => item.code === 'UNPAID_LEAVE' && item.settings_id === version
		);
		assert.ok(row !== undefined);
		return idOf('leave_catalog', String(row.id));
	};
	const whole = (date: string) => [
		{ date: PlainDate(date), part: 'AM' as const },
		{ date: PlainDate(date), part: 'PM' as const }
	];
	const take = (t: Kit, seed: Seed, days: ReturnType<typeof whole>, is_reversal = false) =>
		t
			.as(t.admin)
			.act('leave_catalog_entry.create', [
				{ entity_id: ENTITY, employment_id: CONTRACT, catalog_id: noPay(seed), days, is_reversal }
			]);
	const line = (slip: PayslipBreakdown | undefined) =>
		slip?.lines.find((row) => row.code === 'UNPAID_LEAVE');
	// 22 working days in June, 23 in July
	const FIXED = { FIXED_ALLOWANCE: { amount: 22_000 } };
	const NOW = '2026-07-20T02:00:00.000Z';

	it.live('comes off as a line: the month’s pay and fixed allowance ÷ its working days', () => {
		const seed = seedOf(440_000, FIXED);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, whole('2026-06-10'));
			yield* onCycle(t, '2026-06');
			const [june] = yield* runs(t, '2026-06');
			assert.equal(line(june)?.amount, 21_000);
			assert.equal(line(june)?.direction, 'DEDUCT');
			assert.equal(june?.checkpoints.find((row) => row.code === 'BASIC')?.value, 440_000);
			assert.equal(june?.checkpoints.find((row) => row.code === 'ORDINARY_WAGES')?.value, 441_000);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});

	it.live('a half day is half', () => {
		const seed = seedOf(440_000, FIXED);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, [{ date: PlainDate('2026-06-10'), part: 'AM' }]);
			yield* onCycle(t, '2026-06');
			const [june] = yield* runs(t, '2026-06');
			assert.equal(line(june)?.amount, 10_500);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});

	it.live('the roster’s days are the month’s working days', () => {
		const rest = (date: string) => ({ date, shift: uuid(12), hours: 1 });
		const seed = seedOf(440_000, {}, [rest('2026-06-11'), rest('2026-06-12')]);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, whole('2026-06-10'));
			yield* onCycle(t, '2026-06');
			const [june] = yield* runs(t, '2026-06');
			assert.equal(line(june)?.amount, 22_000);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});

	/** The month the salary basis would have paid, on the same seed with the rows back as UNPAID. */
	const onTheBasis = (seed: Seed): Seed => ({
		...seed,
		leave_catalog: (seed.leave_catalog ?? []).map((row) =>
			NO_PAY.includes(String(row.code)) ? { ...row, pay_treatment: 'UNPAID' } : row
		)
	});
	const paid = (seed: Seed, days: ReturnType<typeof whole>) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, days);
			yield* onCycle(t, '2026-06');
			const [june] = yield* runs(t, '2026-06');
			const [slip] = (yield* t.storedQuery({ payslip: { limit: 1 } })).payslip.rows;
			return {
				net: slip?.net_pay,
				ordinary: june?.checkpoints.find((row) => row.code === 'ORDINARY_WAGES')?.value,
				statutory: june?.statutory.map(({ code, employee, employer }) => [code, employee, employer])
			};
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	const everyDay = Array.from({ length: 30 }, (_, index) =>
		whole(`2026-06-${String(index + 1).padStart(2, '0')}`)
	).flat();
	const SAME: readonly (readonly [string, ReturnType<typeof whole>])[] = [
		['a half day', [{ date: PlainDate('2026-06-10'), part: 'AM' }]],
		['three days', [...whole('2026-06-10'), ...whole('2026-06-11'), ...whole('2026-06-12')]],
		['the whole month', everyDay]
	];
	for (const [name, days] of SAME)
		it.live(
			`${name}: net pay and every statutory figure stand as the salary basis left them`,
			() => {
				const seed = seedOf(500_000, { FIXED_ALLOWANCE: { amount: 30_000 } });
				return Effect.gen(function* () {
					assert.deepEqual(yield* paid(seed, days), yield* paid(onTheBasis(seed), days));
				});
			}
		);

	it.live('reversed after payment, the next period’s run gives back what June took, once', () => {
		const seed = seedOf(440_000, FIXED);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, whole('2026-06-10'));
			yield* onCycle(t, '2026-06');
			yield* take(t, seed, whole('2026-07-06'), true);
			yield* onCycle(t, '2026-07');
			const [june] = yield* runs(t, '2026-06');
			const [july] = yield* runs(t, '2026-07');
			assert.equal(line(july)?.amount, line(june)?.amount);
			assert.equal(line(july)?.direction, 'ADD');
			yield* onCycle(t, '2026-08');
			const [august] = yield* runs(t, '2026-08');
			assert.equal(line(august), undefined);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-08-20T02:00:00.000Z' })));
	});

	it.live('a half day reversed comes back at the half taken', () => {
		const seed = seedOf(440_000, FIXED);
		const half = (date: string) => [{ date: PlainDate(date), part: 'AM' as const }];
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, half('2026-06-10'));
			yield* onCycle(t, '2026-06');
			yield* take(t, seed, half('2026-07-06'), true);
			yield* onCycle(t, '2026-07');
			const [july] = yield* runs(t, '2026-07');
			assert.equal(line(july)?.amount, 10_500);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});

	it.live('a date in a period that has run is refused, and says why', () => {
		const seed = seedOf(440_000, FIXED);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, '2026-06');
			const late = yield* Effect.flip(take(t, seed, whole('2026-06-10'), true));
			assert.match(String(late), /already run/);
			const missed = yield* Effect.flip(take(t, seed, whole('2026-06-11')));
			assert.match(String(missed), /already run/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
});
