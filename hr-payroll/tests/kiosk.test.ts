// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The kiosk's server half: `work_days.kiosk_punch` and `employees.kiosk_match`, one light case per guarantee. Ported
 * from kiosk-punch-day and kiosk-match (the `src/functions/+kiosk_*` handlers).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import workDays from '../src/data/collection/work_days/+collection.ts';
import employees from '../src/data/collection/employees/+collection.ts';
import { VERSION, actionCtx, workDayTables } from './helpers/work-day-db.ts';

/** The workspace clock at `now`, with `todayIn` read on the real zone (the kiosk's day is the entity's). */
const at = (tables, now) => ({
	...actionCtx(tables, { now }),
	todayIn: (zone) =>
		new Intl.DateTimeFormat('en-CA', {
			timeZone: zone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(new Date(now))
});
const CODES = [
	{
		id: 'c-day',
		code: 'D',
		variant: { kind: 'WORK', start_time: '09:00', end_time: '17:00', break_minutes: 60 }
	},
	{ id: 'c-rest', code: 'REST', variant: { kind: 'REST' } }
];
const person = (over = {}) => ({
	id: 'person-emp-1',
	name: 'Aina',
	face_enrollment_status: 'APPROVED',
	face_match_count: 0,
	face_last_match_at: null,
	...over
});
const punch = (tables, kind = 'FACE', now = '2026-03-10T02:00:00.000Z') => {
	const ctx = at(tables, now);
	return workDays.bodies.actions
		.kiosk_punch({ employment_id: 'emp-1', kind }, ctx)
		.then((output) => ({ output, acts: ctx.acts }));
};

test('a punch at 23:30 in a UTC+7 entity lands on that local day, not the next one', async () => {
	const tables = workDayTables({
		people: [person()],
		versions: [{ ...VERSION, payroll: { timezone: 'Asia/Bangkok' } }]
	});
	// 16:30 UTC is 23:30 in Bangkok on the 10th, and already 00:30 on the 11th in Kuala Lumpur.
	const { output, acts } = await punch(tables, 'MANUAL', '2026-03-10T16:30:00.000Z');
	assert.equal(output.status, 'in');
	assert.deepEqual(acts[0], {
		callable: 'work_days.create',
		input: {
			employment_id: 'emp-1',
			work_date: '2026-03-10',
			worked_intervals: [{ start: '2026-03-10T16:30:00.000Z', end: null }]
		}
	});
});

test('a face punch needs a planned WORK day: not rostered and a rest day are blocked outcomes, not failures', async () => {
	assert.deepEqual((await punch(workDayTables({ people: [person()] }))).output, {
		status: 'blocked',
		kind: 'FACE',
		reason: 'not-scheduled'
	});
	const rest = workDayTables({
		people: [person()],
		codes: CODES,
		days: [
			{
				id: 'd',
				employment_id: 'emp-1',
				work_date: '2026-03-10',
				shift_definition_id: 'c-rest',
				worked_intervals: null
			}
		]
	});
	assert.deepEqual((await punch(rest)).output, {
		status: 'blocked',
		kind: 'FACE',
		reason: 'not-a-work-day',
		plannedCode: 'REST'
	});
	// the pattern projects the day's code when the row names none; nothing is stamped onto the row
	const patterned = workDayTables({
		people: [person()],
		codes: CODES,
		patterns: [
			{
				id: 'p',
				code: 'W',
				pattern: { days: Array.from({ length: 7 }, () => ({ roster_code_id: 'c-day' })) },
				effective_range: { from: '2026-01-05', to: null }
			}
		],
		terms: [
			{
				employment_id: 'emp-1',
				shift_pattern_id: 'p',
				effective_range: { from: '2020-01-01', to: null },
				approval_id: null
			}
		]
	});
	const { output, acts } = await punch(patterned);
	assert.equal(output.status, 'in');
	assert.equal(acts[0].input.shift_definition_id, undefined);
	assert.deepEqual(acts[1], {
		callable: 'employees.update',
		input: {
			target: 'person-emp-1',
			set: { face_last_match_at: '2026-03-10T02:00:00.000Z', face_match_count: 1 }
		}
	});
});

test('a face punch needs an approved enrolment; a later punch moves the departure; the cooldown debounces', async () => {
	await assert.rejects(
		punch(workDayTables({ people: [person({ face_enrollment_status: 'PENDING' })] })),
		/approved enrollment/
	);
	const open = [{ start: '2026-03-10T01:00:00.000Z', end: null }];
	const day = (over) =>
		workDayTables({
			people: [person(over)],
			codes: CODES,
			days: [
				{
					id: 'd',
					employment_id: 'emp-1',
					work_date: '2026-03-10',
					shift_definition_id: 'c-day',
					worked_intervals: open
				}
			]
		});
	const out = await punch(day({}));
	assert.equal(out.output.status, 'out');
	assert.deepEqual(out.acts[0], {
		callable: 'work_days.update',
		input: {
			target: 'd',
			set: {
				worked_intervals: [{ start: '2026-03-10T01:00:00.000Z', end: '2026-03-10T02:00:00.000Z' }]
			}
		}
	});
	const soon = await punch(day({ face_last_match_at: '2026-03-10T01:59:55.000Z' }));
	assert.equal(soon.output.status, 'blocked');
	assert.equal(soon.output.reason, 'cooldown');
	assert.equal(soon.acts.length, 0);
});

// ── kiosk_match ──
const probe = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
const contract = (id, company_id = 'co-1', to = null) => ({
	id,
	employee_id: 'person',
	company_id,
	employee_number: id,
	approval_id: null,
	effective_range: { from: '2000-01-01', to }
});
const match = (distances, contracts = [], company_id = 'co-1') => {
	const tables = { ...workDayTables(), employments: contracts };
	const ctx = {
		...at(tables, '2026-03-10T02:00:00.000Z'),
		similar: async (collection, search, input, q) => {
			assert.deepEqual([collection, search, q.limit], ['employees', 'face', 2]);
			return distances.map((distance, i) => ({
				id: i === 0 ? 'person' : `other-${i}`,
				name: 'Fixture',
				$distance: distance
			}));
		}
	};
	return employees.bodies.queries.kiosk_match({ company_id, probe }, ctx);
};

test('the matcher rejects weak and ambiguous neighbours', async () => {
	for (const [distances, expected] of [
		[[], 'unknown'],
		[[0.3], 'unknown'],
		[[NaN], 'unknown'],
		[[0.1, 0.11], 'unknown'],
		[[0.24, 0.26], 'unknown'],
		[[0.1, 0.2], 'unenrolled'],
		[[0.1], 'unenrolled']
	])
		assert.equal((await match(distances)).status, expected, JSON.stringify(distances));
	await assert.rejects(
		match([0.1], [], 'co-1').then(() =>
			employees.bodies.queries.kiosk_match({ company_id: 'co-1', probe: probe.map(() => 0) }, {})
		),
		/face descriptor/
	);
});

test('only the selected entity’s one active contract matches', async () => {
	const both = [contract('other', 'co-2'), contract('selected')];
	assert.equal((await match([0.1], both)).employment.id, 'selected');
	assert.equal(
		(await match([0.1], [contract('other', 'co-2'), contract('departed', 'co-1', '2001-01-01')]))
			.status,
		'unenrolled'
	);
	await assert.rejects(match([0.1], [contract('first'), contract('second')]), /overlapping active/);
});
