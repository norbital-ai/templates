// A leave row's `paid_share` may be an expression on the dated fact behind the day: pay that steps down as a long illness
// ages. The run takes the unpaid share of each day off the salary on the row's own line, and a workplace case moves no
// balance. EMERGENCY_LEAVE is varied to synthetic steps opened by a LONG_ILLNESS fact.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	catalogRow,
	ledgerRows,
	pack,
	sealEvents,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	leaveCreate,
	storedQuery
} from '../kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const CODE = 'EMERGENCY_LEAVE';
const near = (actual: number, expected: number) =>
	assert.ok(Math.abs(actual - expected) < 0.01, `${actual} is not ${expected}`);
const terms = {
	rate: { amount: 3120, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
/** The unpaid share of each step, by the months the illness has run. */
const STEPS = [
	{ until_month: 4, unpaid_share: 0 },
	{ until_month: 8, unpaid_share: 0.25 },
	{ until_month: 12, unpaid_share: 0.5 },
	{ until_month: null, unpaid_share: 0.75 }
];
type Seed = ReturnType<typeof pack>;
const seedOf = (events: readonly JsonObject[] = []): Seed => {
	const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, { events }, [], [], '2026-06-15');
	return {
		...seed,
		leave_catalog: (seed.leave_catalog ?? []).map((row) =>
			row.code === CODE
				? {
						...row,
						lookup: {
							...objectValue(row.lookup),
							pay_steps: STEPS,
							opened_by: { LONG_ILLNESS: { days: 0 } }
						},
						paid_share:
							'if (ctx.event == null) return 1;\nconst months = calendar_completed_months(ctx.event.on, ctx.as_of);\nreturn 1 - ctx.lookup.pay_steps.find((step) => step.until_month == null || months < step.until_month).unpaid_share;'
					}
				: row
		)
	};
};
const PLAIN = seedOf();
const take = (t: Kit, seed: Seed, dates: readonly string[]) =>
	Effect.flatMap(t.as(t.admin), (caller) =>
		caller.act({
			'leave_catalog_entry.create': [
				leaveCreate({
					entity_id: ENTITY,
					employment_id: idOf('employee_contract', uuid(6)),
					catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', CODE)),
					days: wholeDays(...dates)
				})
			]
		})
	);
const run = (t: Kit, period: string) =>
	Effect.flatMap(t.as(t.admin), (caller) =>
		caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
	).pipe(Effect.andThen(t.run_due()));
const breakdowns = (t: Kit) =>
	storedQuery(t, { payslip: { limit: 12 } }).pipe(
		Effect.map(({ payslip }) =>
			payslip.rows.map((slip) => Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown))
		)
	);
/** What the unpaid part of the days took off the salary: the leave row's own line, which PAID_BASIC falls by. */
const taken = (t: Kit) =>
	breakdowns(t).pipe(
		Effect.map((slips) =>
			slips.reduce(
				(sum, slip) =>
					sum +
					terms.rate.amount -
					(slip.checkpoints.find((row) => row.code === 'PAID_BASIC')?.value ?? 0),
				0
			)
		)
	);
/** What a later payslip gave back for a paid period, on the row's own line. */
const refunded = (t: Kit, period: string) =>
	breakdowns(t).pipe(
		Effect.map((slips) =>
			slips
				.flatMap((slip) => slip.lines)
				.filter((line) => line.code === CODE && line.direction === 'ADD' && line.period === period)
				.reduce((sum, line) => sum + line.amount, 0)
		)
	);
const JUNE = ['2026-06-09', '2026-06-10'];
// the fixture's law takes an unpaid day off by its proration: the month's salary over June's 30 calendar days, or
// else its day rate, a year's wage over the year's working days
const settings = (PLAIN.jurisdiction_settings ?? []).find(
	(row) => row.id === PLAIN.entity_profile_version?.[0]?.input_schema_version_id
);
const DAY =
	objectValue(settings?.conversions).proration === 'CALENDAR_DAYS'
		? terms.rate.amount / 30
		: (terms.rate.amount * 12) / (52 * terms.normal_days_per_week);

describe('pay that steps down, on one row', () => {
	it.live('a day with no fact is at full pay', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, PLAIN, JUNE);
			yield* t.run_due();
			yield* run(t, '2026-06');
			assert.equal(yield* taken(t), 0);
		}).pipe(Effect.provide(workspace({ seed: PLAIN, now: NOW })))
	);
	// one start inside each step of the row
	for (const [index, started] of ['2026-05-02', '2026-02-02', '2025-10-02', '2025-05-02'].entries())
		it.live(`an illness from ${started} takes step ${index + 1}’s share of a June day`, () => {
			const share = STEPS[index]?.unpaid_share ?? Number.NaN;
			const ill = seedOf([{ kind: 'LONG_ILLNESS', on: started }]);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* take(t, ill, JUNE);
				yield* t.run_due();
				yield* run(t, '2026-06');
				near(yield* taken(t), 2 * DAY * share);
			}).pipe(Effect.provide(workspace({ seed: ill, now: NOW })));
		});
	it.live('days taken in an illness do not stop the next version, which keeps it', () => {
		const event = { kind: 'LONG_ILLNESS', on: '2026-02-02' };
		const ill = seedOf([event]);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, ill, JUNE);
			yield* t.run_due();
			const next = yield* sealEvents(t, '2026-07-01', [event]);
			const { employee_contract } = yield* storedQuery(t, {
				employee_contract: { where: { id: { eq: next } }, fields: ['status'], limit: 1 }
			});
			assert.equal(employee_contract.rows[0]?.status, 'SEALED');
		}).pipe(Effect.provide(workspace({ seed: ill, now: NOW })));
	});
	it.live('an ended illness ends the count: the next day is at full pay', () => {
		const ill = seedOf([{ kind: 'LONG_ILLNESS', on: '2026-02-02', ended_on: '2026-05-29' }]);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, ill, JUNE);
			yield* t.run_due();
			yield* run(t, '2026-06');
			assert.equal(yield* taken(t), 0);
		}).pipe(Effect.provide(workspace({ seed: ill, now: NOW })));
	});
	it.live(
		'deleted after its month is paid, the next run gives that month back, at that month’s share',
		() => {
			const ill = seedOf([{ kind: 'LONG_ILLNESS', on: '2026-02-02' }]);
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				yield* take(t, ill, ['2026-06-09']);
				yield* t.run_due();
				yield* run(t, '2026-06');
				const before = yield* taken(t);
				assert.ok(before > 0 && before < DAY);
				const [june] = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows;
				assert.ok(june !== undefined);
				yield* (yield* t.as(t.admin)).act({
					'payroll_run.update': [{ target: june, set: { state: 'PAID' } }]
				});
				yield* t.run_due();
				const [first] = (yield* storedQuery(t, { leave_catalog_entry: { limit: 1 } }))
					.leave_catalog_entry.rows;
				assert.ok(first !== undefined);
				yield* (yield* t.as(t.admin)).act({ 'leave_catalog_entry.delete': [{ target: first }] });
				yield* t.run_due();
				const { pay_amendment } = yield* storedQuery(t, { pay_amendment: { limit: 10 } });
				assert.deepEqual(
					pay_amendment.rows.map((row) => [row.period, row.payroll_run_id]),
					[['2026-06', null]]
				);
				yield* run(t, '2026-07');
				near(yield* refunded(t, '2026-06'), before);
			}).pipe(Effect.provide(workspace({ seed: ill, now: NOW })));
		}
	);
});

describe('a workplace case', () => {
	it.live('moves no balance', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* (yield* t.as(t.admin)).act({
				'workplace_case_catalog_entry.create': [
					{
						entity_id: ENTITY,
						employment_id: idOf('employee_contract', uuid(6)),
						catalog_id: idOf(
							'workplace_case_catalog',
							catalogRow(PLAIN, 'workplace_case_catalog', 'PERSONAL_DATA_BREACH')
						),
						kind: 'PERSONAL_DATA_BREACH',
						opened_on: '2026-03-02',
						inputs: {}
					}
				]
			});
			yield* t.run_due();
			assert.deepEqual(yield* ledgerRows(t), []);
		}).pipe(Effect.provide(workspace({ seed: PLAIN, now: NOW })))
	);
});
