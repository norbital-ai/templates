// A month paid in two runs owes what one run of the total owes, and a benefit taxed over calendar years reads what each
// year posted. Indonesia is only the fixture.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, accountsIn, pack, uuid, workspace, storedQuery } from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const DECEMBER = '2026-12-20T02:00:00.000Z';
const terms = (amount: number) => ({
	rate: { amount, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
});
type Terms = ReturnType<typeof terms>;
type Seed = ReturnType<typeof pack>;
type Place = {
	readonly code: string;
	readonly zone: string;
	readonly item: string;
	readonly entity: Parameters<typeof pack>[3];
	readonly extension: Parameters<typeof pack>[3];
};
const INDONESIA: Place = {
	code: 'ID',
	zone: 'Asia/Jakarta',
	item: 'BACK_PAY_SALARY',
	entity: { risk_class: 'I' },
	extension: {}
};
type Options = {
	readonly on?: string;
	readonly from?: string;
	readonly extension?: Parameters<typeof pack>[3];
};
const seedOf = (place: Place, agreed: Terms, options: Options = {}): Seed => {
	const { on = '2026-06-15', from = '2026-01-01', extension = {} } = options;
	const seed = pack(
		place.code,
		place.zone,
		agreed,
		{ ...place.extension, ...extension },
		[],
		[],
		on
	);
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
		.pipe(
			Effect.flatMap((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
			)
		)
		.pipe(Effect.andThen(t.run_due()));
/** The period's on-cycle run, paid: what is entered for the period after it no longer waits on its review. */
const paidCycle = (t: Kit, period: string) =>
	Effect.gen(function* () {
		yield* onCycle(t, period);
		const [run] = (yield* storedQuery(t, {
			payroll_run: { where: { period: { eq: period } }, limit: 1 }
		})).payroll_run.rows;
		assert.ok(run !== undefined);
		yield* (yield* t.as(t.admin)).act({
			'payroll_run.update': [{ target: run, set: { state: 'PAID' } }]
		});
		yield* t.run_due();
	});
const enter = (t: Kit, seed: Seed, item: string, quantity: number, on: string) => {
	const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
	const row = (seed.adhoc_catalog ?? []).find((r) => r.code === item && r.settings_id === version);
	assert.ok(row !== undefined, item);
	return t.as(t.admin).pipe(
		Effect.flatMap((caller) =>
			caller.act({
				'adhoc_catalog_entry.create': [
					{
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: idOf('adhoc_catalog', String(row.id)),
						description: 'Correction',
						quantity,
						incurred_on: PlainDate(on)
					}
				]
			})
		)
	);
};
/** The open entry goes out in its own run. */
const offCycle = (t: Kit, period: string) =>
	Effect.gen(function* () {
		const open = (yield* storedQuery(t, {
			adhoc_catalog_entry: { where: { payroll_run_id: { is_null: true } }, limit: 1 }
		})).adhoc_catalog_entry.rows[0];
		assert.ok(open !== undefined);
		yield* (yield* t.as(t.admin)).act({
			'payroll_run.create': [
				{
					entity_id: ENTITY,
					period,
					kind: 'OFF_CYCLE',
					adhoc: [{ id: open.id, revision: open.revision }]
				}
			]
		});
		yield* t.run_due();
	});
const runs = (t: Kit, period: string) =>
	storedQuery(t, { payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
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
				paidCycle(t, period).pipe(
					Effect.andThen(enter(t, seed, place.item, correction, `${period}-10`)),
					Effect.andThen(offCycle(t, period))
				),
			BOTH
		);
		assert.deepEqual(twice, whole);
	});
};

const JOINED_NOVEMBER: Options = {
	on: '2026-11-15',
	from: '2026-11-01',
	extension: { tax_subject_from: '2026-11-01' }
};

describe('paid short, topped up in the same month', () => {
	it.live('a row reckoned over the year counts both runs at the year’s end', () =>
		toppedUp({
			place: INDONESIA,
			period: '2026-12',
			now: DECEMBER,
			codes: ['JHT', 'JP', 'JKK', 'JKM', 'KESEHATAN', 'PPH21'],
			earlier: ['2026-11'],
			options: JOINED_NOVEMBER,
			salary: 30_000_000,
			correction: 10_000_000
		})
	);
});

describe('a benefit over two calendar years', () => {
	// thirteen months apart, past what the balance keeps by month
	const LATER = '2027-04-20T02:00:00.000Z';
	const ITEM = 'PENSION_LUMPSUM';
	const PAID = 100_000_000;
	const seed = seedOf(INDONESIA, terms(10_000_000), {
		extension: { pension_tax_history: { first_payment_year: 2026 } }
	});
	/** What a statutory row took from the employee in a period's run. */
	const taxed = (t: Kit, period: string, code: string) =>
		runs(t, period).pipe(
			Effect.map(([slip]) => slip?.statutory.find((row) => row.code === code)?.employee ?? 0)
		);
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
	const TAX = 'PPH21_FINAL_PENSION';

	it.live(
		'the second year’s row reads what the first year posted, each year under its own key',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* enter(t, seed, ITEM, PAID, '2026-03-10');
				yield* paidCycle(t, '2026-03');
				const first = yield* taxed(t, '2026-03', TAX);
				yield* enter(t, seed, ITEM, PAID, '2027-04-10');
				yield* paidCycle(t, '2027-04');
				const second = yield* taxed(t, '2027-04', TAX);
				// the same payment twice: only the first year's posting, read from the balance, can make the second differ
				assert.ok(first > 0);
				assert.notEqual(second, first);
				assert.deepEqual(yield* posted(t, 'PENSION_BENEFIT', 'SEVERANCE', `${TAX}.employee`), [
					`ID.Y.2026-01-01 ${PAID}`,
					`ID.Y.2027-01-01 ${PAID}`,
					`ID.Y.2026-01-01 ${first}`,
					`ID.Y.2027-01-01 ${second}`
				]);
			}).pipe(Effect.provide(workspace({ seed, now: LATER })))
	);
	it.live('a benefit posts what sits above the checkpoint under it', () => {
		const leaving = seedOf(INDONESIA, terms(10_000_000), {
			extension: { severance_tax_history: { first_payment_year: 2026 }, hired_at_other_place: true }
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
			yield* enter(t, last, 'UPH_TRAVEL_HOME', PAID, '2026-03-31');
			yield* paidCycle(t, '2026-03');
			const tax = yield* taxed(t, '2026-03', 'PPH21_FINAL_SEVERANCE');
			assert.ok(tax > 0);
			assert.deepEqual(
				yield* posted(t, 'SEVERANCE', 'ADDITIONAL_WAGES', 'PPH21_FINAL_SEVERANCE.employee'),
				[`ID.Y.2026-01-01 ${PAID}`, `ID.Y.2026-01-01 ${tax}`]
			);
		}).pipe(Effect.provide(workspace({ seed: last, now: LATER })));
	});
});
