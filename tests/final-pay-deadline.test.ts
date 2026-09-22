import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory } from './fixtures/statutory-world.ts';

const warningsFor = (code: 'SG' | 'PH' | 'TW', reason: string, exit: string) =>
	buildStatutory({
		code,
		period: exit.slice(0, 7),
		// TW prices 職災 on the entity's industry class and refuses without one.
		riskClass: code === 'TW' ? '1' : null,
		people: [{ key: 'LEAVER', wage: 6000, exit_date: exit, exit_reason: reason }]
	}).warnings;

test('SG: a resignation is due within seven days and the warning names s.23(2)', () => {
	const warnings = warningsFor('SG', 'RESIGNATION', '2026-01-10');
	const late = warnings.find((warning) => warning.includes('FINAL_PAY_LATE'));
	assert.ok(late, `expected a final-pay warning, got ${JSON.stringify(warnings)}`);
	assert.match(late, /s\.23\(2\)/);
	// A month-end payroll pays 21 days later: beyond the seventh day after the last day.
	assert.match(late, /2026-01-17/);
});

test('SG: an employer termination is due within three days, not seven (s.22)', () => {
	const late = warningsFor('SG', 'REDUNDANCY', '2026-01-10').find((warning) =>
		warning.includes('FINAL_PAY_LATE')
	);
	assert.ok(late);
	assert.match(late, /2026-01-13/);
	assert.match(late, /s\.22/);
});

test('PH: the thirty-day final-pay window holds through the month-end run', () => {
	const warnings = warningsFor('PH', 'RESIGNATION', '2026-01-10');
	assert.deepEqual(
		warnings.filter((warning) => warning.includes('FINAL_PAY_LATE')),
		[]
	);
});

test('TW: final wages settle at termination and the run names the rule', () => {
	const late = warningsFor('TW', 'RESIGNATION', '2026-01-10').find((warning) =>
		warning.includes('FINAL_PAY_LATE')
	);
	assert.ok(late);
	assert.match(late, /art\.9/);
	assert.match(late, /2026-01-10/);
});
