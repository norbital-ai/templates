/**
 * Behaviour is configuration: the engine and UI source name no jurisdiction, no statutory scheme, no classification
 * a version's records define, no currency and no bank. A quoted lineage code (`'SG'`), scheme code (`'CPF'`), input
 * schema option or listed kind (`'EA_COVERED'`, `'RESIGNATION'`), catalogue code (`'BASIC'`), currency (`'SGD'`) or
 * bank identifier (`'OCBCSG'`) in `src/` is a hard-coded switch that belongs in the seed records instead.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

type Row = { readonly [key: string]: unknown };
const root = process.cwd();
const law = resolve(root, 'seed/jurisdiction');
const lineages = readdirSync(law);
const file = (lineage: string, version: string, name: string): Row[] =>
	JSON.parse(readFileSync(join(law, lineage, version, `${name}.json`), 'utf8')) as Row[];
const isRow = (value: unknown): value is Row =>
	value != null && typeof value === 'object' && !Array.isArray(value);
/** Every `enum` / `const` string of a JSON Schema, however deep. */
const options = (node: unknown, out: Set<string>): Set<string> => {
	if (Array.isArray(node)) for (const item of node) options(item, out);
	else if (isRow(node))
		for (const [key, value] of Object.entries(node)) {
			if (key === 'enum' && Array.isArray(value))
				for (const option of value) if (typeof option === 'string') out.add(option);
			if (key === 'const' && typeof value === 'string') out.add(value);
			options(value, out);
		}
	return out;
};

const schemes = new Set<string>();
const configured = new Set<string>();
for (const lineage of lineages)
	for (const version of readdirSync(join(law, lineage))) {
		for (const row of file(lineage, version, 'statutory_contribution_catalog'))
			schemes.add(String(row.code));
		for (const settings of file(lineage, version, 'jurisdiction_settings')) {
			options(settings.employee_input_schema, configured);
			options(settings.entity_input_schema, configured);
			if (isRow(settings.payroll) && typeof settings.payroll.currency === 'string')
				configured.add(settings.payroll.currency);
		}
		for (const name of [
			'leave_catalog',
			'claim_catalog',
			'adhoc_catalog',
			'allowance_catalog',
			'loan_catalog',
			'work_catalog',
			'suspension_kind'
		])
			for (const row of file(lineage, version, name)) {
				configured.add(String(row.code));
				if (typeof row.component_code === 'string') configured.add(row.component_code);
			}
		for (const row of file(lineage, version, 'rule_set'))
			if (isRow(row.rules) && Array.isArray(row.rules.kinds))
				for (const kind of row.rules.kinds) if (isRow(kind)) configured.add(String(kind.code));
	}

const sources = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === 'i18n' ? [] : sources(path);
		return /\.(ts|svelte)$/.test(entry.name) ? [path] : [];
	});
const files = sources(resolve(root, 'src'));

/**
 * The platform's own grammar: the closed sets the source declares — a model's enum `values`, a `Schema.Literals`
 * list, a literal union type (a pay frequency, an entry's activity, a line's bucket). A record may reuse such a word
 * as a code (`MONTHLY` as a pay basis, `DEDUCTION` as an ad hoc class); the source naming it is its own grammar
 * speaking, not a classification switch.
 */
const grammar = new Set<string>();
const declared =
	/(?:values:\s*|Literals\(\s*)\[([^\]]*)\]|((?:'[A-Z][A-Z0-9_]*'\s*\|\s*)+'[A-Z][A-Z0-9_]*')/g;
for (const path of files)
	for (const [, list, union] of readFileSync(path, 'utf8').matchAll(declared))
		for (const [, value] of (list ?? union ?? '').matchAll(/'([^']+)'/g)) grammar.add(value!);

/** A SWIFT BIC (or the bank-and-country prefix a branch tests) of a lineage's country. */
const bank = new RegExp(`^[A-Z]{4}(?:${lineages.join('|')})(?:[A-Z0-9]{2}(?:[A-Z0-9]{3})?)?$`);

const literals = (text: string) =>
	[...text.matchAll(/['"`]([A-Z][A-Z0-9_]{1,})['"`]/g)].map(([, code]) => code!);
const hitsOf = (judge: (code: string) => boolean): string[] =>
	files.flatMap((path) =>
		literals(readFileSync(path, 'utf8'))
			.filter(judge)
			.map((code) => `${path.slice(root.length + 1)}: '${code}'`)
	);

describe('source is generic', () => {
	it('names no jurisdiction or statutory scheme code as a string literal', () => {
		const forbidden = new Set([...lineages, ...schemes]);
		assert.deepEqual(
			hitsOf((code) => forbidden.has(code)),
			[]
		);
	});

	it('names no option, kind, catalogue code or currency a version configures', () => {
		assert.ok(configured.has('RESIGNATION') && configured.has('SGD'), 'the vocabulary is read');
		assert.deepEqual(
			hitsOf((code) => configured.has(code) && !grammar.has(code)),
			[]
		);
	});

	it('names no bank identifier', () => {
		assert.equal(bank.test('OCBCSG'), true);
		assert.equal(bank.test('OCBCSGSGXXX'), true);
		assert.deepEqual(
			hitsOf((code) => bank.test(code)),
			[]
		);
	});
});
