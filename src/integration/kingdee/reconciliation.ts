import { Effect } from 'effect';
import type { InstanceId, SyncCtx } from '@norbital-ai/bolt';
import { columns, SourceRowInvalid, type DatabaseContext } from './polling.js';
import { sourceKeys, type SourceProjection } from './sql.js';

const PAGE = 999;
type PreservedModel = 'parties' | 'products' | 'warehouses';
type Context = DatabaseContext & Pick<SyncCtx<'kingdee'>, 'db'>;

/** A completed source listing verifies absence again before retaining a local master as inactive. */
export const preserveSource = ({
	model,
	instance,
	projection,
	ctx
}: {
	readonly model: PreservedModel;
	readonly instance: InstanceId<'kingdee'>;
	readonly projection: SourceProjection;
	readonly ctx: Context;
}) =>
	Effect.fnUntraced(function* (after: string) {
		const local = yield* ctx.db.query(model, {
			where: { source: { eq: instance }, external_code: { gt: after } },
			select: { external_code: true, active: true },
			orderBy: 'external_code',
			limit: PAGE
		});
		const keys = local.rows.map((row) => row.external_code);
		const found = keys.length === 0 ? [] : yield* sourceKeys(ctx, projection, keys);
		const present = yield* Effect.try({
			try: () => {
				const requested = new Set(keys);
				const present = new Set<string>();
				for (const row of found) {
					const key = columns(row).text('__key');
					if (!requested.has(key) || present.has(key))
						throw new SourceRowInvalid({
							column: '__key',
							reason: 'The source existence check returned an unexpected or duplicate key'
						});
					present.add(key);
				}
				return present;
			},
			catch: (cause) =>
				cause instanceof SourceRowInvalid
					? cause
					: new SourceRowInvalid({ column: '$row', reason: String(cause) })
		});
		return {
			// The key also lets the engine adopt a retained local row whose id map was not populated yet.
			rows: local.rows
				.filter((row) => row.active && !present.has(row.external_code))
				.map((row) => ({
					$id: row.external_code,
					external_code: row.external_code,
					active: false as const
				})),
			after: local.rows.at(-1)?.external_code ?? after,
			more: local.rows.length === PAGE
		};
	});
