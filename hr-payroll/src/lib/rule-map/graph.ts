/**
 * The rule map of one settings version: every stored expression's reads, as one dependency graph
 * from the inputs (declared facts, site members, tables) through the rules and lines to the
 * scheme bases, the schemes and the payslip. Computed from the stored expressions alone; nothing
 * here knows a jurisdiction, a scheme or a line by name. Reserved engine lines (`BASE`,
 * `OVERTIME`, …) appear only where an expression or a band names them.
 */

import { assessedOnMentions } from '../expressions/compile.js';
import { CATALOGUE_WORDS } from '../expressions/contexts.js';
import {
	DECLARED_FACT_PREFIXES,
	expressionReads,
	expressionsIn,
	type DeclaredFactList
} from './reads.js';

export const NODE_KINDS = [
	'fact',
	'input',
	'table',
	'rule',
	'line',
	'base',
	'scheme',
	'check',
	'payslip'
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** Left-to-right column of each kind: inputs, rules, lines, bases, schemes and checks, the payslip. */
export const KIND_COLUMN: Readonly<Record<NodeKind, number>> = {
	fact: 0,
	input: 0,
	table: 0,
	rule: 1,
	line: 2,
	base: 3,
	scheme: 4,
	check: 4,
	payslip: 5
};

export type RuleNode = {
	readonly id: string;
	readonly kind: NodeKind;
	readonly label: string;
	/** The tracker `config_path`s that name this node (`statutory_contributions:<code>`). */
	readonly config: readonly string[];
	/** The stored expressions this node evaluates, with the field each sits at. */
	readonly expressions: readonly { readonly field: string; readonly expression: string }[];
};

export type RuleEdge = { readonly from: string; readonly to: string };

export type RuleMap = {
	readonly nodes: readonly RuleNode[];
	readonly edges: readonly RuleEdge[];
};

type Row = { readonly code: string; readonly name?: string | null | undefined };
type CatalogueRow = Row & {
	readonly counts_toward?: readonly string[] | null | undefined;
	readonly [field: string]: unknown;
};
type Scheme = Row & {
	readonly assessed_on?: string | null | undefined;
	readonly ordinary_on?: string | null | undefined;
	readonly base_when?: readonly { readonly when: string; readonly base: string }[] | null | undefined;
	readonly rules?: readonly Readonly<Record<string, unknown>>[] | null | undefined;
	readonly elections?: readonly Readonly<Record<string, unknown>>[] | null | undefined;
};
type Declared = readonly ({ readonly key: string; readonly label?: string | null | undefined } & Readonly<
	Record<string, unknown>
>)[];

export const CATALOGUE_COLLECTIONS = [
	'allowance_catalogue',
	'adhoc_catalogue',
	'claim_catalogue',
	'leave_catalogue',
	'loan_catalogue'
] as const;
export type CatalogueCollection = (typeof CATALOGUE_COLLECTIONS)[number];

/** Which catalogue each assessment word sums. */
const WORD_CATALOGUE: Readonly<Record<(typeof CATALOGUE_WORDS)[number], CatalogueCollection>> = {
	ALLOWANCES: 'allowance_catalogue',
	ADHOC: 'adhoc_catalogue',
	CLAIMS: 'claim_catalogue'
};

export type RuleMapInput = {
	readonly version: {
		readonly work_rules?: unknown;
		readonly payroll?: unknown;
		readonly tables?: readonly { readonly name: string; readonly label?: string | null }[] | null;
		readonly checks?:
			| readonly { readonly code: string; readonly at: string; readonly when?: string | null }[]
			| null;
	} & Partial<Readonly<Record<DeclaredFactList, Declared | null>>>;
	readonly schemes: readonly Scheme[];
	readonly catalogues: Partial<Readonly<Record<CatalogueCollection, readonly CatalogueRow[]>>>;
};

export const PAYSLIP = 'payslip';
export const factId = (list: string, key: string) => `fact:${list}:${key}`;
export const lineId = (code: string) => `line:${code}`;
export const schemeId = (code: string) => `scheme:${code}`;
export const baseId = (code: string) => `base:${code}`;
export const tableId = (name: string) => `table:${name}`;

const readsAnything = (expression: string) => {
	const read = expressionReads(expression);
	return (
		read.paths.length + read.tables.length + read.lines.length + read.produced.length + read.limits.length > 0
	);
};

export function ruleMap(input: RuleMapInput): RuleMap {
	const nodes = new Map<
		string,
		{ id: string; kind: NodeKind; label: string; config: string[]; expressions: RuleNode['expressions'][number][] }
	>();
	const edges = new Map<string, RuleEdge>();
	const node = (id: string, kind: NodeKind, label: string, config?: string) => {
		let found = nodes.get(id);
		if (found == null) {
			found = { id, kind, label, config: [], expressions: [] };
			nodes.set(id, found);
		}
		if (config != null && !found.config.includes(config)) found.config.push(config);
		return found;
	};
	const edge = (from: string, to: string) => {
		if (from !== to) edges.set(`${from}>${to}`, { from, to });
	};
	/**
	 * Record one expression on `target` and draw an edge from everything it reads. `quiet`: a value
	 * walked for expressions keeps only those that read something, so an enum value is not listed.
	 */
	const reads = (target: string, field: string, expression: string, quiet = false) => {
		const found = nodes.get(target)!;
		const read = expressionReads(expression);
		if (quiet && !readsAnything(expression)) return;
		found.expressions.push({ field, expression });
		for (const [list, key] of read.facts) edge(node(factId(list, key), 'fact', key, `${list}:${key}`).id, target);
		for (const path of read.inputs) edge(node(`input:${path}`, 'input', path).id, target);
		for (const name of read.tables)
			edge(node(tableId(name), 'table', name, `tables:${name}`).id, target);
		for (const code of read.lines) edge(node(lineId(code), 'line', code).id, target);
		for (const code of read.produced) edge(node(schemeId(code), 'scheme', code).id, target);
		if (read.limits.length > 0)
			edge(node('rule:work_rules.limits', 'rule', 'work_rules.limits', 'work_rules.limits').id, target);
	};

	const payslip = node(PAYSLIP, 'payslip', 'payslip').id;

	// Declared inputs, read or not: an input nothing reads is itself worth seeing.
	for (const [list] of DECLARED_FACT_PREFIXES)
		for (const [index, fact] of (input.version[list] ?? []).entries()) {
			const id = node(factId(list, fact.key), 'fact', fact.key, `${list}:${fact.key}`).id;
			for (const { field, expression } of expressionsIn(fact, `${list}[${index}]`))
				reads(id, field, expression, true);
			// a `code` input picks its value from a table
			if (typeof fact.table === 'string')
				edge(node(tableId(fact.table), 'table', fact.table, `tables:${fact.table}`).id, id);
		}
	for (const table of input.version.tables ?? [])
		node(tableId(table.name), 'table', table.name, `tables:${table.name}`);

	// Work rules and payroll settings: one rule node per top-level part; each band and derived line its own.
	for (const root of ['work_rules', 'payroll'] as const) {
		const value = input.version[root];
		if (value == null || typeof value !== 'object') continue;
		for (const [part, stored] of Object.entries(value)) {
			if (root === 'work_rules' && part === 'bands' && Array.isArray(stored)) {
				for (const [index, band] of (stored as Readonly<Record<string, unknown>>[]).entries()) {
					const label = String(band.label ?? index);
					const id = node(`rule:work_rules.bands:${label}`, 'rule', label, `work_rules.bands`).id;
					for (const { field, expression } of expressionsIn(band, `bands[${index}]`))
						reads(id, field, expression);
					const posts = band.component ?? band.line ?? 'OVERTIME';
					edge(id, node(lineId(String(posts)), 'line', String(posts)).id);
				}
				continue;
			}
			if (root === 'work_rules' && part === 'derived_lines' && Array.isArray(stored)) {
				for (const [index, line] of (stored as Readonly<Record<string, unknown>>[]).entries()) {
					const code = String(line.code);
					const id = node(lineId(code), 'line', code, 'work_rules.derived_lines').id;
					for (const { field, expression } of expressionsIn(line, `derived_lines[${index}]`))
						reads(id, field, expression);
					if (line.component != null) edge(id, node(lineId(String(line.component)), 'line', String(line.component)).id);
				}
				continue;
			}
			const found = expressionsIn(stored, `${root}.${part}`).filter(({ expression }) =>
				readsAnything(expression)
			);
			if (found.length === 0) continue;
			const id = node(`rule:${root}.${part}`, 'rule', `${root}.${part}`, `${root}.${part}`).id;
			for (const { field, expression } of found) reads(id, field, expression);
			edge(id, payslip);
		}
	}

	for (const collection of CATALOGUE_COLLECTIONS)
		for (const row of input.catalogues[collection] ?? []) {
			const id = node(lineId(row.code), 'line', row.code, `${collection}:${row.code}`).id;
			for (const { field, expression } of expressionsIn(row)) reads(id, field, expression, true);
		}

	for (const scheme of input.schemes) {
		const base = node(baseId(scheme.code), 'base', scheme.code).id;
		const charge = node(schemeId(scheme.code), 'scheme', scheme.code, `statutory_contributions:${scheme.code}`).id;
		nodes.get(charge)!.label = scheme.name ?? scheme.code;
		const baseExpressions: (readonly [string, string | null | undefined])[] = [
			['assessed_on', scheme.assessed_on],
			['ordinary_on', scheme.ordinary_on],
			...(scheme.base_when ?? []).flatMap((override, index) => [
				[`base_when[${index}].when`, override.when] as const,
				[`base_when[${index}].base`, override.base] as const
			])
		];
		for (const [field, expression] of baseExpressions) {
			if (expression == null || expression.trim() === '') continue;
			reads(base, field, expression);
			const mentions = assessedOnMentions(expression);
			for (const reserved of mentions.reserved) edge(node(lineId(reserved), 'line', reserved).id, base);
			for (const written of mentions.words) {
				const segments = written.split('.');
				const word = segments.at(-1) as (typeof CATALOGUE_WORDS)[number];
				const part = segments.filter((segment) => segment !== 'year').at(-2);
				for (const row of input.catalogues[WORD_CATALOGUE[word]] ?? [])
					if (
						(row.counts_toward ?? []).some((target) =>
							part == null
								? target === scheme.code || target.startsWith(`${scheme.code}.`)
								: target === `${scheme.code}.${part}`
						)
					)
						edge(lineId(row.code), base);
			}
		}
		edge(base, charge);
		for (const [index, rule] of (scheme.rules ?? []).entries())
			for (const { field, expression } of expressionsIn(rule, `rules[${index}]`)) reads(charge, field, expression);
		for (const [index, election] of (scheme.elections ?? []).entries())
			for (const { field, expression } of expressionsIn(election, `elections[${index}]`))
				reads(charge, field, expression);
	}

	for (const check of input.version.checks ?? []) {
		const id = node(`check:${check.code}`, 'check', check.code, `checks:${check.code}`).id;
		if (check.when != null && check.when !== '') reads(id, 'when', check.when);
		if (check.at === 'PAYSLIP') edge(id, payslip);
	}

	for (const found of nodes.values())
		if (found.kind === 'line' || found.kind === 'scheme') edge(found.id, payslip);

	return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Every node `id` depends on (`up`) or that depends on it (`down`), transitively, `id` excluded. */
export function reach(map: RuleMap, id: string, direction: 'up' | 'down'): ReadonlySet<string> {
	const next = new Map<string, string[]>();
	for (const { from, to } of map.edges) {
		const [key, value] = direction === 'up' ? [to, from] : [from, to];
		next.set(key, [...(next.get(key) ?? []), value]);
	}
	const seen = new Set<string>();
	const queue = [id];
	while (queue.length > 0)
		for (const neighbour of next.get(queue.pop()!) ?? [])
			if (!seen.has(neighbour) && neighbour !== id) {
				seen.add(neighbour);
				queue.push(neighbour);
			}
	return seen;
}

/** The nodes one edge away: what `id` reads (`up`) and what reads it (`down`). */
export function adjacent(map: RuleMap, id: string, direction: 'up' | 'down'): readonly string[] {
	return map.edges.flatMap(({ from, to }) =>
		direction === 'up' ? (to === id ? [from] : []) : from === id ? [to] : []
	);
}
