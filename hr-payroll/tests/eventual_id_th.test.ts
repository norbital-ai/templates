// A wrong payment needs no automatic entry: HR corrects the pay, and the next cycle's statutory rows count the total paid.
// A no-pay day is a catalog line, so a reversal entry after payment pays back exactly what it took.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { lookupOf } from '../src/lib/payroll_engine/contracts.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	WORK,
	accountsIn,
	pack,
	read,
	sealedAdhoc,
	sealedLeave,
	uuid,
	workspace
} from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const JUNE = '2026-06-20T02:00:00.000Z';
const DECEMBER = '2026-12-20T02:00:00.000Z';
const terms = (
	amount: number,
	allowances: Record<string, { readonly amount: number; readonly variability?: string }> = {},
	unit = 'MONTHLY'
) => ({
	rate: { amount, unit },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances
});
type Terms = ReturnType<typeof terms>;
type Seed = ReturnType<typeof pack>;
type Place = {
	readonly code: string;
	readonly zone: string;
	readonly item: string;
	readonly entity: Parameters<typeof pack>[3];
	readonly facts: Parameters<typeof pack>[3];
};
const INDONESIA: Place = {
	code: 'ID',
	zone: 'Asia/Jakarta',
	item: 'BACK_PAY_SALARY',
	entity: { risk_class: 'I' },
	facts: {}
};
const THAILAND: Place = {
	code: 'TH',
	zone: 'Asia/Bangkok',
	item: 'SUSPENSION_BACK_PAY',
	entity: { wcf_rate_percent: 0.2, pvd_employer_percent: 3 },
	facts: { statutory: { PVD: { kind: 'MEMBER', elections: { employee_percent: 5 } } } }
};
type Options = {
	readonly on?: string;
	readonly from?: string;
	readonly days?: Parameters<typeof pack>[4];
	readonly facts?: Parameters<typeof pack>[3];
};
const seedOf = (place: Place, agreed: Terms, options: Options = {}): Seed => {
	const { on = '2026-06-15', from = '2026-01-01', days = [], facts = {} } = options;
	const seed = pack(place.code, place.zone, agreed, { ...place.facts, ...facts }, days, [], on);
	return {
		...seed,
		entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
			...row,
			entity_extension_data: place.entity
		})),
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from, to: null }
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
			unit: 'MONEY',
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
const BOTH = ['.employee', '.employer'];
const EMPLOYEE = ['.employee'];
/** Every row the periods charged across their runs: a refund counts against it. */
const charged = (
	t: Kit,
	periods: readonly string[],
	codes: readonly string[],
	sides: readonly string[]
) =>
	Effect.forEach(periods, (period) => runs(t, period)).pipe(
		Effect.map((months) => {
			const totals = new Map<string, number>();
			const add = (key: string, value: number) => totals.set(key, (totals.get(key) ?? 0) + value);
			for (const { code, employee, employer } of months.flat().flatMap((slip) => slip.statutory)) {
				if (!codes.includes(code)) continue;
				add(`${code}.employee`, employee);
				add(`${code}.employer`, employer);
			}
			return Object.fromEntries(
				[...totals]
					.filter(([key]) => sides.some((side) => key.endsWith(side)))
					.map(([key, value]) => [key, Number(value.toFixed(2))] as const)
					.sort(([left], [right]) => left.localeCompare(right))
			);
		})
	);
const row = (slip: PayslipBreakdown | undefined, code: string) =>
	slip?.statutory.find((one) => one.code === code);

const ID_ROWS = ['JHT', 'JP', 'JKK', 'JKM', 'KESEHATAN', 'PPH21'];
const TH_ROWS = ['SSO', 'WCF', 'PVD'];
const TH_ALL = [...TH_ROWS, 'PND1'];

type Case = {
	readonly place: Place;
	readonly salary: number;
	readonly correction: number;
	readonly codes: readonly string[];
	readonly period: string;
	readonly now: string;
	readonly earlier?: readonly string[];
	readonly options?: Options;
};
const within = ({ place, salary, codes, period, now, earlier = [], options = {} }: Case) => {
	const seed = seedOf(place, terms(salary), { on: `${period}-15`, ...options });
	return <A, E>(month: (t: Kit) => Effect.Effect<A, E, never>, sides: readonly string[]) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			for (const cycle of earlier) yield* onCycle(t, cycle);
			yield* month(t);
			return yield* charged(t, [period], codes, sides);
		}).pipe(Effect.provide(workspace({ seed, now })));
};

/** The on-cycle run paid short, the rest goes off-cycle in the same month: together they owe one run of the whole. */
const toppedUp = (one: Case) => {
	const { place, salary, correction, period } = one;
	const seed = seedOf(place, terms(salary), { on: `${period}-15`, ...one.options });
	const month = within(one);
	return Effect.gen(function* () {
		const whole = yield* month(
			(t) =>
				enter(t, seed, place.item, correction, `${period}-10`).pipe(
					Effect.andThen(onCycle(t, period))
				),
			BOTH
		);
		const twice = yield* month(
			(t) =>
				onCycle(t, period).pipe(
					Effect.andThen(enter(t, seed, place.item, correction, `${period}-10`)),
					Effect.andThen(offCycle(t, period))
				),
			BOTH
		);
		assert.deepEqual(twice, whole);
	});
};

/** The same reversal off-cycle would pay below zero, and nothing negative posts to a balance. */
const refusedOffCycle = ({ place, salary, correction, period, now, options = {} }: Case) => {
	const seed = seedOf(place, terms(salary), { on: `${period}-15`, ...options });
	return Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* enter(t, seed, place.item, correction, `${period}-05`);
		yield* onCycle(t, period);
		yield* enter(t, seed, place.item, correction, `${period}-15`, yield* sealedAdhoc(t));
		const refused = yield* Effect.flip(offCycle(t, period));
		assert.match(
			String(refused),
			/This run would take someone below zero\. A reversal goes in the next on-cycle run\./
		);
	}).pipe(Effect.provide(workspace({ seed, now })));
};

/**
 * The correction rides the next on-cycle run: no line goes negative, the second month's employee rows come to `lower`,
 * and the two months' figures equal two correct months.
 */
const nextMonth = (
	one: Case,
	first: string,
	second: string,
	lower: Readonly<Record<string, number>> = {},
	stops = false
) => {
	const { place, salary, correction, codes, now, options = {} } = one;
	const seed = seedOf(place, terms(salary), { on: `${first}-15`, ...options });
	const months = [first, second];
	const rows = Object.keys(lower).map((key) => key.replace('.employee', ''));
	return Effect.gen(function* () {
		const corrected = yield* Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, place.item, correction, `${first}-05`);
			yield* onCycle(t, first);
			yield* enter(t, seed, place.item, correction, `${second}-05`, yield* sealedAdhoc(t));
			yield* onCycle(t, second);
			const [taken] = yield* runs(t, second);
			assert.ok(taken !== undefined);
			for (const line of taken.lines) assert.ok(line.amount >= 0, `${line.code} went negative`);
			for (const row of taken.statutory) assert.ok(row.employee >= 0, `${row.code} went negative`);
			assert.deepEqual(yield* charged(t, [second], rows, EMPLOYEE), lower);
			return yield* charged(t, months, codes, EMPLOYEE);
		}).pipe(Effect.provide(workspace({ seed, now })));
		const right = yield* Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, first);
			yield* onCycle(t, second);
			return yield* charged(t, months, codes, EMPLOYEE);
		}).pipe(Effect.provide(workspace({ seed, now })));
		// a row with no refund route stops at zero: what the first month took stands, and the rest stays right
		if (stops)
			assert.ok(Object.entries(right).every(([key, value]) => (corrected[key] ?? 0) >= value));
		else assert.deepEqual(corrected, right);
	});
};

const INDONESIA_IN_JUNE = { place: INDONESIA, period: '2026-06', now: JUNE, codes: ID_ROWS };
const THAILAND_IN_JUNE = { place: THAILAND, period: '2026-06', now: JUNE, codes: TH_ROWS };
const JOINED_NOVEMBER: Options = {
	from: '2026-11-01',
	facts: { tax_subject_from: '2026-11-01' }
};
const INDONESIA_IN_DECEMBER = {
	place: INDONESIA,
	period: '2026-12',
	now: DECEMBER,
	codes: ID_ROWS,
	earlier: ['2026-11'],
	options: JOINED_NOVEMBER
};
const THAILAND_IN_DECEMBER = {
	place: THAILAND,
	period: '2026-12',
	now: DECEMBER,
	codes: TH_ALL,
	earlier: ['2026-11']
};

describe('paid short, topped up in the same month', () => {
	it.live('Indonesia: over a TER band, the month’s PPh 21 counts both runs', () =>
		toppedUp({ ...INDONESIA_IN_JUNE, salary: 9_000_000, correction: 3_000_000 })
	);
	it.live('Indonesia: December’s reckoning counts both runs', () =>
		toppedUp({ ...INDONESIA_IN_DECEMBER, salary: 30_000_000, correction: 10_000_000 })
	);
	it.live('Thailand: past the SSO ceiling it stops at the ceiling', () =>
		toppedUp({ ...THAILAND_IN_JUNE, salary: 15_000, correction: 5000 })
	);
	it.live('Thailand: December’s PND1 counts both runs', () =>
		toppedUp({ ...THAILAND_IN_DECEMBER, salary: 150_000, correction: 50_000 })
	);
	it.live('Thailand: overtime stays out of the month’s SSO wages', () => {
		const days = [{ date: '2026-06-10', shift: WORK, hours: 10, overtime: 2 }];
		const seed = seedOf(THAILAND, terms(15_000), { days });
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, '2026-06');
			yield* enter(t, seed, THAILAND.item, 1000, '2026-06-15');
			yield* offCycle(t, '2026-06');
			const [first] = yield* runs(t, '2026-06');
			assert.ok(first?.lines.some((line) => line.code === 'OVERTIME'));
			assert.deepEqual(yield* charged(t, ['2026-06'], ['SSO'], EMPLOYEE), { 'SSO.employee': 800 });
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
});

describe('paid too much, reversed in the next on-cycle run', () => {
	const INDONESIA_WAGES = { ...INDONESIA_IN_JUNE, salary: 9_000_000, correction: 3_000_000 };
	const THAILAND_WAGES = { ...THAILAND_IN_JUNE, salary: 15_000, correction: 5000 };
	it.live('Indonesia: off-cycle in the same month it is refused', () =>
		refusedOffCycle(INDONESIA_WAGES)
	);
	it.live('Thailand: off-cycle in the same month it is refused', () =>
		refusedOffCycle(THAILAND_WAGES)
	);
	// BPJS stands on the contract's wage (PP 44/2015 art.19), so of Indonesia's rows PPh 21 moves: 1% TER of 6,408,600
	it.live('Indonesia: June’s PPh 21 counts the lower pay, no negative line', () =>
		nextMonth({ ...INDONESIA_WAGES, codes: [] }, '2026-05', '2026-06', {
			'JHT.employee': 180_000,
			'PPH21.employee': 64_086
		})
	);
	it.live('Indonesia: December’s reckoning nets the two months', () =>
		nextMonth(
			{
				...INDONESIA_IN_DECEMBER,
				salary: 30_000_000,
				correction: 10_000_000,
				codes: ['PPH21']
			},
			'2026-11',
			'2026-12',
			{ 'JHT.employee': 600_000 }
		)
	);
	it.live('Thailand: June’s SSO and PVD count the lower wages, and PND1 nets', () =>
		nextMonth({ ...THAILAND_WAGES, codes: ['PND1'] }, '2026-05', '2026-06', {
			'SSO.employee': 500,
			'PVD.employee': 500
		})
	);
	it.live('Thailand: a bonus is no wage, so SSO and PVD stay and PND1 stops at zero', () =>
		nextMonth(
			{
				...THAILAND_IN_JUNE,
				place: { ...THAILAND, item: 'BONUS' },
				salary: 120_000,
				correction: 90_000,
				codes: ['PND1']
			},
			'2026-05',
			'2026-06',
			{ 'SSO.employee': 875, 'PVD.employee': 6000, 'PND1.employee': 0 },
			true
		)
	);
	it.live('Thailand: in December PND1 stops at zero too', () =>
		nextMonth(
			{ ...THAILAND_IN_DECEMBER, salary: 150_000, correction: 50_000, codes: ['PND1'] },
			'2026-11',
			'2026-12',
			{ 'PVD.employee': 5000, 'PND1.employee': 0 },
			true
		)
	);
});

describe('corrected in the next month', () => {
	const INDONESIA_ACROSS = {
		place: INDONESIA,
		period: '2026-11',
		now: DECEMBER,
		codes: ['PPH21'],
		options: JOINED_NOVEMBER
	};
	const THAILAND_ACROSS = {
		place: THAILAND,
		period: '2026-11',
		now: DECEMBER,
		codes: ['PND1']
	};
	it.live('Indonesia: the two months’ PPh 21 equals the correct total', () =>
		nextMonth(
			{ ...INDONESIA_ACROSS, salary: 30_000_000, correction: 10_000_000 },
			'2026-11',
			'2026-12'
		)
	);
	it.live('Thailand: the two months’ PND1 equals the correct total', () =>
		nextMonth({ ...THAILAND_ACROSS, salary: 60_000, correction: 30_000 }, '2026-11', '2026-12')
	);
	it.live('Thailand: a correction past what December owes stops at zero', () =>
		nextMonth(
			{ ...THAILAND_ACROSS, salary: 100_000, correction: 90_000 },
			'2026-11',
			'2026-12',
			{ 'PND1.employee': 0 },
			true
		)
	);
	it.live('Indonesia: the next month’s PPh 21 counts the lower pay', () => {
		const seed = seedOf(INDONESIA, terms(30_000_000));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, INDONESIA.item, 10_000_000, '2026-05-05');
			yield* onCycle(t, '2026-05');
			yield* enter(t, seed, INDONESIA.item, 10_000_000, '2026-06-05', yield* sealedAdhoc(t));
			yield* onCycle(t, '2026-06');
			const [may] = yield* runs(t, '2026-05');
			const [june] = yield* runs(t, '2026-06');
			assert.ok(Number(row(june, 'PPH21')?.employee) < Number(row(may, 'PPH21')?.employee));
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
	it.live('Thailand: the next month’s SSO is on that month’s wages', () => {
		const seed = seedOf(THAILAND, terms(12_000));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, THAILAND.item, 3000, '2026-05-05');
			yield* onCycle(t, '2026-05');
			yield* enter(t, seed, THAILAND.item, 3000, '2026-06-05', yield* sealedAdhoc(t));
			yield* onCycle(t, '2026-06');
			const [may] = yield* runs(t, '2026-05');
			const [june] = yield* runs(t, '2026-06');
			assert.equal(row(may, 'SSO')?.employee, 750);
			assert.equal(row(june, 'SSO')?.employee, 450);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
});

describe('a benefit over two calendar years', () => {
	// thirteen months apart, past what the balance keeps by month
	const LATER = '2027-04-20T02:00:00.000Z';
	const ITEM = 'PENSION_LUMPSUM';
	const seed = seedOf(INDONESIA, terms(10_000_000), {
		facts: { pension_tax_history: { first_payment_year: 2026 } }
	});
	const pension = (t: Kit, period: string) =>
		runs(t, period).pipe(
			Effect.map(([slip]) => slip?.statutory.find((row) => row.code === 'PPH21_FINAL_PENSION'))
		);
	const pay = (t: Kit, period: string) =>
		Effect.gen(function* () {
			yield* onCycle(t, period);
			const run = (yield* t.storedQuery({ payroll_run: { limit: 100 } })).payroll_run.rows.find(
				(row) => row.period === period
			);
			assert.ok(run !== undefined);
			yield* t.as(t.admin).act('payroll_run.update', [{ target: run.id, set: { state: 'PAID' } }]);
			yield* t.runDue();
		});
	/** What each calendar year holds of a benefit, the checkpoint under it taken off, and of the tax on it. */
	const posted = (t: Kit, benefit: string, below: string, tax: string) =>
		accountsIn(t).pipe(
			Effect.map((accounts) => {
				const years = (family: string, code: string, measure: string) =>
					Object.entries(accounts[family]?.[code] ?? {}).flatMap(([period, measures]) =>
						period.includes('.Y.') ? [[period, measures[measure] ?? 0] as const] : []
					);
				const under = new Map(years('pay', below, 'total'));
				return [
					...years('pay', benefit, 'total').map(
						([period, total]) => `${period} ${total - (under.get(period) ?? 0)}`
					),
					...years('statutory', tax, 'paid').map(([period, paid]) => `${period} ${paid}`)
				];
			})
		);
	const pensions = (t: Kit) =>
		posted(t, 'PENSION_BENEFIT', 'SEVERANCE', 'PPH21_FINAL_PENSION.employee');

	it.live('the second year stands on the first year’s ladder', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, ITEM, 100_000_000, '2026-03-10');
			yield* pay(t, '2026-03');
			assert.equal((yield* pension(t, '2026-03'))?.employee, 2_500_000);
			yield* enter(t, seed, ITEM, 100_000_000, '2027-04-10');
			yield* pay(t, '2027-04');
			assert.equal((yield* pension(t, '2027-04'))?.employee, 5_000_000);
			assert.deepEqual(yield* pensions(t), [
				'ID.Y.2026-01-01 100000000',
				'ID.Y.2027-01-01 100000000',
				'ID.Y.2026-01-01 2500000',
				'ID.Y.2027-01-01 5000000'
			]);
		}).pipe(Effect.provide(workspace({ seed, now: LATER })))
	);
	it.live('a reversal in the second year takes it back off the ladder', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, ITEM, 100_000_000, '2026-03-10');
			yield* pay(t, '2026-03');
			yield* enter(t, seed, ITEM, 50_000_000, '2027-04-10', yield* sealedAdhoc(t));
			yield* pay(t, '2027-04');
			assert.equal((yield* pension(t, '2027-04'))?.employee, -2_500_000);
		}).pipe(Effect.provide(workspace({ seed, now: LATER })))
	);
	it.live('severance posts what sits above additional wages', () => {
		const leaving = seedOf(INDONESIA, terms(10_000_000), {
			facts: { severance_tax_history: { first_payment_year: 2026 }, hired_at_other_place: true }
		});
		const last = {
			...leaving,
			employee_contract: (leaving.employee_contract ?? []).map((row) => ({
				...row,
				effective_range: { from: '2026-01-01', to: '2026-03-31' }
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, last, 'UPH_TRAVEL_HOME', 100_000_000, '2026-03-31');
			yield* pay(t, '2026-03');
			assert.deepEqual(
				yield* posted(t, 'SEVERANCE', 'ADDITIONAL_WAGES', 'PPH21_FINAL_SEVERANCE.employee'),
				['ID.Y.2026-01-01 100000000', 'ID.Y.2026-01-01 2500000']
			);
		}).pipe(Effect.provide(workspace({ seed: last, now: LATER })));
	});
	it.live('a run cannot be paid until its balances have it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			yield* admin.act('payroll_run.create', [
				{ entity_id: ENTITY, period: '2026-03', kind: 'ON_CYCLE' }
			]);
			const run = (yield* t.storedQuery({ payroll_run: { limit: 1 } })).payroll_run.rows[0];
			assert.ok(run !== undefined);
			const paid = admin.act('payroll_run.update', [{ target: run.id, set: { state: 'PAID' } }]);
			assert.match(String(yield* Effect.flip(paid)), /still posting/);
			yield* t.runDue();
			yield* paid;
		}).pipe(Effect.provide(workspace({ seed, now: LATER })))
	);
	it.live('an unpaid run posts from its payslip, and deleting it takes that back', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, ITEM, 100_000_000, '2026-03-10');
			yield* onCycle(t, '2026-03');
			assert.deepEqual(yield* pensions(t), [
				'ID.Y.2026-01-01 100000000',
				'ID.Y.2026-01-01 2500000'
			]);
			const run = (yield* t.storedQuery({ payroll_run: { limit: 1 } })).payroll_run.rows[0];
			assert.ok(run !== undefined);
			yield* t.as(t.admin).act('payroll_run.delete', [{ target: run.id }]);
			yield* t.runDue();
			assert.deepEqual(yield* pensions(t), ['ID.Y.2026-01-01 0', 'ID.Y.2026-01-01 0']);
		}).pipe(Effect.provide(workspace({ seed, now: LATER })))
	);
});

describe('a lump sum across a month’s runs', () => {
	const folder = 'seed/public/jurisdiction/ID/version_3';
	const [settings] = read(join(folder, 'jurisdiction_settings.json'));
	assert.ok(settings !== undefined);
	/** A pay month's figures, by the year each is held under. */
	const yearsOf = (held: Readonly<Record<string, number>>) => {
		const years: Record<string, Record<string, number>> = {};
		for (const [key, value] of Object.entries(held))
			(years[key.slice(0, 4)] ??= {})[key.slice(8)] = value;
		return years;
	};
	const owed = (
		code: string,
		subtotals: Readonly<Record<string, number>>,
		month: Readonly<Record<string, number>>,
		paid: Readonly<Record<string, number>> = {}
	) => {
		const scheme = read(join(folder, 'statutory_contribution_catalog.json')).find(
			(one) => one.code === code
		);
		assert.ok(scheme !== undefined);
		return evaluate(
			String(scheme.employee_amount),
			'CALCULATION',
			{
				subject: {
					employment: {
						employee_extension_data: { severance_tax_history: { first_payment_year: 2026 } }
					}
				},
				lookup: { ...lookupOf(settings), ...lookupOf(scheme) },
				run: {
					kind: 'OFF_CYCLE',
					pay_date: '2026-06-25',
					salary_coverage: { from: '2026-06-01', to: '2026-06-30' }
				},
				as_of: '2026-06-30',
				subtotals,
				balances: { month, years: yearsOf({ ...paid, ...month }) }
			},
			code
		);
	};
	const FORTY_PAID = { '2026-06.ADDITIONAL_WAGES': 10_000_000, '2026-06.SEVERANCE': 50_000_000 };

	it('Indonesia: severance paid in two parts is one payment on the ladder', () => {
		const wages = { ADDITIONAL_WAGES: 0, SEVERANCE: 50_000_000 };
		assert.equal(owed('PPH21_FINAL_SEVERANCE', wages, FORTY_PAID), 2_000_000);
	});
	it('Indonesia: severance counts the months paid before, from the first payment’s year', () => {
		const paid = {
			'2025-03.SEVERANCE': 400_000_000,
			'2025-03.PPH21_FINAL_SEVERANCE.employee': 57_500_000,
			'2026-03.SEVERANCE': 100_000_000,
			'2026-03.PPH21_FINAL_SEVERANCE.employee': 2_500_000
		};
		const wages = { ADDITIONAL_WAGES: 0, SEVERANCE: 100_000_000 };
		assert.equal(owed('PPH21_FINAL_SEVERANCE', wages, {}, paid), 15_000_000);
	});
	it('Indonesia: severance counts an earlier run not marked paid yet', () => {
		const month = {
			'2026-05.ADDITIONAL_WAGES': 10_000_000,
			'2026-05.SEVERANCE': 110_000_000,
			'2026-05.PPH21_FINAL_SEVERANCE.employee': 2_500_000
		};
		const wages = { ADDITIONAL_WAGES: 0, SEVERANCE: 100_000_000 };
		assert.equal(owed('PPH21_FINAL_SEVERANCE', wages, month), 15_000_000);
	});
	it('Indonesia: severance reversed comes off what the month charged', () => {
		const wages = { ADDITIONAL_WAGES: 0, SEVERANCE: -50_000_000 };
		const month = {
			'2026-06.ADDITIONAL_WAGES': 10_000_000,
			'2026-06.SEVERANCE': 100_000_000,
			'2026-06.PPH21_FINAL_SEVERANCE.employee': 2_000_000
		};
		assert.equal(owed('PPH21_FINAL_SEVERANCE', wages, month), -2_000_000);
	});
	it('Indonesia: a non-employee’s month is one figure on the ladder', () => {
		const month = {
			'2026-06.ADDITIONAL_WAGES': 100_000_000,
			'2026-06.PPH21_BUKAN_PEGAWAI.employee': 2_500_000
		};
		assert.equal(owed('PPH21_BUKAN_PEGAWAI', { ADDITIONAL_WAGES: 200_000_000 }, month), 14_000_000);
	});
});

describe('a month’s second salary stands alone', () => {
	const paidOnTheFirst = (seed: Seed): Seed => ({
		...seed,
		entity_profile_version: (seed.entity_profile_version ?? []).map((one) => ({
			...one,
			payment_schedule: {
				frequency: 'MONTHLY',
				business_day: 'PREVIOUS',
				non_working_weekdays: [0, 6],
				short_month: 'LAST_DAY',
				anchors: [{ cycle_part: 1, day: 1, month_offset: 0 }]
			}
		}))
	});
	// 1 August 2026 is a Saturday, so August's salary is paid on 31 July, in July's pay month
	const twice = (place: Place, salary: number, codes: readonly string[]) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, '2026-07');
			yield* onCycle(t, '2026-08');
			assert.deepEqual(
				yield* charged(t, ['2026-08'], codes, BOTH),
				yield* charged(t, ['2026-07'], codes, BOTH)
			);
		}).pipe(
			Effect.provide(
				workspace({
					seed: paidOnTheFirst(seedOf(place, terms(salary))),
					now: '2026-08-20T02:00:00.000Z'
				})
			)
		);
	it.live('Indonesia: August owes what July owed', () => twice(INDONESIA, 9_000_000, ID_ROWS));
	it.live('Thailand: August owes what July owed', () => twice(THAILAND, 15_000, TH_ROWS));
});

const ID_NO_PAY = ['UNPAID_LEAVE'];
const TH_NO_PAY = [
	'SICK_LEAVE_UNPAID',
	'TRAINING_LEAVE',
	'MATERNITY_LEAVE_SSO',
	'UNPAID_LEAVE',
	'WORK_INJURY_LEAVE'
];
const noPay = (seed: Seed, code: string) => {
	const version = seed.employee_contract?.[0]?.input_schema_version_id;
	const item = seed.leave_catalog?.find((one) => one.code === code && one.settings_id === version);
	assert.ok(item !== undefined);
	return idOf('leave_catalog', String(item.id));
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
		{
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: noPay(seed, code),
			days,
			reverses
		}
	]);
const takenIn = (t: Kit, period: string, code: string) =>
	runs(t, period).pipe(
		Effect.map(([slip]) => {
			const line = slip?.lines.find((one) => one.code === code);
			if (line === undefined) return undefined;
			return Number(line.amount.toFixed(2)) * (line.direction === 'DEDUCT' ? -1 : 1);
		})
	);
const AUGUST = '2026-08-20T02:00:00.000Z';

const ID_SEED = seedOf(
	INDONESIA,
	terms(10_000_000, { HOUSE_ALLOWANCE: { amount: 1_000_000, variability: 'FIXED' } })
);
const TH_SEED = seedOf(THAILAND, terms(28_000, { FIXED_ALLOWANCE: { amount: 2000 } }));

describe('a no-pay day in Indonesia', () => {
	const code = 'UNPAID_LEAVE';
	it.live('comes off at monthly pay ÷ the month’s working days, a line on the payslip', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, ID_SEED, code, whole('2026-06-10'));
			yield* onCycle(t, '2026-06');
			assert.equal(yield* takenIn(t, '2026-06', code), -500_000);
		}).pipe(Effect.provide(workspace({ seed: ID_SEED, now: JUNE })))
	);
	it.live('a half day is half, a variable allowance stays out', () => {
		const seed = seedOf(
			INDONESIA,
			terms(11_000_000, { SPECIAL_ALLOWANCE: { amount: 900_000, variability: 'VARIABLE' } })
		);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, code, [{ date: PlainDate('2026-06-10'), part: 'AM' }]);
			yield* onCycle(t, '2026-06');
			assert.equal(yield* takenIn(t, '2026-06', code), -250_000);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
	it.live('a reversal in July gives back June’s day, once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, ID_SEED, code, whole('2026-06-10'));
			yield* onCycle(t, '2026-06');
			yield* take(t, ID_SEED, code, whole('2026-07-06'), yield* sealedLeave(t));
			yield* onCycle(t, '2026-07');
			assert.equal(yield* takenIn(t, '2026-07', code), 500_000);
			yield* onCycle(t, '2026-08');
			assert.equal(yield* takenIn(t, '2026-08', code), undefined);
		}).pipe(Effect.provide(workspace({ seed: ID_SEED, now: AUGUST })))
	);
	it.live('across months of 22 and 23 working days it pays back what it took', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, ID_SEED, code, whole('2026-07-08'));
			yield* onCycle(t, '2026-07');
			yield* take(t, ID_SEED, code, whole('2026-08-05'), yield* sealedLeave(t));
			yield* onCycle(t, '2026-08');
			const given = yield* takenIn(t, '2026-08', code);
			assert.equal(given, -Number((yield* takenIn(t, '2026-07', code)) ?? 0));
			assert.equal(given, 478_260.87);
		}).pipe(Effect.provide(workspace({ seed: ID_SEED, now: AUGUST })))
	);
	it.live('a date in a period that has run is refused', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, ID_SEED, code, whole('2026-06-10'));
			yield* onCycle(t, '2026-06');
			const late = yield* Effect.flip(
				take(t, ID_SEED, code, whole('2026-06-10'), yield* sealedLeave(t))
			);
			assert.match(String(late), /already run/);
		}).pipe(Effect.provide(workspace({ seed: ID_SEED, now: AUGUST })))
	);
	it.live('an entry not yet paid is deleted, not reversed', () => notYetPaid(ID_SEED, code));
});

const notYetPaid = (seed: Seed, code: string) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* take(t, seed, code, whole('2026-06-10'));
		const [open] = (yield* t.storedQuery({ leave_catalog_entry: { limit: 1 } })).leave_catalog_entry
			.rows;
		assert.ok(open !== undefined);
		const refused = yield* Effect.flip(take(t, seed, code, whole('2026-06-10'), open.id));
		assert.match(String(refused), /not been paid yet/);
		yield* t.as(t.admin).act('leave_catalog_entry.delete', [{ target: open.id }]);
		yield* onCycle(t, '2026-06');
		assert.equal(yield* takenIn(t, '2026-06', code), undefined);
	}).pipe(Effect.provide(workspace({ seed, now: JUNE })));

describe('a no-pay day in Thailand', () => {
	for (const code of TH_NO_PAY)
		it.live(`${code}: a line at monthly wage ÷ the month’s days, paid back by a reversal`, () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, TH_SEED, code, whole('2026-06-10'));
				yield* onCycle(t, '2026-06');
				assert.equal(yield* takenIn(t, '2026-06', code), -1000);
				yield* take(t, TH_SEED, code, whole('2026-07-06'), yield* sealedLeave(t));
				yield* onCycle(t, '2026-07');
				assert.equal(yield* takenIn(t, '2026-07', code), 1000);
			}).pipe(Effect.provide(workspace({ seed: TH_SEED, now: AUGUST })))
		);
	const code = 'UNPAID_LEAVE';
	it.live('a half day is half', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, TH_SEED, code, [{ date: PlainDate('2026-06-10'), part: 'PM' }]);
			yield* onCycle(t, '2026-06');
			assert.equal(yield* takenIn(t, '2026-06', code), -500);
		}).pipe(Effect.provide(workspace({ seed: TH_SEED, now: JUNE })))
	);
	it.live('a weekend between two missed days goes with them', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, TH_SEED, code, [...whole('2026-06-12'), ...whole('2026-06-15')]);
			yield* onCycle(t, '2026-06');
			assert.equal(yield* takenIn(t, '2026-06', code), -4000);
		}).pipe(Effect.provide(workspace({ seed: TH_SEED, now: JUNE })))
	);
	it.live('across months of 31 and 30 days it pays back what it took', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, TH_SEED, code, whole('2026-07-08'));
			yield* onCycle(t, '2026-07');
			yield* take(t, TH_SEED, code, whole('2026-08-05'), yield* sealedLeave(t));
			yield* onCycle(t, '2026-08');
			const given = yield* takenIn(t, '2026-08', code);
			assert.equal(given, -Number((yield* takenIn(t, '2026-07', code)) ?? 0));
			assert.equal(given, 967.74);
		}).pipe(Effect.provide(workspace({ seed: TH_SEED, now: AUGUST })))
	);
	it.live('an entry not yet paid is deleted, not reversed', () => notYetPaid(TH_SEED, code));
	it.live('a date in a period that has run is refused', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			for (const [index, item] of TH_NO_PAY.entries())
				yield* take(t, TH_SEED, item, whole(`2026-06-${15 + index}`));
			yield* onCycle(t, '2026-06');
			const { leave_catalog_entry } = yield* t.storedQuery({ leave_catalog_entry: { limit: 10 } });
			for (const item of TH_NO_PAY) {
				const original = leave_catalog_entry.rows.find(
					(row) => row.catalog_id === noPay(TH_SEED, item)
				);
				assert.ok(original !== undefined);
				const late = yield* Effect.flip(take(t, TH_SEED, item, whole('2026-06-10'), original.id));
				assert.match(String(late), /already run/);
			}
		}).pipe(Effect.provide(workspace({ seed: TH_SEED, now: AUGUST })))
	);
});

describe('a no-pay line owes what the salary basis owed', () => {
	/** The same rows on the salary basis: UNPAID, no line. */
	const onTheBasis = (seed: Seed, codes: readonly string[]): Seed => ({
		...seed,
		leave_catalog: (seed.leave_catalog ?? []).map((one) =>
			codes.includes(String(one.code))
				? {
						...Object.fromEntries(
							Object.entries(one).filter(
								([key]) => !['direction', 'party', 'conversion'].includes(key)
							)
						),
						pay_treatment: 'UNPAID',
						subtotal_id: null
					}
				: one
		)
	});
	const paid = (seed: Seed, code: string, days: ReturnType<typeof whole>) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, code, days);
			yield* onCycle(t, '2026-06');
			const [slip] = yield* runs(t, '2026-06');
			return {
				wages: slip?.checkpoints.find((one) => one.code === 'ORDINARY_WAGES')?.value,
				net: slip?.checkpoints.at(-1)?.value,
				statutory: slip?.statutory
			};
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	const same = (seed: Seed, codes: readonly string[], days: ReturnType<typeof whole>) =>
		Effect.gen(function* () {
			const [code] = codes;
			assert.ok(code !== undefined);
			assert.deepEqual(
				yield* paid(seed, code, days),
				yield* paid(onTheBasis(seed, codes), code, days)
			);
		});
	const june = whole('2026-06-10');
	const month = Array.from({ length: 30 }, (_, day) =>
		whole(`2026-06-${String(day + 1).padStart(2, '0')}`)
	).flat();
	const days = [...whole('2026-06-12'), ...whole('2026-06-15')];
	const ID_CODES = ID_NO_PAY;
	const TH_CODES = ['UNPAID_LEAVE'];

	it.live('Indonesia: a salary with a fixed allowance', () => same(ID_SEED, ID_CODES, days));
	it.live('Indonesia: a day rate', () =>
		same(
			seedOf(INDONESIA, terms(300_000, {}, 'DAILY'), {
				facts: { pph21_payment_cadence: 'NON_MONTHLY' }
			}),
			ID_CODES,
			june
		)
	);
	it.live('Indonesia: an hour rate', () =>
		same(seedOf(INDONESIA, terms(40_000, {}, 'HOURLY')), ID_CODES, june)
	);
	it.live('Indonesia: the whole month', () => same(ID_SEED, ID_CODES, month));
	it.live('Thailand: a salary with a fixed allowance', () => same(TH_SEED, TH_CODES, days));
	it.live('Thailand: a day rate with a fixed allowance', () =>
		same(
			seedOf(THAILAND, terms(500, { FIXED_ALLOWANCE: { amount: 3000 } }, 'DAILY')),
			TH_CODES,
			june
		)
	);
	it.live('Thailand: the whole month', () => same(TH_SEED, TH_CODES, month));
});

describe('the catalogs', () => {
	const root = 'seed/public/jurisdiction';
	for (const [code, rows, taken] of [
		['ID', ID_NO_PAY, [...ID_NO_PAY, 'MEDICAL_LEAVE', 'MATERNITY_LEAVE']],
		['TH', TH_NO_PAY, TH_NO_PAY]
	] as const)
		it(`${code}: every version carries the lines and their rule`, () => {
			for (const version of readdirSync(join(root, code))) {
				const leave = read(join(root, code, version, 'leave_catalog.json'));
				const lines = leave.filter((one) => one.pay_treatment === 'UNPAID');
				assert.deepEqual(lines, [], version);
				for (const item of rows) {
					const one = leave.find((candidate) => candidate.code === item);
					assert.equal(one?.direction, 'DEDUCT', `${version} ${item}`);
					assert.equal(one?.party, 'EMPLOYEE', `${version} ${item}`);
					assert.deepEqual(one?.lookup, {
						no_cap: true,
						...(code === 'ID'
							? {
									prorated_allowances: ['CAR_ALLOWANCE', 'HOUSE_ALLOWANCE', 'SPECIAL_ALLOWANCE']
								}
							: {})
					});
				}
				const rules = read(join(root, code, version, 'registered_rule.json'));
				const rule = rules.find((one) => one.code === 'NO_PAY_OPEN_PERIOD');
				assert.deepEqual(rule?.lookup, { no_pay: taken }, version);
			}
		});
});
