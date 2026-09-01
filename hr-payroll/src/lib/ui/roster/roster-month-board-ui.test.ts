// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schedulingSource = readFileSync(
	new URL('../../../apps/hr_controller/+scheduling.svelte', import.meta.url),
	'utf8'
);

test('the month board has one month-precision picker and no custom month pagination', () => {
	assert.match(schedulingSource, /<Input\s+[\s\S]*?type="month"/);
	assert.doesNotMatch(schedulingSource, /function stepMonth/);
	assert.doesNotMatch(schedulingSource, /app\.scheduling\.(previous_month|next_month)/);
});

test('exceptions stay on the board and the retired query and tab are absent', () => {
	assert.match(schedulingSource, /openClockOutEmploymentIds\(facts\.values\(\)\)/);
	assert.match(schedulingSource, /lucide:eye/);
	assert.doesNotMatch(schedulingSource, /attendanceSummaryQuery/);
	assert.doesNotMatch(schedulingSource, /name: 'exceptions'/);
});

test('normal board reads are bounded, declarative, and shared across the whole month', () => {
	assert.match(schedulingSource, /MONTH_BOARD_QUERY_LIMITS/);
	assert.match(schedulingSource, /monthBoardQueryReceipt\(/);
	assert.match(schedulingSource, /data-month-board-query-count=/);
	assert.match(schedulingSource, /data-month-board-row-bound=/);
	assert.match(schedulingSource, /data-month-board-query-ceiling=/);
	assert.match(schedulingSource, /data-month-board-row-ceiling=/);
	assert.match(schedulingSource, /data-month-board-eye-filter-queries=/);
	assert.match(
		schedulingSource,
		/work_date: \{ gte: monthStart, lte: monthEnd \},\s*employment_id: \{ in: monthEmploymentIds \}/
	);
	assert.match(
		schedulingSource,
		/client\.db\.employment_terms\.findMany\(\{[\s\S]*?employment_id: \{ in: monthEmploymentIds \}/
	);
	assert.equal(schedulingSource.match(/client\.db\.work_days\.findMany/g)?.length, 2);
	assert.doesNotMatch(schedulingSource, /client\.db\.payroll_runs\.findFirst/);
	assert.doesNotMatch(schedulingSource, /work_day_employment:/);
});

test('the eye filter is a local projection over loaded facts and cannot create a query', () => {
	const eyeStart = schedulingSource.indexOf('const unresolvedClockOutEmploymentIds = $derived.by');
	const peopleStart = schedulingSource.indexOf('const boardPeople = $derived', eyeStart);
	const eyeSlice = schedulingSource.slice(eyeStart, peopleStart);

	assert.notEqual(eyeStart, -1);
	assert.notEqual(peopleStart, -1);
	assert.match(eyeSlice, /openClockOutEmploymentIds\(facts\.values\(\)\)/);
	assert.doesNotMatch(eyeSlice, /client\.db\./);
});
