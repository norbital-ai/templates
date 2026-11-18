import { DateTime, Effect, Schema } from 'effect';
import type { AutomationCtx, Id, LayerWhere } from '@norbital-ai/bolt';
import { ActConflict, ActRefused } from '@norbital-ai/bolt/errors';

/** The stored `sys_integration.import_start`, decoded at this boundary: the host-side protocol entry is not guest code. */
/** An instant stated with its zone (`Z` or an offset): an unzoned one's moment depends on whoever reads it. */
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
		return Date.parse(source.created_at) >= Date.parse(start.selectedAt);
	if (start?.kind !== 'since') return true;
	const at = source.source_at;
	return at != null && Date.parse(at) >= Date.parse(start.at);
});

/** Native values stay provider-owned; only raw messages admitted after that selection can enter CRM. */
/** The import boundary over a message, as an activity's `source_message` layer reads it (and so any `sys_message` read). */
export type MessageImportWhere = LayerWhere<'activities', 'activities.source_message'>;

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

/**
 * A per-message write that lost a race is skipped, never the whole run: a concurrent write moved its rows (conflict),
 * or the connection's import selection changed after the run read it (refused on `source_message`). The message keeps
 * its state, so the next run reconsiders it against the current rows.
 */
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
/** Newest messages first, by source time when known, then arrival. */
export const newestOf = <R extends Lane>(rows: readonly R[], take: number) => {
	const at = (row: R) => Date.parse(row.source_at ?? row.created_at);
	return [...rows].sort((a, b) => at(b) - at(a) || b.seq - a.seq).slice(0, take);
};

/**
 * One run's batch: fresh messages get a bounded share, round-robin across providers' newest lanes; the larger half
 * advances old history in sequence order. Messages in `taken` are already filed. Returned in sequence order.
 */
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
