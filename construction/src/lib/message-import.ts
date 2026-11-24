import { DateTime, Effect, Option, Schema } from 'effect';
import type { AutomationCtx, Id, LayerWhere } from '@norbital-ai/bolt';
import { ActConflict, ActRefused } from '@norbital-ai/bolt/errors';

const instantEpoch = (raw: string): number =>
	Option.match(DateTime.make(raw), {
		onNone: () => 0,
		onSome: (dt) => DateTime.toEpochMillis(dt)
	});

const Zoned = Schema.String.check(Schema.isPattern(/(?:Z|[+-]\d{2}:?\d{2})$/i));
const ImportStart = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('all') }),
	Schema.Struct({ kind: Schema.Literal('since'), at: Zoned }),
	Schema.Struct({ kind: Schema.Literal('native'), selectedAt: Zoned })
]);

const messageImportStart = (value: unknown, ctx: Pick<AutomationCtx, 'refuse'>) =>
	Schema.decodeUnknownEffect(Schema.NullOr(ImportStart))(value ?? null).pipe(
		Effect.catch(() => ctx.refuse('errors.invalid_import_start'))
	);

type ImportAccount = {
	id: Id<'sys_integration'>;
	import_start: unknown;
};

export const messageImportAllows = Effect.fnUntraced(function* (
	account: ImportAccount,
	source: { source_at: string | null; created_at: string },
	ctx: Pick<AutomationCtx, 'refuse'>
) {
	const start = yield* messageImportStart(account.import_start, ctx);
	if (start?.kind === 'native')
		return instantEpoch(source.created_at) >= instantEpoch(start.selectedAt);
	if (start?.kind !== 'since') return true;
	const at = source.source_at;
	return at != null && instantEpoch(at) >= instantEpoch(start.at);
});

export type MessageImportWhere = LayerWhere<'project_messages', 'project_messages.source_message'>;

export const messageImportWhere = Effect.fnUntraced(function* (
	accounts: readonly ImportAccount[],
	ctx: Pick<AutomationCtx, 'refuse'>
) {
	const clauses: MessageImportWhere[] = [];
	for (const account of accounts) {
		const start = yield* messageImportStart(account.import_start, ctx);
		clauses.push({
			integration: { eq: account.id },
			...(start?.kind === 'native'
				? { created_at: { gte: DateTime.formatIso(DateTime.makeUnsafe(start.selectedAt)) } }
				: start?.kind === 'since'
					? { source_at: { gte: DateTime.formatIso(DateTime.makeUnsafe(start.at)) } }
					: {})
		});
	}
	return clauses.length === 0
		? ({ integration: { in: [] } } satisfies MessageImportWhere)
		: ({ or: clauses } satisfies MessageImportWhere);
});

export const skipRacedWrite = <A, E, R>(write: Effect.Effect<A, E | ActConflict | ActRefused, R>) =>
	write.pipe(
		Effect.catch((error) =>
			error instanceof ActConflict ||
			(error instanceof ActRefused && error.field === 'source_message')
				? Effect.succeed(null)
				: Effect.fail(error)
		)
	);

type Lane = {
	readonly id: string;
	readonly seq: number;
	readonly source_at: string | null;
	readonly created_at: string;
};

export const newestOf = <R extends Lane>(rows: readonly R[], take: number) => {
	const at = (row: R) => instantEpoch(row.source_at ?? row.created_at);
	return [...rows].sort((a, b) => at(b) - at(a) || b.seq - a.seq).slice(0, take);
};

export const selectBatch = <R extends Lane>(
	oldest: readonly R[],
	recent: readonly (readonly R[])[],
	taken: ReadonlySet<string | null>,
	batch: number
) => {
	const unfiled = (rows: readonly R[]) => rows.filter((row) => !taken.has(row.id));
	const selected = new Map<string, R>();
	const fresh = Math.floor((batch - 1) / 2);
	const lanes = recent.map(unfiled);
	const depth = Math.max(0, ...lanes.map((lane) => lane.length));
	for (let i = 0; i < depth && selected.size < fresh; i++)
		for (const lane of lanes) {
			const row = lane[i];
			if (row !== undefined) selected.set(row.id, row);
			if (selected.size >= fresh) break;
		}
	for (const row of unfiled(oldest)) {
		if (selected.size >= batch) break;
		selected.set(row.id, row);
	}
	return [...selected.values()].sort((a, b) => a.seq - b.seq);
};
