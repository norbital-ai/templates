// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Every scheme fixture's `assessed_on` formula names catalogue rows of the scheme's own settings
 * version, and every version's schemes state something. A seed converter that stamped one
 * version's codes into another's, or left a scheme charging nothing, is caught here rather than by
 * a payroll that silently reads zero under a code.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync } from 'node:fs';
import { lawFileExists, readLawFile } from './fixtures/law-file.ts';
import { assessedOnMentions } from '../src/lib/expressions/compile.ts';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOTS = [resolve(here, 'fixtures/statutory'), resolve(here, 'fixtures/seed')];
const FILES = {
	LEAVE: 'leave_catalogue',
	ALLOWANCE: 'allowance_catalogue',
	CLAIM: 'claim_catalogue',
	LOAN: 'loan_catalogue'
};

test('every fixture formula names a row of its own settings version, and no scheme charges nothing', () => {
	let checked = 0;
	for (const root of ROOTS)
		for (const lineage of readdirSync(root)) {
			const dir = `${root}/${lineage}`;
			if (!lawFileExists(`${dir}/statutory_contributions`)) continue;
			// A curated snapshot may carry fewer catalogue files than the bank; only a family whose
			// file is present can be checked.
			const codes = new Map();
			const present = new Set();
			for (const [family, file] of Object.entries(FILES)) {
				if (!lawFileExists(`${dir}/${file}`)) continue;
				present.add(family);
				for (const row of readLawFile(`${dir}/${file}`))
					codes.set(`${row.settings_id}/${family}/${row.code}`, true);
			}
			for (const scheme of readLawFile(`${dir}/statutory_contributions`)) {
				const formula = scheme.assessed_on;
				assert.ok(formula, `${lineage} ${scheme.code}: no assessed_on`);
				const mentions = assessedOnMentions(formula);
				// A formula that reads the contract's own wage — Vietnam's insurance salary is the
				// contractual salary, not the month's lines — charges something too.
				assert.ok(
					mentions.reserved.length > 0 ||
						mentions.codes.length > 0 ||
						mentions.catalogues.length > 0 ||
						/person\.terms\.(basic_salary|monthly_wage|statutory_wages)/.test(formula),
					`${lineage} ${scheme.code}: charges nothing`
				);
				for (const code of [...mentions.codes, ...mentions.yearEarned]) {
					const families = [...present].filter((family) =>
						codes.has(`${scheme.settings_id}/${family}/${code}`)
					);
					if (families.length === 0) continue;
					checked += 1;
					assert.equal(
						families.length,
						1,
						`${lineage} ${scheme.code}: ${code} is a row of two catalogues (${families.join(', ')})`
					);
				}
				for (const selection of mentions.catalogues) {
					if (!present.has(selection.catalogue)) continue;
					for (const code of [...selection.pick, ...selection.exclude]) {
						checked += 1;
						assert.ok(
							codes.has(`${scheme.settings_id}/${selection.catalogue}/${code}`),
							`${lineage} ${scheme.code}: ${selection.catalogue} ${code} is not a row of its settings version`
						);
					}
				}
			}
		}
	assert.ok(checked > 0, 'the fixture banks carry formulas to check');
});
