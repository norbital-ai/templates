import { Effect } from 'effect';
import type { InstanceId, SyncCtx } from '@norbital-ai/bolt';
import { columns, SourceRowInvalid, type DatabaseContext } from './polling.js';
import { sourceKeys, type SourceProjection } from './sql.js';

const PAGE = 999;
type PreservedModel = 'parties' | 'products' | 'warehouses' | 'source_sales_lines';
type Context = DatabaseContext & Pick<SyncCtx<'kingdee'>, 'query'>;

/** A completed source listing verifies absence again before retaining a local master as inactive. */
export const preserveSource = ({
	model,
	instance,
	projection,
	ctx,
	account
}: {
	readonly model: PreservedModel;
	readonly instance: InstanceId<'kingdee'>;
	readonly projection: SourceProjection;
	readonly ctx: Context;
	readonly account?: string;
}) =>
	Effect.fnUntraced(function* (after: string) {
		const page = {
			where: { source: { eq: instance }, external_code: { gt: after } },
			fields: ['external_code', 'active'],
			order_by: 'external_code',
			limit: PAGE
		} as const;
		const local =
			model === 'parties'
				? (yield* ctx.query({ parties: page })).parties
				: model === 'products'
					? (yield* ctx.query({ products: page })).products
					: model === 'warehouses'
						? (yield* ctx.query({ warehouses: page })).warehouses
						: (yield* ctx.query({
								source_sales_lines: {
									...page,
									where: {
										...page.where,
										kind: { eq: 'invoice_only' },
										order: { is_null: true },
										active: { eq: true }
									}
								}
							})).source_sales_lines;
		const remoteKey = (external: string) =>
			model === 'source_sales_lines' ? external.replace(/^invoice-only:/, '') : external;
		const keys = local.rows.map((row) => remoteKey(row.external_code));
		const found = keys.length === 0 ? [] : yield* sourceKeys(ctx, projection, keys, account);
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
				.filter((row) => row.active && !present.has(remoteKey(row.external_code)))
				.map((row) => ({
					$id: remoteKey(row.external_code),
					external_code: row.external_code,
					active: false as const
				})),
			after: local.rows.at(-1)?.external_code ?? after,
			more: local.rows.length === PAGE
		};
	});
