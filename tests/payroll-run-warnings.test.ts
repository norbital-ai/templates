// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { source } from './helpers/page-source.ts';

test('run warnings are kept out of the way: no runs-table column, one muted trigger on the run page', () => {
	const runs = source('apps/hr_controller/+payroll.svelte');
	assert.doesNotMatch(runs, /name="warnings"/, 'the runs table no longer counts warnings per row');
	const run = source('collections/payroll_runs/+representation.svelte');
	assert.match(run, /data-run-warnings/, 'the popover trigger stays');
	assert.match(
		run,
		/text-xs text-muted-foreground/,
		'and reads as a footnote, not an amber banner'
	);
	assert.doesNotMatch(run, /data-run-warnings[\s\S]{0,200}amber/);
});
