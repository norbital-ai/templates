/**
 * Runtime-schema rule (docs/inventory/README.md): jurisdiction behaviour is configuration, never
 * `src` code, a jurisdiction-named collection, module or field, or a hard-coded tracker path.
 *
 * The code list is read from the seed — every `seed/jurisdiction/<lineage>` directory, every seeded
 * `jurisdiction_code`, and each lineage's first segment — so a new lineage is covered on arrival.
 * Every failure names the file, the line and the token that matched.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseCsv } from './helpers/csv.ts';

const at = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const root = at('');
const rel = (path: string) => path.slice(root.length);

/** Every file under `dir`, recursively. */
const walk = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = `${dir}/${entry.name}`;
		return entry.isDirectory() ? [path, ...walk(path)] : [path];
	});

const LINEAGES = readdirSync(at('seed/jurisdiction'));
const seeded = (value: unknown): string[] =>
	Array.isArray(value)
		? value.flatMap(seeded)
		: value && typeof value === 'object'
			? Object.entries(value).flatMap(([key, v]) =>
					key === 'jurisdiction_code' && typeof v === 'string' ? [v] : seeded(v)
				)
			: [];
const CODES = new Set([
	...LINEAGES,
	...LINEAGES.map((lineage) => lineage.split('-')[0]),
	...walk(at('seed/jurisdiction'))
		.filter((file) => file.endsWith('.json'))
		.flatMap((file) => seeded(JSON.parse(readFileSync(file, 'utf8'))))
]);

const NAME_TOKEN = /^(ph|vn|th|sg|my|cn|tw|id)[-_]/i;
const COUNTRY_WORD =
	/\b(philippin|thai|vietnam|malaysia|singapore|indonesia|taiwan|chinese|shanghai|kunming|nihon)/i;
const FIELD_PREFIX = /^(ph|vn|th|sg|my|cn|tw)_|^id_(?!(number|type)$)/i;
const SCHEME_NAME = /sss_|iras_|ir21|kbli|bpjs/i;
const I18N_SEGMENT = /_(vn|ph|th|sg|my)_|^(vn|ph|th|sg|my)_/;
/** Self-service "my …" surfaces: the possessive, not Malaysia. */
const MY_KEYS = new Set([
	'app.hr_employee.my_claims_description',
	'app.hr_employee.my_claims_title',
	'app.hr_employee.my_contract',
	'app.hr_employee.my_leave_description',
	'app.hr_employee.my_leave_title',
	'app.hr_employee.my_loans_description',
	'app.hr_employee.my_loans_title',
	'app.hr_employee.my_payslips_description',
	'app.hr_employee.my_payslips_title',
	'app.hr_employee.my_profile',
	'app.hr_employee.my_schedule_description',
	'app.hr_employee.my_schedule_title'
]);

const lineOf = (text: string, pos: number) => text.slice(0, pos).split('\n').length;

type Token = { kind: ts.SyntaxKind; value: string; pos: number };

const scanner = ts.createScanner(ts.ScriptTarget.Latest, true);
const K = ts.SyntaxKind;
const OPERAND = new Set([
	K.Identifier,
	K.PrivateIdentifier,
	K.StringLiteral,
	K.NumericLiteral,
	K.BigIntLiteral,
	K.NoSubstitutionTemplateLiteral,
	K.TemplateTail,
	K.RegularExpressionLiteral,
	K.CloseParenToken,
	K.CloseBracketToken,
	K.CloseBraceToken,
	K.ThisKeyword,
	K.SuperKeyword,
	K.TrueKeyword,
	K.FalseKeyword,
	K.NullKeyword,
	K.PlusPlusToken,
	K.MinusMinusToken
]);

/**
 * Tokens of `text[from, to)`, comments skipped. A template's `}` is rescanned as its continuation
 * and a `/` in operand position as a regex, as the parser would. With `mustache`, stops after the
 * unbalanced `}` that closes a Svelte `{…}` and returns its end.
 */
function scan(text: string, from: number, to: number, out: Token[], mustache = false): number {
	scanner.setText(text, from, to - from);
	const braces = [0];
	let prev = K.Unknown;
	for (;;) {
		let kind = scanner.scan();
		if (kind === K.EndOfFileToken) return to;
		if (kind === K.CloseBraceToken && braces.at(-1) === 0) {
			if (braces.length === 1 && mustache) return scanner.getTokenEnd();
			if (braces.length > 1) {
				kind = scanner.reScanTemplateToken(false);
				if (kind === K.TemplateTail) braces.pop();
			}
		} else if (kind === K.CloseBraceToken) braces[braces.length - 1]--;
		else if (kind === K.OpenBraceToken) braces[braces.length - 1]++;
		else if (kind === K.TemplateHead) braces.push(0);
		else if ((kind === K.SlashToken || kind === K.SlashEqualsToken) && !OPERAND.has(prev))
			kind = scanner.reScanSlashToken();
		out.push({ kind, value: scanner.getTokenValue(), pos: scanner.getTokenStart() });
		prev = kind;
	}
}

const blank = (s: string) => s.replace(/[^\n]/g, ' ');

/**
 * A Svelte file's tokens: its `<script>` blocks, then each markup `{…}` expression, then markup
 * attribute values and text as string literals. Style blocks and HTML comments are dropped.
 */
function svelteTokens(text: string): Token[] {
	const out: Token[] = [];
	let markup = text.replace(/<!--[\s\S]*?-->|<style[\s\S]*?<\/style>/g, blank);
	for (const m of markup.matchAll(/(<script[^>]*>)([\s\S]*?)<\/script>/g)) {
		const start = m.index + m[1].length;
		scan(text, start, start + m[2].length, out);
	}
	markup = markup.replace(/<script[\s\S]*?<\/script>/g, blank);
	for (let i = markup.indexOf('{'); i !== -1; i = markup.indexOf('{', i + 1)) {
		const head = /^[#:/@]\w+(\s+if\b)?/.exec(markup.slice(i + 1))?.[0].length ?? 0;
		const end = scan(markup, i + 1 + head, markup.length, out, true);
		markup = markup.slice(0, i) + blank(markup.slice(i, end)) + markup.slice(end);
	}
	for (const m of markup.matchAll(/=\s*(?:"([^"]*)"|'([^']*)')|>([^<>]+)</g)) {
		const value = (m[1] ?? m[2] ?? m[3]).trim();
		if (value) out.push({ kind: K.StringLiteral, value, pos: m.index });
	}
	return out;
}

const STRING = new Set([
	K.StringLiteral,
	K.NoSubstitutionTemplateLiteral,
	K.TemplateHead,
	K.TemplateMiddle,
	K.TemplateTail
]);
const NAME = new Set([K.Identifier, K.PrivateIdentifier]);

const src = walk(at('src')).filter((f) => /\.(ts|svelte)$/.test(f));
const i18n = at('src/i18n/');

test('no src string equals a jurisdiction code', () => {
	assert.ok(CODES.has('MY') && CODES.has('CN') && CODES.has('MY-nihon'), [...CODES].join(', '));
	const offenders: string[] = [];
	for (const file of src.filter((f) => !f.startsWith(i18n))) {
		const text = readFileSync(file, 'utf8');
		const tokens: Token[] = [];
		if (file.endsWith('.svelte')) tokens.push(...svelteTokens(text));
		else scan(text, 0, text.length, tokens);
		for (const t of tokens)
			// A string that equals a code, or opens with one as its label ('VN paternity leave …').
			if (STRING.has(t.kind) && (CODES.has(t.value) || CODES.has(t.value.split(/[\s:]/)[0]!)))
				offenders.push(`${rel(file)}:${lineOf(text, t.pos)} — '${t.value}'`);
	}
	assert.deepEqual(offenders, [], 'a jurisdiction code in src is a branch: move it to the seed');
});

/** Catalogue codes (`seed/jurisdiction/<lineage>/*_catalogue.json`) by the lineages, first segment, that seed them. */
const CATALOGUE_LINEAGES = new Map<string, Set<string>>();
for (const lineage of LINEAGES)
	for (const name of readdirSync(at(`seed/jurisdiction/${lineage}`)).filter((f) =>
		f.endsWith('_catalogue.json')
	))
		for (const row of JSON.parse(readFileSync(at(`seed/jurisdiction/${lineage}/${name}`), 'utf8')))
			CATALOGUE_LINEAGES.set(
				row.code,
				(CATALOGUE_LINEAGES.get(row.code) ?? new Set()).add(lineage.split('-')[0]!)
			);

/** Enum values declared in `src/data` models and custom fields: engine vocabulary, not a branch. */
const VOCABULARY = new Set(
	walk(at('src/data'))
		.filter((f) => /\+(model|definition)\.ts$/.test(f))
		.flatMap((file) => {
			const sf = ts.createSourceFile(
				file,
				readFileSync(file, 'utf8'),
				ts.ScriptTarget.Latest,
				true
			);
			const out: string[] = [];
			const visit = (node: ts.Node): void => {
				if (
					ts.isPropertyAssignment(node) &&
					node.name.getText(sf) === 'values' &&
					ts.isArrayLiteralExpression(node.initializer)
				)
					for (const el of node.initializer.elements) if (ts.isStringLiteral(el)) out.push(el.text);
				ts.forEachChild(node, visit);
			};
			visit(sf);
			return out;
		})
);

test('no src string equals a catalogue code only one lineage seeds', () => {
	assert.ok(CATALOGUE_LINEAGES.get('KASAMBAHAY_FORFEITURE')?.size === 1);
	const offenders: string[] = [];
	for (const file of src.filter((f) => !f.startsWith(i18n))) {
		const text = readFileSync(file, 'utf8');
		const tokens: Token[] = [];
		if (file.endsWith('.svelte')) tokens.push(...svelteTokens(text));
		else scan(text, 0, text.length, tokens);
		for (const t of tokens)
			if (
				STRING.has(t.kind) &&
				CATALOGUE_LINEAGES.get(t.value)?.size === 1 &&
				!VOCABULARY.has(t.value)
			)
				offenders.push(
					`${rel(file)}:${lineOf(text, t.pos)} — '${t.value}' (${[...CATALOGUE_LINEAGES.get(t.value)!]})`
				);
	}
	assert.deepEqual(offenders, [], 'a one-lineage catalogue code in src is a branch: declare it');
});

test('the declarations that replaced catalogue-code branches name seeded rows', () => {
	for (const lineage of LINEAGES) {
		const dir = `seed/jurisdiction/${lineage}`;
		const adhoc: { code: string; destination: string; direction: string | null }[] = readdirSync(
			at(dir)
		).includes('adhoc_catalogue.json')
			? JSON.parse(readFileSync(at(`${dir}/adhoc_catalogue.json`), 'utf8'))
			: [];
		const codes = new Set(adhoc.map((row) => row.code));
		for (const version of JSON.parse(
			readFileSync(at(`${dir}/jurisdiction_settings.json`), 'utf8')
		)) {
			const pay = version.work_rules?.wages?.results_pay ?? {};
			for (const code of [
				...(pay.levy_unclassified_codes ?? []),
				...(pay.results_wage_codes ?? []),
				...(pay.zero_results_code == null ? [] : [pay.zero_results_code])
			])
				assert.ok(codes.has(code), `${dir} ${version.id}: results_pay names unseeded ${code}`);
		}
		// RA 10361 s.32: the forfeiture takes unpaid salary, so a flagged class is a NET deduction.
		for (const row of adhoc.filter((r) => 'reduces_unpaid_salary' in r))
			assert.deepEqual([row.destination, row.direction], ['NET', 'SUBTRACT'], `${dir} ${row.code}`);
	}
	const ph = JSON.parse(readFileSync(at('seed/jurisdiction/PH/adhoc_catalogue.json'), 'utf8'));
	const forfeiture = ph.filter((row: { code: string }) => row.code === 'KASAMBAHAY_FORFEITURE');
	assert.ok(forfeiture.length > 0);
	for (const row of forfeiture) assert.equal(row.reduces_unpaid_salary, true, row.id);
});

test('no src identifier or string names a jurisdiction', () => {
	const offenders: string[] = [];
	for (const file of src.filter((f) => !f.startsWith(i18n))) {
		const text = readFileSync(file, 'utf8');
		const tokens: Token[] = [];
		if (file.endsWith('.svelte')) tokens.push(...svelteTokens(text));
		else scan(text, 0, text.length, tokens);
		for (const t of tokens) {
			if (!STRING.has(t.kind) && !NAME.has(t.kind)) continue;
			const match = COUNTRY_WORD.exec(t.value);
			if (match) offenders.push(`${rel(file)}:${lineOf(text, t.pos)} — ${match[0]} in ${t.value}`);
		}
	}
	assert.deepEqual(offenders, [], 'a country name in src belongs in the seed or src/i18n');
});

test('no collection, model, custom field, lib or app entry is named for a jurisdiction', () => {
	const codes = new Set([...CODES].map((c) => c.toLowerCase()));
	const entries = [
		...['collection', 'model', 'custom_field'].flatMap((kind) =>
			readdirSync(at(`src/data/${kind}`)).map((name) => at(`src/data/${kind}/${name}`))
		),
		...walk(at('src/lib')),
		...walk(at('src/app'))
	];
	const offenders = entries.flatMap((path) => {
		const stem = path
			.slice(path.lastIndexOf('/') + 1)
			.replace(/^\+/, '')
			.split('.')[0];
		const token = NAME_TOKEN.exec(stem)?.[0] ?? (codes.has(stem.toLowerCase()) ? stem : null);
		return token ? [`${rel(path)}:1 — ${token}`] : [];
	});
	assert.deepEqual(offenders, [], 'jurisdiction data is a row in a generic collection');
});

test('no model field is named for a jurisdiction or its scheme', () => {
	const offenders: string[] = [];
	for (const name of readdirSync(at('src/data/model'))) {
		const file = at(`src/data/model/${name}/+model.ts`);
		const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
		const visit = (node: ts.Node): void => {
			if (
				ts.isPropertyAssignment(node) &&
				node.name.getText(sf) === 'fields' &&
				ts.isObjectLiteralExpression(node.initializer)
			) {
				for (const prop of node.initializer.properties) {
					if (!prop.name || !(ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)))
						continue;
					const key = prop.name.text;
					const match = FIELD_PREFIX.exec(key) ?? SCHEME_NAME.exec(key);
					if (match) {
						const line = sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line + 1;
						offenders.push(`${rel(file)}:${line} — ${match[0]} in ${key}`);
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sf);
	}
	assert.deepEqual(offenders, [], 'a jurisdiction fact is a declared FactKey, not a column');
});

test('no i18n key is scoped to a jurisdiction', () => {
	const offenders: string[] = [];
	for (const file of src.filter((f) => f.startsWith(i18n))) {
		const text = readFileSync(file, 'utf8');
		const tokens: Token[] = [];
		scan(text, 0, text.length, tokens);
		tokens.forEach((t, i) => {
			if (t.kind !== K.StringLiteral || tokens[i + 1]?.kind !== K.ColonToken) return;
			if (MY_KEYS.has(t.value)) return;
			const match = t.value
				.split('.')
				.map((s) => I18N_SEGMENT.exec(s)?.[0])
				.find(Boolean);
			if (match) offenders.push(`${rel(file)}:${lineOf(text, t.pos)} — ${match} in ${t.value}`);
		});
	}
	assert.deepEqual(offenders, [], 'a message key names the capability, not the country');
});

test('no tracker config_path is hard-coded', () => {
	const offenders: string[] = [];
	const dir = at('docs/inventory');
	for (const name of readdirSync(dir).filter((f) => f.endsWith('.csv'))) {
		const rows = parseCsv(readFileSync(`${dir}/${name}`, 'utf8'));
		const column = rows[0].indexOf('config_path');
		rows.forEach((cells, i) => {
			const value = cells[column] ?? '';
			if (i > 0 && value.includes('HARDCODED:'))
				offenders.push(`docs/inventory/${name}:${rows.lines[i]} — ${value}`);
		});
	}
	assert.deepEqual(offenders, [], 'config_path names a settings key, catalogue code or fact key');
});

test('a rate row can read the working week', () => {
	assert.match(
		readFileSync(at('src/lib/expressions/contexts.ts'), 'utf8'),
		/terms\.ordinary_hours_per_week/
	);
});
