#!/usr/bin/env node
/**
 * Snapshot the seed bank's sealed statutory law into `tests/fixtures/statutory/`.
 *
 * The golden tests assert payslip figures against the law as the vetting reports state it, and they
 * run in CI where the seed bank is not checked out. So the four files that carry the law — the
 * settings versions, the contribution schemes and their bands, the work regime and the leave
 * ladder — are copied here and committed. This script is how they are refreshed when the bank
 * changes; it is never run by `pnpm test`.
 *
 * Usage: node scripts/refresh-statutory-fixtures.mjs [path-to-seed-bank]
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const template = resolve(here, '..');
const bank = resolve(process.argv[2] ?? resolve(template, '../../seed_bank/norbital_hr/statutory'));

if (!existsSync(bank)) {
	console.error(
		`No seed bank at ${bank}. The snapshot in tests/fixtures/statutory/ is what CI runs against; ` +
			'pass the bank path as the first argument to refresh it.'
	);
	process.exit(1);
}

const LINEAGES = ['MY', 'MY-nihon', 'PH', 'SG', 'VN', 'TW', 'ID'];
const FILES = [
	'jurisdiction_settings.json',
	'statutory_contributions.json',
	'work_catalogue.json',
	'leave_catalogue.json'
];

for (const code of LINEAGES) {
	const source = resolve(bank, code);
	if (!existsSync(source)) {
		console.error(`Seed bank has no lineage ${code} at ${source}.`);
		process.exit(1);
	}
	const target = resolve(template, 'tests/fixtures/statutory', code);
	mkdirSync(target, { recursive: true });
	for (const file of FILES) {
		const from = resolve(source, file);
		if (!existsSync(from)) {
			console.error(`${code} has no ${file}.`);
			process.exit(1);
		}
		cpSync(from, resolve(target, file));
	}
	console.log(`${code}: ${FILES.length} files`);
}
