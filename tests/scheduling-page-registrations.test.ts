import assert from 'node:assert/strict';
import test from 'node:test';
import { registrations, snippet, source } from './helpers/page-source.ts';

const page = source('apps/hr_controller/events/+work.svelte');

test('the Work board reads schedule patterns through terms and jurisdiction calendars through settings', () => {
	const script = page.slice(0, page.indexOf('</script>'));
	const reads = registrations(script);
	assert.equal(reads.filter((name) => name === 'db.employment_terms.findMany').length, 1);
	assert.ok(
		!reads.includes('db.shift_patterns.findMany'),
		'patterns ride the effective terms query'
	);
	assert.match(
		script,
		/with: \{ term_shift_pattern: \{ columns: \{ id: true, code: true, pattern: true \} \} \}/
	);
	assert.equal(reads.filter((name) => name === 'db.jurisdiction_settings.findMany').length, 1);
	assert.equal(
		reads.filter((name) => name === 'db.jurisdiction_holiday_calendars.findMany').length,
		1
	);
	assert.ok(!reads.includes('db.company_holidays.findMany'));
	assert.match(script, /holidayCalendarView\(/);
	const calendarView = source('lib/ui/holiday-calendar.ts');
	assert.match(calendarView, /resolveHolidayCalendars\(/);
	assert.deepEqual(
		registrations(calendarView),
		[],
		'the shared calendar view owns no live queries'
	);
});

test('the Shift patterns tab registers one table', () => {
	const tab = snippet(page, 'patterns');
	assert.deepEqual(registrations(tab), ['CollectionTable']);
	assert.match(tab, /collection="shift_patterns"/);
});

test('the Work holiday view reads annual jurisdiction calendars instead of employee events', () => {
	const tab = snippet(page, 'holidays');
	assert.deepEqual(registrations(tab), ['CollectionTable']);
	assert.match(tab, /collection="jurisdiction_holiday_calendars"/);
	assert.match(tab, /jurisdiction_code/);
	assert.doesNotMatch(tab, /collection="work_days"/);
});
