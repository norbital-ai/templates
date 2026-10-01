/**
 * The settings linter: every stored expression and table of one settings version, judged as a
 * whole before it governs a payroll. The expression compiler judges one field against its site;
 * this reads the version together, which is where the faults that no single field shows live:
 *
 * - `type` — money times a percent never divided by 100, money mixed with a fraction, a date in
 *   arithmetic or compared with a number, a money field producing a percent (`units.ts`);
 * - `code` — a code compared with a value its table does not carry, a lookup keyed by a code of
 *   another table;
 * - `table` — `table()`/`band()` naming an undeclared table or the wrong shape; a declared table
 *   nothing reads; a percent column holding fractions;
 * - `band` — band rows whose seams leave a gap or a one-cent hole (`ladders.ts`);
 * - `cycle` — schemes that read each other's `produced.<code>` round a loop; a `produced` or
 *   `history` mention of a scheme the version does not have;
 * - `fact` — a declared input no expression reads, and a read of an input nobody declared;
 * - `unreachable` — a first-match rule an earlier rule always takes, or whose condition can never
 *   hold; a value between two rungs of one ladder that no rung matches;
 * - `rounding` — a money result computed by `*` or `/` and never rounded;
 * - `range` — table rows that leave days of their version uncovered or reach outside it, and
 *   (`lintLineage`) versions of one lineage that overlap or leave days no version governs;
 * - `floor` — `min()` of a company term and a statutory figure, so the term can undercut it.
 *
 * Errors are faults a run would trip over or silently misprice; warnings are what a reviewer
 * should look at. The seal refuses on the first error (`settingsLintFault`). Everything is pure
 * over the stored rows; nothing here knows a jurisdiction, a rate or a band.
 */

import type { SettingsVersionTree } from '../settings_clone.js';
import { DOCUMENT_TABLE, type FactKey } from '../datatypes/fact_keys.js';
import type { ReferenceTable } from '../datatypes/reference_tables.js';
import { CATALOGUE_WORDS, EXPRESSION_CONTEXTS } from '../expressions/contexts.js';
import { tableMentions } from '../expressions/functions/tables.js';
import { producedMentionsOf } from '../payroll/run/mentions.js';
import { governed, periodsOverlap, type Governed } from '../jurisdiction_settings.js';
import { addDays } from '../payroll/run/dates.js';
import { decodeNumber } from '../wire.js';
import { callArgs, callName, chainsOf, children, nodes, parse, textOf, type Node } from './ast.js';
import { bandSeams, ladderFindings } from './ladders.js';
import {
	DATE,
	FRACTION,
	MONEY,
	PERCENT,
	describeUnit,
	unitOf,
	type Unit,
	type UnitEnv
} from './units.js';
import * as Predicate from 'effect/Predicate';

export type LintRule =
	| 'type'
	| 'code'
	| 'table'
	| 'band'
	| 'cycle'
	| 'fact'
	| 'unreachable'
	| 'rounding'
	| 'range'
	| 'floor';

export type LintFinding = {
	readonly rule: LintRule;
	readonly severity: 'error' | 'warning';
	/** Where in the version: `scheme EPF rules[3].employee`, `settings work_rules.bands[0].when`. */
	readonly where: string;
	readonly message: string;
};

/** One version and every row under it: `readSettingsVersionTree`'s answer, or the seeded rows. */
export type LintTree = {
	readonly [K in keyof SettingsVersionTree]: K extends 'source' ? object : readonly object[];
};

const get = (row: object, key: string): unknown => Reflect.get(row, key);
const text = (row: object, key: string): string => {
	const value = get(row, key);
	return Predicate.isString(value) ? value : '';
};
const list = (row: object, key: string): readonly unknown[] => {
	const value = get(row, key);
	return Array.isArray(value) ? value : [];
};
const factsOf = (row: object, key: string): readonly FactKey[] =>
	list(row, key).filter((item): item is FactKey => Predicate.isObject(item));

// ---------------------------------------------------------------------------------------------
// What the contexts say about their members: dates, money, and codes of an engine-read table.

const person = (chain: readonly string[]) =>
	chain[0] === 'person' && chain.length > 1 ? chain.slice(1) : chain;
const segments = (path: string) =>
	person(path.replace(/\(.*$/, '').trim().split('.')).filter((part) => part !== '');
const FIELDS = Object.values(EXPRESSION_CONTEXTS).flatMap((context) => context.fields);

/** Context paths documented as a `YYYY-MM-DD` day. */
const DATE_PATHS = FIELDS.filter(
	(field) => !field.path.includes('(') && /YYYY-MM-DD/.test(field.description)
).map((field) => segments(field.path));

/** Context paths documented as a code of a named table: `a `X` code`, `a `X` table code`. */
const ENGINE_CODES = new Map(
	FIELDS.flatMap((field) => {
		const match = /`([A-Z][A-Z0-9_]*)` (?:table )?code/.exec(field.description);
		return match == null || field.path.includes('(')
			? []
			: [[segments(field.path).join('.'), match[1]!] as const];
	})
);
const ENGINE_TABLES = new Set(ENGINE_CODES.values());

/** Bare money names: the reserved lines, the catalogue words and the scheme's own base. */
const MONEY_BARE = new Set([
	...EXPRESSION_CONTEXTS.assessment.bare,
	...EXPRESSION_CONTEXTS.scheme.bare,
	'wage_floor'
]);

const matchesPath = (chain: readonly string[], pattern: readonly string[]) =>
	chain.length === pattern.length &&
	pattern.every((part, index) => part.startsWith('<') || part === chain[index]);

/** A member's unit by the naming the codebase keeps (`_amount` money, `_percent`, `_on` a day). */
function unitByName(name: string, dates: boolean): Unit | null {
	if (/(?:^|_)(?:percent|pct)$/.test(name)) return PERCENT;
	if (/(?:^|_)(?:fraction|ratio)$/.test(name)) return FRACTION;
	if (
		/(?:^|_)(?:amount|salary|wage|base|basic|gross|net)$/.test(name) ||
		['ordinary', 'wage_floor', 'fixed_allowances', 'ordinary_hour', 'ordinary_day'].includes(name)
	)
		return MONEY;
	if (dates && (name === 'date' || /_(?:date|on)$/.test(name))) return DATE;
	return null;
}

function unitOfFact(field: FactKey): Unit | null {
	if (field.type === 'date') return DATE;
	if (field.type === 'code') return { dim: 'text', pct: 0, table: field.table ?? undefined };
	if (field.type === 'boolean') return { dim: 'bool', pct: 0 };
	if (field.type === 'number') return unitByName(field.key, false);
	return { dim: 'text', pct: 0 };
}

// ---------------------------------------------------------------------------------------------
// Every stored expression, found by walking the rows, never by a list of fields to remember.

/** Row columns that are bookkeeping, dates or prose, never an expression. */
const SKIP = new Set([
	'id',
	'settings_id',
	'cloned_from_id',
	'sealed_at',
	'voided_at',
	'void_reason',
	'created_at',
	'updated_at',
	'created_by',
	'updated_by',
	'revision',
	'approval_id',
	'effective_range',
	'sources',
	'change_summary'
]);
/** Keys whose string is a name, a code, an enum or prose. */
const PROSE = new Set([
	'label',
	'description',
	'authority',
	'message',
	'validation_message',
	'name',
	'owner',
	'timing',
	'trigger',
	'provision',
	'url',
	'source',
	'pattern',
	'reference_label',
	'timezone',
	'short_name',
	'child_claims_hint',
	'refusal',
	'warning',
	'code',
	'table',
	'key',
	'type',
	'place',
	'worksite',
	'currency',
	'lineage',
	'document',
	'parent_fact',
	'exception_fact',
	'region_fact',
	'reclassified_fact',
	'rate_key'
]);

type ExpressionType = 'boolean' | 'money' | 'date';

/** A field's required result, by the naming the datatypes keep; null is untyped (read for mentions). */
function typeOf(key: string, parent: string): ExpressionType | null {
	if (key === 'when' || key.endsWith('_when') || key === 'eligibility' || key === 'holds')
		return 'boolean';
	if (key === 'due' || key === 'advance_due') return 'date';
	if (
		[
			'employee',
			'employer',
			'rebate',
			'deduction',
			'price_amount',
			'day_amount',
			'late_charge',
			'assessed_on',
			'ordinary_on',
			'base',
			'award',
			'wage',
			'employer_pays',
			'reimbursable',
			'amount',
			'hourly_rate',
			'hourly_rate_excluded'
		].includes(key) ||
		(parent === 'ordinary_rate' && (key === 'hour' || key === 'day'))
	)
		return 'money';
	return null;
}

/** Money a pay line or a charge settles, so it must be rounded; a rate, a cap or a base is not. */
const ROUNDED = new Set([
	'employee',
	'employer',
	'price_amount',
	'day_amount',
	'late_charge',
	'award',
	'wage',
	'employer_pays',
	'amount'
]);

type Scope = {
	readonly schemeCode?: string | undefined;
	readonly elections?: readonly FactKey[] | undefined;
	readonly eventFacts?: readonly FactKey[] | undefined;
	readonly requestFacts?: readonly FactKey[] | undefined;
};

type Located = {
	readonly where: string;
	readonly type: ExpressionType | null;
	readonly rounded: boolean;
	readonly text: string;
	readonly ast: Node;
	readonly scope: Scope;
};

const FAMILIES = [
	['schemes', 'scheme'],
	['catalogueLeaves', 'leave'],
	['loanCatalogue', 'loan'],
	['claimCatalogue', 'claim'],
	['adhocCatalogue', 'ad hoc'],
	['allowanceCatalogue', 'allowance catalogue']
] as const;

function collect(tree: LintTree) {
	const expressions: Located[] = [];
	/** Every string the version stores outside a declaration's own `key`: a name read by config. */
	const strings = new Set<string>();
	/** Every table a `code` declaration or an evidence document names. */
	const codeTables = new Set<string>();
	const walk = (value: unknown, path: string, key: string, parent: string, scope: Scope) => {
		if (Predicate.isString(value)) {
			// a declaration's own name is not a read of it
			if (key !== 'key' && !(key === 'name' && parent === 'tables')) strings.add(value);
			if (PROSE.has(key) && !(key === 'name' && parent === 'format')) return;
			const type = typeOf(key, parent);
			const ast = parse(value);
			if (ast == null || ast.op === 'value' || (ast.op === 'id' && type == null)) return;
			expressions.push({
				where: path,
				type,
				rounded: ROUNDED.has(key) && parent !== 'limit',
				text: value,
				ast,
				scope
			});
			return;
		}
		if (Array.isArray(value)) {
			value.forEach((item, index) => walk(item, `${path}[${index}]`, key, parent, scope));
			return;
		}
		if (!Predicate.isObject(value)) return;
		if (get(value, 'type') === 'code' && Predicate.isString(get(value, 'table')))
			codeTables.add(text(value, 'table'));
		if (
			Predicate.isObject(get(value, 'evidence')) &&
			get(get(value, 'evidence') as object, 'document') != null
		)
			codeTables.add(DOCUMENT_TABLE);
		for (const [child, item] of Object.entries(value))
			if (!SKIP.has(child)) walk(item, path === '' ? child : `${path}.${child}`, child, key, scope);
	};
	walk(tree.source, 'settings', '', '', {});
	for (const [family, noun] of FAMILIES)
		for (const row of tree[family]) {
			const scope: Scope =
				family === 'schemes'
					? { schemeCode: text(row, 'code'), elections: factsOf(row, 'elections') }
					: family === 'catalogueLeaves'
						? { eventFacts: factsOf(row, 'event_facts') }
						: { requestFacts: factsOf(row, 'request_facts') };
			walk(row, `${noun} ${text(row, 'code')}`, '', '', scope);
		}
	return { expressions, strings, codeTables };
}

// ---------------------------------------------------------------------------------------------
// Declared inputs: which root reads which list.

const VERSION_LISTS = [
	['facts', [['company', 'facts']]],
	['exit_facts', [['employment', 'exit_facts']]],
	[
		'terms_facts',
		[
			['terms', 'facts'],
			['before', 'facts'],
			['after', 'facts']
		]
	],
	['work_day_facts', [['day_facts']]],
	['payment_facts', [['payment', 'facts']]],
	['settlement_facts', [['settlement', 'facts']]],
	['person_facts', [['employee', 'facts']]],
	['worksite_facts', [['worksite', 'facts']]]
] as const;
const ROW_LISTS = [
	// `event.facts` is the obligation site's triggering record, not a leave row's inputs
	['event_facts', 'eventFacts', [['leave', 'facts']]],
	['request_facts', 'requestFacts', [['entry', 'facts']]]
] as const;
const SCHEME_FACT_MEMBERS = new Set([
	'registered',
	'since',
	'since_months',
	'elections',
	'election_keys'
]);
const HISTORY_METHODS = new Set(['slips', 'days', 'leave', 'terms', 'external']);

const startsWith = (chain: readonly string[], root: readonly string[]) =>
	chain.length > root.length && root.every((part, index) => chain[index] === part);

type Resolved =
	| {
			readonly kind: 'declared';
			readonly list: string;
			readonly key: string;
			readonly field: FactKey;
	  }
	| { readonly kind: 'undeclared'; readonly message: string }
	| null;

// ---------------------------------------------------------------------------------------------
// Tables.

type TableRow = {
	readonly table: string;
	readonly code: string;
	readonly days: Governed | null;
	readonly from: number | null;
	readonly to: number | null;
	readonly values: Readonly<Record<string, unknown>>;
	readonly cells: (column: string) => unknown;
};

const bound = (value: unknown): number | null =>
	value == null || value === '' ? null : decodeNumber(value);

function tableRows(rows: readonly object[]): readonly TableRow[] {
	return rows.map((row) => {
		const stored = get(row, 'values');
		const values = Predicate.isObject(stored) ? stored : {};
		return {
			table: text(row, 'table'),
			code: text(row, 'code'),
			days: governed(get(row, 'effective_range')),
			from: bound(get(row, 'range_from')),
			to: bound(get(row, 'range_to')),
			values,
			cells: (column) =>
				column === 'code' || column === 'parent_code' || column === 'label'
					? get(row, column)
					: values[column]
		};
	});
}

/** The days of `span` no range covers, as inclusive spans; `span.to` null is open. */
function uncovered(span: Governed, ranges: readonly Governed[]): Governed[] {
	const holes: Governed[] = [];
	let next: string | null = span.from;
	for (const range of ranges.toSorted((a, b) => a.from.localeCompare(b.from))) {
		if (next == null) break;
		if (span.to != null && range.from > span.to) break;
		if (range.from > next) holes.push({ from: next, to: addDays(range.from, -1) });
		if (range.to == null) next = null;
		else if (range.to >= next) next = addDays(range.to, 1);
	}
	if (next != null && (span.to == null || next <= span.to)) holes.push({ from: next, to: span.to });
	return holes;
}
const spanText = (span: Governed) => `${span.from} to ${span.to ?? 'open'}`;

// ---------------------------------------------------------------------------------------------

/** Every finding on one version: errors first, then warnings, each in the order found. */
export function lintSettingsVersion(tree: LintTree): readonly LintFinding[] {
	const out: LintFinding[] = [];
	const push = (
		rule: LintRule,
		severity: LintFinding['severity'],
		where: string,
		message: string
	) => out.push({ rule, severity, where, message });
	const { expressions, strings, codeTables } = collect(tree);
	const source = tree.source;
	const versionDays = governed(get(source, 'effective_range'));
	const declarations = list(source, 'tables').filter((item): item is ReferenceTable =>
		Predicate.isObject(item)
	);
	const rows = tableRows(tree.referenceRows);
	const schemes = new Map(tree.schemes.map((row) => [text(row, 'code'), row]));
	const versionLists = new Map(VERSION_LISTS.map(([name]) => [name, factsOf(source, name)]));
	const rowUnion = new Map(
		ROW_LISTS.map(([name]) => [
			name,
			[...tree.catalogueLeaves, ...tree.claimCatalogue, ...tree.adhocCatalogue].flatMap((row) =>
				factsOf(row, name)
			)
		])
	);
	/** Keys read, by list; a scheme's elections as `<CODE>.<key>`. */
	const reads = new Map<string, Set<string>>();
	const read = (listName: string, key: string) =>
		reads.set(listName, (reads.get(listName) ?? new Set()).add(key));
	const literals = new Set<string>();

	const resolve = (chain: readonly string[], scope: Scope): Resolved => {
		const member = person(chain);
		/** The input `member[depth]` names in `fields`. */
		const find = (listName: string, fields: readonly FactKey[], depth: number) => {
			const key = member[depth]!;
			const field = fields.find((candidate) => candidate.key === key);
			if (field == null)
				return {
					kind: 'undeclared',
					message: `reads ${member.slice(0, depth + 1).join('.')}, which is not declared.`
				} as const;
			read(listName, key);
			return { kind: 'declared', list: listName, key, field } as const;
		};
		for (const [name, roots] of VERSION_LISTS)
			for (const root of roots)
				if (startsWith(member, root)) return find(name, versionLists.get(name)!, root.length);
		for (const [name, option, roots] of ROW_LISTS)
			for (const root of roots)
				if (startsWith(member, root))
					return find(name, scope[option] ?? rowUnion.get(name)!, root.length);
		if (startsWith(member, ['scheme', 'elections']) && scope.elections != null) {
			const found = find('elections', scope.elections, 2);
			if (found.kind === 'declared') read('elections', `${scope.schemeCode}.${found.key}`);
			return found;
		}
		if (member[0] === 'facts' && member.length > 2 && SCHEME_FACT_MEMBERS.has(member[2]!)) {
			const scheme = schemes.get(member[1]!);
			if (scheme == null)
				return {
					kind: 'undeclared',
					message: `reads facts.${member[1]}, but this version has no scheme ${member[1]}.`
				};
			if (member[2] === 'elections' && member[3] != null) {
				const found = find('elections', factsOf(scheme, 'elections'), 3);
				if (found.kind === 'declared') read('elections', `${member[1]}.${found.key}`);
				return found;
			}
		}
		return null;
	};

	const codesOf = new Map<string, Set<string>>();
	for (const row of rows)
		codesOf.set(row.table, (codesOf.get(row.table) ?? new Set()).add(row.code));
	const declaration = (name: string) => declarations.find((table) => table.name === name);

	const envFor = (scope: Scope, where: string, silent = false): UnitEnv => ({
		member: (chain) => {
			const resolved = resolve(chain, scope);
			if (resolved?.kind === 'declared') return unitOfFact(resolved.field);
			if (resolved != null) return null;
			const member = person(chain);
			const last = member.at(-1) ?? '';
			if (member.length === 1 && MONEY_BARE.has(last)) return MONEY;
			if ((CATALOGUE_WORDS as readonly string[]).includes(last)) return MONEY;
			if (member[0] === 'produced' && member.length === 3) return MONEY;
			if (DATE_PATHS.some((pattern) => matchesPath(member, pattern))) return DATE;
			if (member[0] === 'period' && member.length === 2 && ['start', 'end'].includes(last))
				return DATE;
			const table = ENGINE_CODES.get(member.join('.'));
			if (table != null) return { dim: 'text', pct: 0, table };
			return unitByName(last, true);
		},
		column: (name, column) => {
			const table = declaration(name);
			if (table == null) return null;
			if (column === 'code') return { dim: 'text', pct: 0, table: name };
			const field = table.columns.find((candidate) => candidate.key === column);
			return field == null ? null : unitOfFact(field);
		},
		keyTables: (name) => {
			const table = declaration(name);
			return table == null
				? null
				: table.keys.map((key) => {
						if (key === 'code') return name;
						const field = table.columns.find((candidate) => candidate.key === key);
						return field?.type === 'code' ? (field.table ?? null) : null;
					});
		},
		codes: (name) => codesOf.get(name) ?? null,
		report: (rule, message) => {
			if (!silent) push(rule, 'error', where, message);
		}
	});

	// Expressions: units, declared inputs, tables, schemes, rounding, floors.
	const tablesRead = new Set<string>();
	const edges = new Map<string, Set<string>>();
	for (const expression of expressions) {
		const { where, scope, ast } = expression;
		for (const node of nodes(ast))
			if (node.op === 'value' && Predicate.isString(node.args)) literals.add(node.args);
		const seen = new Set<string>();
		for (const chain of chainsOf(ast)) {
			const resolved = resolve(chain, scope);
			if (resolved?.kind === 'undeclared' && !seen.has(resolved.message)) {
				seen.add(resolved.message);
				push('fact', 'error', where, `The expression ${resolved.message}`);
			}
			const member = person(chain);
			if (
				member[0] === 'history' &&
				member.length > 2 &&
				!HISTORY_METHODS.has(member[1]!) &&
				!schemes.has(member[1]!)
			)
				push(
					'cycle',
					'error',
					where,
					`history.${member[1]} names a scheme this version does not have.`
				);
		}
		for (const code of producedMentionsOf(expression.text)) {
			if (!schemes.has(code))
				push(
					'cycle',
					'error',
					where,
					`produced.${code} names a scheme this version does not have.`
				);
			else if (scope.schemeCode != null)
				edges.set(scope.schemeCode, (edges.get(scope.schemeCode) ?? new Set()).add(code));
		}
		for (const { fn, name } of tableMentions(expression.text)) {
			tablesRead.add(name);
			const table = declaration(name);
			if (table == null)
				push(
					'table',
					'error',
					where,
					`${fn}('${name}') names a table this version does not declare.`
				);
			else if (fn === 'table' && table.range != null)
				push(
					'table',
					'error',
					where,
					`table('${name}') reads a band table; use band('${name}', value, …).`
				);
			else if (fn === 'band' && table.range == null)
				push(
					'table',
					'error',
					where,
					`band('${name}', …) reads a table without a range; use table('${name}', …).`
				);
		}
		const result = unitOf(envFor(scope, where), ast);
		const type = expression.type;
		if (type === 'money') {
			if (result.dim === 'money' && result.pct !== 0)
				push(
					'type',
					'error',
					where,
					result.pct > 0
						? 'The money result is money times a percent: divide the percent by 100.'
						: 'The money result divides money by a percent.'
				);
			else if ((result.dim === 'ratio' && result.pct > 0) || result.dim === 'date')
				push('type', 'error', where, `A money field produces ${describeUnit(result)}.`);
		} else if (type === 'boolean' && ['money', 'ratio', 'date'].includes(result.dim))
			push('type', 'error', where, `A condition produces ${describeUnit(result)}, not a boolean.`);
		else if (type === 'date' && (result.dim === 'money' || result.dim === 'ratio'))
			push('type', 'error', where, `A date field produces ${describeUnit(result)}.`);
		if (expression.rounded && !isRounded(ast))
			push(
				'rounding',
				'warning',
				where,
				"The money result is computed with `*` or `/` and never rounded: wrap it in round(value, step, 'MODE')."
			);
		for (const node of nodes(ast)) {
			const pair = minimumOf(node);
			if (pair == null) continue;
			const company = pair.find(readsCompanyTerm);
			const statutory = pair.find((side) => side !== company && readsFloor(side));
			if (company != null && statutory != null)
				push(
					'floor',
					'warning',
					where,
					`${textOf(company)} can undercut ${textOf(statutory)}: the smaller of a company term and a statutory floor is taken. A floor is max().`
				);
		}
	}

	// Scheme cycles: `produced.<code>` edges round a loop.
	const reported = new Set<string>();
	const visit = (code: string, path: readonly string[]) => {
		const at = path.indexOf(code);
		if (at >= 0) {
			const cycle = path.slice(at);
			const key = cycle.toSorted().join(',');
			if (!reported.has(key)) {
				reported.add(key);
				push(
					'cycle',
					'error',
					`scheme ${code}`,
					`Schemes read each other's results in a loop: ${[...cycle, code].join(' → ')}.`
				);
			}
			return;
		}
		for (const next of edges.get(code) ?? []) visit(next, [...path, code]);
	};
	for (const code of edges.keys()) visit(code, []);

	// First-match ladders: scheme rules, base overrides, catalogue bands.
	const moneyEnv = envFor({}, '', true);
	const ladder = (where: string, whens: readonly string[], noun: string) => {
		for (const finding of ladderFindings(whens, (node) => unitOf(moneyEnv, node).dim === 'money'))
			push(
				'unreachable',
				'warning',
				`${where}[${finding.index}].when`,
				`${noun} ${finding.index + 1}: ${finding.message}`
			);
	};
	const whensOf = (items: readonly unknown[]) =>
		items.map((item) => (Predicate.isObject(item) ? text(item, 'when') : ''));
	for (const scheme of tree.schemes) {
		const code = text(scheme, 'code');
		ladder(`scheme ${code} rules`, whensOf(list(scheme, 'rules')), 'Rule');
		ladder(`scheme ${code} base_when`, whensOf(list(scheme, 'base_when')), 'Override');
	}
	for (const [family, noun] of FAMILIES)
		if (family !== 'schemes' && family !== 'catalogueLeaves')
			for (const row of tree[family])
				ladder(`${noun} ${text(row, 'code')} bands`, whensOf(list(row, 'bands')), 'Band');

	// Declared inputs nobody reads.
	const unread = (listName: string, key: string, readKey = key) =>
		!(reads.get(listName)?.has(readKey) ?? false) && !strings.has(key) && !literals.has(key);
	for (const [name, fields] of versionLists)
		for (const field of fields)
			if (unread(name, field.key))
				push(
					'fact',
					'warning',
					`settings ${name}.${field.key}`,
					`${field.key} is declared but no expression or setting reads it.`
				);
	for (const scheme of tree.schemes)
		for (const field of factsOf(scheme, 'elections'))
			if (unread('elections', field.key, `${text(scheme, 'code')}.${field.key}`))
				push(
					'fact',
					'warning',
					`scheme ${text(scheme, 'code')} elections.${field.key}`,
					`${field.key} is declared but no expression reads it.`
				);
	for (const [name] of ROW_LISTS)
		for (const key of new Set(rowUnion.get(name)!.map((field) => field.key)))
			if (unread(name, key))
				push('fact', 'warning', `${name}.${key}`, `${key} is declared but no expression reads it.`);

	// Tables: read, filled, typed, banded and dated.
	for (const table of declarations) {
		const where = `table ${table.name}`;
		const own = rows.filter((row) => row.table === table.name);
		const readSomewhere =
			tablesRead.has(table.name) ||
			codeTables.has(table.name) ||
			ENGINE_TABLES.has(table.name) ||
			strings.has(table.name);
		if (!readSomewhere)
			push('table', 'warning', where, 'The table is declared but nothing reads it.');
		if (own.length === 0) push('table', 'warning', where, 'The table is declared but has no rows.');
		for (const column of table.columns) {
			const unit = column.type === 'number' ? unitByName(column.key, false) : null;
			if (unit?.dim !== 'ratio') continue;
			const values = own.map((row) => row.values[column.key]).filter(Predicate.isNumber);
			if (
				unit.pct > 0 &&
				values.length > 0 &&
				values.every((value) => value <= 1) &&
				values.some((value) => value > 0)
			)
				push(
					'table',
					'warning',
					`${where}.${column.key}`,
					'A percent column holds only values of at most 1, which read as fractions.'
				);
			if (unit.pct === 0 && values.some((value) => value > 1))
				push(
					'table',
					'warning',
					`${where}.${column.key}`,
					'A fraction column holds a value above 1; a percent column is named `_percent`.'
				);
		}
		const groups = Map.groupBy(own, (row) =>
			JSON.stringify(table.keys.map((key) => row.cells(key) ?? null))
		);
		for (const [keys, group] of groups) {
			const label = table.keys.length === 0 ? where : `${where} ${keys}`;
			if (table.range != null) {
				const messages = new Set<string>();
				for (const day of new Set(
					group.flatMap((row) => (row.days == null ? [] : [row.days.from]))
				))
					for (const message of bandSeams(
						table.range,
						group.filter(
							(row) =>
								row.days != null &&
								row.days.from <= day &&
								(row.days.to == null || day <= row.days.to)
						)
					))
						messages.add(message);
				for (const message of messages) push('band', 'error', label, message);
			}
			const ranges = group.flatMap((row) => (row.days == null ? [] : [row.days]));
			if (versionDays == null || ranges.length === 0) continue;
			for (const row of group)
				if (
					row.days != null &&
					(row.days.from < versionDays.from ||
						(versionDays.to != null && (row.days.to == null || row.days.to > versionDays.to)))
				)
					push(
						'range',
						'warning',
						`${label} ${row.code}`,
						`The row is in force ${spanText(row.days)}, outside its version (${spanText(versionDays)}).`
					);
			// A keyless table (one row, or one set of bands) covers its version; a keyed row only its own
			// days, so between two rows of one key is the only hole it can have.
			const froms = ranges.map((range) => range.from).toSorted();
			const tos = ranges.map((range) => range.to);
			const span: Governed =
				table.keys.length === 0
					? versionDays
					: {
							from: froms[0]!,
							to: tos.includes(null) ? null : (tos as string[]).toSorted().at(-1)!
						};
			for (const hole of uncovered(span, ranges))
				push(
					'range',
					'warning',
					label,
					`No row is in force ${spanText(hole)}${table.keys.length === 0 ? ' inside its version' : ' between its rows'}.`
				);
		}
	}
	return out.toSorted(
		(a, b) => Number(a.severity === 'warning') - Number(b.severity === 'warning')
	);
}

/** The first error of a version, as the sentence a seal refuses with; null where it has none. */
export function settingsLintFault(tree: LintTree): string | null {
	const error = lintSettingsVersion(tree).find((finding) => finding.severity === 'error');
	return error == null ? null : `${error.where}: ${error.message}`;
}

/**
 * The versions of each lineage that govern (sealed, never voided): two covering one day overlap,
 * a day between two versions that none covers is a hole a run on it cannot price, and a last
 * version that ends leaves every later day ungoverned.
 */
export function lintLineage(versions: readonly object[]): readonly LintFinding[] {
	const out: LintFinding[] = [];
	const live = versions.filter(
		(version) =>
			get(version, 'sealed_at') != null &&
			get(version, 'voided_at') == null &&
			get(version, 'approval_id') == null
	);
	for (const [code, group] of Map.groupBy(live, (version) => text(version, 'code'))) {
		const dated = group
			.flatMap((version) => {
				const days = governed(get(version, 'effective_range'));
				return days == null ? [] : [{ name: text(version, 'name'), days }];
			})
			.toSorted((a, b) => a.days.from.localeCompare(b.days.from));
		for (const [index, version] of dated.entries()) {
			const prior = dated[index - 1];
			if (prior == null) continue;
			if (periodsOverlap(prior.days, version.days))
				out.push({
					rule: 'range',
					severity: 'error',
					where: `lineage ${code}`,
					message: `${prior.name} (${spanText(prior.days)}) and ${version.name} (${spanText(version.days)}) both govern the same days.`
				});
			else if (prior.days.to != null && addDays(prior.days.to, 1) < version.days.from)
				out.push({
					rule: 'range',
					severity: 'error',
					where: `lineage ${code}`,
					message: `No version governs ${addDays(prior.days.to, 1)} to ${addDays(version.days.from, -1)}, between ${prior.name} and ${version.name}.`
				});
		}
		const last = dated.at(-1);
		if (last?.days.to != null)
			out.push({
				rule: 'range',
				severity: 'warning',
				where: `lineage ${code}`,
				message: `The last version, ${last.name}, ends ${last.days.to}; no version governs after it.`
			});
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// Tree predicates.

/** Whether a money tree ends on a rounded or stored figure: a sum of rounded parts is rounded. */
function isRounded(node: Node): boolean {
	const name = callName(node);
	if (name != null) {
		if (name === 'min' || name === 'max') return callArgs(node).every(isRounded);
		return true;
	}
	if (node.op === '*' || node.op === '/') return false;
	if (node.op === '?:') return children(node).slice(1).every(isRounded);
	if (node.op === '+' || node.op === '-' || node.op === '-_')
		return children(node).every(isRounded);
	return true;
}

/** The two sides a node keeps the smaller of: `min(a, b)`, or `a < b ? a : b`. */
function minimumOf(node: Node): readonly Node[] | null {
	if (callName(node) === 'min') return callArgs(node);
	if (node.op !== '?:') return null;
	const [condition, yes, no] = children(node);
	if (condition == null || yes == null || no == null) return null;
	const [left, right] = children(condition);
	if (left == null || right == null) return null;
	const same = (a: Node, b: Node) => textOf(a) === textOf(b);
	if ((condition.op === '<' || condition.op === '<=') && same(yes, left) && same(no, right))
		return [left, right];
	if ((condition.op === '>' || condition.op === '>=') && same(yes, right) && same(no, left))
		return [left, right];
	return null;
}

const COMPANY_ROOTS = new Set(['terms', 'contract', 'entry', 'before', 'after']);
const readsCompanyTerm = (node: Node): boolean =>
	chainsOf(node).some((chain) => {
		const member = person(chain);
		return COMPANY_ROOTS.has(member[0]!) || (member[0] === 'company' && member[1] === 'facts');
	});
/**
 * A statutory floor: `minimum_wage()`, or a member or table column named for a floor or minimum.
 * A ceiling (`min(terms.salary, table('CAP').amount)`) is not one: capping a term is lawful.
 */
const FLOOR = /floor|minimum/;
const readsFloor = (node: Node): boolean =>
	[...nodes(node)].some((part) => {
		if (callName(part) === 'minimum_wage') return true;
		if (part.op === 'id') return Predicate.isString(part.args) && FLOOR.test(part.args);
		const property =
			part.op === '.' || part.op === '.?' ? (part.args as readonly unknown[])[1] : null;
		return Predicate.isString(property) && FLOOR.test(property);
	});
