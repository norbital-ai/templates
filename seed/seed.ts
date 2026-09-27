import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { BankReader, FieldKind, SeedSource } from '@norbital-ai/bolt';
import { statutoryFactSummary, termsSummary } from '../src/lib/derived-titles.js';
import { leaveActivityOf } from '../src/lib/leave/activity-fields.js';
import * as Predicate from 'effect/Predicate';

/**
 * The sample pack: the template's public jurisdiction law (`seed/jurisdiction/<lineage>/<collection>.json[.gz]`) and
 * the bank tree's identity and entity records (`records/<entity>/<collection>.json`), read without rewriting either.
 * Rows are the template's model shapes of 0.0.0.x; the one conversion is to 0.0.1 kinds, field by field from each
 * model: `{ start, end }` ranges become `{ from, to }` periods (an end at UTC midnight is exclusive, a business-zone
 * end of day is inclusive, a year-9999 end is open), day instants become dates, `{ amount, currency }` money is split
 * into its amount and the row's currency field, and the three formerly generated fields are derived as SQL did.
 * A key no model field, relationship or system column takes is an error, never dropped.
 */

const ZONE = 'Asia/Kuala_Lumpur';
const ENTITIES = ['kdit', 'opsph', 'nihon', 'norbital', 'opssg'];

type Row = { [field: string]: unknown };
type Model = { fields: { [name: string]: FieldKind } };
const models = import.meta.glob<{ default: Model }>('../src/data/model/*/+model.ts', {
	eager: true
});
const relationships = import.meta.glob<{ default: Record<string, unknown> }>(
	'../src/data/+relationship.ts',
	{
		eager: true
	}
);
const MODELS = new Map(
	Object.entries(models).map(([path, m]) => [path.split('/').at(-2)!, m.default.fields] as const)
);
const FKS = new Set(Object.keys(Object.values(relationships)[0]?.default ?? {}));
const SYSTEM = new Set(['id', 'created_at', 'updated_at', 'created_by', 'updated_by']);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?Z$/;
const zoneDay = new Intl.DateTimeFormat('en-CA', {
	timeZone: ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});
const addDays = (day: string, n: number) =>
	new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A day column: a bare day, a UTC-midnight day instant, or an instant read in the business zone. */
function day(value: string): string {
	if (DAY.test(value)) return value;
	return MIDNIGHT.exec(value)?.[1] ?? zoneDay.format(new Date(value));
}
/** An inclusive `to`: open for the 9999 sentinel, the day before a half-open midnight end, else its day. */
function endDay(value: unknown): string | null {
	if (!Predicate.isString(value) || value === '' || value.startsWith('9999')) return null;
	const midnight = MIDNIGHT.exec(value);
	return midnight == null ? day(value) : addDays(midnight[1]!, -1);
}
function period(value: unknown, of: 'date' | 'instant') {
	if (!Predicate.isObjectOrArray(value)) return value;
	const v = value as { start?: string; end?: string | null; from?: string; to?: string | null };
	if (v.from !== undefined) return value;
	if (of === 'instant')
		return {
			start: v.start,
			end: Predicate.isString(v.end) && !v.end.startsWith('9999') ? v.end : null
		};
	return { from: day(v.start!), to: endDay(v.end) };
}

/**
 * The formerly generated columns, as their SQL composed them, and the values a transform sets on every write (a seed
 * is a restore and runs none): the empty lists and records, and a leave entry's activity.
 */
const DERIVED: { [collection: string]: (row: Row) => Row } = {
	companies: (row) => ({ facts: row.facts ?? {} }),
	company_facts: (row) => ({ facts: row.facts ?? {} }),
	jurisdiction_settings: (row) => ({
		facts: row.facts ?? [],
		exit_facts: row.exit_facts ?? [],
		obligations: row.obligations ?? []
	}),
	statutory_contributions: (row) => ({ elections: row.elections ?? [], parts: row.parts ?? [] }),
	employees: (row) => ({ children: row.children ?? [] }),
	leave_entries: (row) => ({
		activity: row.activity ?? leaveActivityOf(row as Parameters<typeof leaveActivityOf>[0])
	}),
	employment_terms: (row) => ({
		allowances: row.allowances ?? [],
		summary: termsSummary(row as Parameters<typeof termsSummary>[0])
	}),
	employment_statutory_facts: (row) => ({
		summary: statutoryFactSummary(
			row.status as Parameters<typeof statutoryFactSummary>[0],
			row.effective_range
		)
	}),
	loans: (row) => ({ effective_from: (row.effective_range as { from: string }).from })
};

function convert(collection: string, rows: readonly Row[]): Row[] {
	const fields = MODELS.get(collection);
	if (fields == null) throw new Error(`${collection}: no model of that name`);
	const unknown = new Set<string>();
	const out = rows.map((source) => {
		const row: Row = {};
		for (const [key, value] of Object.entries(source)) {
			const kind = fields[key];
			if (kind == null) {
				if (!SYSTEM.has(key) && !FKS.has(`${collection}.${key}`)) unknown.add(key);
				row[key] = value;
				continue;
			}
			if (value == null) row[key] = value;
			else if (kind.kind === 'period') row[key] = period(value, kind.of);
			else if (kind.kind === 'date') row[key] = day(String(value));
			else if (kind.kind === 'money' && Predicate.isObjectOrArray(value)) {
				// the bank writes `{ value, currency }`, the public law `{ amount, currency }`
				const money = value as { amount?: unknown; value?: unknown; currency: string };
				row[key] = money.amount ?? money.value;
				if (Predicate.isString(kind.currency) && kind.currency.length > 3)
					row[kind.currency] ??= money.currency;
			} else row[key] = value;
		}
		// a restore takes rows as given and a key absent from some rows of a batch lands as null: state the defaults
		for (const [key, kind] of Object.entries(fields))
			if (row[key] === undefined && 'default' in kind) row[key] = kind.default;
		return { ...row, ...(DERIVED[collection]?.(row) ?? {}) };
	});
	if (unknown.size > 0)
		throw new Error(
			`${collection}: no field takes ${[...unknown].map((k) => `'${k}'`).join(', ')}`
		);
	return out;
}

/** `contract_number` is a sequence per person and entity: the stints in start order. */
function numberContracts(rows: Row[]): Row[] {
	const seen = new Map<string, number>();
	return rows
		.toSorted((a, b) =>
			String((a.effective_range as { from: string }).from).localeCompare(
				(b.effective_range as { from: string }).from
			)
		)
		.map((row) => {
			const key = `${row.employee_id}:${row.company_id}`;
			const n = (seen.get(key) ?? 0) + 1;
			seen.set(key, n);
			return { ...row, contract_number: row.contract_number ?? n };
		});
}

/** The template's own public law, beside this file (the build imports this module from its cache). */
function lawRows(): { [collection: string]: Row[] } {
	const dir = fileURLToPath(
		new URL(['..', '..', 'seed', 'jurisdiction', ''].join('/'), import.meta.url)
	);
	const out: { [collection: string]: Row[] } = {};
	if (!existsSync(dir)) throw new Error(`the public law is not at ${dir}`);
	for (const lineage of readdirSync(dir).toSorted())
		for (const file of readdirSync(`${dir}${lineage}`).toSorted()) {
			const hit = /^([a-z_]+)\.json(\.gz)?$/.exec(file);
			if (hit == null) continue;
			const bytes = readFileSync(`${dir}${lineage}/${file}`);
			const rows: unknown = JSON.parse((hit[2] ? gunzipSync(bytes) : bytes).toString('utf8'));
			(out[hit[1]!] ??= []).push(...(rows as Row[]));
		}
	return out;
}

function bankRows(bank: BankReader): { [collection: string]: Row[] } {
	const out: { [collection: string]: Row[] } = {};
	for (const entity of ENTITIES)
		for (const file of bank.files(`records/${entity}`)) {
			const hit = /\/([a-z_]+)\.json$/.exec(file);
			if (hit == null) continue;
			(out[hit[1]!] ??= []).push(
				...bank.json<Row[]>(file).map((row) =>
					// the bank's marker for a number the source never gave
					hit[1] === 'companies' && row.registration_number === 'SOURCE_NOT_PROVIDED'
						? { ...row, registration_number: null }
						: row
				)
			);
		}
	return out;
}

export default {
	bank: 'norbital_hr',
	rows(bank) {
		const raw: { [collection: string]: Row[] } = {};
		for (const part of [lawRows(), bankRows(bank)])
			for (const [collection, rows] of Object.entries(part)) (raw[collection] ??= []).push(...rows);
		const rows = Object.fromEntries(
			Object.entries(raw).map(([collection, list]) => [collection, convert(collection, list)])
		);
		if (rows.employments != null) rows.employments = numberContracts(rows.employments);
		// the base pack is read over no bank: the public law alone, no identity
		if (!bank.has('user.json')) return rows as never;
		return {
			...rows,
			sys_team: bank
				.json<Row[]>('team.json')
				.map((row) => ({ id: row.id, name: row.name, parent: null })),
			sys_user: bank.json<Row[]>('user.json').map((row) => ({
				id: row.id,
				name: row.name,
				email: row.email ?? null,
				kind: 'staff',
				admin: row.status === 'admin',
				team: row.team_id ?? null
			}))
		} as never;
	},
	// the late-arrival chain re-plans itself from each run; the first admission starts it instead of the first midnight
	start: ['late_arrival_notice']
} satisfies SeedSource;
