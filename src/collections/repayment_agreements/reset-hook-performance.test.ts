// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertBatchHasNoOverlap } from '../pay_components/+hooks.ts';

function source(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('bulk statutory rates rely on the atomic exclusion instead of one sibling read per row', () => {
	const hooks = source('../contribution_rates/+hooks.ts');
	const model = source('../contribution_rates/+model.ts');

	assert.doesNotMatch(hooks, /api\.db\.query\.contribution_rates/);
	assert.match(model, /name: 'contribution_rates_no_overlap'/);
});

test('bulk pay components validate overlap with one set read and retain the atomic exclusion', () => {
	const hooks = source('../pay_components/+hooks.ts');
	const model = source('../pay_components/+model.ts');

	assert.match(hooks, /batchHandler: \(\{ inputs, api \}\) =>/);
	assert.match(
		hooks,
		/const existing = yield\* api\.db\.query\.pay_components\.findMany\([\s\S]*?assertBatchHasNoOverlap\(inputs, existing\);[\s\S]*?return inputs;/
	);
	assert.match(
		hooks,
		/for \(const \[index, input\] of inputs\.entries\(\)\)[\s\S]*?assertNoOverlap\([\s\S]*?siblings\.push\(/
	);
	assert.match(model, /name: 'pay_components_no_overlap'/);
});

test('bulk pay component overlap validation covers persisted and same-batch siblings', () => {
	const adjacent = [
		{
			company_id: 'company-a',
			code: 'BASIC',
			effective_range: { start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z' }
		},
		{
			company_id: 'company-a',
			code: 'BASIC',
			effective_range: { start: '2026-02-01T00:00:00.000Z', end: null }
		},
		{
			company_id: 'company-b',
			code: 'BASIC',
			effective_range: { start: '2026-01-15T00:00:00.000Z', end: null }
		}
	];
	assert.doesNotThrow(() => assertBatchHasNoOverlap(adjacent, []));
	assert.throws(
		() =>
			assertBatchHasNoOverlap(
				[
					...adjacent,
					{
						company_id: 'company-a',
						code: 'BASIC',
						effective_range: {
							start: '2026-01-15T00:00:00.000Z',
							end: '2026-03-01T00:00:00.000Z'
						}
					}
				],
				[]
			),
		/overlaps an existing row for pay component BASIC/
	);
	assert.throws(
		() =>
			assertBatchHasNoOverlap(
				[adjacent[0]],
				[
					{
						norbital_id: 'existing',
						company_id: 'company-a',
						code: 'BASIC',
						effective_range: { start: '2025-01-01T00:00:00.000Z', end: null }
					}
				]
			),
		/overlaps an existing row for pay component BASIC/
	);
});

test('loan instalment uniqueness is atomic and agreements do not write component entries', () => {
	const entryHooks = source('../component_entries/+hooks.ts');
	const entryModel = source('../component_entries/+model.ts');
	const agreementHooks = source('./+hooks.ts');

	assert.doesNotMatch(entryHooks, /api\.db\.query\.component_entries/);
	assert.match(
		entryModel,
		/columns: \['repayment_agreement_id', 'repayment_sequence'\],[\s\S]*?unique: true/
	);
	assert.doesNotMatch(agreementHooks, /api\.db\.mutate\(['"]component_entries['"]/);
	assert.doesNotMatch(agreementHooks, /synchronizeInstalments/);
	assert.doesNotMatch(agreementHooks, /scheduledInstalmentInputs/);
	assert.match(
		entryHooks,
		/batchHandler: \(\{ inputs, api \}\) =>[\s\S]*?api\.db\.query\.repayment_agreements\.findMany[\s\S]*?assertInstalmentMatchesResolvedAgreement/
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

	assert.match(hooks, /batchHandler: \(\{ inputs, api \}\) =>/);
	assert.match(hooks, /monthRanges\(startDate, endDate\)/);
	assert.match(hooks, /api\.db\.query\.leave_requests\.findMany/);
	assert.match(hooks, /api\.db\.query\.roster_entries\.findMany/);
	assert.match(hooks, /const event = yield\* normalizedTimeOff\(/);
});
