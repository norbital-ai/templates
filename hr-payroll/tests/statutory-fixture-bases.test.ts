// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Every scheme fixture's `base.entries` names a catalogue row of the scheme's own settings
 * version (RFC 0003 §1.4), and every version's schemes admit something. A seed converter that
 * stamped one version's codes into another's, or left a scheme charging nothing, is caught here
 * rather than by a payroll that silently admits no line.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync } from 'node:fs';
import { lawFileExists, readLawFile } from './fixtures/law-file.ts';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOTS = [resolve(here, 'fixtures/statutory'), resolve(here, 'fixtures/seed')];
const FILES = {
	LEAVE: 'leave_catalogue',
	ALLOWANCE: 'allowance_catalogue',
	CLAIM: 'claim_catalogue',
	PAYMENT: 'payment_catalogue',
	LOAN: 'loan_catalogue'
};

test('every fixture base entry names a row of its own settings version, and no scheme charges nothing', () => {
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
				const base = scheme.base;
				assert.ok(base, `${lineage} ${scheme.code}: no base`);
				assert.ok(
					base.salary ||
						base.absence ||
						base.overtime ||
						base.night_premium ||
						base.entries.length > 0,
					`${lineage} ${scheme.code}: charges nothing`
				);
				for (const entry of base.entries) {
					if (!present.has(entry.family)) continue;
					checked += 1;
					assert.ok(
						codes.has(`${scheme.settings_id}/${entry.family}/${entry.code}`),
						`${lineage} ${scheme.code}: ${entry.family} ${entry.code} is not a row of its settings version`
					);
				}
			}
		}
	assert.ok(checked > 0, 'the fixture banks carry base entries to check');
});
