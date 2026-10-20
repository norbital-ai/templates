import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Cause, Effect, Exit, Layer, Schema } from 'effect';
import { TestWorkspace, type KitFailure } from '@norbital-ai/bolt/test';
import { seed } from '@norbital-ai/bolt/engine';
import { addDays } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Reads, readsFrom, type CallerRead } from '../src/lib/payroll_engine/foundation.js';
import { buildPayrollRun } from '../src/lib/payroll_engine/run.js';
import type { PayrollRunKind } from '../src/lib/payroll_engine/payslip/context.js';
import { readSeedRows } from './seed_values.js';
import { workspace } from './kit.js';
import relationships from '../src/data/+relationship.js';
import { SNAPSHOT_MODELS } from '../src/lib/payroll_engine/statutory_snapshot.js';
import settingsModel from '../src/data/model/+jurisdiction_settings.model.js';
import { fixtureRows } from './fixture_values.js';

export type Row = Record<string, unknown>;
export type Tables = Map<string, Row[]>;
export const CATALOGS = [
	'statutory_contribution_catalog',
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog',
	'allowance_catalog',
	'work_catalog'
] as const;
export const TABLES = ['jurisdiction_settings', 'rule_set', ...CATALOGS] as const;
export type Table = (typeof TABLES)[number] | 'suspension_kind';
export const SEED = resolve(process.cwd(), 'seed/jurisdiction');
export const LINEAGES = readdirSync(SEED)
	.filter((name) => existsSync(resolve(SEED, name, 'version_1')))
	.sort();
export const nextDay = (day: string): string => addDays(day, 1);

export function lineage(code: string) {
	const root = resolve(SEED, code);
	const rows = (version: string, table: string) => readSeedRows(resolve(root, version), table);
	const versions = readdirSync(root)
		.filter((name) => /^version_\d+$/.test(name))
		.filter((name) => rows(name, 'jurisdiction_settings')[0]?.['voided_at'] == null)
		.toSorted((left, right) => {
			const from = (name: string) => {
				const range = rows(name, 'jurisdiction_settings')[0]?.['effective_range'];
				return Schema.is(Schema.Record(Schema.String, Schema.Json))(range)
					? String(range['from'])
					: '';
			};
			return from(left).localeCompare(from(right));
		});
	const settingsOf = (version: string): Row => {
		const [settings] = rows(version, 'jurisdiction_settings');
		assert.ok(settings, `${code}/${version} has its settings row`);
		return settings;
	};
	const byCode = (version: string, table: string, wanted: string) => {
		const row = rows(version, table).find((row) => row['code'] === wanted);
		assert.ok(row, `${code}/${version}/${table} ${wanted}`);
		return row;
	};
	const versionOn = (day: string): string => {
		const version = versions.find((name) => {
			const range = settingsOf(name)['effective_range'];
			return (
				Schema.is(Schema.Record(Schema.String, Schema.Json))(range) &&
				String(range['from']) <= day &&
				(range['to'] == null || day <= String(range['to']))
			);
		});
		assert.ok(version, `${code} has a version governing ${day}`);
		return version;
	};
	return {
		root,
		versions,
		rows,
		settingsOf,
		byCode,
		versionOn,
		payrollRules: (version: string): Row =>
			Object.fromEntries(
				rows(version, 'rule_set')
					.filter((row) => row['family'] === 'PAYROLL')
					.map((row) => [String(row['code']), row['rules']])
			),
		law: (): Tables =>
			new Map(TABLES.map((table) => [table, versions.flatMap((version) => rows(version, table))]))
	};
}

/** Model keys and authored foreign keys, read from the actual declarations. */
export function modelFields(table: string): ReadonlySet<string> {
	const fields =
		table === 'jurisdiction_settings'
			? Object.keys(settingsModel.fields)
			: Object.entries(SNAPSHOT_MODELS).find(([name]) => name === table)?.[1].fields;
	return new Set([
		'id',
		...(Array.isArray(fields) ? fields : Object.keys(fields ?? {})),
		...Object.keys(relationships)
			.filter((key) => key.startsWith(`${table}.`))
			.map((key) => key.slice(table.length + 1))
	]);
}
const KEYWORDS = new Set([
	'type',
	'properties',
	'items',
	'additionalProperties',
	'required',
	'enum',
	'const',
	'minimum',
	'maximum',
	'minLength',
	'maxLength',
	'minItems',
	'maxItems',
	'pattern',
	'format',
	'description',
	'title',
	'default',
	'$schema',
	'$id',
	'$ref',
	'$defs',
	'allOf',
	'anyOf',
	'oneOf',
	'not',
	'if',
	'then',
	'else',
	'examples',
	'exclusiveMinimum',
	'exclusiveMaximum',
	'multipleOf',
	'uniqueItems'
]);
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const record = Schema.is(Schema.Record(Schema.String, Schema.Unknown));
export function schemaProblems(node: unknown, path: string, out: string[] = []): string[] {
	if (node === true || node === false) return out;
	if (!record(node)) return [...out, `${path} is not a schema`];
	for (const [key, value] of Object.entries(node)) {
		if (!KEYWORDS.has(key)) out.push(`${path}.${key} is not a keyword`);
		if (key === 'type' && ![value].flat().every((type) => TYPES.has(String(type))))
			out.push(`${path}.type`);
		if (key === 'properties') {
			if (!record(value)) out.push(`${path}.properties`);
			else
				for (const [name, child] of Object.entries(value))
					schemaProblems(child, `${path}.${name}`, out);
		}
		if (key === 'items' || key === 'additionalProperties')
			schemaProblems(value, `${path}.${key}`, out);
		if (key === 'enum' && (!Array.isArray(value) || value.length === 0)) out.push(`${path}.enum`);
		if (['minimum', 'maximum'].includes(key) && typeof value !== 'number')
			out.push(`${path}.${key}`);
	}
	return out;
}
export function propertiesAt(schema: unknown, ...path: string[]): Set<string> {
	let node = schema;
	for (const key of path) node = record(node) ? node[key] : undefined;
	return new Set(record(node) && record(node['properties']) ? Object.keys(node['properties']) : []);
}

const SeedTable = Schema.Array(Schema.Record(Schema.String, Schema.Json));
const SeedRows = Schema.Record(Schema.String, SeedTable);
/** Every query is performed by the real workspace database, including keyed references and native relation arms. */
export function world(tables: Tables) {
	const normalized = new Map<
		string,
		{ readonly encoded: string; readonly rows: typeof SeedTable.Type }
	>();
	const seedRows = (): typeof SeedRows.Type =>
		Object.fromEntries(
			[...tables].map(([table, rows]): [string, typeof SeedTable.Type] => {
				// Compare full values, including defaults and in-place edits; array identity is insufficient.
				const encoded = JSON.stringify(fixtureRows(table, rows));
				let stored = normalized.get(table);
				if (stored === undefined || stored.encoded !== encoded) {
					const parsed: unknown = JSON.parse(encoded);
					stored = { encoded, rows: Schema.decodeUnknownSync(SeedTable)(parsed) };
					normalized.set(table, stored);
				}
				return [table, structuredClone(stored.rows)];
			})
		);
	const layer = Layer.unwrap(
		Effect.sync(() => {
			return Layer.effect(
				Reads,
				TestWorkspace.pipe(Effect.map((t) => readsFrom(t.as(t.admin).read)))
			).pipe(Layer.provideMerge(workspace({ seed: seedRows() })));
		})
	);
	const provide = <A, E>(effect: Effect.Effect<A, E, Reads>) => effect.pipe(Effect.provide(layer));
	const withRead = <A, E, R>(use: (read: CallerRead) => Effect.Effect<A, E, R>) =>
		TestWorkspace.pipe(
			Effect.flatMap((t) => use(t.as(t.admin).read)),
			Effect.provide(layer)
		);
	const companyFrom = (read: CallerRead, wanted: string) =>
		read('entity', { all: true }).pipe(
			Effect.map((page) => {
				const row = page.rows.find((row) => row.id === wanted);
				assert.ok(row, `The fixture seeds entity ${wanted}.`);
				return row.id;
			})
		);
	const company = (wanted: string) => withRead((read) => companyFrom(read, wanted));
	const runWith = (
		readWith: <A, E>(
			use: (read: CallerRead) => Effect.Effect<A, E>
		) => Effect.Effect<A, E | KitFailure>
	) =>
		Effect.fnUntraced(function* (
			companyId: string,
			period: string,
			kind: PayrollRunKind,
			sources?: readonly string[]
		) {
			const plan = yield* readWith((read) =>
				Effect.gen(function* () {
					const company_id = yield* companyFrom(read, companyId);
					return yield* buildPayrollRun({
						company_id,
						period,
						kind,
						...(sources === undefined ? {} : { sources })
					}).pipe(Effect.provideService(Reads, readsFrom(read)));
				})
			);
			const id = randomUUID();
			tables.set('payroll_run', [...(tables.get('payroll_run') ?? []), { ...plan.run, id }]);
			for (const slip of plan.payslips) {
				const slipId = randomUUID();
				const { pins, warnings: _warnings, hold: _hold, ...stored } = slip;
				tables.set('payslip', [
					...(tables.get('payslip') ?? []),
					{
						...stored,
						gross: Decimal.of(String(stored.gross)),
						total_deductions: Decimal.of(String(stored.total_deductions)),
						net: Decimal.of(String(stored.net)),
						employer_cost: Decimal.of(String(stored.employer_cost)),
						id: slipId,
						payroll_run_id: id,
						terms_through: slip.salary_to,
						status: 'DRAFT'
					}
				]);
				for (const pin of pins)
					tables.set(
						pin.collection,
						(tables.get(pin.collection) ?? []).map((row) =>
							row['id'] === pin.id ? { ...row, payslip_id: slipId } : row
						)
					);
			}
			return plan;
		});
	const run = runWith(withRead);
	/** The suite's scoped workspace owns the history; each call restores its exact current table snapshot. */
	const useRun = <A, E, R>(use: (historyRun: typeof run) => Effect.Effect<A, E, R>) =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			// The native schema creates a stored relation for every model, including uncollected ones.
			// Built-in tables carry `table`; retain their authentication and source-catalogue rows.
			const models = Object.entries(t.manifest.models)
				.filter(([, model]) => model.table === undefined)
				.map(([name]) => name);
			assert.ok(models.length > 0, 'The fixture has authored stored models.');
			// A delta omits old given-derived values. Keep full native drift checks for any rollup schema.
			const appendSafe = !Object.values(t.manifest.models).some((model) =>
				Object.values(model.fields).some((field) => field.kind === 'sum' || field.kind === 'count')
			);
			let restored:
				| {
						readonly at: string;
						readonly rows: Readonly<Record<string, readonly string[]>>;
				  }
				| undefined;
			const restore = Effect.gen(function* () {
				const rows = seedRows();
				for (const name of Object.keys(rows))
					assert.ok(models.includes(name), `Dependent histories seed an authored model: ${name}.`);
				const at = t.clock.now();
				let append =
					appendSafe &&
					restored !== undefined &&
					restored.at === at &&
					Object.keys(restored.rows).length === Object.keys(rows).length;
				const snapshot: Record<string, readonly string[]> = {};
				const additions: Record<string, (typeof SeedRows.Type)[string]> = {};
				for (const [name, entries] of Object.entries(rows)) {
					const prior = restored?.rows[name];
					const current = entries.map((row) => JSON.stringify(row));
					const ids = entries.map((row) => row['id']);
					if (
						prior === undefined ||
						prior.length > current.length ||
						prior.some((row, index) => row !== current[index]) ||
						ids.some((id) => typeof id !== 'string') ||
						new Set(ids).size !== ids.length
					)
						append = false;
					snapshot[name] = current;
					// Retain empty collection keys so native relationship ordering and validation still run.
					additions[name] = entries.slice(prior?.length ?? 0);
				}
				// A failed refresh must never authorize another delta against a partially restored database.
				restored = undefined;
				if (!append) {
					// RESTRICT cannot silently clear a referenced system table. Full refresh also removes
					// deleted rows and restores modified inputs, including source pins and older snapshots.
					yield* t.db.write({
						text: `TRUNCATE TABLE ${models.map((name) => `"${name.replaceAll('"', '""')}"`).join(', ')} RESTRICT`,
						params: []
					});
					yield* t.db.write({
						text: 'DELETE FROM bolt_history WHERE collection IN (SELECT jsonb_array_elements_text($1::jsonb))',
						params: [models]
					});
					yield* t.db.write({
						text: 'DELETE FROM bolt_seq WHERE model IN (SELECT jsonb_array_elements_text($1::jsonb))',
						params: [models]
					});
				}
				yield* seed(t.manifest, t.db, append ? additions : rows, at);
				restored = { at, rows: snapshot };
			});
			const readWith = <B, F>(read: (reader: CallerRead) => Effect.Effect<B, F>) =>
				Effect.andThen(
					restore,
					Effect.suspend(() => read(t.as(t.admin).read))
				);
			return yield* use(runWith(readWith));
		});
	return { tables, layer, provide, run, useRun, withRead, company };
}
export const statutoryLines = (slip: {
	readonly statutory: readonly {
		readonly scheme_code: string;
		readonly employee_amount: number;
		readonly employer_amount: number;
	}[];
}): Record<string, [number, number]> =>
	Object.fromEntries(
		slip.statutory
			.filter((line) => line.employee_amount !== 0 || line.employer_amount !== 0)
			.map((line) => [line.scheme_code, [line.employee_amount, line.employer_amount]])
	);

/** The same rejection predicate as node:assert, over an Effect failure rather than a Promise. */
export const assertFailure = Effect.fnUntraced(function* <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	expected?: Parameters<typeof assert.throws>[1]
) {
	const exit = yield* Effect.exit(effect);
	if (Exit.isSuccess(exit)) assert.fail('Expected the operation to refuse.');
	const raised = () => {
		throw Cause.squash(exit.cause);
	};
	if (expected === undefined) assert.throws(raised);
	else assert.throws(raised, expected);
});
