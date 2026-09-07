/**
 * A relation may enter a `where` only under a quantifier.
 *
 * `{ term_employment: { employee_id: { eq: id } } }` reads to the predicate decoder as a *field*
 * called `term_employment` carrying an operator called `employee_id`, and it is refused —
 * `SchemaError: term_employment has unsupported operator employee_id`, thrown while the surface
 * renders, so the page dies rather than showing an empty table. Nothing else catches this: the
 * shape is valid TypeScript, `bolt sync` accepts it, and the refusal only happens once a real
 * query is decoded against a real schema.
 *
 * The correct form names the quantifier: `{ term_employment: { some: { employee_id: { eq: id } } } }`.
 *
 * This scan reads source text, so it can only be trusted if it can be shown to see a violation.
 * `finds a violation it is shown` is that proof, and it fails the moment the scanner goes blind.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const QUANTIFIERS = new Set(['some', 'none', 'every']);
/** Keys that follow a relation name when it is being *loaded*, not filtered. */
const LOADERS = new Set(['columns', 'with', 'limit', 'orderBy']);

const templateRoot = fileURLToPath(new URL('../', import.meta.url));

const sourceFiles = (directory: string): string[] =>
	readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory()) return sourceFiles(path);
		return entry.name.endsWith('.svelte') || entry.name.endsWith('.ts') ? [path] : [];
	});

export const relationNames = (relationshipSource: string): ReadonlySet<string> =>
	new Set(
		[...relationshipSource.matchAll(/^\t\t([a-z_][a-z0-9_]*):\s*(?:cascade\()?r\.(?:one|many)\./gm)]
			.map((match) => match[1] ?? '')
			.filter((name) => name !== '')
	);

/**
 * Every relation named inside a `where` without a quantifier, as `line: relation.operator`.
 *
 * The window after each `where` is bounded and cut at the next `with`/`columns`/`orderBy`, because
 * those introduce a *load* of the same relation and a load names its columns directly and legally.
 */
export const unquantifiedRelationPredicates = (
	source: string,
	relations: ReadonlySet<string>
): readonly string[] => {
	const found: string[] = [];
	for (const where of source.matchAll(/\bwhere\b\s*:/g)) {
		const from = where.index + where[0].length;
		const window = source.slice(from, from + 600);
		const cuts = [
			window.indexOf('with:'),
			window.indexOf('columns:'),
			window.indexOf('orderBy:')
		].filter((index) => index > 0);
		const scanned = window.slice(0, cuts.length === 0 ? window.length : Math.min(...cuts));
		for (const relation of relations) {
			const pattern = new RegExp(`\\b${relation}\\s*:\\s*\\{\\s*([A-Za-z_$][\\w$]*)`, 'g');
			for (const match of scanned.matchAll(pattern)) {
				const key = match[1] ?? '';
				if (QUANTIFIERS.has(key) || LOADERS.has(key)) continue;
				const line = source.slice(0, from).split('\n').length;
				found.push(`${line}: ${relation}.${key}`);
			}
		}
	}
	return found.toSorted();
};

test('finds a violation it is shown', () => {
	const relations = new Set(['term_employment']);
	assert.deepEqual(
		unquantifiedRelationPredicates(
			'client.db.employment_terms.findMany({ where: { term_employment: { employee_id: { eq: id } } } })',
			relations
		),
		['1: term_employment.employee_id'],
		'the scan cannot see the shape it exists to find'
	);
	assert.deepEqual(
		unquantifiedRelationPredicates(
			'client.db.employment_terms.findMany({ where: { term_employment: { some: { employee_id: { eq: id } } } } })',
			relations
		),
		[],
		'the scan flags the quantified form, which is the correct one'
	);
	assert.deepEqual(
		unquantifiedRelationPredicates(
			'findMany({ where: { id: { eq: x } }, with: { term_employment: { columns: { employee_id: true } } } })',
			relations
		),
		[],
		'the scan mistakes a relation load for a relation filter'
	);
});

test('no authored query filters through a relation without a quantifier', () => {
	const relations = relationNames(
		readFileSync(`${templateRoot}src/collections/+relationship.ts`, 'utf8')
	);
	assert.ok(relations.size > 0, 'no relations were read, so this scan proves nothing');
	const offenders = sourceFiles(`${templateRoot}src`).flatMap((path) => {
		const hits = unquantifiedRelationPredicates(readFileSync(path, 'utf8'), relations);
		return hits.map((hit) => `${path.slice(templateRoot.length)}:${hit}`);
	});
	assert.deepEqual(
		offenders,
		[],
		`these predicates are refused at decode time: ${offenders.join(', ')}`
	);
});
