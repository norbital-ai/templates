// Labour Code art.137(1): pregnancy has no consent exception; raising a child under 12 months needs the day's consent
// for night work and for overtime. Consent is a fact on the roster day, never a contract-wide attestation.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, pack, uuid, workspace } from './kit.ts';

const terms = {
	rate: { amount: 26_000_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 48,
	normal_days_per_week: 6,
	statutory_work_category: 'NORMAL',
	work_classification: 'ORDINARY',
	residency_status: 'RESIDENT',
	wage_payment_method: 'BANK',
	allowances: {}
};
const CONTRACT = idOf('employee_contract', uuid(6));
type ChildFact = { readonly expected_on?: string; readonly born_on?: string };
const seedOf = (children: readonly ChildFact[]) => {
	const base = pack(
		'VN',
		'Asia/Ho_Chi_Minh',
		terms,
		{ family: children.map((child) => ({ relation: 'CHILD', ...child })) },
		[],
		[],
		'2026-09-15'
	);
	return {
		...base,
		employee_contract: (base.employee_contract ?? []).map((row) => ({
			...row,
			effective_range: { from: '2026-01-01', to: null }
		}))
	};
};
const NIGHT = [
	{ start: Instant('2026-09-01T15:00:00.000Z'), end: Instant('2026-09-01T17:00:00.000Z') }
];
type Consent = {
	readonly night_work: boolean;
	readonly overtime: boolean;
	readonly reference: string;
};
const CONSENT: Consent = { night_work: true, overtime: true, reference: 'signed form 1/9' };
const create = (date: string, overtime = false, actual = false, consent?: Consent) => ({
	employment_id: CONTRACT,
	work_date: PlainDate(date),
	planned_overtime_intervals: overtime ? NIGHT : null,
	actual_worked_intervals: actual ? NIGHT : null,
	...(consent === undefined ? {} : { consent })
});
const seedInfant = seedOf([{ born_on: '2026-04-01' }]);
const seedPregnant = seedOf([{ expected_on: '2026-11-15' }]);
const live = (seed: ReturnType<typeof seedOf>) =>
	workspace({ seed, now: '2026-09-20T02:00:00.000Z' });

describe('VN night work and overtime while pregnant or raising an infant', () => {
	it.live(
		'an infant needs the day\u2019s overtime consent before planned overtime is entered',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.admin);
				const refused = yield* Effect.flip(
					hr.act('roster_entry.create', [create('2026-09-01', true)])
				);
				assert.match(String(refused), /ROSTER_MATERNITY_NIGHT_OVERTIME/);
				yield* hr.act('roster_entry.create', [create('2026-09-01', true, false, CONSENT)]);
			}).pipe(Effect.provide(live(seedInfant)))
	);
	it.live(
		'an infant needs the day\u2019s night-work consent before actual night work is entered',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.admin);
				const created = yield* hr.act('roster_entry.create', [create('2026-09-02')]);
				const id = created.records.find((row) => row.model === 'roster_entry')?.id;
				assert.ok(id !== undefined);
				const refused = yield* Effect.flip(
					hr.act('roster_entry.update', [{ target: id, set: { actual_worked_intervals: NIGHT } }])
				);
				assert.match(String(refused), /PREGNANT_OR_INFANT_NIGHT_OVERTIME/);
				yield* hr.act('roster_entry.update', [
					{ target: id, set: { actual_worked_intervals: NIGHT, consent: CONSENT } }
				]);
			}).pipe(Effect.provide(live(seedInfant)))
	);
	it.live('a pregnancy refuses planned overtime even with consent', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const refused = yield* Effect.flip(
				t.as(t.admin).act('roster_entry.create', [create('2026-09-01', true, false, CONSENT)])
			);
			assert.match(String(refused), /ROSTER_MATERNITY_NIGHT_OVERTIME/);
		}).pipe(Effect.provide(live(seedPregnant)))
	);
	it.live('a pregnancy refuses night work even with consent', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.admin);
			const created = yield* hr.act('roster_entry.create', [create('2026-09-03')]);
			const id = created.records.find((row) => row.model === 'roster_entry')?.id;
			assert.ok(id !== undefined);
			const refused = yield* Effect.flip(
				hr.act('roster_entry.update', [
					{ target: id, set: { actual_worked_intervals: NIGHT, consent: CONSENT } }
				])
			);
			assert.match(String(refused), /PREGNANT_OR_INFANT_NIGHT_OVERTIME/);
		}).pipe(Effect.provide(live(seedPregnant)))
	);
	it.live('a child over 12 months raises no consent gate', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* t
				.as(t.admin)
				.act('roster_entry.create', [create('2026-09-01', true, true, undefined)]);
		}).pipe(Effect.provide(live(seedOf([{ born_on: '2025-01-01' }]))))
	);
});
