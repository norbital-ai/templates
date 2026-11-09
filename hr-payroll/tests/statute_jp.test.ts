// Japan's leave law on the catalog rows: the expressions sync evaluates, the rules that refuse an entry, and the review an
// annual leave grant day raises. Figures are synthetic: this proves the mechanism, not the seeded law.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { addDays, PlainDate } from '@norbital-ai/std/date';
import { entitlementOf, type LeavePerson } from '../src/lib/ledger/entitlement.ts';
import { entitlementPlans } from '../src/lib/ledger/service.ts';
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

const LEAVE = read('seed/public/jurisdiction/JP/version_17/leave_catalog.json');
const lookupOf = (code: string) => objectValue(LEAVE.find((row) => row.code === code)?.lookup);
const person = (
	terms: JsonObject,
	extension: JsonObject = {},
	started = '2024-01-01'
): LeavePerson => {
	const { events, children, ...facts } = extension;
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
			...(Array.isArray(children) ? { children } : {}),
			employee_extension_data: facts
		}
	};
};
const FULL = { normal_hours_per_week: 40, normal_days_per_week: 5 };
const SHORT = { normal_hours_per_week: 20, normal_days_per_week: 2 };

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
	const on = (who: LeavePerson, date: string) => entitlementOf(lookup, who, date);
	it('grants by service from the grant day', () => {
		assert.equal(on(person(FULL), '2024-06-30'), 0);
		assert.equal(on(person(FULL), '2024-07-01'), 7);
		assert.equal(on(person(FULL), '2025-07-01'), 9);
	});
	it('takes the table only below both the weekly hours and the weekly days', () => {
		assert.equal(on(person(SHORT), '2024-07-01'), 2);
		assert.equal(on(person(SHORT), '2025-07-01'), 3);
		assert.equal(on(person(SHORT), '2029-07-01'), 3);
		assert.equal(on(person({ ...SHORT, normal_days_per_week: 5 }), '2024-07-01'), 7);
		assert.equal(on(person({ ...SHORT, normal_hours_per_week: 35 }), '2024-07-01'), 7);
	});
	it('gives nothing for a grant day the fact stands on, and resumes the year after', () => {
		const short = { kind: 'ATTENDANCE_BELOW_RATIO', on: '2025-07-01' };
		const who = person(FULL, { events: [short] });
		assert.equal(on(who, '2025-06-30'), 7);
		assert.equal(on(who, '2025-07-01'), 0);
		assert.equal(on(who, '2026-07-01'), 9);
	});
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

describe('child nursing leave', () => {
	const lookup = {
		...lookupOf('CHILD_NURSING_LEAVE'),
		days_one_child: 2,
		days_two_or_more: 3,
		school_age_limit_years: 4
	};
	const child = (on: string, ended_on?: string) => ({
		kind: 'CHILD_BIRTH',
		on,
		...(ended_on === undefined ? {} : { ended_on })
	});
	const on = (date: string, ...events: readonly JsonObject[]) =>
		entitlementOf(lookup, person(FULL, { events }), date);
	it('counts the children in age', () => {
		assert.equal(on('2026-02-01'), 0);
		assert.equal(on('2026-02-01', child('2024-05-01')), 2);
		assert.equal(on('2026-02-01', child('2024-05-01'), child('2025-05-01')), 3);
	});
	it('is limited by age on the 1 April the year opens, whenever in the year it is read', () => {
		assert.equal(on('2026-03-31', child('2021-04-02')), 2);
		assert.equal(on('2026-04-01', child('2021-04-02')), 0);
		assert.equal(on('2026-03-31', child('2021-04-01')), 0);
	});
	it('leaves out a child not yet born or no longer raised', () => {
		assert.equal(on('2026-02-01', child('2026-02-02')), 0);
		assert.equal(on('2026-02-01', child('2024-05-01', '2026-01-31')), 0);
	});
});

describe('family care days', () => {
	const lookup = {
		...lookupOf('FAMILY_CARE_DAYS'),
		days_one_recipient: 2,
		days_two_or_more: 6,
		recipient_threshold: 3
	};
	const on = (family_care_recipients: number) =>
		entitlementOf(lookup, person(FULL, { family_care_recipients }), '2026-02-01');
	it('follows the family members in need of care', () => {
		assert.equal(on(0), 0);
		assert.equal(on(2), 2);
		assert.equal(on(3), 6);
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
	statutory: { HEALTH: { elections: { standard_monthly_remuneration: 300_000 } } }
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
const OUTSIDE = /JP_PRENATAL_WINDOW/;
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

describe('prenatal leave', () => {
	const LOOKUP = { PRENATAL_LEAVE: { days: 3, multiple_pregnancy_days: 5 } };
	const birth = (kind: string, ended_on?: string): JsonObject => ({
		kind,
		on: '2026-07-20',
		...(ended_on === undefined ? {} : { ended_on })
	});
	const prenatal = (seed: Seed, date: string) => (t: Kit) =>
		take(t, seed, 'PRENATAL_LEAVE', wholeDays(date));
	const inSeed = (seed: Seed, body: (t: Kit) => Effect.Effect<unknown, unknown>) =>
		TestWorkspace.pipe(Effect.flatMap(body), Effect.provide(workspace({ seed, now: NOW })));
	it.live('opens the days before the expected birth, the day itself counted', () => {
		const seed = seedOf([birth('EXPECTED_BIRTH')], LOOKUP);
		return inSeed(seed, (t) =>
			Effect.gen(function* () {
				yield* refused(prenatal(seed, '2026-07-17')(t), OUTSIDE);
				yield* prenatal(seed, '2026-07-18')(t);
			})
		);
	});
	it.live('opens earlier for a multiple pregnancy', () => {
		const seed = seedOf([birth('EXPECTED_MULTIPLE_BIRTH')], LOOKUP);
		return inSeed(seed, (t) =>
			Effect.gen(function* () {
				yield* refused(prenatal(seed, '2026-07-15')(t), OUTSIDE);
				yield* prenatal(seed, '2026-07-16')(t);
			})
		);
	});
	it.live('runs on past the expected day until the birth', () => {
		const late = seedOf([birth('EXPECTED_BIRTH')], LOOKUP);
		const born = seedOf([birth('EXPECTED_BIRTH', '2026-07-21')], LOOKUP);
		return Effect.gen(function* () {
			yield* inSeed(late, prenatal(late, '2026-07-23'));
			yield* inSeed(born, (t) => refused(prenatal(born, '2026-07-22')(t), OUTSIDE));
		});
	});
	it.live('needs the expected birth on the contract', () => {
		const seed = seedOf([], LOOKUP);
		return inSeed(seed, (t) => refused(prenatal(seed, '2026-07-18')(t), OUTSIDE));
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
	const GRANT = '2026-07-06';
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

	it.live('raises HR’s task, due on the grant day, when recorded attendance is short', () => {
		const seed = seedOf([], AFTER, year(140));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t);
			const [task] = yield* reviews(t);
			assert.equal(String(task?.due_on), GRANT);
			assert.equal(task?.employment_id, CONTRACT);
			assert.match(String(task?.title), /\d+\/\d+ days recorded/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
	it.live('stays quiet when attendance reaches the ratio', () => {
		const seed = seedOf([], AFTER, year(100));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t);
			assert.deepEqual(yield* reviews(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
	it.live('stays quiet in a month with no grant day', () => {
		const seed = seedOf([], AFTER, year(140));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t, '2026-06');
			assert.deepEqual(yield* reviews(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
	it.live('stays quiet once HR has recorded the fact', () => {
		const fact = { kind: 'ATTENDANCE_BELOW_RATIO', on: GRANT };
		const seed = seedOf([fact], AFTER, year(140));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* run(t);
			assert.deepEqual(yield* reviews(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
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

	const AWAY = wholeDays('2025-07-07', '2025-07-08', '2025-07-09', '2025-07-10', '2025-07-11');
	const SHORT_ROSTER = { ANNUAL_LEAVE: { attendance_ratio: 0.99 } };
	it.live('counts leave the statute does not deem attended', () => {
		const seed = seedOf([], SHORT_ROSTER, year(0));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, 'UNPAID_LEAVE', AWAY);
			yield* run(t);
			assert.equal((yield* reviews(t)).length, 1);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
	it.live('leaves alone the leave it deems attended', () => {
		const seed = seedOf([], SHORT_ROSTER, year(0));
		return Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, seed, 'CHILDCARE_LEAVE', AWAY);
			yield* run(t);
			assert.deepEqual(yield* reviews(t), []);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })));
	});
});
