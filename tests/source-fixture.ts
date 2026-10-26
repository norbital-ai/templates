import type { DatabaseRequest, DatabaseResult, Json } from '@norbital-ai/bolt/engine';
import { Effect, Schema } from 'effect';
import { randomUUID } from 'node:crypto';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
const Record = Schema.Record(Schema.String, Schema.Json);
const hex = (value: number) => '0x' + value.toString(16).padStart(16, '0');
const VERSIONED = new Set(['parties', 'products', 'warehouses']);
/** Scripted physical projection rows at the native request boundary; this is not a SQL engine. */
export function sourceFixture(records: () => Record<string, Json[]>) {
	let sequence = 10;
	const stored = new Map<
		string,
		Map<string, { encoded: string; row: Record<string, Json>; version: number }>
	>();
	const identity = randomUUID();
	const objects = new Map<string, number>();
	return (op: DatabaseRequest): Effect.Effect<DatabaseResult, FacilityFailure> =>
		Effect.try({
			try: () => {
				const current = records();
				for (const resource of stored.keys()) {
					if (current[`/${resource}`] === undefined) stored.delete(resource);
				}
				for (const [path, values] of Object.entries(current)) {
					const resource = path.slice(1),
						rows =
							stored.get(resource) ??
							new Map<string, { encoded: string; row: Record<string, Json>; version: number }>();
					stored.set(resource, rows);
					const seen = new Set<string>();
					for (const value of values) {
						const row = Schema.decodeUnknownSync(Record)(value),
							key = String(row.__key ?? row.external_code ?? row.external_id),
							encoded = JSON.stringify(row);
						seen.add(key);
						if (rows.get(key)?.encoded !== encoded)
							rows.set(key, { encoded, row, version: VERSIONED.has(resource) ? ++sequence : 0 });
					}
					// A hard delete leaves no tombstone in a rowversion source.
					for (const key of rows.keys()) if (!seen.has(key)) rows.delete(key);
				}
				if (
					op.op !== 'call' ||
					op.procedure.schema !== 'sys' ||
					op.procedure.name !== 'sp_executesql'
				)
					throw new Error('A native parameterized SQL call is required');
				const args = op.arguments;
				const statement = args.stmt;
				if (typeof statement !== 'string') throw new Error('SQL statement required');
				if (statement.includes('sys.database_recovery_status'))
					return { rows: [{ database_guid: identity, recovery_fork_guid: identity }] };
				if (statement.includes('MIN_ACTIVE_ROWVERSION()'))
					return {
						rows: [{ maximum: hex(sequence + 1), observed_at: '2026-10-10T00:00:00.000Z' }]
					};
				if (statement.includes('SYSUTCDATETIME()'))
					return { rows: [{ observed_at: '2026-10-10T00:00:00.000Z' }] };
				if (statement.includes('sys.objects')) {
					const rows: Record<string, Json>[] = [];
					for (let i = 0; args[`p${i}`] !== undefined; i += 4) {
						const alias = args[`p${i}`],
							column = args[`p${i + 1}`],
							schema = args[`p${i + 2}`],
							table = args[`p${i + 3}`];
						if (
							typeof alias !== 'string' ||
							(column !== null && typeof column !== 'string') ||
							typeof schema !== 'string' ||
							typeof table !== 'string'
						)
							throw new Error('Invalid source metadata parameters');
						const name = `${schema}.${table}`;
						if (!objects.has(name)) objects.set(name, objects.size + 1);
						rows.push({
							alias,
							column,
							object_id: objects.get(name) ?? 0,
							created: '2026-10-13T00:00:00.000Z',
							rowversion_type: column === null ? null : 189
						});
					}
					rows.sort((a, b) => {
						const left = `${String(a.alias)}:${String(a.column)}`,
							right = `${String(b.alias)}:${String(b.column)}`;
						return left < right ? -1 : left > right ? 1 : 0;
					});
					return { rows };
				}
				const relation = /FROM\s+\[([^\]]+)\]\.\[([^\]]+)\]\s+AS\s+\[([^\]]+)\]/i.exec(statement);
				if (relation === null) throw new Error('Unexpected fixture SQL statement');
				const resource = relation[3] === 'source' ? relation[2] : relation[3];
				if (resource === undefined) throw new Error('Source relation required');
				const currentRows = stored.get(resource);
				if (statement.includes('DECLARE @source_keys')) {
					if (typeof args.keys !== 'string') throw new Error('Source identity batch required');
					const requested = new Set(
						[...args.keys.matchAll(/<key>(.*?)<\/key>/g)].map((match) =>
							(match[1] ?? '')
								.replaceAll('&lt;', '<')
								.replaceAll('&gt;', '>')
								.replaceAll('&amp;', '&')
						)
					);
					return {
						rows: [...(currentRows?.keys() ?? [])]
							.filter((key) => requested.has(key))
							.sort()
							.map((key) => ({ __key: key }))
					};
				}
				if (typeof args.after !== 'string') throw new Error('Source page position required');
				const after = args.after;
				const from = args.from,
					to = args.to;
				if (
					(from !== undefined || to !== undefined) &&
					(typeof from !== 'string' || typeof to !== 'string')
				)
					throw new Error('Source window bounds required');
				const rows = [...(stored.get(resource) ?? [])]
					.filter(
						([key, value]) =>
							key > after &&
							(typeof from !== 'string' ||
								typeof to !== 'string' ||
								(value.version >= Number(BigInt(from)) && value.version < Number(BigInt(to))))
					)
					.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
					.map(([key, value]) => ({
						...value.row,
						__key: key,
						...(statement.includes(' AS __rowversion') ? { __rowversion: hex(value.version) } : {})
					}));
				return { rows: rows.slice(0, op.maxRows ?? 1000) };
			},
			catch: (cause) => new FacilityFailure({ kind: 'upstream', message: String(cause) })
		});
}
