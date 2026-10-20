import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect, Schema } from 'effect';
import { fieldValue, moneyNumber } from '../src/lib/payroll_engine/foundation.js';
import { fixtureId, nativeId } from './fixture_values.js';
import { lineage, world, type Tables } from './jurisdiction_kit.js';

const LAW = lineage('SG');
const COMPANY = nativeId('entity', fixtureId('roster-pin-company'));
const PERSON = nativeId('employment_profile', fixtureId('roster-pin-person'));
const OTHER_PERSON = nativeId('employment_profile', fixtureId('roster-pin-other-person'));
const EMPLOYMENT = nativeId('employment_contract', fixtureId('roster-pin-employment'));
const OTHER_EMPLOYMENT = nativeId('employment_contract', fixtureId('roster-pin-other-employment'));
const WORK = nativeId('shift_definition', fixtureId('roster-pin-work'));
const REST = nativeId('shift_definition', fixtureId('roster-pin-rest'));
const PATTERN = nativeId('shift_pattern', fixtureId('roster-pin-pattern'));
const JANUARY_DAY = nativeId('roster_entry', fixtureId('roster-pin-january'));
const FEBRUARY_DAY = nativeId('roster_entry', fixtureId('roster-pin-february'));
const Pins = Schema.Array(Schema.Struct({ collection: Schema.String, id: Schema.String }));

function tables(): Tables {
	const rows = LAW.law();
	rows.set('entity', [
		{
			id: COMPANY,
			name: 'Roster pin employer',
			settings_code: 'SG',
			time_zone: 'Asia/Singapore',
			pay_frequency: 'MONTHLY',
			pay_cutoff_day: 1,
			effective_range: { from: '2020-01-01', to: null },
			facts: {}
		}
	]);
	const people = [
		{ person: PERSON, employment: EMPLOYMENT, number: 'PIN-1' },
		{ person: OTHER_PERSON, employment: OTHER_EMPLOYMENT, number: 'PIN-2' }
	];
	rows.set(
		'employment_profile',
		people.map(({ person, number }) => ({
			id: person,
			name: `Roster pin employee ${number}`,
			email: `${number}@example.com`,
			date_of_birth: '1990-01-01',
			nationality: 'SG',
			race: 'CHINESE',
			religion: 'OTHER',
			facts: {}
		}))
	);
	rows.set(
		'employment_contract',
		people.map(({ person, employment, number }) => ({
			id: employment,
			employee_id: person,
			company_id: COMPANY,
			employee_number: number,
			contract_number: 1,
			effective_range: { from: '2020-01-01', to: null },
			facts: {
				contract_terms: [
					{
						effective_range: { from: '2020-01-01', to: null },
						base_salary: { value: 4000, currency: 'SGD' },
						residency_status: 'CITIZEN',
						work_classification: 'EA_COVERED',
						statutory_work_category: 'NON_MANUAL',
						employment_type: 'PERMANENT',
						shift_pattern_id: PATTERN,
						allowances: []
					}
				]
			}
		}))
	);
	rows.set('shift_definition', [
		{
			id: WORK,
			company_id: COMPANY,
			code: 'DAY',
			variant: { day_type: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 }
		},
		{ id: REST, company_id: COMPANY, code: 'REST', variant: { day_type: 'REST' } }
	]);
	rows.set('shift_pattern', [
		{
			id: PATTERN,
			company_id: COMPANY,
			code: 'WEEK',
			effective_range: { from: '2020-01-06', to: null },
			pattern: {
				days: [
					...Array.from({ length: 5 }, () => ({ roster_code_id: WORK })),
					{ roster_code_id: REST },
					{ roster_code_id: REST }
				]
			}
		}
	]);
	rows.set('roster_entry', [
		{
			id: JANUARY_DAY,
			employment_id: EMPLOYMENT,
			work_date: '2026-01-15',
			shift_definition_id: WORK,
			worked_intervals: [{ start: '2026-01-15T01:00:00.000Z', end: '2026-01-15T10:00:00.000Z' }]
		},
		{
			id: FEBRUARY_DAY,
			employment_id: EMPLOYMENT,
			work_date: '2026-02-02',
			shift_definition_id: WORK,
			worked_intervals: [{ start: '2026-02-02T01:00:00.000Z', end: '2026-02-02T12:00:00.000Z' }]
		}
	]);
	return rows;
}

it.effect(
	'ordinary zero-OT days are captured, and HR cannot attach them to off-cycle, wrong-period or wrong-employee payslips',
	Effect.fnUntraced(function* () {
		yield* world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				const roster = () =>
					actor
						.read('roster_entry', {
							select: {
								revision: true,
								employment_id: true,
								work_date: true,
								shift_definition_id: true,
								worked_intervals: true,
								payslip_id: true
							},
							all: true
						})
						.pipe(Effect.map((page) => page.rows.toSorted((a, b) => a.id.localeCompare(b.id))));
				yield* actor.act('adhoc_catalog_entry.create', {
					catalog_id: nativeId(
						'adhoc_catalog',
						LAW.byCode(LAW.versionOn('2026-01-10'), 'adhoc_catalog', 'bonus').id
					),
					employment_id: EMPLOYMENT,
					occurred_on: PlainDate('2026-01-10'),
					amount: Decimal.of('100')
				});
				const [bonus] = (yield* actor.read('adhoc_catalog_entry', { all: true })).rows;
				assert.ok(bonus);
				yield* actor.act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-01',
					kind: 'OFF_CYCLE',
					sources: [bonus.id]
				});
				const [offCycle] = (yield* actor.read('payroll_run', {
					where: { period: { eq: '2026-01' }, kind: { eq: 'OFF_CYCLE' } },
					select: { pins: true },
					all: true
				})).rows;
				assert.ok(offCycle);
				const offCyclePins = Schema.decodeUnknownSync(Pins)(
					yield* Effect.fromResult(fieldValue(offCycle.pins, 'payroll_run.pins'))
				);
				assert.ok(
					offCyclePins.some(
						(pin) => pin.collection === 'adhoc_catalog_entry' && pin.id === bonus.id
					)
				);
				assert.equal(
					offCyclePins.some((pin) => pin.collection === 'roster_entry'),
					false
				);
				const [offCycleSlip] = (yield* actor.read('payslip', {
					where: { payroll_run_id: { eq: offCycle.id }, employment_id: { eq: EMPLOYMENT } },
					all: true
				})).rows;
				assert.ok(offCycleSlip);
				yield* actor.act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-01',
					kind: 'REGULAR'
				});
				const [january] = (yield* actor.read('payroll_run', {
					where: { period: { eq: '2026-01' }, kind: { eq: 'REGULAR' } },
					select: { pins: true },
					all: true
				})).rows;
				assert.ok(january);
				const januaryPins = Schema.decodeUnknownSync(Pins)(
					yield* Effect.fromResult(fieldValue(january.pins, 'payroll_run.pins'))
				);
				assert.ok(
					januaryPins.some((pin) => pin.collection === 'roster_entry' && pin.id === JANUARY_DAY)
				);
				const [januarySlip] = (yield* actor.read('payslip', {
					where: { payroll_run_id: { eq: january.id }, employment_id: { eq: EMPLOYMENT } },
					all: true
				})).rows;
				assert.ok(januarySlip);
				assert.equal(moneyNumber(januarySlip.gross), 4000);
				const original = yield* roster();
				assert.equal(original.find((row) => row.id === JANUARY_DAY)?.payslip_id, null);
				const changedOrdinaryDay = yield* Effect.flip(
					actor.act('roster_entry.update', {
						target: JANUARY_DAY,
						set: { shift_definition_id: REST }
					})
				);
				assert.ok(changedOrdinaryDay._tag === 'ActRefused');
				assert.equal(changedOrdinaryDay.code, 'refused');
				assert.match(changedOrdinaryDay.message, /captured by payroll/);
				assert.deepEqual(yield* roster(), original);
				// Same employee and month are insufficient: the off-cycle run did not capture attendance.
				for (const input of [
					{ target: JANUARY_DAY, set: { payslip_id: offCycleSlip.id } },
					{ target: FEBRUARY_DAY, set: { payslip_id: januarySlip.id } }
				]) {
					const refused = yield* Effect.flip(actor.act('roster_entry.update', input));
					assert.ok(refused._tag === 'ActRefused');
					assert.equal(refused.code, 'refused');
					assert.match(refused.message, /Only the payroll run that captured this work day/);
					assert.deepEqual(yield* roster(), original);
				}
				yield* actor.act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-02',
					kind: 'REGULAR'
				});
				const [february] = (yield* actor.read('payroll_run', {
					where: { period: { eq: '2026-02' } },
					select: { pins: true },
					all: true
				})).rows;
				assert.ok(february);
				const februaryPins = Schema.decodeUnknownSync(Pins)(
					yield* Effect.fromResult(fieldValue(february.pins, 'payroll_run.pins'))
				);
				assert.ok(
					februaryPins.some((pin) => pin.collection === 'roster_entry' && pin.id === FEBRUARY_DAY)
				);
				const februarySlips = (yield* actor.read('payslip', {
					where: { payroll_run_id: { eq: february.id } },
					select: { employment_id: true },
					all: true
				})).rows;
				const correct = februarySlips.find((slip) => slip.employment_id === EMPLOYMENT);
				const wrongEmployee = februarySlips.find((slip) => slip.employment_id === OTHER_EMPLOYMENT);
				assert.ok(correct && wrongEmployee);
				const pending = yield* roster();
				assert.equal(pending.find((row) => row.id === FEBRUARY_DAY)?.payslip_id, null);
				const wrong = yield* Effect.flip(
					actor.act('roster_entry.update', {
						target: FEBRUARY_DAY,
						set: { payslip_id: wrongEmployee.id }
					})
				);
				assert.ok(wrong._tag === 'ActRefused');
				assert.equal(wrong.code, 'refused');
				assert.match(wrong.message, /Only the payroll run that captured this work day/);
				assert.deepEqual(yield* roster(), pending);
				const mixed = yield* Effect.flip(
					actor.act('roster_entry.update', [
						{ target: FEBRUARY_DAY, set: { payslip_id: correct.id } },
						{ target: JANUARY_DAY, set: { payslip_id: offCycleSlip.id } }
					])
				);
				assert.ok(mixed._tag === 'ActRefused');
				assert.equal(mixed.code, 'refused');
				assert.match(mixed.message, /Only the payroll run that captured this work day/);
				assert.deepEqual(yield* roster(), pending);
				assert.equal(
					(yield* actor.act('roster_entry.update', {
						target: JANUARY_DAY,
						set: { payslip_id: januarySlip.id }
					})).kind,
					'committed'
				);
				const attached = yield* actor.act('roster_entry.update', {
					target: FEBRUARY_DAY,
					set: { payslip_id: correct.id }
				});
				assert.equal(attached.kind, 'committed');
				const final = yield* roster();
				assert.equal(final.find((row) => row.id === JANUARY_DAY)?.payslip_id, januarySlip.id);
				assert.equal(final.find((row) => row.id === FEBRUARY_DAY)?.payslip_id, correct.id);
				assert.equal(
					final.find((row) => row.id === FEBRUARY_DAY)?.work_date,
					PlainDate('2026-02-02')
				);
			})
		);
	}),
	15_000
);

it.effect(
	'payroll freezes approved overtime windows while unconsumed windows remain editable and mixed edits are atomic',
	Effect.fnUntraced(function* () {
		const rows = tables();
		const january = rows.get('roster_entry')?.find((row) => row.id === JANUARY_DAY);
		assert.ok(january);
		const windows = [
			{ start: Instant('2026-01-15T00:00:00Z'), end: Instant('2026-01-15T01:00:00Z') },
			{ start: Instant('2026-01-15T10:00:00Z'), end: Instant('2026-01-15T11:00:00Z') }
		];
		january.planned_overtime_hours = 2;
		january.approved_overtime_intervals = windows;
		yield* world(rows).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.member(['hr_manager']));
				const snapshot = () =>
					actor
						.read('roster_entry', {
							select: {
								work_date: true,
								approved_overtime_intervals: true,
								revision: true,
								payslip_id: true
							},
							orderBy: { work_date: 'asc' },
							all: true
						})
						.pipe(Effect.map((page) => page.rows.toSorted((a, b) => a.id.localeCompare(b.id))));
				yield* actor.act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-01',
					kind: 'REGULAR'
				});
				yield* t.runDue();
				assert.ok((yield* snapshot()).find((row) => row.id === JANUARY_DAY)?.payslip_id);
				assert.equal(
					(yield* actor.act('roster_entry.update', {
						target: JANUARY_DAY,
						set: {
							approved_overtime_intervals: [
								{
									start: Instant('2026-01-15T08:00:00+08:00'),
									end: Instant('2026-01-15T09:00:00+08:00')
								},
								{
									start: Instant('2026-01-15T18:00:00+08:00'),
									end: Instant('2026-01-15T19:00:00+08:00')
								}
							]
						}
					})).kind,
					'committed'
				);
				assert.equal(
					(yield* actor.act('roster_entry.update', {
						target: JANUARY_DAY,
						set: {
							approved_overtime_intervals: windows.map((row) => ({ ...row, break_minutes: 0 }))
						}
					})).kind,
					'committed'
				);
				const captured = yield* snapshot();
				for (const changed of [
					null,
					[],
					windows.slice(0, 1),
					windows.toReversed(),
					windows.map((row) => ({ ...row, break_minutes: 15 })),
					[windows[0]!, { start: windows[1]!.start, end: Instant('2026-01-15T11:30:00Z') }],
					[
						...windows,
						{ start: Instant('2026-01-15T12:00:00Z'), end: Instant('2026-01-15T12:30:00Z') }
					]
				]) {
					const refused = yield* Effect.flip(
						actor.act('roster_entry.update', {
							target: JANUARY_DAY,
							set: { approved_overtime_intervals: changed }
						})
					);
					assert.match(refused.message, /settled|captured|payroll/i);
					assert.deepEqual(yield* snapshot(), captured);
				}
				const futureWindows = [
					{ start: Instant('2026-02-02T10:00:00Z'), end: Instant('2026-02-02T11:00:00Z') }
				];
				const mixed = yield* Effect.flip(
					actor.act('roster_entry.update', [
						{ target: FEBRUARY_DAY, set: { approved_overtime_intervals: futureWindows } },
						{ target: JANUARY_DAY, set: { approved_overtime_intervals: null } }
					])
				);
				assert.match(mixed.message, /settled|captured|payroll/i);
				assert.deepEqual(yield* snapshot(), captured);
				const invalidBreak = yield* Effect.flip(
					actor.act('roster_entry.update', {
						target: FEBRUARY_DAY,
						set: {
							approved_overtime_intervals: futureWindows.map((row) => ({
								...row,
								break_minutes: 60
							}))
						}
					})
				);
				assert.match(invalidBreak.message, /break minutes.*shorter/i);
				assert.deepEqual(yield* snapshot(), captured);
				const overlap = yield* Effect.flip(
					actor.act('roster_entry.update', {
						target: FEBRUARY_DAY,
						set: {
							approved_overtime_intervals: [
								...futureWindows,
								{ start: Instant('2026-02-02T10:30:00Z'), end: Instant('2026-02-02T11:30:00Z') }
							]
						}
					})
				);
				assert.match(overlap.message, /time order|overlap/i);
				assert.deepEqual(yield* snapshot(), captured);
				assert.equal(
					(yield* actor.act('roster_entry.update', {
						target: FEBRUARY_DAY,
						set: { approved_overtime_intervals: futureWindows }
					})).kind,
					'committed'
				);
				const edited = yield* snapshot();
				assert.deepEqual(
					edited.find((row) => row.id === JANUARY_DAY),
					captured.find((row) => row.id === JANUARY_DAY)
				);
				assert.deepEqual(
					edited.find((row) => row.id === FEBRUARY_DAY)?.approved_overtime_intervals,
					futureWindows
				);
			})
		);
	}),
	15_000
);
