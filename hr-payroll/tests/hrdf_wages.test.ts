// The HRD levy is charged on wages, which leave overtime out (PSMB Act 2001 s.2; HRD Corp levy guidance).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { Schema } from 'effect';
import { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

const catalog = Schema.decodeUnknownSync(Schema.Array(JsonObject))(
	JSON.parse(
		readFileSync(
			'seed/public/jurisdiction/MY/version_3/statutory_contribution_catalog.json',
			'utf8'
		)
	)
);
const hrdf = catalog.find((row) => row.code === 'HRDF');
assert.ok(hrdf !== undefined);

describe('HRD levy', () => {
	it('charges 1% on wages without the overtime', () => {
		const levy = evaluate(
			String(hrdf.employer_amount),
			'CALCULATION',
			{
				subject: {
					employer: { entity_extension_data: { hrd_registration_class: 'COMPULSORY' } }
				},
				lookup: hrdf.lookup,
				overtime: 500,
				subtotals: { ORDINARY_WAGES: 3500 }
			},
			'HRDF'
		);
		assert.equal(levy, 30);
	});
});
