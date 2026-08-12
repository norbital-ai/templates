// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('bulk statutory rates rely on the atomic exclusion instead of one sibling read per row', () => {
	const hooks = source('../contribution_rates/+hooks.ts');
	const model = source('../contribution_rates/+model.ts');

	assert.doesNotMatch(hooks, /api\.db\.query\.contribution_rates/);
	assert.match(model, /name: 'contribution_rates_no_overlap'/);
});

test('loan instalment uniqueness is atomic and create skips impossible existing-child reads', () => {
	const entryHooks = source('../component_entries/+hooks.ts');
	const entryModel = source('../component_entries/+model.ts');
	const agreementHooks = source('./+hooks.ts');

	assert.doesNotMatch(entryHooks, /api\.db\.query\.component_entries/);
	assert.match(
		entryModel,
		/columns: \['repayment_agreement_id', 'repayment_sequence'\],[\s\S]*?unique: true/
	);
	assert.match(agreementHooks, /synchronizeInstalments\(api, record, \[\]\)/);
	assert.match(agreementHooks, /existingEntries \?\? \(await agreementEntries\(api, agreement\)\)/);
	assert.match(
		agreementHooks,
		/batchHandler: async \(\{ records, api \}\) =>[\s\S]*?records\.flatMap\(\(record\) => scheduledInstalmentInputs\(record\)\)[\s\S]*?api\.db\.mutate\('component_entries', inputs\)/
	);
	assert.match(
		entryHooks,
		/batchHandler: async \(\{ inputs, api \}\) =>[\s\S]*?api\.db\.query\.repayment_agreements\.findMany[\s\S]*?assertInstalmentMatchesResolvedAgreement/
	);
});

test('bulk roster creation validates shared references with set reads', () => {
	const hooks = source('../roster_entries/+hooks.ts');

	assert.match(
		hooks,
		/batchHandler:[\s\S]*?api\.db\.query\.employments\.findMany[\s\S]*?api\.db\.query\.shift_definitions\.findMany[\s\S]*?api\.db\.query\.rosters\.findMany[\s\S]*?return inputs;/
	);
});

test('bulk leave creation reuses canonical normalization over bounded set reads', () => {
	const hooks = source('../leave_requests/+hooks.ts');

	assert.match(hooks, /batchHandler: async \(\{ inputs, api \}\) =>/);
	assert.match(hooks, /monthRanges\(startDate, endDate\)/);
	assert.match(hooks, /api\.db\.query\.leave_requests\.findMany/);
	assert.match(hooks, /api\.db\.query\.roster_entries\.findMany/);
	assert.match(hooks, /const event = await normalizedTimeOff\(/);
});
