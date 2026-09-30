// @ts-nocheck -- Node executes the workspace source directly with type stripping.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { readLeaveContext, leaveRules } from '../src/lib/leave/context.ts';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { settingsInForce } from '../src/lib/jurisdiction_settings.ts';
import { createStatutoryWorld, leaveCatalogue } from './fixtures/statutory-world.ts';
import { memoryDb, runDelete } from './helpers/ctx.ts';
import { id, leaveContext, submission } from './helpers/manual-leave-context.ts';
import workDays from '../src/data/collection/work_days/+collection.ts';
import { VERSION, workDayTables, writeDay } from './helpers/work-day-db.ts';

const annual = JSON.parse(
	readFileSync(new URL('../seed/jurisdiction/SG/leave_catalogue.json', import.meta.url), 'utf8')
).find((row) => row.code === 'ANNUAL_LEAVE');
const sgSettings = JSON.parse(
	readFileSync(
		new URL('../seed/jurisdiction/SG/jurisdiction_settings.json', import.meta.url),
		'utf8'
	)
);

// 2026, the first calendar year the sealed SG lineage covers end to end (its first sealed version
// begins 1 December 2025, so a 2025 service year has eleven months with no catalogue at all).
const YEAR = 2026;
const weekdays = Array.from({ length: 365 }, (_, index) => {
	const day = new Date(Date.UTC(YEAR, 0, index + 1));
	return { date: day.toISOString().slice(0, 10), weekday: day.getUTCDay() };
})
	.filter(({ weekday }) => weekday !== 0 && weekday !== 6)
	.map(({ date }) => date);
assert.equal(weekdays.length, 261);

function forfeitureWorld(absentDays: number) {
	const world = createStatutoryWorld({
		code: 'SG',
		period: `${YEAR}-12`,
		people: [{ key: 'SG-ANNUAL', wage: 3000, hire_date: `${YEAR}-01-01` }]
	});
	world.leave_catalogue.push(...leaveCatalogue('SG').map((row) => ({ ...row, approval_id: null })));
	for (const [index, date] of weekdays.entries())
		world.work_days.push({
			id: id(100 + index),
			employment_id: world.employments[0]!.id,
			work_date: date,
			shift_definition_id: world.shift_definitions[0]!.id,
			worked_intervals:
				index < absentDays
					? []
					: [{ start: `${date}T09:00:00.000Z`, end: `${date}T17:00:00.000Z` }],
			facts:
				index < absentDays
					? {
							absence_permission: 'NO',
							absence_reasonable_excuse: 'NO',
							absence_decision: `Attendance review ${date}`
						}
					: {},
			approval_id: null
		});
	return world;
}

async function savedAnnual(world, asOf = `${YEAR}-12-31`) {
	const employmentId = world.employments[0]!.id;
	const context = await readLeaveContext(memoryDb(world) as never, [employmentId], {
		start: asOf,
		end: asOf
	});
	const version = settingsInForce(context.versions, 'SG', asOf)!;
	const catalogue = context.catalogues.find(
		(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
	)!;
	const rules = leaveRules(context, employmentId, catalogue.id);
	return { context, rules, employmentId };
}

test('SG annual forfeiture uses all 261 rostered working days and a strict >20% threshold', async () => {
	for (const [absentDays, expected] of [
		[52, 7],
		[53, 0]
	] as const) {
		const { context, rules, employmentId } = await savedAnnual(forfeitureWorld(absentDays));
		const year = { start: `${YEAR}-01-01`, end: `${YEAR}-12-31` };
		assert.equal(rules.entitlementAt(year, year.end).earned, expected);
		assert.equal(
			leaveBalanceSummaries(context, employmentId, year.end).find(
				(row) => row.code === 'ANNUAL_LEAVE'
			)?.earned ?? 0,
			expected
		);
	}
});

test('SG work-day write saves both absence decisions with a dated evidence reference', async () => {
	// The SG version declares the absence inputs and the day rules that pair them.
	const sg = sgSettings.find(
		(row) =>
			row.voided_at == null &&
			row.effective_range.start <= '2026-07-01T00:00:00.000Z' &&
			row.effective_range.end > '2026-07-01T00:00:00.000Z'
	);
	const tables = workDayTables({
		versions: [
			{
				...VERSION,
				code: 'SG',
				jurisdiction_code: 'SG',
				work_day_facts: sg.work_day_facts,
				work_rules: { limits: [], breaks: [], day_rules: sg.work_rules.day_rules }
			}
		]
	});
	tables.companies[0]!.settings_code = 'SG';
	// The work-day transform assesses every absence decision against the sealed annual-leave
	// catalogue in force on the day, so the fixture states one.
	tables.leave_catalogue = [
		{
			settings_id: VERSION.id,
			code: 'ANNUAL_LEAVE',
			entitlement: annual.entitlement,
			approval_id: null
		}
	];
	const write = (fields) =>
		writeDay(
			workDays,
			{ employment_id: 'emp-1', work_date: '2026-07-01', worked_intervals: [], ...fields },
			undefined,
			tables
		);
	await assert.rejects(write({ facts: { absence_permission: 'NO' } }), /both Singapore absence/);
	await assert.rejects(
		write({ facts: { absence_permission: 'NO', absence_reasonable_excuse: 'NO' } }),
		/reference for its Singapore absence decision/
	);
	const decided = {
		absence_permission: 'NO',
		absence_reasonable_excuse: 'NO',
		absence_decision: 'Attendance review 2026-07-01'
	};
	await assert.rejects(
		write({ worked_intervals: null, facts: decided }),
		/recorded attendance for its Singapore absence decision/
	);
	const saved = await write({ facts: decided });
	assert.deepEqual(saved.facts, decided);
});

test('SG annual forfeiture requires dated absence evidence and refuses an unsettled part-year', async () => {
	const world = forfeitureWorld(1);
	const { rules } = await savedAnnual(world);
	const year = { start: `${YEAR}-01-01`, end: `${YEAR}-12-31` };
	assert.throws(() => rules.entitlementAt(year, `${YEAR}-06-30`), /partial-year accrual period/);
	delete world.work_days[0]!.facts.absence_decision;
	await assert.rejects(
		async () => (await savedAnnual(world)).rules.entitlementAt(year, year.end),
		/permission, excuse and reference evidence/
	);
});

test('SG final annual balance refuses an unrecorded working day instead of treating it as worked', async () => {
	const world = forfeitureWorld(0);
	world.work_days.find((row) => row.work_date === `${YEAR}-06-02`)!.worked_intervals = null;
	const { context, rules } = await savedAnnual(world);
	assert.equal(
		context.absences?.some((row) => row.work_date === `${YEAR}-06-02`),
		false
	);
	assert.throws(
		() => rules.entitlementAt({ start: `${YEAR}-01-01`, end: `${YEAR}-12-31` }, `${YEAR}-12-31`),
		new RegExp(`dated attendance or leave evidence on ${YEAR}-06-02`)
	);
});

test('SG final annual balance refuses a short worked interval without a partial-day decision', async () => {
	const world = forfeitureWorld(0);
	world.work_days.find((row) => row.work_date === `${YEAR}-06-02`)!.worked_intervals = [
		{ start: `${YEAR}-06-02T09:00:00.000Z`, end: `${YEAR}-06-02T10:00:00.000Z` }
	];
	const { rules } = await savedAnnual(world);
	assert.throws(
		() => rules.entitlementAt({ start: `${YEAR}-01-01`, end: `${YEAR}-12-31` }, `${YEAR}-12-31`),
		new RegExp(`partial-day attendance decision on ${YEAR}-06-02`)
	);
});

test('SG work-day deletion cannot alter an approved annual service year or its carry year', async () => {
	const world = forfeitureWorld(0);
	const stored = world.work_days.find((row) => row.work_date === `${YEAR}-06-02`)!;
	const entry = {
		id: id(500),
		employment_id: stored.employment_id,
		leave_code: 'ANNUAL_LEAVE',
		from_date: `${YEAR}-07-01`,
		to_date: `${YEAR}-07-01`,
		approval_id: null,
		payslip_id: null
	};
	world.leave_entries.push(entry);
	await assert.rejects(
		runDelete(workDays, [stored], { tables: world }),
		/ANNUAL_LEAVE in its leave year or carry year/
	);
	for (const change of [
		{ worked_intervals: [] },
		{ shift_definition_id: world.shift_definitions[1]!.id },
		{ facts: { absence_permission: 'NO' } },
		{ facts: { absence_reasonable_excuse: 'NO' } },
		{ facts: { absence_decision: 'Changed review' } },
		{ facts: { partial_absence: true } }
	])
		await assert.rejects(
			writeDay(workDays, change, stored, world),
			/ANNUAL_LEAVE in its leave year or carry year/
		);
	await writeDay(
		workDays,
		{ worked_intervals: [{ start: `${YEAR}-06-02T09:00:00.000Z`, end: null }] },
		{ ...stored, worked_intervals: null },
		world
	);
	world.work_days.splice(
		world.work_days.findIndex((row) => row.work_date === `${YEAR}-06-03`),
		1
	);
	await assert.rejects(
		writeDay(
			workDays,
			{ employment_id: stored.employment_id, work_date: `${YEAR}-06-03`, worked_intervals: [] },
			undefined,
			world
		),
		/ANNUAL_LEAVE in its leave year or carry year/
	);
	entry.from_date = `${YEAR + 1}-07-01`;
	entry.to_date = `${YEAR + 1}-07-01`;
	await assert.rejects(
		runDelete(workDays, [stored], { tables: world }),
		/ANNUAL_LEAVE in its leave year or carry year/
	);
	entry.from_date = `${YEAR + 2}-07-01`;
	entry.to_date = `${YEAR + 2}-07-01`;
	await runDelete(workDays, [stored], { tables: world });
});

test('SG annual forfeiture refuses partial-day absence instead of counting a whole working day', async () => {
	const world = forfeitureWorld(1);
	world.work_days[0]!.facts.partial_absence = true;
	const { rules } = await savedAnnual(world);
	assert.throws(
		() => rules.entitlementAt({ start: `${YEAR}-01-01`, end: `${YEAR}-12-31` }, `${YEAR}-12-31`),
		/partial-day absence convention/
	);
});

test('SG annual forfeiture refuses a threshold changed by public-holiday denominator choice', async () => {
	const world = forfeitureWorld(52);
	// Two published holidays on rostered working days (Thursday and Friday), which drop the
	// denominator by two and put 52 absences at exactly 20% of it.
	for (const [index, date] of [`${YEAR}-12-24`, `${YEAR}-12-25`].entries())
		world.jurisdiction_holidays.push({
			id: id(350 + index),
			company_id: world.companies[0]!.id,
			date,
			name: `Published holiday ${index + 1}`,
			kind: 'PUBLIC_HOLIDAY',
			replaces: null,
			given_to: 'EVERYONE',
			worksite: null,
			published_at: `${YEAR}-01-01T00:00:00.000Z`,
			approval_id: null
		});
	const { rules } = await savedAnnual(world);
	assert.throws(
		() => rules.entitlementAt({ start: `${YEAR}-01-01`, end: `${YEAR}-12-31` }, `${YEAR}-12-31`),
		/public-holiday denominator/
	);
});

test('SG annual forfeiture does not count an approved full-day leave or rostered rest day', async () => {
	const world = forfeitureWorld(0);
	const employmentId = world.employments[0]!.id;
	const sick = world.leave_catalogue.find((row) => row.code === 'SICK_LEAVE')!;
	world.work_days.find((row) => row.work_date === `${YEAR}-06-02`)!.worked_intervals = [];
	world.work_days.push({
		id: id(402),
		employment_id: employmentId,
		work_date: `${YEAR}-06-07`,
		shift_definition_id: world.shift_definitions[1]!.id,
		worked_intervals: [],
		approval_id: null
	});
	world.leave_entries.push({
		id: id(403),
		employment_id: employmentId,
		catalogue_id: sick.id,
		leave_code: 'SICK_LEAVE',
		reference: 'Approved certificate',
		from_date: `${YEAR}-06-02`,
		to_date: `${YEAR}-06-02`,
		charges: [{ date: `${YEAR}-06-02`, days: 1, catalogue_id: sick.id }],
		allocations: [],
		approval_id: null,
		payslip_id: null
	});
	const { rules } = await savedAnnual(world);
	assert.equal(
		rules.entitlementAt({ start: `${YEAR}-01-01`, end: `${YEAR}-12-31` }, `${YEAR}-12-31`).earned,
		7
	);
});

test('SG three-month take gate opens the day after completion; an exit on completion earns leave', () => {
	const context = leaveContext();
	context.employments[0]!.effective_range = { start: '2026-01-01', end: null };
	context.terms[0]!.effective_range = { start: '2026-01-01', end: null };
	Object.assign(context.companies[0]!, { settings_code: 'SG' });
	Object.assign(context.versions[0]!, { code: 'SG', jurisdiction_code: 'SG' });
	Object.assign(context.catalogues[0]!, {
		code: 'ANNUAL_LEAVE',
		eligibility: annual.eligibility,
		entitlement: annual.entitlement
	});
	const rules = leaveRules(context, id(1), id(7));
	assert.equal(rules.eligibleOn('2026-03-31'), false);
	assert.equal(rules.eligibleOn('2026-04-01'), true);
	assert.throws(
		() =>
			planLeaveActivity(
				context,
				submission({ from_date: '2026-03-31', to_date: '2026-03-31' }),
				id(300)
			),
		/INELIGIBLE/
	);
	assert.equal(
		planLeaveActivity(
			context,
			submission({ from_date: '2026-04-01', to_date: '2026-04-01' }),
			id(301)
		).charges.length,
		1
	);
	context.employments[0]!.effective_range = { start: '2026-01-01', end: '2026-03-31' };
	context.terms[0]!.effective_range = { start: '2026-01-01', end: '2026-03-31' };
	context.annualAttendance = Array.from({ length: 90 }, (_, index) => ({
		employment_id: id(1),
		work_date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
		shift_definition_id: id(8),
		worked_intervals: [
			{
				start: new Date(Date.UTC(2026, 0, index + 1, 9)).toISOString(),
				end: new Date(Date.UTC(2026, 0, index + 1, 18)).toISOString()
			}
		]
	}));
	assert.equal(
		leaveRules(context, id(1), id(7)).entitlementAt(
			{ start: '2026-01-01', end: '2026-12-31' },
			'2026-03-31'
		).earned,
		2
	);
});

test('SG no-pay approval refuses a non-employee-requested origin before saving', () => {
	const context = leaveContext();
	Object.assign(context.companies[0]!, { settings_code: 'SG' });
	Object.assign(context.versions[0]!, { code: 'SG', jurisdiction_code: 'SG' });
	Object.assign(context.catalogues[0]!, {
		is_npl: true,
		requires_no_pay_origin: true,
		code: 'UNPAID_LEAVE'
	});
	assert.throws(
		() =>
			planLeaveActivity(
				context,
				submission({
					from_date: '2026-06-01',
					to_date: '2026-06-01',
					no_pay_origin: 'OTHER'
				}),
				id(310)
			),
		/lawful pay and service basis assessed/
	);
	assert.equal(context.entries.length, 0);
});
