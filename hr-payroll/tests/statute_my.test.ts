// What the Employment Act 1955 conditions on Malaysian leave: who it covers, which confinement bears the allowance, which
// confinement a father still has, and what absence and unpaid leave do to annual leave; and how long a roster day runs.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate, add_days } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { payBasis } from '../src/lib/payroll_engine/engine.ts';
import { idOf, objectValue } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	catalogRow,
	pack,
	read,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	accountsIn,
	measureOf,
	leaveCreate,
	storedQuery
} from './kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const ABS = uuid(14);
const TERMS = {
	rate: { amount: 8000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
type Person = {
	readonly started?: string;
	readonly gender?: 'FEMALE' | 'MALE';
	readonly engagement?: string;
	readonly terms?: JsonObject;
	readonly events?: readonly JsonObject[];
	readonly absent?: readonly string[];
};
const seedOf = ({
	started = '2024-01-01',
	gender = 'FEMALE',
	engagement = 'EMPLOYEE',
	terms = TERMS,
	events = [],
	absent = []
}: Person) => {
	const seed = pack(
		'MY',
		'Asia/Kuala_Lumpur',
		terms,
		{ events },
		absent.map((date) => ({ date, shift: ABS, hours: 0 })),
		[],
		'2026-11-15'
	);
	return {
		...seed,
		shift_definition: [
			...(seed.shift_definition ?? []),
			{
				id: ABS,
				entity_id: ENTITY,
				code: 'ABSENT',
				name: 'ABSENT',
				effective_range: { from: '2020-01-01', to: null },
				variant: { day_type: 'ABS', ends_next_day: false, breaks: [] }
			}
		],
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			engagement,
			service_started_on: started,
			effective_range: { from: started, to: null },
			payroll: { date_of_birth: '1990-01-01', gender, marital_status: 'MARRIED' }
		}))
	};
};
type Seed = ReturnType<typeof seedOf>;
const born = (...dates: readonly string[]) => dates.map((on) => ({ kind: 'CHILD_BIRTH', on }));
const dates = (from: string, count: number) =>
	Array.from({ length: count }, (_, index) => String(add_days(PlainDate(from), index)));
const take = (
	t: Kit,
	seed: Seed,
	code: string,
	days: readonly string[],
	more: { readonly encashment?: boolean } = {}
) =>
	t.as(t.admin).pipe(
		Effect.flatMap((caller) =>
			caller.act({
				'leave_catalog_entry.create': [
					leaveCreate({
						entity_id: ENTITY,
						employment_id: CONTRACT,
						catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
						days: wholeDays(...days),
						...more
					})
				]
			})
		)
	);
const run = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.pipe(
			Effect.flatMap((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
			)
		)
		.pipe(Effect.andThen(t.run_due()));
const ANNUAL_DAY = ['2026-11-23'];
/** How many leave entries the workspace holds. */
const entries = (t: Kit) =>
	storedQuery(t, { leave_catalog_entry: { fields: ['id'], limit: 10 } }).pipe(
		Effect.map(({ leave_catalog_entry }) => leave_catalog_entry.rows.length)
	);

describe('a father', () => {
	it.live(
		'counts the stint before a rehire toward those months where the profile counts every stint',
		() => {
			const base = seedOf({ started: '2025-11-10', gender: 'MALE', events: born('2026-11-02') });
			const seed = {
				...base,
				employee_profile: [
					{ id: uuid(4), user_id: uuid(3), name: 'Worker', cumulative_service: true }
				],
				employee_contract: (base.employee_contract ?? []).flatMap((row) => [
					{
						...row,
						id: uuid(60),
						service_started_on: '2024-01-02',
						effective_range: { from: '2024-01-02', to: '2025-11-05' }
					},
					row
				])
			};
			return Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				// the current stint alone is short of the row's qualifying months
				assert.ok(measureOf(yield* accountsIn(t), 'leave', 'PATERNITY_LEAVE', 'entitled') > 0);
				yield* take(t, base, 'PATERNITY_LEAVE', ['2026-11-03']);
				assert.equal(yield* entries(t), 1);
			}).pipe(Effect.provide(workspace({ seed, now: NOW })));
		}
	);
});

describe('absence without leave', () => {
	const asks = (person: Person) => {
		const seed = seedOf(person);
		return { seed, layer: workspace({ seed, now: NOW }) };
	};
	// B2: a contract without its ordinary week is refused, so the rule has no unrecorded-week fallback
	it.live('does not stop an exit pay-out being written', () => {
		const { seed, layer } = asks({ absent: dates('2026-02-01', 27) });
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* take(t, seed, 'ANNUAL_LEAVE', ANNUAL_DAY, { encashment: true });
			assert.equal(yield* entries(t), 1);
		}).pipe(Effect.provide(layer));
	});
});

describe('unpaid leave', () => {
	// two full years' service at the 12-day band; a month less and it is the 8-day band
	const seed = seedOf({ started: '2024-11-01' });
	const nine = dates('2026-11-23', 9);
	const layer = workspace({ seed, now: NOW });
	const unpaid = (t: Kit, days: readonly string[]) => take(t, seed, 'NPL', days);
	it.live('deleted after its run is paid does not count', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* unpaid(t, dates('2026-03-01', 31));
			yield* run(t, '2026-03');
			const [march] = (yield* storedQuery(t, { payroll_run: { limit: 1 } })).payroll_run.rows;
			const [priced] = (yield* storedQuery(t, { leave_catalog_entry: { limit: 1 } }))
				.leave_catalog_entry.rows;
			assert.ok(march !== undefined && priced !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.update': [{ target: march, set: { state: 'PAID' } }]
			});
			yield* t.run_due();
			yield* (yield* t.as(t.admin)).act({ 'leave_catalog_entry.delete': [{ target: priced }] });
			yield* t.run_due();
			yield* take(t, seed, 'ANNUAL_LEAVE', nine);
			assert.equal(yield* entries(t), 1);
		}).pipe(Effect.provide(layer))
	);
});

describe('the day rate', () => {
	it('carries an allowance in the rate, and none outside it', () => {
		const [settings] = read('seed/public/jurisdiction/MY/version_5/jurisdiction_settings.json');
		assert.ok(settings !== undefined);
		const rate = (amount: number, allowances: JsonObject) =>
			payBasis(
				{
					run: {},
					settings,
					subtotals: [],
					allowance: [
						{ code: 'FIXED', lookup: {}, include_in_rate: true },
						{ code: 'TIPS', lookup: {}, include_in_rate: false }
					],
					overtime: [],
					statutory: [],
					leave_catalog: [],
					claim_catalog: [],
					adhoc_catalog: [],
					loan_catalog: [],
					employee: {},
					employment: {
						terms: {
							rate: { amount, unit: 'MONTHLY' },
							normal_hours_per_day: 8,
							normal_hours_per_week: 40,
							normal_days_per_week: 5,
							allowances
						}
					},
					employer: { payment_schedule: { non_working_weekdays: [0, 6] } },
					balance: {},
					entries: {}
				},
				{ from: '2026-06-01', to: '2026-06-30' }
			).day_rate;
		const both = rate(2600, { FIXED: { amount: 260 }, TIPS: { amount: 100 } });
		// the one in the rate is wage like the salary; the one outside changes nothing
		assert.equal(both, rate(2860, {}));
		assert.ok(both > rate(2600, { TIPS: { amount: 100 } }));
		assert.equal(rate(2600, { TIPS: { amount: 100 } }), rate(2600, {}));
	});
});
