import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Environment } from '@marcbachmann/cel-js';

// Stored-eligibility probe, not saved-input or payroll evidence. EA First Schedule
// para.1A excludes high-wage ordinary employees from s.60J; para.2 preserves the
// listed categories regardless of wages. Vessel workers' Part XII exclusion does
// not extend to Part XIIA. Other termination-benefit conditions remain separate.
const engine = new Environment({ unlistedVariablesAreDyn: true });
type Row = { id: string; code: string; eligibility: string };
const cases = [
	{ category: 'NON_MANUAL', wages: 4000, type: 'PERMANENT', expected: true },
	{ category: 'NON_MANUAL', wages: 4000.01, type: 'PERMANENT', expected: false },
	{ category: 'MANUAL_LABOUR', wages: 5000, type: 'PERMANENT', expected: true },
	{ category: 'MANUAL_LABOUR_SUPERVISOR', wages: 5000, type: 'PERMANENT', expected: true },
	{ category: 'COMMERCIAL_VEHICLE_OPERATOR', wages: 5000, type: 'PERMANENT', expected: true },
	{ category: 'VESSEL_WORK', wages: 5000, type: 'PERMANENT', expected: true },
	{ category: 'NON_MANUAL', wages: 3000, type: 'DOMESTIC', expected: false }
];

for (const lineage of ['MY', 'MY-nihon']) {
	const rows: Row[] = JSON.parse(
		readFileSync(
			new URL(`../seed/jurisdiction/${lineage}/adhoc_catalogue.json`, import.meta.url),
			'utf8'
		)
	);
	for (const row of rows.filter((row) => row.code === 'TERMINATION_BENEFIT'))
		for (const example of cases)
			test(`${lineage} ${row.id}: ${example.type} ${example.category} RM${example.wages}`, () => {
				const actual = engine.evaluate(row.eligibility, {
					employment: {
						type: example.type,
						service_months: 24,
						exit_reason: 'REDUNDANCY'
					},
					terms: {
						statutory_wages: example.wages,
						statutory_work_category: example.category,
						workman: example.category.startsWith('MANUAL_LABOUR')
					}
				});
				assert.equal(actual, example.expected);
			});
}
