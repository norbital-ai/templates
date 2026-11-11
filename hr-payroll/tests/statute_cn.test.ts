// What Chinese statute and the Shanghai and Kunming rules condition on leave and its pay: dated facts open the days, a
// region picks its figure. The figures are synthetic: these prove the mechanism, not the seeded law.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import type { LeavePerson } from '../src/lib/ledger/entitlement.ts';
import { entitlementOf } from '../src/lib/ledger/entitlement.ts';
import { entitlementPlans } from '../src/lib/ledger/service.ts';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { payBasis } from '../src/lib/payroll_engine/engine.ts';
import { idOf, objectValue } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	measureOf,
	pack,
	read,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	leaveCreate
} from './kit.ts';

const ROOT = 'seed/public/jurisdiction/CN';
const file = (version: number, name: string) =>
	read(join(ROOT, `version_${version}`, `${name}.json`));
const leaveRow = (code: string, version = 2) => {
	const row = file(version, 'leave_catalog').find((item) => item.code === code);
	assert.ok(row !== undefined, code);
	return row;
};
const lookupOf = (code: string, version = 2) => objectValue(leaveRow(code, version).lookup);

type Person = {
	readonly region?: string;
	readonly gender?: string;
	readonly events?: readonly JsonObject[];
	readonly started?: string;
};
const personOf = ({
	region = 'SH',
	gender = 'FEMALE',
	events = [],
	started = '2020-01-01'
}: Person): LeavePerson => {
	return {
		started,
		partTime: false,
		gender,
		maritalStatus: 'MARRIED',
		employment: {
			service_started_on: started,
			effective_range: { from: started, to: null },
			events,
			employee_extension_data: {}
		},
		employer: { entity_extension_data: { region } }
	};
};
/** What the events on a contract open of a row, by period. */
const opened = (code: string, person: Person, law: JsonObject = {}) => {
	const events = person.events ?? [];
	return Object.fromEntries(
		entitlementPlans(
			[{ account: 'leave', code, lookup: { ...lookupOf(code), ...law } }],
			personOf(person),
			{
				scope: 'CN',
				started: '2020-01-01',
				events: events.map((event) => ({ kind: String(event.kind), on: String(event.on) }))
			},
			'balance',
			{},
			'2026-06-15'
		).map((plan) => [
			String(plan.source.split(':').at(-1)),
			plan.wanted.reduce((total, row) => total + row.amount, 0)
		])
	);
};

describe('dated facts open maternity leave', () => {
	const LAW = {
		grant_days: 100,
		prenatal_days: 10,
		difficult_birth_extra_days: 7,
		additional_baby_extra_days: 5,
		miscarriage_month_threshold: 3,
		miscarriage_under_threshold_days: 2,
		miscarriage_from_threshold_days: 4
	};
	const open = (events: readonly JsonObject[], gender = 'FEMALE') =>
		opened('MATERNITY_LEAVE', { events, gender }, LAW);
	it('opens nothing for a man', () => {
		assert.deepEqual(open([{ kind: 'CHILD_BIRTH', on: '2026-03-02' }], 'MALE'), {});
	});
});

describe('the day rate', () => {
	it('adds the fixed allowances to the salary', () => {
		const settings = file(4, 'jurisdiction_settings')[0];
		assert.ok(settings !== undefined);
		const day = payBasis(
			{
				run: {},
				settings: {
					...settings,
					conversions: { ...(settings.conversions as object), day: { basis: 'FIXED', days: 10 } }
				},
				subtotals: [],
				allowance: [
					{ code: 'FIXED_ALLOWANCE', include_in_rate: true },
					{ code: 'FOREIGN_LANGUAGE_ALLOWANCE', include_in_rate: true },
					{ code: 'FOREIGN_CHILD_EDUCATION_ALLOWANCE', include_in_rate: true },
					{ code: 'MEAL_SUBSIDY_OUT', include_in_rate: false }
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
						rate: { amount: 900, unit: 'MONTHLY' },
						normal_hours_per_day: 8,
						normal_hours_per_week: 40,
						normal_days_per_week: 5,
						allowances: {
							FIXED_ALLOWANCE: { amount: 50 },
							FOREIGN_LANGUAGE_ALLOWANCE: { amount: 30 },
							FOREIGN_CHILD_EDUCATION_ALLOWANCE: { amount: 20 },
							MEAL_SUBSIDY_OUT: { amount: 400 }
						}
					}
				},
				employer: { payment_schedule: { non_working_weekdays: [0, 6] } },
				balance: {},
				entries: {}
			},
			{ from: '2026-06-01', to: '2026-06-30' }
		).day_rate;
		assert.equal(day, 100);
	});
});

describe('work events in leave entitlement', () => {
	it('exposes dated work events to the entitlement expression', () => {
		const lookup = {
			entitlement:
				'return (ctx.work_events ?? []).some((event) => event.code === "NATURAL_DISASTER") ? 3 : 0;'
		};
		const person = personOf({});
		assert.equal(entitlementOf(lookup, person, '2026-07-15'), 0);
		assert.equal(
			entitlementOf(
				lookup,
				{
					...person,
					workEvents: [{ code: 'NATURAL_DISASTER', from: '2026-07-01', to: '2026-07-31' }]
				},
				'2026-07-15'
			),
			3
		);
	});
});

const NOW = '2026-06-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const TERMS = {
	rate: { amount: 22_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
type Seeded = Person & { readonly family?: readonly JsonObject[]; readonly account?: JsonObject };
const seedOf = ({
	region = 'SH',
	gender = 'FEMALE',
	events = [],
	family = [],
	started = '2015-01-01',
	account = {}
}: Seeded) => {
	const seed = pack('CN', 'Asia/Shanghai', TERMS, { events, family }, [], [], '2026-06-15');
	return {
		...seed,
		employee_balance: (seed.employee_balance ?? []).map((row) => ({ ...row, account })),
		entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
			...row,
			entity_extension_data: {
				region,
				hpf_rate_percent: 7,
				work_injury_rate_percent: 0.2
			}
		})),
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			service_started_on: started,
			payroll: { date_of_birth: '1990-01-01', gender, marital_status: 'MARRIED' }
		}))
	};
};
type Seed = ReturnType<typeof seedOf>;
const take = (t: Kit, seed: Seed, code: string, ...dates: readonly string[]) =>
	t.as(t.admin).act('leave_catalog_entry.create', [
		leaveCreate({
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
			days: wholeDays(...dates)
		})
	]);
const refused = (t: Kit, seed: Seed, code: string, ...dates: readonly string[]) =>
	Effect.flip(take(t, seed, code, ...dates)).pipe(Effect.map(String));
/** Consecutive days from a date. */
const run = (from: string, count: number) =>
	Array.from({ length: count }, (_, index) => {
		const at = new Date(`${from}T00:00:00Z`);
		at.setUTCDate(at.getUTCDate() + index);
		return at.toISOString().slice(0, 10);
	});

describe('on the ledger', () => {
	const mother = seedOf({
		events: [
			{ kind: 'CONFINEMENT', on: '2026-05-28' },
			{ kind: 'CHILD_BIRTH', on: '2026-06-01' }
		]
	});
	it.live('a birth’s days are limited, and those before it draw on the confinement', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* take(t, mother, 'MATERNITY_LEAVE', '2026-05-28', '2026-05-29');
			yield* take(t, mother, 'MATERNITY_LEAVE', '2026-06-01');
			yield* t.runDue();
			const accounts = yield* accountsIn(t);
			assert.equal(measureOf(accounts, 'leave', 'MATERNITY_LEAVE', 'used'), 3);
			assert.equal(accounts.leave?.MATERNITY_LEAVE?.['CN.E.2026-05-28']?.used, 2);
			assert.equal(accounts.leave?.MATERNITY_LEAVE?.['CN.E.2026-06-01']?.used, 1);
			const before = run('2026-05-20', 3);
			assert.match(
				yield* refused(t, mother, 'MATERNITY_LEAVE', ...before),
				/MATERNITY_LEAVE: insufficient balance/
			);
		}).pipe(Effect.provide(workspace({ seed: mother, now: NOW })))
	);
});
