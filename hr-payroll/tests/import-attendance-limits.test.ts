// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import workDays from '../src/data/collection/work_days/+collection.ts';
import { actionCtx, workDayTables, VERSION } from './helpers/work-day-db.ts';
const code = {
	id: 'day',
	code: 'DAY',
	effective_range: { from: '2020-01-01', to: null },
	variant: { kind: 'WORK', start_time: '08:30', end_time: '17:00', break_minutes: 60 }
};
const limit = (key, period, measure, max_hours) => ({
	key,
	period,
	measure,
	max_hours,
	unit: 'WORKED_HOURS'
});
const run = async (clock_out, clock_in = '08:30') => {
	const tables = workDayTables({
		employees: ['PERSON'],
		codes: [code],
		versions: [
			{
				...VERSION,
				work_rules: {
					bands: [],
					breaks: [],
					limits: [
						limit('daily_total', 'DAY', 'TOTAL_WORK_HOURS', 12),
						limit('daily_spread', 'DAY', 'SPREAD_HOURS', 14),
						limit('weekly_total', 'WEEK', 'TOTAL_WORK_HOURS', 20)
					]
				}
			}
		],
		days: ['2026-01-05', '2026-01-06'].map((work_date) => ({
			id: work_date,
			employment_id: 'PERSON',
			work_date,
			shift_definition_id: 'day',
			worked_intervals: null
		}))
	});
	const ctx = actionCtx(tables);
	const output = await workDays.bodies.actions.import_month(
		{
			legal_entity: 'Test Sdn Bhd',
			month: '2026-01',
			timezone: 'Asia/Kuala_Lumpur',
			attendance: ['2026-01-05', '2026-01-06'].map((work_date) => ({
				employee_number: 'PERSON',
				work_date,
				clock_in,
				clock_out
			}))
		},
		ctx
	);
	return { output, acts: ctx.acts };
};
test('attendance-only import warns on actual daily, spread and weekly hours and still writes', async () => {
	const { output, acts } = await run('23:30');
	const warnings = output.warnings.join('\n');
	assert.match(warnings, /recorded attendance.*14.00.*daily_total/);
	assert.match(warnings, /recorded attendance.*15.00.*daily_spread/);
	assert.match(warnings, /recorded attendance.*28.00.*weekly_total/);
	assert.equal(output.warnings.filter((w) => w.includes('daily_total')).length, 2);
	assert.equal(acts.find((a) => a.callable === 'work_days.update').input.length, 2);
});
test('early arrival is excluded and an open departure produces no fabricated hours', async () => {
	assert.deepEqual((await run('17:00', '00:00')).output.warnings, []);
	assert.deepEqual((await run(null)).output.warnings, []);
});
