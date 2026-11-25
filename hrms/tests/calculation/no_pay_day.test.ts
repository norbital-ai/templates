// A no-pay day is a catalogue line at PAID_BASIC: the salary stands, the day comes off on its own line, and an allowance
// that reads the share of the period paid loses the same share. A no-pay amount HR settles by hand is an ad hoc row at
// its own checkpoint. Malaysia's law pack is only the fixture: every expected amount is the fixture's own input or what
// the run itself produced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../../src/data/model/payroll_run/service/payslip_breakdown.ts';
import { idOf, objectValue } from '../../src/lib/reads.ts';
import { pay, run } from '../amendment_kit.ts';
import { ENTITY, leaveCreate, pack, storedQuery, uuid, workspace, packTerms } from '../kit.ts';

const EMPLOYMENT = idOf('employment', uuid(6));
const NOW = '2026-06-20T02:00:00.000Z';
const SALARY = 3120;
const ALLOWANCE = 300;
type Seed = ReturnType<typeof pack>;
const malaysia = (allowances: Record<string, { readonly amount: number }> = {}): Seed =>
	pack(
		'MY',
		'Asia/Kuala_Lumpur',
		{ ...packTerms(SALARY, 'MANUAL_LABOUR'), allowances },
		{},
		[],
		[]
	);
const whole = (date: string) => [
	{ date, part: 'AM' as const },
	{ date, part: 'PM' as const }
];
const entry = (t: Kit, days: ReturnType<typeof whole>) =>
	t.as(t.admin).pipe(
		Effect.andThen((caller) =>
			caller.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: EMPLOYMENT,
						catalog_code: 'NPL',
						days
					})
				]
			})
		)
	);
/** A period's BASIC, SUA and NPL lines, signed. */
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
	/** What June's run takes for these slots, in a workspace of its own. */
	const taken = (seed: Seed, days: ReturnType<typeof whole>) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* entry(t, days);
			yield* run(t, '2026-06');
			return (yield* paid(t, '2026-06'))['NPL'] ?? 0;
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));

	it.live(
		'comes off as its own line, the salary stands, and a fixed allowance loses the same share',
		() => {
			const seed = malaysia({ SUA: { amount: ALLOWANCE } });
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* entry(t, whole('2026-06-10'));
				yield* run(t, '2026-06');
				const { BASIC, NPL = 0, SUA = 0 } = yield* paid(t, '2026-06');
				assert.equal(BASIC, SALARY);
				assert.ok(NPL < 0 && -NPL < SALARY, String(NPL));
				assert.ok(Math.abs(SUA - ALLOWANCE * (1 + NPL / SALARY)) < 0.01, String(SUA));
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		}
	);

	it.live(
		'a leave the employer pays by its own policy pays in full, though the law leaves it unpaid',
		() => {
			// the fixture's unpaid row stands in for any leave the law leaves unpaid (e.g. emergency leave)
			const base = malaysia({ SUA: { amount: ALLOWANCE } });
			const seed: Seed = {
				...base,
				entity_change: (base.entity_change ?? []).map((row) => ({
					...row,
					pay_methods: { paid_leave: ['NPL'] }
				}))
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* entry(t, whole('2026-06-10'));
				yield* run(t, '2026-06');
				const { BASIC, NPL = 0, SUA = 0 } = yield* paid(t, '2026-06');
				assert.equal(BASIC, SALARY);
				assert.equal(NPL, 0);
				assert.equal(SUA, ALLOWANCE);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		}
	);

	it.live('a half day is half, and an allowance outside the rate stays out of it', () =>
		Effect.gen(function* () {
			const day = yield* taken(malaysia(), whole('2026-06-10'));
			const half = yield* taken(malaysia({ ONCALL: { amount: ALLOWANCE } }), [
				{ date: '2026-06-10', part: 'AM' }
			]);
			assert.ok(day < 0, String(day));
			assert.equal(half * 2, day);
		})
	);

	it.live('a weekend between two missed days stays paid', () =>
		Effect.gen(function* () {
			const day = yield* taken(malaysia(), whole('2026-06-10'));
			assert.equal(
				yield* taken(malaysia(), [...whole('2026-06-12'), ...whole('2026-06-15')]),
				day * 2
			);
		})
	);

	it.live('after a late cutoff, a day past it belongs to the next month’s run', () => {
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
			yield* entry(t, whole('2026-06-29'));
			yield* run(t, '2026-07');
			assert.ok(((yield* paid(t, '2026-07'))['NPL'] ?? 0) < 0);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-07-20T02:00:00.000Z' })));
	});

	// June has 30 days and July 31, and the rate is raised from July: one rate for both days could not equal this
	it.live(
		'after a late cutoff, each day is priced in the month it falls in: its rate and its wage, as runs of those months price it',
		() => {
			const cutoff = (day: number): Seed => {
				const base = malaysia();
				return {
					...base,
					pay_group: (base.pay_group ?? []).map((row) => ({
						...row,
						payment_schedule: { ...objectValue(row.payment_schedule), pay_cutoff_day: day }
					}))
				};
			};
			const raised = (t: Kit) =>
				Effect.flatMap(t.as(t.admin), (caller) =>
					caller.act({
						'contract_terms.create': [
							{
								employment_id: EMPLOYMENT,
								effective_from: '2026-07-01',
								rate: { amount: SALARY + 480, unit: 'MONTHLY' }
							}
						]
					})
				);
			const now = '2026-07-20T02:00:00.000Z';
			const DAYS = ['2026-06-29', '2026-07-10'];
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* raised(t);
				yield* pay(t, '2026-06');
				yield* entry(t, DAYS.flatMap(whole));
				yield* run(t, '2026-07');
				return (yield* paid(t, '2026-07'))['NPL'] ?? 0;
			}).pipe(
				Effect.provide(workspace({ seed: cutoff(21), now })),
				Effect.flatMap((late) =>
					Effect.gen(function* () {
						const t = yield* TestWorkspace;
						yield* raised(t);
						yield* entry(t, DAYS.flatMap(whole));
						yield* pay(t, '2026-06');
						yield* run(t, '2026-07');
						const [june, july] = [yield* paid(t, '2026-06'), yield* paid(t, '2026-07')];
						assert.ok((june['NPL'] ?? 0) < 0 && (july['NPL'] ?? 0) < 0);
						assert.equal(late, Number(((june['NPL'] ?? 0) + (july['NPL'] ?? 0)).toFixed(2)));
					}).pipe(Effect.provide(workspace({ seed: cutoff(1), now })))
				)
			);
		}
	);
});
