import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import pipeline from '../src/collections/work_days/+pipelines.ts';
import {
	EMPLOYEE_ID,
	EMPLOYMENT_ID,
	createPublicPayrollWorld
} from './fixtures/public-payroll-world.ts';
import { memoryPayrollApi, type PayrollWorld } from './fixtures/memory-payroll-api.ts';

/**
 * The `work_days` import against the contract history: one payload, one legal entity, one month.
 * A person-day resolves to the approved contract covering that day in the named entity, a roster
 * row set names every employed day of the month, and a sealed day may only be restated as it is.
 */
type Half = 'roster' | 'attendance';
const OTHER_COMPANY = 'other-company';
const REHIRE = 'rehire-contract';
const OTHER_CONTRACT = 'other-entity-contract';
const MONTH = '2026-01';
const JANUARY = Array.from(
	{ length: 31 },
	(_, index) => `2026-01-${String(index + 1).padStart(2, '0')}`
);

function importWorld() {
	const world = createPublicPayrollWorld();
	world.work_days = [];
	world.companies.push({
		...world.companies[0],
		id: OTHER_COMPANY,
		name: 'Other Entity',
		registration_number: 'OTHER'
	});
	const original = {
		...world.employments[0],
		employee_id: EMPLOYEE_ID,
		employee_number: 'PERSON',
		effective_range: { start: '2026-01-01', end: '2026-01-15' }
	};
	world.employments = [
		{
			...original,
			id: REHIRE,
			effective_range: { start: '2026-01-16', end: null }
		},
		{
			...original,
			id: OTHER_CONTRACT,
			company_id: OTHER_COMPANY,
			effective_range: { start: '2026-01-01', end: null }
		},
		original
	];
	return world;
}

const rosterRow = (work_date: string, shift_code = '7.5AM') => ({
	employee_number: 'PERSON',
	work_date,
	shift_code
});
const attendanceRow = (work_date: string) => ({
	employee_number: 'PERSON',
	work_date,
	clock_in: '08:00',
	clock_out: '17:00'
});

/** A roster names every day of January; the days under test carry the shift, the rest REST. */
function januaryRoster(dates: readonly string[]) {
	return JANUARY.map((date) => rosterRow(date, dates.includes(date) ? '7.5AM' : 'REST'));
}

function rosterWorld() {
	const world = importWorld();
	world.shift_definitions.push({
		...world.shift_definitions[0],
		id: 'rest-shift',
		code: 'REST',
		variant: { kind: 'REST' }
	});
	return world;
}

function runImport(
	world: PayrollWorld,
	half: Half,
	dates: readonly string[],
	legalEntity: string | null = 'Public Fixture Co'
) {
	const api = memoryPayrollApi(world);
	const input = {
		legal_entity: legalEntity ?? undefined,
		month: MONTH,
		timezone: 'Asia/Singapore',
		...(half === 'roster'
			? { roster: januaryRoster(dates) }
			: { attendance: dates.map(attendanceRow) })
	};
	return Effect.runPromise(pipeline.import.handler({ input } as never, api as never));
}

for (const half of ['roster', 'attendance'] as const) {
	const world = () => (half === 'roster' ? rosterWorld() : importWorld());
	test(`${half} resolves departure-day and next-day rehire to their own contracts regardless of row order`, async () => {
		const current = world();
		current.work_days.push({
			id: 'existing-old-day',
			employment_id: EMPLOYMENT_ID,
			work_date: '2026-01-15',
			shift_definition_id: half === 'attendance' ? current.shift_definitions[0].id : null,
			worked_intervals:
				half === 'roster'
					? [{ start: '2026-01-15T08:00:00+08:00', end: '2026-01-15T17:00:00+08:00' }]
					: null
		});
		const results = await runImport(current, half, ['2026-01-15', '2026-01-16']);
		assert.deepEqual(
			results
				.filter((row) => row.work_date === '2026-01-15' || row.work_date === '2026-01-16')
				.map((row) => [row.employment_id, row.work_date, row.id ?? null]),
			[
				[EMPLOYMENT_ID, '2026-01-15', 'existing-old-day'],
				[REHIRE, '2026-01-16', null]
			]
		);
	});
	test(`${half} refuses a date in the gap between contracts`, async () => {
		const current = world();
		current.employments.find((row) => row.id === REHIRE)!.effective_range = {
			start: '2026-01-17',
			end: null
		};
		await assert.rejects(
			runImport(current, half, ['2026-01-16']),
			/No approved employment contract covers PERSON on 2026-01-16/
		);
	});
	test(`${half} refuses a date before the signed service range starts`, async () => {
		const current = world();
		current.employments.find((row) => row.id === EMPLOYMENT_ID)!.effective_range = {
			start: '2026-01-02',
			end: null
		};
		await assert.rejects(
			runImport(current, half, ['2026-01-01']),
			/No approved employment contract covers PERSON on 2026-01-01/
		);
	});
	test(`${half} refuses overlapping contracts instead of selecting the last row`, async () => {
		const current = world();
		current.employments.push({
			...current.employments.find((row) => row.id === REHIRE)!,
			id: 'overlap'
		});
		await assert.rejects(
			runImport(current, half, ['2026-01-16']),
			/More than one employment contract.*overlapping/
		);
	});
	test(`${half} ignores an unapproved rehire`, async () => {
		const current = world();
		current.employments.push({
			...current.employments.find((row) => row.id === REHIRE)!,
			id: 'pending-rehire',
			approval_id: 'pending'
		});
		const results = await runImport(current, half, ['2026-01-15', '2026-01-16']);
		assert.deepEqual(
			[...new Set(results.map((row) => row.employment_id))],
			[EMPLOYMENT_ID, REHIRE]
		);
	});
}

test('the legal entity is the file’s to state: absent it is refused before a row is read, unknown it is named', async () => {
	await assert.rejects(
		runImport(importWorld(), 'attendance', ['2026-01-16'], null),
		/Expected string/
	);
	await assert.rejects(
		runImport(importWorld(), 'attendance', ['2026-01-16'], 'Nobody Sdn Bhd'),
		/No legal entity named "Nobody Sdn Bhd" is on file[\s\S]*Public Fixture Co/
	);
});

test('a roster names every employed day of the month, or the file is refused listing the gaps', async () => {
	const world = rosterWorld();
	const api = memoryPayrollApi(world);
	const partial = januaryRoster([]).filter((row) => row.work_date < '2026-01-30');
	await assert.rejects(
		Effect.runPromise(
			pipeline.import.handler(
				{ input: { legal_entity: 'Public Fixture Co', month: MONTH, roster: partial } } as never,
				api as never
			)
		),
		/write REST or OFF where they are not working[\s\S]*PERSON: 2026-01-30, 2026-01-31/
	);
	// A day past the contract's end is not a gap: the departure contract ends on the 15th and the
	// rehire starts on the 16th, so the whole month is employed and the whole month lands.
	const results = await runImport(world, 'roster', []);
	assert.equal(results.length, 31);
	assert.deepEqual(
		world.rosters?.map((row) => [row.employment_id, row.period]).toSorted(),
		[
			[EMPLOYMENT_ID, MONTH],
			[REHIRE, MONTH]
		].toSorted(),
		'each contract the sheet names gets its roster of record for the month'
	);
});

test('PH is not a roster code: the holiday is overlaid from the calendar', async () => {
	const world = rosterWorld();
	const roster = januaryRoster([]).map((row) =>
		row.work_date === '2026-01-01' ? { ...row, shift_code: 'PH' } : row
	);
	await assert.rejects(
		Effect.runPromise(
			pipeline.import.handler(
				{ input: { legal_entity: 'Public Fixture Co', month: MONTH, roster } } as never,
				memoryPayrollApi(world) as never
			)
		),
		/PH is not a roster code[\s\S]*PERSON on 2026-01-01/
	);
});

test('a sealed day restated unchanged is skipped; changed or omitted, the whole file is refused', async () => {
	const sealed = (world: PayrollWorld, shift: string | null) =>
		world.work_days.push({
			id: 'sealed-day',
			employment_id: REHIRE,
			work_date: '2026-01-20',
			shift_definition_id: shift,
			worked_intervals: [{ start: '2026-01-20T00:00:00.000Z', end: '2026-01-20T09:00:00.000Z' }],
			payslip_id: 'slip-1'
		});
	// Restated: the file's plan half matches the sealed plan, and the file carries no clock half,
	// so the day is untouched — it is not among the mutations and is not deleted.
	const same = rosterWorld();
	sealed(same, same.shift_definitions[0].id);
	const results = await runImport(same, 'roster', ['2026-01-20']);
	assert.equal(
		results.some((row) => row.work_date === '2026-01-20'),
		false
	);
	assert.ok(same.work_days.some((row) => row.id === 'sealed-day'));

	const changed = rosterWorld();
	sealed(changed, changed.shift_definitions[0].id);
	await assert.rejects(
		runImport(changed, 'roster', []),
		/already taken into account by a payslip[\s\S]*PERSON on 2026-01-20 \(the file changes it\)/
	);

	// The clock half compares by instant: the same punches spelled in another zone are the same.
	const sameClock = importWorld();
	sealed(sameClock, null);
	const restated = await Effect.runPromise(
		pipeline.import.handler(
			{
				input: {
					legal_entity: 'Public Fixture Co',
					month: MONTH,
					timezone: 'Asia/Singapore',
					attendance: [
						{
							employee_number: 'PERSON',
							work_date: '2026-01-20',
							clock_in: '08:00',
							clock_out: '17:00'
						}
					]
				}
			} as never,
			memoryPayrollApi(sameClock) as never
		)
	);
	assert.deepEqual(restated, []);

	const omitted = importWorld();
	sealed(omitted, null);
	await assert.rejects(
		runImport(omitted, 'attendance', ['2026-01-21']),
		/PERSON on 2026-01-20 \(the file leaves it out\)/
	);
});
