import assert from 'node:assert/strict';
import test from 'node:test';
import { registrations, source } from './helpers/page-source.ts';

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
	assert.equal(reads.filter((name) => name === 'db.jurisdiction_holidays.findMany').length, 1);
	assert.ok(!reads.includes('db.company_holidays.findMany'));
	assert.match(script, /holidayView\(/);
	const calendarView = source('lib/ui/holiday-calendar.ts');
	assert.match(calendarView, /resolveHolidays\(/);
	assert.deepEqual(
		registrations(calendarView),
		[],
		'the shared calendar view owns no live queries'
	);
});

test('the Work page carries no roster-code or pattern tables: the vocabulary is the lineage’s', () => {
	assert.doesNotMatch(page, /collection="shift_patterns"/);
	assert.doesNotMatch(page, /collection="shift_definitions"/);
	assert.doesNotMatch(page, /hr_controller:scheduling:(shifts|patterns)/);
	// The board still reads the codes to render a month; it no longer edits them.
	assert.match(page.slice(0, page.indexOf('</script>')), /db\.shift_definitions\.findMany/);
});

test('the Work page carries no holiday table: holidays are the entity’s, edited where the entity is', () => {
	assert.doesNotMatch(page, /collection="jurisdiction_holidays"/);
	assert.doesNotMatch(page, /hr_controller:scheduling:holidays/);
	// The board still reads the entity's published holidays to resolve day types.
	assert.match(page.slice(0, page.indexOf('</script>')), /holidayView\(/);
});
