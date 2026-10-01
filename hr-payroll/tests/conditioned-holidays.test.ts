// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A holiday row with `applies_when` (a religion's own day) is a holiday per person: payroll prices it for the worker
 * who meets the condition and not for a colleague of the same company, and the roster board observes it the same way.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, COMPANY_ID, settingsVersions } from './fixtures/statutory-world.ts';
import { observedHolidays } from '../src/lib/scheduling/work-limits.ts';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';

const HOLIDAY = {
	id: 'h-muslim-2026',
	company_id: COMPANY_ID,
	date: '2026-01-16',
	name: 'Muslim holiday (PD 1083 art.170)',
	kind: 'SPECIAL_HOLIDAY',
	replaces: null,
	given_to: null,
	worksite: null,
	applies_when: 'employee.religion == "ISLAM"',
	source: null,
	published_at: '2025-12-01T00:00:00.000Z',
	approval_id: null
};

const punch = (world, key: string, date: string) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const at = (time: string) => `${date}T${time}:00+08:00`;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [
			{ start: at('09:00'), end: at('13:00') },
			{ start: at('14:00'), end: at('18:00') }
		],
		requested_by: null,
		approval_id: null
	});
};

test('a religion-conditioned special day pays the premium to the worker it names and not to a colleague', () => {
	// ₱21,750 a month, an hour 125; eight net hours on Friday 16 January 2026. A special day worked is 130%
	// (DOLE Handbook ch.4 §C), of which the salary pays 100% → 8 × 125 × 0.3 = 300. The other worker works an
	// ordinary day inside normal hours: nothing extra.
	const { slips } = buildStatutory(
		{
			code: 'PH',
			period: '2026-01',
			people: [
				{ key: 'PH-ISLAM', wage: 21_750, religion: 'Islam' },
				{ key: 'PH-OTHER', wage: 21_750, religion: 'Catholic' }
			]
		},
		(world) => {
			world.jurisdiction_holidays.push(HOLIDAY);
			punch(world, 'PH-ISLAM', '2026-01-16');
			punch(world, 'PH-OTHER', '2026-01-16');
		}
	);
	const lines = (key: string) =>
		slips
			.get(key)!
			.adjustments.filter((row) => row.family === 'WORK_DAY')
			.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount]);
	assert.deepEqual(lines('PH-ISLAM'), [['2026-01-16', 'OT-1.3X', 8, 300]]);
	assert.deepEqual(lines('PH-OTHER'), []);
});

test('the roster board observes a religion-conditioned day for the person who meets it; without the person, nobody', () => {
	const codes = [
		{
			id: 'W',
			code: 'W',
			variant: { kind: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 },
			effective_range: { start: '2020-01-01', end: null }
		},
		{
			id: 'R',
			code: 'R',
			variant: { kind: 'REST' },
			effective_range: { start: '2020-01-01', end: null }
		}
	];
	const pattern = {
		kind: 'CYCLE',
		days: ['W', 'W', 'W', 'W', 'W', 'R', 'R'].map((roster_code_id) => ({ roster_code_id }))
	};
	const observed = (religion?: string) => [
		...observedHolidays({
			dates: ['2026-01-16'],
			cutoffDay: 1,
			companyId: COMPANY_ID,
			holidays: [HOLIDAY],
			codes,
			work: settingsVersions('PH').at(-1)!.work_rules,
			plans: [],
			rosterPeriods: [],
			patternOn: () => ({ pattern, anchor: '2026-01-05' }),
			worksiteOn: () => null,
			...(religion == null
				? {}
				: {
						personOn: (date: string) =>
							personContext({
								employee: { religion },
								employment: { service_start: '' },
								asOf: date
							})
					})
		}).keys()
	];
	assert.deepEqual(observed('Islam'), ['2026-01-16']);
	assert.deepEqual(observed('Catholic'), []);
	assert.deepEqual(observed(), []);
});
