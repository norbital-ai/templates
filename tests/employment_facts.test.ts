/** L-TPL-hr-payroll-037 statutory facts; 038 wage periods; 040 payment holds. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	electionKeysOf,
	refuseEmploymentFacts,
	statutoryFactsFromFacts
} from '../src/lib/payroll_engine/employment_facts.ts';
import type { HostRead } from '../src/lib/payroll_engine/foundation.ts';

/** The SG v4 version and its CPF/SDL schemes, as the transform reads them. */
const settings = JSON.parse(
	readFileSync(
		resolve(process.cwd(), 'seed/jurisdiction/SG/version_4/jurisdiction_settings.json'),
		'utf8'
	)
)[0] as { id: string; employee_input_schema: unknown };
const read = (async (collection: string) => ({
	rows:
		collection === 'statutory_contribution_catalog'
			? [{ id: 'cpf', settings_id: settings.id }]
			: [{ id: settings.id, employee_input_schema: settings.employee_input_schema }]
})) as unknown as HostRead;

describe('employment facts', () => {
	it('reads the election keys from the jurisdiction’s employee input schema', () => {
		const schema = {
			properties: {
				employment_statutory_facts: {
					items: {
						properties: {
							status: {
								properties: { elections: { properties: { rate: {}, member: {} } } }
							}
						}
					}
				}
			}
		};
		assert.deepEqual(electionKeysOf(schema).toSorted(), ['member', 'rate']);
		assert.ok(electionKeysOf(settings.employee_input_schema).length > 0);
		assert.deepEqual(electionKeysOf({}), []);
	});

	it('L-TPL-hr-payroll-037 refuses two standings of one scheme that overlap, and an unknown election', async () => {
		assert.equal(
			await refuseEmploymentFacts(
				{
					employment_statutory_facts: [
						{
							statutory_contribution_id: 'cpf',
							effective_range: { from: '2020-01-01', to: null },
							status: { kind: 'REGISTERED' }
						},
						{
							statutory_contribution_id: 'cpf',
							effective_range: { from: '2024-01-01', to: '2024-12-31' },
							status: { kind: 'NOT_REGISTERED' }
						}
					]
				},
				read
			),
			'A person can have only one standing per scheme at a time.'
		);
		assert.equal(
			await refuseEmploymentFacts(
				{
					employment_statutory_facts: [
						{
							statutory_contribution_id: 'cpf',
							effective_range: { from: '2020-01-01', to: '2023-12-31' },
							status: { kind: 'REGISTERED' }
						},
						{
							statutory_contribution_id: 'cpf',
							effective_range: { from: '2024-01-01', to: null },
							status: { kind: 'REGISTERED', elections: { sdl_nonbusiness: true } }
						},
						{
							statutory_contribution_id: 'sdl',
							effective_range: { from: '2020-01-01', to: null },
							status: { kind: 'REGISTERED' }
						}
					]
				},
				read
			),
			null
		);
		assert.equal(
			await refuseEmploymentFacts(
				{
					employment_statutory_facts: [
						{
							statutory_contribution_id: 'cpf',
							effective_range: { from: '2020-01-01', to: null },
							status: { kind: 'REGISTERED', elections: { mystery: true } }
						}
					]
				},
				read
			),
			"Unknown election 'mystery'."
		);
		assert.equal(statutoryFactsFromFacts({ employment_statutory_facts: [] }).length, 0);
	});
});
