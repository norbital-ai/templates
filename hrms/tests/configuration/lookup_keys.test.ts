// A key in a catalog's lookup is law or policy. A key nothing reads looks enforced and is not.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { LAW_ROWS } from '../../src/lib/law.ts';
import { SEEDED } from './seeded.ts';

/** Every row of every seeded law on each of its change dates, and the settings beside them: each may hold a lookup. */
const ROWS: readonly Record<string, unknown>[] = SEEDED.flatMap(({ standing }) =>
	standing.flatMap((law) => [law.settings, ...LAW_ROWS.flatMap((family) => law.rows[family])])
);
const sources = (dir: string): readonly string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? sources(path) : /\.(ts|svelte)$/.test(name) ? [path] : [];
	});
const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
/** Read by building the key, one per wage band. */
const TABLES = new Set(['cpf_rates']);
/** A row's named keys, and those of the objects directly under them. Deeper levels are tables, not settings. */
const keysOf = (lookup: unknown): readonly string[] =>
	(isObject(lookup) ? Object.entries(lookup) : [])
		.flatMap(([key, item]) => [
			key,
			...(isObject(item) && !TABLES.has(key) ? Object.keys(item) : [])
		])
		.filter((key) => /^[a-z][a-z0-9_]*$/.test(key));

describe('catalog lookups', () => {
	it('declare nothing new that nothing reads', () => {
		const code = sources('src')
			.map((path) => readFileSync(path, 'utf8'))
			.join('\n');
		const expressions = ROWS.flatMap((row) => [
			...Object.entries(row).flatMap(([key, value]) =>
				key === 'lookup' || key === 'references' || typeof value !== 'string' ? [] : [value]
			),
			...(isObject(row.lookup) && typeof row.lookup.entitlement === 'string'
				? [row.lookup.entitlement]
				: [])
		]).join('\n');
		const read = new Set(`${code}\n${expressions}`.match(/[A-Za-z_][A-Za-z0-9_]*/g));
		const declared = new Set(ROWS.flatMap((row) => keysOf(row.lookup)));
		assert.deepEqual(
			[...declared].filter((key) => !read.has(key)).toSorted(),
			[],
			'a lookup key nothing reads: read it, or remove it'
		);
	});
});
