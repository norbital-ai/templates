/**
 * The inputs oracle (capability plan I8): a tracker row's `config_path` names configuration the seeds declare.
 *
 * A path is `;`-separated tokens. Each token is read as far as its first space, `(`, `=`, `{` or `[`, and resolved
 * in every seeded lineage its `profile` covers (`CN-shanghai` and `CN-kunming` resolve in `CN`):
 *
 *   - `<collection>:<CODE>[.<path>]`: a row of the lineage's `<collection>.json[.gz]` whose `code` (or `table`, for
 *     `reference_rows`) is CODE, then `path` inside it;
 *   - `<collection>.<path>`: `path` inside any row of that seeded collection;
 *   - `settings:<CODE>` / `jurisdiction_settings:<CODE>`: a settings version of that code;
 *   - `<settings field>.<path>` or `<settings field>:<key>` (`work_rules`, `payroll`, `facts`, `obligations`, …):
 *     `path` inside that field of any settings version;
 *   - `<model or custom field>.<name>`: `name` is declared in `src/data/{model,custom_field}/<head>`.
 *
 * A path step into a list picks the item whose `key`, `code`, `name`, `label` or `table` equals it (or, failing that, the
 * items' own field of that name). `*` in a step is a wildcard; `A,B` or `A|B` in a step is each of them. A bare word
 * after a token replaces that token's last step (`CPF.elections.a; b` is `CPF.elections.b`). `none` names nothing.
 *
 * A row that claims a production proof (`VERIFIED`, `EXTERNAL-RECORDED`) must resolve every token; the rows that
 * claim behaviour without one (`TESTED`, `IMPLEMENTED`, `PARTIAL`) are listed as a todo until their owners fix them.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseCsv } from './helpers/csv.ts';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const root = new URL('../', import.meta.url);
const seedDir = new URL('seed/jurisdiction/', root);
const LINEAGES = new Map(
	readdirSync(seedDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map(({ name: lineage }) => {
			const dir = new URL(`${lineage}/`, seedDir);
			const collections = new Map<string, Obj[]>();
			for (const file of readdirSync(dir).filter((f) => /\.json(\.gz)?$/.test(f))) {
				const bytes = readFileSync(new URL(file, dir));
				const text = (file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
				collections.set(file.replace(/\.json(\.gz)?$/, ''), JSON.parse(text) as Obj[]);
			}
			return [lineage, collections] as const;
		})
);
/** The declaring source of each model and custom field, by directory name. */
const DECLARED = new Map<string, string>();
for (const kind of ['model', 'custom_field']) {
	const dir = new URL(`src/data/${kind}/`, root);
	for (const name of readdirSync(dir)) {
		const sub = new URL(`${name}/`, dir);
		const text = readdirSync(sub, { withFileTypes: true })
			.filter((f) => f.isFile())
			.map((f) => readFileSync(new URL(f.name, sub), 'utf8'))
			.join('\n');
		DECLARED.set(name, (DECLARED.get(name) ?? '') + text);
	}
}

// Relationship keys declare model foreign-key fields even when the model omits them.
const relationships = readFileSync(new URL('src/data/+relationship.ts', root), 'utf8');
for (const match of relationships.matchAll(/['"]([a-z_]+)\.([a-z_]+)['"]\s*:/g)) {
	const [, model, field] = match;
	if (DECLARED.has(model!)) DECLARED.set(model!, `${DECLARED.get(model!)}\n${field}`);
}

/** Heads a bare word names on its own, so it is never read as the previous token's continuation. */
const HEADS = new Set([
	'settings',
	...DECLARED.keys(),
	...[...LINEAGES.values()].flatMap((data) => [
		...data.keys(),
		...(data.get('jurisdiction_settings') ?? []).flatMap((v) => Object.keys(v))
	])
]);

const ID_FIELDS = ['key', 'code', 'name', 'label', 'table'];
const escape = (step: string) => step.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const glob = (step: string) => new RegExp(`^${escape(step).replace(/\*/g, '.*')}$`);
const isObj = (v: Json | undefined): v is Obj =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** One path step over every candidate value. */
function step(values: readonly Json[], name: string): Json[] {
	const match = glob(name);
	const out: Json[] = [];
	for (const v of values) {
		if (isObj(v)) for (const [k, x] of Object.entries(v)) if (match.test(k)) out.push(x);
		if (!Array.isArray(v)) {
			if (v === name) out.push(v);
			continue;
		}
		out.push(...v.filter((item) => typeof item === 'string' && match.test(item)));
		const items = v.filter(isObj);
		const named = items.filter((item) =>
			ID_FIELDS.some((f) => typeof item[f] === 'string' && match.test(item[f] as string))
		);
		out.push(
			...(named.length > 0 ? named : items.flatMap((item) => (name in item ? [item[name]!] : [])))
		);
	}
	return out;
}
const walk = (values: readonly Json[], steps: readonly string[]) => {
	let current = [...values];
	for (let index = 0; index < steps.length; index += 1) {
		let next = step(current, steps[index]!);
		// Stored labels may contain a decimal point; resolve their exact seeded spelling.
		let end = index;
		while (next.length === 0 && end + 1 < steps.length) {
			end += 1;
			next = step(current, steps.slice(index, end + 1).join('.'));
		}
		current = next;
		index = end;
	}
	return current;
};

/** Whether one token resolves in one lineage; `undefined` when its head names nothing the seeds or models know. */
function resolves(lineage: string, token: string): boolean | undefined {
	const data = LINEAGES.get(lineage)!;
	const [, head = token, sep = '', rest = ''] = /^([a-z_]+)([:.])(.*)$/.exec(token) ?? [];
	const steps = rest.split(/[.:]/).filter((s) => s !== '');
	if ((head === 'settings' || head === 'jurisdiction_settings') && sep === '.')
		return resolves(lineage, rest);
	if ((head === 'settings' || head === 'jurisdiction_settings') && sep === ':')
		return (data.get('jurisdiction_settings') ?? []).some((v) => v.code === steps[0]);
	const rows = data.get(head);
	if (rows !== undefined) {
		if (steps.length === 0) return true;
		if (sep === '.') return walk(rows, steps).length > 0;
		const code = glob(steps[0]!);
		const hit = rows.filter((r) =>
			['code', 'table'].some((f) => typeof r[f] === 'string' && code.test(r[f] as string))
		);
		return walk(hit, steps.slice(1)).length > 0;
	}
	const versions = (data.get('jurisdiction_settings') ?? []).filter((v) => head in v);
	if (versions.length > 0)
		return (
			walk(
				versions.map((v) => v[head]!),
				steps
			).length > 0
		);
	const source = DECLARED.get(head);
	if (source !== undefined)
		return steps.every((s) => new RegExp(`\\b${escape(s).replace(/\*/g, '\\w*')}\\b`).test(source));
	return undefined;
}

/** The tokens of one `config_path`, lists expanded and bare continuations completed. */
function tokens(path: string): string[] {
	const out: string[] = [];
	let previous: string | undefined;
	for (const raw of path.split(';')) {
		let token = raw.trim().split(/[\s(={[]/)[0]!;
		if (token === '' || token === 'none') continue;
		if (
			/^[A-Za-z0-9_*]+$/.test(token) &&
			!HEADS.has(token) &&
			previous !== undefined &&
			/[.:]/.test(previous)
		)
			token = previous.replace(/[^.:]+$/, token);
		previous = token;
		// each `A,B` / `A|B` step expands into one token per alternative
		let expanded = [''];
		for (const part of token.split(/([.:])/))
			expanded = expanded.flatMap((prefix) =>
				part.split(/[,|]/).flatMap((alt) => (alt === '' && part !== '' ? [] : [prefix + alt]))
			);
		out.push(...expanded);
	}
	return out;
}

// A locality profile (`CN-shanghai`) resolves in its jurisdiction's lineage (`CN`).
const lineagesOf = (profile: string) =>
	[...LINEAGES.keys()].filter(
		(l) => l === profile || l.split('-')[0] === profile || l === profile.split('-')[0]
	);

test('config_path tokens expand lists and continuations', () => {
	assert.deepEqual(tokens('statutory_contributions:CPF.elections.a; b; none'), [
		'statutory_contributions:CPF.elections.a',
		'statutory_contributions:CPF.elections.b'
	]);
	assert.deepEqual(tokens('statutory_contributions:EPF,SOCSO.assessed_on (x, y)'), [
		'statutory_contributions:EPF.assessed_on',
		'statutory_contributions:SOCSO.assessed_on'
	]);
	assert.deepEqual(tokens('statutory_contributions:JP;KESEHATAN'), [
		'statutory_contributions:JP',
		'statutory_contributions:KESEHATAN'
	]);
	assert.deepEqual(tokens('work_rules.holiday_rest_precedence=PUBLIC_HOLIDAY'), [
		'work_rules.holiday_rest_precedence'
	]);
	assert.deepEqual(tokens(''), []);
});

test('a token resolves only against what a lineage seeds', () => {
	const lineage = [...LINEAGES.keys()][0]!;
	const settings = LINEAGES.get(lineage)!.get('jurisdiction_settings')!;
	assert.equal(resolves(lineage, `settings:${String(settings[0]!.code)}`), true);
	assert.equal(resolves(lineage, 'settings:NO_SUCH_LINEAGE'), false);
	assert.equal(resolves(lineage, 'work_rules.no_such_rule_anywhere'), false);
	assert.equal(resolves(lineage, 'statutory_contributions:NO_SUCH_SCHEME'), false);
	assert.equal(resolves(lineage, 'no_such_head.anything'), undefined);
	assert.equal(resolves(lineage, 'payroll_runs.period'), true);
	assert.equal(resolves(lineage, 'payroll_runs.no_such_field_anywhere'), false);
});

/** Every unresolved token of the rows whose status is in `statuses`, as `file:line id token`. */
function unresolved(statuses: ReadonlySet<string>) {
	const out: string[] = [];
	const dir = new URL('docs/inventory/', root);
	for (const file of readdirSync(dir).filter((f) => f.endsWith('.csv'))) {
		const rows = parseCsv(readFileSync(new URL(file, dir), 'utf8'));
		const [header, ...body] = rows;
		const col = (name: string) => header!.indexOf(name);
		for (const [n, cells] of body.entries()) {
			const [id, profile, status, path] = ['id', 'profile', 'status', 'config_path'].map((h) =>
				(cells[col(h)] ?? '').trim()
			);
			if (!statuses.has(status!)) continue;
			const at = `${file}:${rows.lines[n + 1]} ${id}`;
			const lineages = lineagesOf(profile!);
			if (lineages.length === 0) {
				out.push(`${at}: profile ${profile} has no seeded lineage`);
				continue;
			}
			for (const token of tokens(path!)) {
				const results = lineages.map((l) => [l, resolves(l, token)] as const);
				if (results.every(([, r]) => r === undefined))
					out.push(`${at}: ${token} is not a settings key, catalogue code or fact key`);
				else
					for (const [l, r] of results)
						if (r !== true) out.push(`${at}: ${token} is not seeded in ${l}`);
			}
		}
	}
	return out;
}

test('configuration selectors resolve seeded band labels and vocabulary values exactly', () => {
	assert.equal(resolves('MY', 'leave_entries.episode_id'), true);
	assert.equal(resolves('MY', 'leave_entries.no_such_relationship'), false);
	assert.equal(resolves('TH', 'work_rules.bands:S65-OT-HOURLY-1.0X'), true);
	assert.equal(resolves('TH', 'work_rules.bands:NO_SUCH_BAND'), false);
	assert.equal(resolves('TH', 'payroll.vocabularies.work_classification:COMMISSION_SALES'), true);
	assert.equal(resolves('TH', 'payroll.vocabularies.work_classification:NO_SUCH_CLASS'), false);
});

test('every proven tracker row names configuration the seeds declare', () => {
	assert.deepEqual(unresolved(new Set(['VERIFIED', 'EXTERNAL-RECORDED'])), []);
});

test('every tested, implemented or partial tracker row names configuration the seeds declare', () => {
	assert.deepEqual(unresolved(new Set(['TESTED', 'IMPLEMENTED', 'PARTIAL'])), []);
});

/** Every declared FactKey (an object with a string `key` and `type`) anywhere under `value`. */
const factKeys = (value: Json): Obj[] =>
	Array.isArray(value)
		? value.flatMap(factKeys)
		: isObj(value)
			? [
					...(typeof value.key === 'string' && typeof value.type === 'string' ? [value] : []),
					...Object.values(value).flatMap(factKeys)
				]
			: [];

test('every coded fact key names a table its lineage seeds rows for', () => {
	const faults: string[] = [];
	for (const [lineage, data] of LINEAGES) {
		const tables = new Set([
			...(data.get('reference_rows') ?? []).map((r) => r.table),
			...(data.get('jurisdiction_settings') ?? []).flatMap((v) =>
				Array.isArray(v.tables) ? v.tables.filter(isObj).map((t) => t.name) : []
			)
		]);
		for (const [collection, rows] of data)
			for (const fact of factKeys(rows))
				if (fact.type === 'code' && !tables.has(fact.table ?? null))
					faults.push(
						`${lineage}/${collection}: fact ${String(fact.key)} names table ${String(fact.table)}, which has no rows`
					);
	}
	assert.deepEqual(faults, []);
});
