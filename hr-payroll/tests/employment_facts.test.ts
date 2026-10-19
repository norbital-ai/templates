/** L-TPL-hr-payroll-037 statutory facts; 038 wage periods; 040 payment holds. */
import assert from 'node:assert/strict';
import { describe, it, layer } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { workspace } from './kit.ts';
import { readSeedRows } from './seed_values.ts';
import { resolve } from 'node:path';
import {
	electionKeysOf,
	refuseEmploymentFacts,
	statutoryFactsFromFacts
} from '../src/lib/payroll_engine/employment_facts.ts';

/** The SG v4 version and its CPF/SDL schemes, as the transform reads them. */
const folder = resolve(process.cwd(), 'seed/jurisdiction/SG/version_4');
const settings = Schema.decodeUnknownSync(
	Schema.Struct({ id: Schema.String, employee_input_schema: Schema.Json })
)(readSeedRows(folder, 'jurisdiction_settings')[0]);
const schemes = readSeedRows(folder, 'statutory_contribution_catalog');
const schemeId = (code: string) => {
	const row = schemes.find((held) => held['code'] === code);
	assert.ok(row, `SG v4 has ${code}.`);
	return Schema.decodeUnknownSync(Schema.String)(row['id']);
};
const cpf = schemeId('CPF');
const sdl = schemeId('SDL');

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

	layer(workspace())('native statutory fact validation', (it) => {
		it.effect(
			'L-TPL-hr-payroll-037 refuses two standings of one scheme that overlap, and an unknown election',
			() =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					const read = t.storedRead;
					assert.equal(
						yield* refuseEmploymentFacts(
							{
								employment_statutory_facts: [
									{
										statutory_contribution_id: cpf,
										effective_range: { from: '2020-01-01', to: null },
										status: { kind: 'REGISTERED' }
									},
									{
										statutory_contribution_id: cpf,
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
						yield* refuseEmploymentFacts(
							{
								employment_statutory_facts: [
									{
										statutory_contribution_id: cpf,
										effective_range: { from: '2020-01-01', to: '2023-12-31' },
										status: { kind: 'REGISTERED' }
									},
									{
										statutory_contribution_id: cpf,
										effective_range: { from: '2024-01-01', to: null },
										status: { kind: 'REGISTERED', elections: { sdl_nonbusiness: true } }
									},
									{
										statutory_contribution_id: sdl,
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
						yield* refuseEmploymentFacts(
							{
								employment_statutory_facts: [
									{
										statutory_contribution_id: cpf,
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
				})
		);
	});
});
