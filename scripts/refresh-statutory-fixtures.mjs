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
 * The snapshot is curated, not a mirror: a fixture may carry fewer versions than the bank or
 * annotated prose the bank has since moved past. Run this script to see the diff, then hand-carry
 * only the change it is meant to carry; a blind copy rewrites what the golden tests assert.
 *
 * Usage: node scripts/refresh-statutory-fixtures.mjs [path-to-seed-bank]
 */

import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { gzipSync } from 'node:zlib';

/** The host's ceiling on one authored text file; see `tests/fixtures/law-file.ts`. */
const HOST_TEXT_FILE_CEILING = 1_048_576;
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const template = resolve(here, '..');
const bank = resolve(
	process.argv[2] ?? resolve(template, '../../seed_bank/norbital_hr/jurisdiction')
);

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
	'leave_catalogue.json'
];
/** Carried when the lineage has one: an allowance or ad hoc class is law the goldens price. */
const OPTIONAL_FILES = ['allowance_catalogue.json', 'adhoc_catalogue.json'];

for (const code of LINEAGES) {
	const source = resolve(bank, code);
	if (!existsSync(source)) {
		console.error(`Seed bank has no lineage ${code} at ${source}.`);
		process.exit(1);
	}
	const target = resolve(template, 'tests/fixtures/statutory', code);
	mkdirSync(target, { recursive: true });
	for (const file of [...FILES, ...OPTIONAL_FILES]) {
		const from = resolve(source, file);
		// An optional file the lineage no longer carries is removed from the fixture as well.
		if (!existsSync(from) && !OPTIONAL_FILES.includes(file)) {
			console.error(`${code} has no ${file}.`);
			process.exit(1);
		}
		// The host refuses any authored text file over its 1 MiB ceiling and skips what it does not
		// recognise, so a fixture that large is committed gzipped; `tests/fixtures/law-file.ts`
		// reads both forms.
		const to = resolve(target, file);
		rmSync(to, { force: true });
		rmSync(`${to}.gz`, { force: true });
		if (!existsSync(from)) continue;
		if (statSync(from).size > HOST_TEXT_FILE_CEILING)
			writeFileSync(`${to}.gz`, gzipSync(readFileSync(from)));
		else cpSync(from, to);
	}
	console.log(`${code}: ${FILES.length} files`);
}
