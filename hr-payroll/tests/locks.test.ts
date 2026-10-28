/**
 * What a run settled is fixed: an entry or a work day a payroll run consumed refuses edits until that run is deleted;
 * a paid payslip keeps its run; a sealed version cannot be deleted while a draft can; a settled obligation cannot be
 * withdrawn while an open one can. One shared workspace; each test owns its own period or rows.
 */
import assert from 'node:assert/strict';
import { layer } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { datePeriod, Instant, PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { fixtureId, nativeId } from './fixture_values.ts';
import {
	CATALOG,
	COMPANY,
	REST,
	VERSION,
	WORK,
	employer,
	employment,
	runOf,
	world
} from './jurisdiction_kit.ts';

const A = employment('a');
const DAY = nativeId('roster_entry', fixtureId('xx-captured-day'));
const rows = employer([{ key: 'a', salary: 4000 }]);
rows.set('roster_entry', [
	{
		id: DAY,
		employment_id: A,
		work_date: PlainDate('2026-01-15'),
		shift_definition_id: WORK,
		worked_intervals: [
			{ start: Instant('2026-01-15T09:00:00.000Z'), end: Instant('2026-01-15T18:00:00.000Z') }
		]
	}
]);
// December's run, already paid
const DECEMBER = nativeId('payroll_run', fixtureId('xx-paid-run'));
const PAID = nativeId('payslip', fixtureId('xx-paid-slip'));
rows.set('payroll_run', [
	{
		id: DECEMBER,
		period: '2025-12',
		kind: 'REGULAR',
		sequence: 1,
		warnings: '',
		company_id: COMPANY,
		settings_id: VERSION
	}
]);
rows.set('payslip', [
	{
		id: PAID,
		payroll_run_id: DECEMBER,
		employment_id: A,
		terms_through: '2025-12-31',
		status: 'PAID',
		paid_at: '2025-12-31T00:00:00.000Z',
		currency: 'USD',
		gross: '4000',
		total_deductions: '0',
		net: '4000',
		employer_cost: '4000'
	}
]);

layer(world(rows).layer)('settled payroll locks', (it) => {
	it.effect(
		'a run locks what it consumed for its own payslip until deleted; a paid payslip keeps its run',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const hr = t.as(t.member(['hr_manager']));
				const entered = yield* hr.act('adhoc_catalog_entry.create', [
					{
						catalog_id: CATALOG.BONUS,
						employment_id: A,
						occurred_on: PlainDate('2026-01-20'),
						amount: Decimal.of('100')
					}
				]);
				const bonus =
					entered.kind === 'committed'
						? entered.records.find((row) => row.model === 'adhoc_catalog_entry')
						: undefined;
				assert.ok(bonus && bonus.model === 'adhoc_catalog_entry');
				yield* hr.act('payroll_run.create', [
					{ company_id: COMPANY, period: '2026-01', kind: 'REGULAR' }
				]);
				const january = yield* runOf(hr, '2026-01');
				assert.ok(january.pins.some((pin) => pin.id === bonus.id));
				assert.ok(january.pins.some((pin) => pin.id === DAY));

				// before any pin lands, every consumed row refuses
				assert.match(
					(yield* Effect.flip(
						hr.act('adhoc_catalog_entry.update', [
							{ target: bonus.id, set: { amount: Decimal.of('150') } }
						])
					)).message,
					/settled|captured|payroll|payslip/i
				);
				assert.match(
					(yield* Effect.flip(
						hr.act('roster_entry.update', [{ target: DAY, set: { shift_definition_id: REST } }])
					)).message,
					/captured by payroll/
				);
				assert.match(
					(yield* Effect.flip(
						hr.act('roster_entry.update', [{ target: DAY, set: { payslip_id: PAID } }])
					)).message,
					/Only the payroll run that captured this work day/
				);
				assert.equal(
					(yield* hr.act('roster_entry.update', [
						{ target: DAY, set: { payslip_id: january.slip('a').id } }
					])).kind,
					'committed'
				);

				assert.match(
					(yield* Effect.flip(hr.act('payroll_run.delete', [{ target: DECEMBER }]))).message,
					/paid payslip cannot be deleted/
				);
				yield* hr.act('payroll_run.delete', [{ target: january.id }]);
				assert.equal(
					(yield* hr.act('adhoc_catalog_entry.update', [
						{ target: bonus.id, set: { amount: Decimal.of('150') } }
					])).kind,
					'committed'
				);
			})
	);

	it.effect('a sealed version cannot be deleted; an unsealed draft of it can', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const hr = t.as(t.member(['hr_manager']));
			const created = yield* hr.act('jurisdiction_settings.create', [
				{
					code: 'XX',
					jurisdiction_code: 'XX',
					name: 'Draft to discard',
					payroll: { currency: 'USD' },
					sources: { entries: [] },
					effective_range: datePeriod('2027-01-01', null)
				}
			]);
			const draft =
				created.kind === 'committed'
					? created.records.find((row) => row.model === 'jurisdiction_settings')
					: undefined;
			assert.ok(draft && draft.model === 'jurisdiction_settings');
			assert.equal(
				(yield* hr.act('jurisdiction_settings.delete', [{ target: draft.id }])).kind,
				'committed'
			);
			assert.equal(
				(yield* Effect.flip(hr.act('jurisdiction_settings.delete', [{ target: VERSION }])))._tag,
				'ActRefused'
			);
		})
	);

	it.effect('an open obligation is withdrawn; a settled one stays', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			const obligation = (state: 'OPEN' | 'FULFILLED') => ({
				duty_code: 'REMITTANCE',
				trigger_ref: 'run',
				triggered_on: PlainDate('2026-01-31'),
				due_on: PlainDate('2026-02-14'),
				state,
				company_id: COMPANY,
				settings_id: VERSION
			});
			const raised = yield* admin.act('obligation.create', [
				obligation('OPEN'),
				obligation('FULFILLED')
			]);
			const [open, settled] =
				raised.kind === 'committed'
					? raised.records.flatMap((row) => (row.model === 'obligation' ? [row.id] : []))
					: [];
			assert.ok(open && settled);
			assert.match(
				(yield* Effect.flip(
					admin.act('obligation.delete', [{ target: open }, { target: settled }])
				)).message,
				/Only an open obligation is withdrawn/
			);
			assert.equal((yield* admin.act('obligation.delete', [{ target: open }])).kind, 'committed');
		})
	);
});
