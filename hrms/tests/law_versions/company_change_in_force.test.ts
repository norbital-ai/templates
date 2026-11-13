// A company's dated values are its changes folded on a day. A rule reads the company as it stands on the row's own
// day, and a run prices on the company as it stands on its salary period's last day. A change written after its month
// is paid amends that month, and the next run carries the difference. The rules are VN's because only VN's read a
// company value that varies by date; the run is on the MY pack, and every expected figure is one the system produced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { DateTime, Effect } from 'effect';
import { employerOn } from '../../src/lib/company.ts';
import { evaluate } from '../../src/lib/payroll_engine/expressions.ts';
import { isJsonObject, type JsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { amendments, carriedFor, ownLines, pay, run, working } from '../amendment_kit.ts';
import {
	ENTITY,
	WORK,
	current,
	lawAt,
	pack,
	refusal,
	storedQuery,
	uuid,
	workspace
} from '../kit.ts';

const LAW = lawAt('VN', '2026-12-31');
/** A registered rule's check, with the law's shared lookup under its own. */
const ruleOf = (code: string) => {
	const rule = LAW.rows.registered_rule.find((row) => row.code === code);
	const validate = rule?.validate;
	assert.ok(typeof validate === 'string', code);
	return {
		validate,
		lookup: {
			...(isJsonObject(LAW.settings.lookup) ? LAW.settings.lookup : {}),
			...(isJsonObject(rule?.lookup) ? rule.lookup : {})
		}
	};
};
const COMPANY = { id: 'company', name: 'Entity', settings_code: 'VN' };
const change = (region: string, from: string, rest = false): JsonObject => ({
	id: from,
	entity_id: COMPANY.id,
	effective_from: from,
	statutory_parameters: { region, rest_averaged_monthly: rest }
});
const worked = (date: string) => ({
	work_date: date,
	actual_worked_intervals: [
		{
			start: DateTime.formatIso(DateTime.makeUnsafe(`${date}T01:00:00.000Z`)),
			end: DateTime.formatIso(DateTime.makeUnsafe(`${date}T09:00:00.000Z`))
		}
	]
});

describe('the company a rule reads', () => {
	it('is the company as it stands on the contract start', () => {
		const rule = ruleOf('MINIMUM_WAGE_FLOOR');
		const a = change('IV', '2026-01-01');
		const b = change('I', '2027-01-01');
		const context = (from: string, amount: number, changes: readonly JsonObject[]) => ({
			lookup: rule.lookup,
			entry: { effective_range: { from }, terms: { rate: { amount, unit: 'MONTHLY' } } },
			subject: { employer: employerOn(COMPANY, changes, from) }
		});
		// B is first: reading the latest change would take B's region floor, which the amount does not reach
		assert.equal(
			evaluate(rule.validate, 'CALCULATION', context('2026-12-20', 4_000_000, [b, a]), 'x'),
			true
		);
		assert.equal(
			evaluate(rule.validate, 'CALCULATION', context('2027-02-01', 5_000_000, [a, b]), 'x'),
			false
		);
	});
	it('is the company as it stands on the roster day', () => {
		const rule = ruleOf('WEEKLY_REST');
		const a = change('I', '2026-01-01', false);
		const b = change('I', '2027-01-01', true);
		const days = Array.from({ length: 27 }, (_, index) => {
			const date = `2026-02-${String(index + 1).padStart(2, '0')}`;
			// one rest day in the final seven, so the weekly cycle has its 24 hours
			return date === '2026-02-22'
				? { work_date: date, actual_worked_intervals: [] }
				: worked(date);
		});
		const context = (changes: readonly JsonObject[], roster: readonly object[] = days) => ({
			lookup: rule.lookup,
			entry: {
				work_date: '2026-02-28',
				actual_worked_intervals: worked('2026-02-28').actual_worked_intervals
			},
			reads: { roster_entry: roster },
			subject: { employer: employerOn(COMPANY, changes, '2026-02-28') }
		});
		// B is first: reading the latest change would apply the monthly averaging (1 rest < 4) and fail
		assert.equal(evaluate(rule.validate, 'CALCULATION', context([b, a]), 'x'), true);
		// averaging in force on the day fails it
		assert.equal(
			evaluate(
				rule.validate,
				'CALCULATION',
				context([{ ...b, effective_from: '2026-01-01' }]),
				'x'
			),
			false
		);
		// all seven worked in the window is a violation under the company as it stands
		assert.equal(
			evaluate(
				rule.validate,
				'CALCULATION',
				context(
					[b, a],
					days.map((day) => worked(day.work_date))
				),
				'x'
			),
			false
		);
	});
});

const NOW = '2026-07-20T02:00:00.000Z';
const LINE = 'OVERTIME/EMPLOYEE';
const CHANGE = idOf('entity_change', uuid(950));
/** Two hours of overtime on one day of each month, the same wage throughout. */
const OVERTIME_DAYS = ['2026-05-12', '2026-06-09', '2026-07-07'];
/** The statute's own hour, written whole: what the change is corrected to. */
const STATUTORY = {
	overtime_hour_basis: 'STATUTORY',
	night_differential_basis: 'WORKED',
	contribution_split: 'EVEN',
	health_billing: 'CURRENT',
	benefit_exclusion: 'POOLED'
} as const;
/** One person on an 8 h × 6 day, 45 h week, whose company pays overtime on its own hour from `from`. */
const seedOf = (from: string) => {
	const base = pack(
		'MY',
		'Asia/Kuala_Lumpur',
		{
			rate: { amount: 2800, unit: 'MONTHLY' },
			normal_hours_per_day: 8,
			normal_hours_per_week: 45,
			normal_days_per_week: 6,
			statutory_work_category: 'MANUAL_LABOUR',
			work_classification: 'EA_COVERED',
			residency_status: 'CITIZEN',
			wage_payment_method: 'BANK',
			allowances: {}
		},
		{},
		['2026-05', '2026-06', '2026-07']
			.flatMap(working)
			.map((date) =>
				OVERTIME_DAYS.includes(date)
					? { date, shift: WORK, hours: 10, overtime: 2 }
					: { date, shift: WORK, hours: 8 }
			),
		[]
	);
	return {
		...base,
		entity_change: [
			...(base.entity_change ?? []),
			{
				id: CHANGE,
				entity_id: ENTITY,
				effective_from: from,
				pay_methods: { overtime_hour_basis: 'CONTRACT_WEEKLY' }
			}
		]
	};
};
const scenario = (from: string, body: (t: Kit) => Effect.Effect<void, unknown>) =>
	Effect.gen(function* () {
		yield* body(yield* TestWorkspace);
	}).pipe(Effect.provide(workspace({ seed: seedOf(from), now: NOW })));
/** The company's change as stored now. */
const filed = (t: Kit) =>
	storedQuery(t, { entity_change: { where: { id: { eq: CHANGE } }, limit: 1 } }).pipe(
		Effect.map(({ entity_change }) => {
			const [row] = entity_change.rows;
			assert.ok(row !== undefined, 'No change is filed');
			return row;
		})
	);
const edited = (t: Kit) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'entity_change.update': [{ target: yield* filed(t), set: { pay_methods: STATUTORY } }]
		});
		yield* t.run_due();
	});
const moved = (t: Kit, to: string) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'entity_change.update': [{ target: yield* filed(t), set: { effective_from: to } }]
		});
		yield* t.run_due();
	});
const deleted = (t: Kit) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({ 'entity_change.delete': [{ target: yield* filed(t) }] });
		yield* t.run_due();
	});
/** The run of a period deleted. */
const dropped = (t: Kit, ran: { readonly id: Id<'payroll_run'> }) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'payroll_run.delete': [{ target: yield* current(t, 'payroll_run', ran.id) }]
		});
		yield* t.run_due();
	});
/** What a period's own payslip paid for its overtime. */
const overtime = (t: Kit, period: string) =>
	ownLines(t, period).pipe(Effect.map((lines) => lines[LINE] ?? 0));

describe('a company change in force', () => {
	it.live(
		'dated mid-year applies from its date, and a run prices its period on the company as it stands on the period’s last day',
		() =>
			scenario('2026-06-16', (t) =>
				Effect.gen(function* () {
					yield* pay(t, '2026-05');
					yield* pay(t, '2026-06');
					const may = yield* overtime(t, '2026-05');
					// June's overtime was worked on the 9th, before the change: the run prices it on the company of the 30th
					const june = yield* overtime(t, '2026-06');
					assert.ok(may > 0 && june > may, `${june} with the method, ${may} before it`);
					assert.deepEqual(yield* amendments(t), []);
				})
			)
	);

	it.live(
		'under an unpaid run it does not move: the run is deleted, the change corrected, and the run made again prices on the corrected company',
		() =>
			scenario('2026-06-01', (t) =>
				Effect.gen(function* () {
					yield* pay(t, '2026-05');
					const made = yield* run(t, '2026-06');
					const method = yield* overtime(t, '2026-06');
					const held = yield* refusal(deleted(t));
					assert.equal(held.key, 'errors.payroll_refused');
					assert.match(
						String(held.values?.message),
						/Run \d+ holds this person and is not paid yet/
					);
					assert.equal((yield* filed(t)).effective_from, '2026-06-01');
					assert.equal(yield* overtime(t, '2026-06'), method);
					yield* dropped(t, made);
					yield* deleted(t);
					yield* run(t, '2026-06');
					assert.equal(yield* overtime(t, '2026-06'), yield* overtime(t, '2026-05'));
					assert.ok((yield* overtime(t, '2026-06')) < method, 'the method paid more');
					assert.deepEqual(yield* amendments(t), []);
				})
			)
	);

	for (const [fix, corrected] of [
		['edited', edited],
		['deleted', deleted]
	] as const)
		it.live(
			`${fix} after its month was paid: everyone paid under it is amended, and the next run carries the difference`,
			() =>
				scenario('2026-06-01', (t) =>
					Effect.gen(function* () {
						yield* pay(t, '2026-05');
						yield* pay(t, '2026-06');
						const paid = yield* ownLines(t, '2026-06');
						assert.deepEqual(yield* amendments(t), []);
						// the change reached the paid period: its people are amended by the write itself, and May is not reached
						yield* corrected(t);
						assert.deepEqual(
							(yield* amendments(t)).map((row) => [row.period, row.payroll_run_id]),
							[['2026-06', null]]
						);
						yield* run(t, '2026-07');
						// July pays the same overtime on the corrected company: what June should have paid, less what it did
						const own = yield* overtime(t, '2026-07');
						const wrong = paid[LINE] ?? 0;
						assert.ok(own > 0 && own < wrong, 'the method paid more');
						assert.equal(
							(yield* carriedFor(t, '2026-07', '2026-06'))[LINE],
							Number((own - wrong).toFixed(2))
						);
						assert.deepEqual(yield* ownLines(t, '2026-06'), paid, 'the paid payslip stands');
					})
				)
		);

	it.live(
		'dated a month early and moved after that month was paid: the month is amended, and the change holds from its real date',
		() =>
			scenario('2026-06-01', (t) =>
				Effect.gen(function* () {
					yield* pay(t, '2026-05');
					yield* pay(t, '2026-06');
					const wrong = yield* overtime(t, '2026-06');
					yield* moved(t, '2026-07-01');
					assert.deepEqual(
						(yield* amendments(t)).map((row) => [row.period, row.payroll_run_id]),
						[['2026-06', null]]
					);
					yield* run(t, '2026-07');
					// July is the change's own month now: the same overtime, paid what June was
					assert.equal(yield* overtime(t, '2026-07'), wrong);
					// and June is worked out on the company of its own last day: part of its overtime comes back
					const back = (yield* carriedFor(t, '2026-07', '2026-06'))[LINE] ?? 0;
					assert.ok(back < 0, 'June was paid too much');
					assert.ok(back > -wrong);
				})
			)
	);
});
