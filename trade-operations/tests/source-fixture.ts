import type { DatabaseRequest, DatabaseResult, Json } from '@norbital-ai/bolt/engine';
import { Effect, Schema } from 'effect';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
const Record = Schema.Record(Schema.String, Schema.Json);
const hex = (value: number) => '0x' + value.toString(16).padStart(20, '0');
/** SQL CDC fixture at the native request boundary; the live SQL2017 cases use a real server. */
export function sourceFixture(records: () => Record<string, Json[]>) {
	let sequence = 10;
	const stored = new Map<string, Map<string, string>>();
	const changes = new Map<
		string,
		{
			sequence: number;
			row: Record<string, Json>;
		}[]
	>();
	return (op: DatabaseRequest): Effect.Effect<DatabaseResult, FacilityFailure> =>
		Effect.try({
			try: () => {
				for (const [path, values] of Object.entries(records())) {
					const resource = path.slice(1),
						rows = stored.get(resource) ?? new Map<string, string>();
					stored.set(resource, rows);
					for (const value of values) {
						const row = Schema.decodeUnknownSync(Record)(value),
							key = String(row.external_code ?? row.external_id),
							encoded = JSON.stringify(row);
						if (rows.get(key) !== encoded) {
							rows.set(key, encoded);
							sequence++;
							const deltas = changes.get(resource) ?? [];
							changes.set(resource, deltas);
							deltas.push({
								sequence,
								row: {
									...row,
									__key: key,
									__event_key: key,
									__$start_lsn: hex(sequence),
									__$seqval: hex(1),
									__$operation: 4
								}
							});
						}
					}
				}
				if (op.statement.includes('FROM cdc.change_tables'))
					return {
						rows: Object.values(op.parameters).map((capture) => ({
							capture_instance: capture,
							object_id: 10,
							created: '2026-10-13',
							minimum: hex(1)
						}))
					};
				if (op.statement.includes('sys.database_recovery_status'))
					return { rows: [{ database_guid: 'fixture', recovery_fork_guid: 'fixture' }] };
				if (op.statement.includes('SELECT sys.fn_cdc_get_max_lsn()'))
					return { rows: [{ maximum: hex(sequence), lag: '0' }] };
				if (op.statement.includes(' AS age')) return { rows: [{ age: '0' }] };
				const table =
					/colony_([\w]+)\(/.exec(op.statement)?.[1] ??
					/FROM colony\.\[([\w]+)\]/.exec(op.statement)?.[1];
				const resource =
					table === 'OrderHeader'
						? op.statement.includes("direction = 'purchasing'")
							? 'ext_purchase_orders'
							: 'ext_sales_orders'
						: table === 'OrderTransaction'
							? 'transactions'
							: table;
				if (!resource) throw new Error('Unrecognized fixture SQL statement');
				const rows = op.statement.includes('fn_cdc_get_all_changes')
					? (changes.get(resource) ?? [])
							.filter(
								(change) =>
									change.sequence >= Number(BigInt(String(op.parameters.from_lsn_hex))) &&
									change.sequence <= Number(BigInt(String(op.parameters.to_lsn_hex)))
							)
							.map((change) => change.row)
					: [...(stored.get(resource) ?? [])]
							.filter(([key]) => key > String(op.parameters.after_key ?? ''))
							.map(([key, text]) => ({
								...Schema.decodeUnknownSync(Record)(JSON.parse(text)),
								__key: key
							}));
				return { rows: rows.slice(0, 1000) };
			},
			catch: (cause) => new FacilityFailure({ kind: 'upstream', message: String(cause) })
		});
}
