// Japan's leave law on the catalog rows: the expressions sync evaluates, the rules that refuse an entry, and the review an
// annual leave grant day raises. Figures are synthetic: this proves the mechanism, not the seeded law.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { addDays, PlainDate } from '@norbital-ai/std/date';
import type { LeavePerson } from '../src/lib/ledger/entitlement.ts';
import { entitlementPlans } from '../src/lib/ledger/service.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { dateWeekday } from '../src/lib/payroll_engine/time_evidence.ts';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { idOf, objectValue } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	REST,
	WORK,
	accountsIn,
	catalogRow,
	measureOf,
	pack,
	read,
	sealEvents,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	leaveCreate
} from './kit.ts';

const LEAVE = read('seed/public/jurisdiction/JP/version_6/leave_catalog.json');
const OVERTIME = read('seed/public/jurisdiction/JP/version_6/overtime_catalog.json');
const lookupOf = (code: string) => objectValue(LEAVE.find((row) => row.code === code)?.lookup);
const person = (
	terms: JsonObject,
	extension: JsonObject = {},
	started = '2024-01-01'
): LeavePerson => {
	const { events, family, ...facts } = extension;
	return {
		started,
		partTime: false,
		gender: null,
		maritalStatus: null,
		terms,
		employment: {
			service_started_on: started,
			terms,
			...(Array.isArray(events) ? { events } : {}),
			...(Array.isArray(family) ? { family } : {}),
			employee_extension_data: facts
		}
	};
};
const FULL = { normal_hours_per_week: 40, normal_days_per_week: 5 };

describe('annual leave', () => {
	const lookup = {
		...lookupOf('ANNUAL_LEAVE'),
		service_bands: [
			{ service_months: 18, days: 9 },
			{ service_months: 6, days: 7 }
		],
		full_time_weekly_hours: 30,
		full_time_days_per_week: 5,
		full_time_days_per_year: 200,
		grant_days_by_normal_days_per_week: [
			{ normal_days_per_week: 2, service_year: 1, days: 2 },
			{ normal_days_per_week: 2, service_year: 2, days: 3 }
		]
	};
	it('keeps what carried into the year the grant is refused', () => {
		const who = person(FULL, {
			events: [{ kind: 'ATTENDANCE_BELOW_RATIO', on: '2025-07-01' }]
		});
		const [plan] = entitlementPlans(
			[{ account: 'leave', code: 'ANNUAL_LEAVE', lookup }],
			who,
			{ scope: 'JP', started: who.started, events: [] },
			'balance',
			{ leave: { ANNUAL_LEAVE: { 'JP.S.2024-07-01': { entitled: 7, used: 3 } } } },
			'2025-07-01'
		);
		assert.deepEqual(
			plan?.wanted.map((row) => [row.period, row.measure, row.amount]),
			[['JP.S.2025-07-01', 'carried', 4]]
		);
	});
});

const TERMS = {
	rate: { amount: 300_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
	work_classification: 'ORDINARY',
	residency_status: 'RESIDENT',
	wage_payment_method: 'BANK',
	allowances: {}
};
const FACTS = {
	insured_office_region: 'HOKKAIDO',
	statutory: { HEALTH: { standard_monthly_remuneration: 300_000 } }
};
const CONTRACT = idOf('employee_contract', uuid(6));
const STARTED = '2025-01-06';
const NOW = '2026-07-20T02:00:00.000Z';
const ABS = uuid(14);
type Seed = ReturnType<typeof pack>;
const seedOf = (
	events: readonly JsonObject[] = [],
	lookups: Readonly<Record<string, JsonObject>> = {},
	roster: readonly (readonly [string, string])[] = []
): Seed => {
	const seed = pack('JP', 'Asia/Tokyo', TERMS, { ...FACTS, events }, [], [], '2026-07-15');
	return {
		...seed,
		entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
			...row,
			entity_extension_data: { workers_accident_rate_per_mille: 3 }
		})),
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			service_started_on: STARTED,
			effective_range: { from: '2025-11-03', to: null },
			payroll: { ...objectValue(row.payroll), gender: 'FEMALE' }
		})),
		leave_catalog: (seed.leave_catalog ?? []).map((row) =>
			Object.hasOwn(lookups, String(row.code))
				? { ...row, lookup: { ...objectValue(row.lookup), ...lookups[String(row.code)] } }
				: row
		),
		shift_definition: [
			...(seed.shift_definition ?? []),
			{
				id: ABS,
				entity_id: ENTITY,
				code: 'ABS',
				name: 'ABS',
				effective_range: { from: '2025-01-01', to: null },
				variant: { day_type: 'ABS', ends_next_day: false, breaks: [] }
			}
		],
		roster_entry: roster.map(([date, shift], index) => ({
			id: uuid(1000 + index),
			employment_id: uuid(6),
			work_date: date,
			shift_definition_id: shift,
			findings: []
		}))
	};
};
const take = (t: Kit, seed: Seed, code: string, days: ReturnType<typeof wholeDays>) =>
	t.as(t.admin).act('leave_catalog_entry.create', [
		leaveCreate({
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
			days
		})
	]);
const refused = (write: Effect.Effect<unknown, unknown>, reason: RegExp) =>
	Effect.flip(write).pipe(Effect.map((error) => assert.match(String(error), reason)));
const NO_BALANCE = /insufficient balance/;
const OVER_CAP = /JP_ANNUAL_LEAVE_HOURS_CAP/;

describe('facts sealed on a contract', () => {
	it.live('open the balance they entitle, and an entry is held to it', () => {
		const seed = seedOf([], {
			CHILD_NURSING_LEAVE: { days_one_child: 1, days_two_or_more: 2 },
			FAMILY_CARE_DAYS: { days_one_recipient: 1 }
		});
		const bare = seed.employee_contract?.[0];
		const cared: Seed = {
			...seed,
			employee_contract: [
				{
					...bare,
					employee_extension_data: {
						...objectValue(bare?.employee_extension_data),
						family_care_recipients: 1
					}
				}
			]
		};
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			assert.equal(measureOf(yield* accountsIn(t), 'leave', 'FAMILY_CARE_DAYS', 'entitled'), 1);
			yield* refused(take(t, cared, 'CHILD_NURSING_LEAVE', wholeDays('2026-07-06')), NO_BALANCE);
			yield* sealEvents(t, '2026-07-01', [{ kind: 'CHILD_BIRTH', on: '2024-05-01' }]);
			yield* t.runDue();
			const accounts = yield* accountsIn(t);
			assert.equal(measureOf(accounts, 'leave', 'CHILD_NURSING_LEAVE', 'entitled'), 1);
			yield* take(t, cared, 'CHILD_NURSING_LEAVE', wholeDays('2026-07-06'));
			yield* t.runDue();
			yield* refused(take(t, cared, 'CHILD_NURSING_LEAVE', wholeDays('2026-07-07')), NO_BALANCE);
		}).pipe(Effect.provide(workspace({ seed: cared, now: NOW })));
	});
});

describe('annual leave in hours', () => {
	it.live('draws on annual leave, and refuses beyond the yearly cap', () => {
		const seed = seedOf([], { ANNUAL_LEAVE_HOURS: { annual_days_cap: 1.5 } });
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* take(t, seed, 'ANNUAL_LEAVE_HOURS', wholeDays('2026-07-06'));
			yield* t.runDue();
			const accounts = yield* accountsIn(t);
			assert.equal(measureOf(accounts, 'leave', 'ANNUAL_LEAVE', 'used'), 1);
			assert.equal(accounts.leave?.['ANNUAL_LEAVE_HOURS'], undefined);
			yield* take(t, seed, 'ANNUAL_LEAVE_HOURS', [{ date: PlainDate('2026-07-07'), part: 'AM' }]);
			yield* refused(
				take(t, seed, 'ANNUAL_LEAVE_HOURS', [{ date: PlainDate('2026-07-07'), part: 'PM' }]),
				OVER_CAP
			);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
});

describe('the attendance review on an annual leave grant day', () => {
	const REVIEW = /below the statutory ratio/;
	/** A roster for every day of the year before the grant, up to the run's month: weekends off, the first weekdays absent. */
	const year = (absent: number) => {
		const days: (readonly [string, string])[] = [];
		let missed = 0;
		for (let day = PlainDate('2025-07-06'); day < PlainDate('2026-07-01'); day = addDays(day, 1)) {
			const off = [0, 6].includes(dateWeekday(String(day)));
			const away = !off && missed < absent;
			if (away) missed += 1;
			days.push([String(day), off ? REST : away ? ABS : WORK]);
		}
		return days;
	};
	const reviews = (t: Kit) =>
		t
			.storedQuery({ obligation: { limit: 1000 } })
			.pipe(
				Effect.map(({ obligation }) => obligation.rows.filter((row) => REVIEW.test(row.title)))
			);
	const run = (t: Kit, period = '2026-07') =>
		t
			.as(t.admin)
			.act('payroll_run.create', [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }])
			.pipe(Effect.andThen(t.runDue()));
	const AFTER = { ANNUAL_LEAVE: { attendance_ratio: 0.5 } };

	it.live('raises once, though the run is made again', () => {
		const seed = seedOf([], AFTER, year(140));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t);
			const [made] = (yield* t.storedQuery({ payroll_run: { limit: 1 } })).payroll_run.rows;
			assert.ok(made !== undefined);
			yield* t.as(t.admin).act('payroll_run.delete', [{ target: made.id }]);
			yield* t.runDue();
			yield* run(t);
			assert.equal((yield* reviews(t)).length, 1);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
});

describe('rest-day work', () => {
	const row = OVERTIME.find((item) => item.code === 'REST_DAY_WORK');
	const pay = (employer: JsonObject) =>
		evaluate(
			String(row?.conversion),
			'CALCULATION',
			{
				hour_rate: 2000,
				lookup: objectValue(row?.lookup),
				work: { days: [{ date: '2026-07-05', day_type: 'REST', worked_hours: 8 }] },
				subject: { employment: {}, employer }
			},
			'REST_DAY_WORK'
		);
	it('pays the employer’s own multiple only where it pays more than the statute', () => {
		const statute = Number(pay({}));
		const multiple = statute / (8 * 2000);
		assert.ok(multiple > 1);
		const method = (rest_day_hourly_multiplier: number) =>
			Number(pay({ pay_methods: { rest_day_hourly_multiplier } }));
		assert.equal(method(multiple / 2), statute);
		assert.ok(Math.abs(method(multiple * 2) - statute * 2) < 1e-6);
	});
});
