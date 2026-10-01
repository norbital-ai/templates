/**
 * Act 265 s.23: imprisonment/custody and court absence (including travel) earn no wages,
 * except attendance as the employer's witness. First Schedule para.2(5) does not exclude s.23.
 * Primary text: https://lom.agc.gov.my/ilims/upload/portal/akta/outputaktap/1744567_BI/Reprint%20Act%20265%20(Final).pdf
 * Monthly wage RM3,100, January's 31 days: one unpaid day under s.18A(c) = RM100;
 * ordinary contractual wages for an employer witness remain RM3,100.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildStatutory,
	leaveCatalogue,
	settingsVersions,
	settingsIdOn,
	type Person
} from './fixtures/statutory-world.ts';

const CODE = 'COURT_CUSTODY_ABSENCE';
const grounds = [
	'IMPRISONMENT',
	'CUSTODY',
	'CUSTODY_TRAVEL',
	'COURT_ATTENDANCE_OR_TRAVEL',
	'EMPLOYER_WITNESS'
];

test('MY s.23 — every settings version classifies court and custody absence without encashment', () => {
	for (const version of settingsVersions('MY')) {
		const rows = leaveCatalogue('MY').filter(
			(row) => row.settings_id === version.id && row.code === CODE
		);
		assert.equal(rows.length, 1);
		const row = rows[0]!;
		assert.equal(row.can_encash, false);
		assert.equal(row.encash_on_exit, false);
		assert.equal(row.eligibility, '');
		assert.deepEqual(row.event_facts?.[0]?.options, grounds);
		assert.equal(row.event_facts?.[0]?.required, true);
	}
});

test('MY s.23 — classified court and custody absence deducts RM100; employer witness preserves RM3100', () => {
	for (const ground of grounds) {
		const { slips } = buildStatutory(
			{
				code: 'MY',
				period: '2026-01',
				people: [
					{
						key: ground,
						wage: 3100,
						citizenship: 'CITIZEN',
						registrations: { EPF_NON_CITIZEN: { kind: 'NOT_REGISTERED' } }
					}
				]
			},
			(world) => {
				const row = leaveCatalogue('MY').find(
					(item) => item.settings_id === settingsIdOn('MY', '2026-01-05') && item.code === CODE
				)!;
				world.leave_catalogue.push(row as never);
				world.leave_entries.push({
					id: 'e2300000-0000-4000-8000-000000000001',
					employment_id: world.employments[0]!.id,
					catalogue_id: row.id,
					leave_code: CODE,
					reference: ground,
					from_date: '2026-01-05',
					to_date: '2026-01-05',
					effective_on: '2026-01-05',
					half_day_start: false,
					half_day_end: false,
					days: 1,
					facts: { absence_ground: ground },
					allocations: [],
					charges: [
						{
							date: '2026-01-05',
							days: 1,
							catalogue_id: row.id,
							employment_term_id: world.employment_terms[0]!.id,
							holiday_id: null,
							shift_definition_id: null,
							work_day_id: null
						}
					],
					approval_id: null,
					payslip_id: null
				} as never);
			}
		);
		assert.equal(slips.get(ground)!.gross, ground === 'EMPLOYER_WITNESS' ? 3100 : 3000, ground);
	}
});

test('MY s.23 — a half-day court absence deducts RM50; a half-day employer witness keeps RM3100', () => {
	for (const ground of ['COURT_ATTENDANCE_OR_TRAVEL', 'EMPLOYER_WITNESS']) {
		const { slips } = buildStatutory(
			{ code: 'MY', period: '2026-01', people: [person(ground, 3100)] },
			(world) => {
				plantAbsence(world, ground, 0.5);
			}
		);
		assert.equal(slips.get(ground)!.gross, ground === 'EMPLOYER_WITNESS' ? 3100 : 3050);
	}
});

// January 2026 has 22 Monday–Friday roster days. Daily RM100 earns RM2200 before
// absence; hourly RM20 for eight roster hours earns RM3520. s.23 removes the actual
// reserved work unit (RM100/day or RM160/day), without the monthly s.18A denominator.
test('MY s.23 — daily and hourly court absence removes earned units; employer witness preserves them', () => {
	for (const [frequency, wage, whole, day] of [
		['DAILY', 100, 2200, 100],
		['HOURLY', 20, 3520, 160]
	] as const) {
		for (const ground of ['COURT_ATTENDANCE_OR_TRAVEL', 'EMPLOYER_WITNESS']) {
			const { slips } = buildStatutory(
				{ code: 'MY', period: '2026-01', people: [person(ground, wage, frequency)] },
				(world) => plantAbsence(world, ground, 1)
			);
			assert.equal(
				slips.get(ground)!.gross,
				ground === 'EMPLOYER_WITNESS' ? whole : whole - day,
				`${frequency} ${ground}`
			);
		}
	}
});

const person = (
	key: string,
	wage: number,
	pay_frequency: Person['pay_frequency'] = 'MONTHLY'
): Person => ({
	key,
	wage,
	pay_frequency,
	citizenship: 'CITIZEN',
	registrations: { EPF_NON_CITIZEN: { kind: 'NOT_REGISTERED' } }
});

function plantAbsence(
	world: Parameters<NonNullable<Parameters<typeof buildStatutory>[1]>>[0],
	ground: string,
	days: number
) {
	const row = leaveCatalogue('MY').find(
		(item) => item.settings_id === settingsIdOn('MY', '2026-01-05') && item.code === CODE
	)!;
	world.leave_catalogue.push(row as never);
	world.leave_entries.push({
		id: 'e2300000-0000-4000-8000-000000000002',
		employment_id: world.employments[0]!.id,
		catalogue_id: row.id,
		leave_code: CODE,
		reference: ground,
		from_date: '2026-01-05',
		to_date: '2026-01-05',
		effective_on: '2026-01-05',
		half_day_start: days === 0.5,
		half_day_end: false,
		days,
		facts: { absence_ground: ground },
		allocations: [],
		charges: [
			{
				date: '2026-01-05',
				days,
				catalogue_id: row.id,
				employment_term_id: world.employment_terms[0]!.id,
				holiday_id: null,
				shift_definition_id: null,
				work_day_id: null
			}
		],
		approval_id: null,
		payslip_id: null
	} as never);
}
