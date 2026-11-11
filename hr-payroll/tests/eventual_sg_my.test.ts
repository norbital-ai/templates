// A wrong payment needs no automatic entry: HR corrects the pay, and the next cycle's contribution counts the total paid.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	pack,
	sealedAdhoc,
	sealedLeave,
	uuid,
	workspace,
	leaveCreate,
	reversalSlots
} from './kit.ts';

const CONTRACT = idOf('employee_contract', uuid(6));
const JUNE = '2026-06-20T02:00:00.000Z';
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
type Seed = ReturnType<typeof pack>;
type Place = {
	readonly code: string;
	readonly zone: string;
	readonly item: string;
	readonly facts?: Parameters<typeof pack>[3];
};
const SINGAPORE: Place = {
	code: 'SG',
	zone: 'Asia/Singapore',
	item: 'ORDINARY_BACKPAY',
	facts: { race: 'CHINESE' }
};
const MALAYSIA: Place = { code: 'MY', zone: 'Asia/Kuala_Lumpur', item: 'BPAYBS' };

const seedOf = ({ code, zone, facts = {} }: Place, amount: number): Seed => {
	const seed = pack(code, zone, terms(amount), facts, [], [], '2026-06-15');
	return {
		...seed,
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
	const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
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
					.sort(([left], [right]) => left.localeCompare(right))
			);
		})
	);
const charged = (slip: PayslipBreakdown | undefined, code: string) =>
	slip?.statutory.find((row) => row.code === code);

const SG_ROWS = ['CPF', 'CDAC', 'SDL'];
const BOTH = ['.employee', '.employer'];

const oneRun = (place: Place, amount: number, codes: readonly string[]) =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		yield* onCycle(t, '2026-06');
		return yield* month(t, '2026-06', codes, BOTH);
	}).pipe(Effect.provide(workspace({ seed: seedOf(place, amount), now: JUNE })));

describe('paid too much', () => {
	const reversed = (place: Place, amount: number, extra: number, codes: readonly string[]) =>
		Effect.gen(function* () {
			const seed = seedOf(place, amount);
			return yield* Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* enter(t, seed, place.item, extra, '2026-05-05');
				yield* onCycle(t, '2026-05');
				yield* enter(t, seed, place.item, extra, '2026-06-05', yield* sealedAdhoc(t));
				yield* onCycle(t, '2026-06');
				const [june] = yield* runs(t, '2026-06');
				assert.ok(june !== undefined);
				for (const line of june.lines) assert.ok(line.amount >= 0, line.code);
				return yield* month(t, '2026-06', codes, BOTH);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
		});
	it.live(
		'Singapore: the next on-cycle run takes the reversal, and its CPF counts the lower pay',
		() =>
			Effect.gen(function* () {
				assert.deepEqual(
					yield* reversed(SINGAPORE, 6000, 2000, SG_ROWS),
					yield* oneRun(SINGAPORE, 4000, SG_ROWS)
				);
			})
	);
	it.live('a reversal alone off-cycle is refused: nothing negative posts to a balance', () => {
		const seed = seedOf(MALAYSIA, 4800);
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, MALAYSIA.item, 400, '2026-06-05');
			yield* onCycle(t, '2026-06');
			yield* enter(t, seed, MALAYSIA.item, 400, '2026-06-15', yield* sealedAdhoc(t));
			const refused = yield* Effect.flip(offCycle(t, '2026-06'));
			assert.match(
				String(refused),
				/This run would take someone below zero\. A reversal goes in the next on-cycle run\./
			);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
});

describe('a contribution corrected for a closed month', () => {
	const scheme = (t: Kit) =>
		accountsIn(t).pipe(Effect.map((accounts) => accounts.statutory?.['EPF.employee'] ?? {}));
	const fund = (t: Kit, seed: Seed, item: string) =>
		Effect.gen(function* () {
			yield* enter(t, seed, item, 100, '2026-06-30');
			yield* t.runDue();
			return (yield* t.storedQuery({ obligation: { limit: 100 } })).obligation.rows.map(
				(row) => row.title
			);
		});
	const seed = seedOf(MALAYSIA, 4800);
	it.live('refuses a month no run has closed, where the row would absorb it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(enter(t, seed, 'EPF_ADJUSTMENT', 100, '2026-06-30'));
			assert.match(String(refused), /corrects a month a run has closed/);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })))
	);
	it.live('a refund takes it off the scheme now, and the next run pays it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, '2026-06');
			const paid = (yield* scheme(t))['MY.Y.2026-01-01']?.['paid'] ?? 0;
			const month = (yield* scheme(t))['MY.M.2026-06-01']?.['paid'] ?? 0;
			const titles = yield* fund(t, seed, 'EPF_REFUND');
			assert.ok(titles.some((title) => title.startsWith('Claim 100 back from the fund')));
			assert.equal((yield* scheme(t))['MY.Y.2026-01-01']?.['paid'], paid - 100);
			assert.equal((yield* scheme(t))['MY.M.2026-06-01']?.['paid'], month - 100);
			yield* onCycle(t, '2026-07');
			const [july] = yield* runs(t, '2026-07');
			const line = july?.lines.find((row) => row.code === 'EPF_REFUND');
			assert.equal(line?.direction, 'ADD');
			assert.equal(line?.amount, 100);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-07-28T02:00:00.000Z' })))
	);
	it.live('dated two runs back, the next run pays it, and the month keeps it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, '2026-06');
			yield* onCycle(t, '2026-07');
			const june = (yield* scheme(t))['MY.M.2026-06-01']?.['paid'] ?? 0;
			yield* fund(t, seed, 'EPF_REFUND');
			yield* onCycle(t, '2026-08');
			const [august] = yield* runs(t, '2026-08');
			const line = august?.lines.find((row) => row.code === 'EPF_REFUND');
			assert.equal(line?.direction, 'ADD');
			assert.equal(line?.amount, 100);
			assert.equal((yield* scheme(t))['MY.M.2026-06-01']?.['paid'], june - 100);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-08-28T02:00:00.000Z' })))
	);
	it.live('an underpayment adds to the scheme, and raises the arrears', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, '2026-06');
			const paid = (yield* scheme(t))['MY.Y.2026-01-01']?.['paid'] ?? 0;
			const titles = yield* fund(t, seed, 'EPF_ADJUSTMENT');
			assert.ok(titles.some((title) => title.startsWith('Pay 100 in arrears to the fund')));
			assert.equal((yield* scheme(t))['MY.Y.2026-01-01']?.['paid'], paid + 100);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-07-28T02:00:00.000Z' })))
	);
	it.live('deleted while unpaid, it posts its exact inverse', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, '2026-06');
			const held = yield* scheme(t);
			yield* fund(t, seed, 'EPF_REFUND');
			const [entry] = (yield* t.storedQuery({
				adhoc_catalog_entry: { where: { payroll_run_id: { isNull: true } }, limit: 1 }
			})).adhoc_catalog_entry.rows;
			assert.ok(entry !== undefined);
			yield* t.as(t.admin).act('adhoc_catalog_entry.delete', [{ target: entry.id }]);
			yield* t.runDue();
			assert.deepEqual(yield* scheme(t), held);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-07-28T02:00:00.000Z' })))
	);
});

describe('a transfer month', () => {
	it.live('an off-cycle run is refused: on-cycle, each company stands alone', () => {
		const base = seedOf(MALAYSIA, 4800);
		const contract = base.employee_contract?.[0] ?? {};
		const profile = base.entity_profile_version?.[0] ?? {};
		const OTHER = idOf('entity', uuid(900));
		const seed: Seed = {
			...base,
			entity: [
				...(base.entity ?? []),
				{ id: OTHER, code: 'E2', name: 'Sister', settings_code: 'MY' }
			],
			entity_profile_version: [
				...(base.entity_profile_version ?? []),
				{ ...profile, id: uuid(902), entity_id: OTHER, name: 'Sister' }
			],
			employee_contract: [
				{ ...contract, effective_range: { from: '2026-01-01', to: '2026-06-15' } },
				{
					...contract,
					id: uuid(907),
					entity_id: OTHER,
					effective_range: { from: '2026-06-16', to: null }
				}
			]
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* enter(t, seed, 'BONUS', 2000, '2026-06-10');
			const refused = yield* Effect.flip(offCycle(t, '2026-06'));
			assert.match(String(refused), /moved between companies/);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
});

describe('someone on a six-day week', () => {
	it.live('a no-pay day and its reversal count the contract’s days, not the company’s', () => {
		const base = seedOf(SINGAPORE, 5200);
		const seed: Seed = {
			...base,
			employee_contract: (base.employee_contract ?? []).map((row) => ({
				...row,
				terms: { ...terms(5200), normal_days_per_week: 6 }
			}))
		};
		const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
		const row = seed.leave_catalog?.find(
			(item) => item.code === 'NPL' && item.settings_id === version
		);
		assert.ok(row !== undefined);
		const take = (t: Kit, date: string, reverses: Id<'leave_catalog_entry'> | null = null) =>
			Effect.gen(function* () {
				const days =
					reverses == null
						? [
								{ date: PlainDate(date), part: 'AM' as const },
								{ date: PlainDate(date), part: 'PM' as const }
							]
						: yield* reversalSlots(t, reverses);
				yield* t.as(t.admin).act('leave_catalog_entry.create', [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: idOf('leave_catalog', String(row.id)),
						days,
						reverses
					})
				]);
			});
		const line = (slip: PayslipBreakdown | undefined) =>
			slip?.lines.find((item) => item.code === 'NPL');
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, '2026-06-10');
			yield* onCycle(t, '2026-06');
			yield* take(t, '2026-07-06', yield* sealedLeave(t));
			yield* onCycle(t, '2026-07');
			const [june] = yield* runs(t, '2026-06');
			const [july] = yield* runs(t, '2026-07');
			// June has 26 days to work on a six-day week, the fixture's own term: the day is a line off PAID_BASIC, and
			// July refunds the original month's value
			assert.equal(line(june)?.amount, 5200 / 26);
			assert.equal(line(june)?.direction, 'DEDUCT');
			assert.equal(
				june?.checkpoints.find((point) => point.code === 'PAID_BASIC')?.value,
				5200 - 5200 / 26
			);
			assert.equal(line(july)?.amount, line(june)?.amount);
			assert.equal(line(july)?.direction, 'ADD');
		}).pipe(Effect.provide(workspace({ seed, now: '2026-07-20T02:00:00.000Z' })));
	});
});

describe('a leaver with no further on-cycle run', () => {
	it.live(
		'Malaysia: an adjustment goes out off-cycle on their last period, and its EPF counts it',
		() => {
			const base = seedOf(MALAYSIA, 4800);
			const seed: Seed = {
				...base,
				employee_contract: (base.employee_contract ?? []).map((row) => ({
					...row,
					effective_range: { from: '2026-01-01', to: '2026-05-31' }
				}))
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* onCycle(t, '2026-05');
				yield* enter(t, seed, 'ADJ', 1000, '2026-05-25');
				yield* offCycle(t, '2026-05');
				const [, adjustment] = yield* runs(t, '2026-05');
				assert.equal(adjustment?.lines.find((line) => line.code === 'ADJ')?.amount, 1000);
				assert.ok((charged(adjustment, 'EPF')?.employee ?? 0) > 0);
			}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
		}
	);
	it.live('Malaysia: a run on a later period refuses, so the entry is never lost', () => {
		const base = seedOf(MALAYSIA, 4800);
		const seed: Seed = {
			...base,
			employee_contract: (base.employee_contract ?? []).map((row) => ({
				...row,
				effective_range: { from: '2026-01-01', to: '2026-05-31' }
			}))
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* onCycle(t, '2026-05');
			yield* enter(t, seed, 'ADJ', 1000, '2026-05-25');
			const refused = yield* Effect.flip(offCycle(t, '2026-06'));
			assert.match(String(refused), /not paid by this pay group in its period/);
		}).pipe(Effect.provide(workspace({ seed, now: JUNE })));
	});
});
