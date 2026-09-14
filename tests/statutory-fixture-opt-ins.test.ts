// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Every catalogue fixture's `statutory_opt_ins` is a foreign key to a scheme of the row's own
 * settings version (RFC 0002 §6). The seed converter once stamped one version's scheme ids into
 * every version's rows, so the historical versions' opt-ins silently named nothing; this is the
 * gate that keeps a cross-version reference from returning.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOTS = [resolve(here, 'fixtures/statutory'), resolve(here, 'fixtures/seed')];
const FILES = [
	'jurisdiction_settings',
	'leave_catalogue',
	'claim_catalogue',
	'payment_catalogue',
	'allowance_catalogue',
	'loan_catalogue'
];

function optInIds(value, out = []) {
	if (Array.isArray(value)) for (const item of value) optInIds(item, out);
	else if (value != null && typeof value === 'object') {
		if (typeof value.contribution_id === 'string') out.push(value.contribution_id);
		for (const item of Object.values(value)) optInIds(item, out);
	}
	return out;
}

test('every fixture opt-in names a scheme of its own settings version', () => {
	let checked = 0;
	for (const root of ROOTS)
		for (const lineage of readdirSync(root)) {
			const dir = `${root}/${lineage}`;
			if (!existsSync(`${dir}/statutory_contributions.json`)) continue;
			const schemes = JSON.parse(readFileSync(`${dir}/statutory_contributions.json`, 'utf8'));
			const idsByVersion = new Map();
			for (const scheme of schemes) {
				const ids = idsByVersion.get(scheme.settings_id) ?? new Set();
				ids.add(scheme.id);
				idsByVersion.set(scheme.settings_id, ids);
			}
			for (const file of FILES) {
				const path = `${dir}/${file}.json`;
				if (!existsSync(path)) continue;
				const parsed = JSON.parse(readFileSync(path, 'utf8'));
				for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
					const versionId = file === 'jurisdiction_settings' ? row.id : row.settings_id;
					const ids = idsByVersion.get(versionId);
					for (const id of optInIds(row)) {
						checked += 1;
						assert.ok(
							ids?.has(id),
							`${file} ${row.code ?? row.id}: opt-in ${id} is not a scheme of its settings version`
						);
					}
				}
			}
		}
	assert.ok(checked > 0, 'the fixture banks carry opt-ins to check');
});
