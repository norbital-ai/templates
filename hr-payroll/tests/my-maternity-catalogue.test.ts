import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Environment } from '@marcbachmann/cel-js';

// First Schedule para.2(5) excludes domestic employees from Part IX. Section 17A's
// approved-apprenticeship exclusion covers ss.10–16 only. More favourable contractual
// leave can be granted separately. This probe executes the stored statutory eligibility.
const engine = new Environment({ unlistedVariablesAreDyn: true });
type Row = { id: string; code: string; eligibility: string };

for (const lineage of ['MY']) {
	const rows: Row[] = JSON.parse(
		readFileSync(
			new URL(`../seed/jurisdiction/${lineage}/leave_catalogue.json`, import.meta.url),
			'utf8'
		)
	);
	for (const row of rows.filter((row) => row.code === 'MATERNITY_LEAVE')) {
		test(`${lineage} maternity scope ${row.id}: domestic exclusion, ordinary and apprentice inclusion`, () => {
			const eligible = (type: string, approvedApprenticeship = false, gender = 'FEMALE') =>
				engine.evaluate(row.eligibility, {
					employee: { gender },
					employment: {
						type,
						exit_facts: { notice_approved_apprenticeship: approvedApprenticeship }
					},
					event: { kind: 'BIRTH' }
				});
			assert.equal(eligible('DOMESTIC'), false);
			assert.equal(eligible('PERMANENT'), true);
			assert.equal(eligible('APPRENTICE', true), true);
			assert.equal(eligible('PERMANENT', false, 'MALE'), false);
		});
	}
}
