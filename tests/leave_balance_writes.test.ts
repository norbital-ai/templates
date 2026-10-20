import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { fixtureId, nativeId } from './fixture_values.js';
import { lineage, world, type Tables } from './jurisdiction_kit.js';

const COMPANY = nativeId('entity', fixtureId('leave-balance-company'));
const PERSON = nativeId('employment_profile', fixtureId('leave-balance-person'));
const EMPLOYMENT = nativeId('employment_contract', fixtureId('leave-balance-employment'));
const WORK = nativeId('shift_definition', fixtureId('leave-balance-work'));
const REST = nativeId('shift_definition', fixtureId('leave-balance-rest'));
const PATTERN = nativeId('shift_pattern', fixtureId('leave-balance-pattern'));
const AS_OF = PlainDate('2026-03-02');

function fixture(country: 'PH' | 'ID') {
	const law = lineage(country);
	const version = law.versionOn(AS_OF);
	const annual = nativeId('leave_catalog', law.byCode(version, 'leave_catalog', 'ANNUAL_LEAVE').id);
	const rows: Tables = law.law();
	rows.set('entity', [
		{
			id: COMPANY,
			name: 'Synthetic leave balance company',
			settings_code: country,
			region: country === 'PH' ? 'IV-A' : 'DKI_JAKARTA',
			time_zone: country === 'PH' ? 'Asia/Manila' : 'Asia/Jakarta',
			pay_frequency: 'MONTHLY',
			pay_cutoff_day: 1,
			effective_range: { from: '2025-03-01', to: null },
			facts: {}
		}
	]);
	rows.set('employment_profile', [
		{
			id: PERSON,
			name: 'Synthetic leave balance employee',
			email: 'leave.balance@example.com',
			date_of_birth: '1990-01-01',
			nationality: country,
			facts: {}
		}
	]);
	rows.set('employment_contract', [
		{
			id: EMPLOYMENT,
			employee_id: PERSON,
			company_id: COMPANY,
			employee_number: 'LEAVE-1',
			contract_number: 1,
			effective_range: { from: '2025-03-01', to: null },
			facts: {
				contract_terms: [
					{
						effective_range: { from: '2025-03-01', to: null },
						base_salary: {
							value: country === 'PH' ? 30000 : 6000000,
							currency: country === 'PH' ? 'PHP' : 'IDR'
						},
						employment_type: 'PERMANENT',
						work_classification: country === 'PH' ? 'RANK_AND_FILE' : 'ORDINARY',
						statutory_work_category: country === 'PH' ? 'NON_FIELD' : 'NON_MANUAL',
						residency_status: 'CITIZEN',
						shift_pattern_id: PATTERN,
						allowances: [],
						facts: {}
					}
				]
			}
		}
	]);
	rows.set('shift_definition', [
		{
			id: WORK,
			company_id: COMPANY,
			code: 'DAY',
			variant: { day_type: 'WORK', start_time: '09:00', end_time: '17:00', break_minutes: 0 }
		},
		{ id: REST, company_id: COMPANY, code: 'REST', variant: { day_type: 'REST' } }
	]);
	rows.set('shift_pattern', [
		{
			id: PATTERN,
			company_id: COMPANY,
			code: 'FIVE-WORK-TWO-REST',
			effective_range: { from: '2025-03-03', to: null },
			pattern: {
				days: [WORK, WORK, WORK, WORK, WORK, REST, REST].map((roster_code_id) => ({
					roster_code_id
				}))
			}
		}
	]);
	for (const name of ['roster_entry', 'holiday', 'leave_catalog_entry', 'payroll_run', 'payslip'])
		rows.set(name, []);
	const request = (from: string, to = from, catalog_id = annual) => ({
		catalog_id,
		employment_id: EMPLOYMENT,
		occurred_on: PlainDate(from),
		activity: 'TIME_OFF' as const,
		from: PlainDate(from),
		to: PlainDate(to)
	});
	return { rows, annual, law, version, request };
}

it.live(
	'native leave batches refuse aggregate overdraw and days-only edits retain the counted range charge',
	() => {
		const f = fixture('PH');
		return world(f.rows).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				const start = yield* actor.query('leave_catalog_entry.leave_balances', {
					employment_id: EMPLOYMENT,
					as_of: AS_OF
				});
				assert.equal(start.balances.find((row) => row.catalog_id === f.annual)?.available, 5);
				const batch = yield* Effect.flip(
					actor.act('leave_catalog_entry.create', [
						f.request('2026-03-02', '2026-03-04'),
						f.request('2026-03-09', '2026-03-11')
					])
				);
				assert.match(batch.message, /available 2 day/);
				assert.equal((yield* t.storedRead('leave_catalog_entry', { all: true })).rows.length, 0);
				yield* actor.act('leave_catalog_entry.create', f.request('2026-03-02', '2026-03-06'));
				const [row] = (yield* t.storedRead('leave_catalog_entry', { all: true })).rows;
				assert.ok(row);
				yield* actor.act('leave_catalog_entry.update', {
					target: [row.id],
					set: { days: Decimal.of('0.5') }
				});
				const [recounted] = (yield* t.storedRead('leave_catalog_entry', { all: true })).rows;
				assert.equal(recounted?.days?.toNumber(), 5);
				const final = yield* actor.query('leave_catalog_entry.leave_balances', {
					employment_id: EMPLOYMENT,
					as_of: AS_OF
				});
				assert.equal(final.balances.find((held) => held.catalog_id === f.annual)?.available, 0);
				const over = yield* Effect.flip(
					actor.act('leave_catalog_entry.create', f.request('2026-03-09'))
				);
				assert.match(over.message, /available 0 day/);
			})
		);
	},
	{ timeout: 15_000 }
);

it.live(
	'native sibling edits use the final leave set and allow a balanced redistribution',
	() => {
		const f = fixture('PH');
		return world(f.rows).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				yield* actor.act('leave_catalog_entry.create', [
					f.request('2026-03-02', '2026-03-03'),
					f.request('2026-03-09', '2026-03-10')
				]);
				const before = (yield* t.storedRead('leave_catalog_entry', { all: true })).rows.toSorted(
					(a, b) => String(a.from).localeCompare(String(b.from))
				);
				const [first, second] = before;
				assert.ok(first && second);
				const over = yield* Effect.flip(
					actor.act('leave_catalog_entry.update', [
						{ target: first.id, set: { to: PlainDate('2026-03-04') } },
						{ target: second.id, set: { to: PlainDate('2026-03-11') } }
					])
				);
				assert.match(over.message, /available 2 day/);
				assert.deepEqual(
					(yield* t.storedRead('leave_catalog_entry', { all: true })).rows.toSorted((a, b) =>
						String(a.from).localeCompare(String(b.from))
					),
					before
				);
				yield* actor.act('leave_catalog_entry.update', [
					{ target: first.id, set: { to: PlainDate('2026-03-02') } },
					{ target: second.id, set: { to: PlainDate('2026-03-12') } }
				]);
				const after = (yield* t.storedRead('leave_catalog_entry', { all: true })).rows;
				assert.deepEqual(after.map((row) => row.days?.toNumber()).sort(), [1, 4]);
				const balance = yield* actor.query('leave_catalog_entry.leave_balances', {
					employment_id: EMPLOYMENT,
					as_of: AS_OF
				});
				assert.equal(balance.balances.find((row) => row.catalog_id === f.annual)?.available, 0);
			})
		);
	},
	{ timeout: 15_000 }
);

it.live(
	'native ID joint leave shares and cannot overdraw its annual leave pool',
	() => {
		const f = fixture('ID');
		const joint = nativeId(
			'leave_catalog',
			f.law.byCode(f.version, 'leave_catalog', 'JOINT_LEAVE').id
		);
		return world(f.rows).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				const before = yield* actor.query('leave_catalog_entry.leave_balances', {
					employment_id: EMPLOYMENT,
					as_of: AS_OF
				});
				assert.equal(before.balances.find((row) => row.catalog_id === f.annual)?.available, 12);
				assert.equal(before.balances.find((row) => row.catalog_id === joint)?.available, 12);
				yield* actor.act('leave_catalog_entry.create', f.request('2026-03-02', '2026-03-17'));
				const exhausted = yield* actor.query('leave_catalog_entry.leave_balances', {
					employment_id: EMPLOYMENT,
					as_of: AS_OF
				});
				assert.equal(exhausted.balances.find((row) => row.catalog_id === joint)?.available, 0);
				const over = yield* Effect.flip(
					actor.act('leave_catalog_entry.create', f.request('2026-03-18', '2026-03-18', joint))
				);
				assert.match(over.message, /available 0 day/);
				assert.equal((yield* t.storedRead('leave_catalog_entry', { all: true })).rows.length, 1);
			})
		);
	},
	{ timeout: 15_000 }
);
