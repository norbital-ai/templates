import { Schema } from 'effect';

const Connection = Schema.Struct({
	state: Schema.String,
	databaseVerified: Schema.optionalKey(Schema.Boolean)
});
export function kingdeeConnectionStatus(instance: { active: boolean; status: unknown }) {
	if (!instance.active || !Schema.is(Connection)(instance.status)) return 'off';
	switch (instance.status.state) {
		case 'connected':
			return instance.status.databaseVerified === true ? 'connected' : 'off';
		case 'error':
			return 'connection_error';
		default:
			return 'off';
	}
}
const Failing = Schema.Struct({ failing: Schema.Record(Schema.String, Schema.String) });
/** The Kingdee feeds whose figures a page judges for freshness. */
export const feeds = {
	stock: 'stock_snapshots.sync.kingdee',
	commitments: 'source_stock_commitments.sync.kingdee',
	lotCosts: 'source_lot_costs.sync.kingdee',
	credit: 'credit_snapshots.sync.kingdee'
} as const;
/**
 * When Kingdee last confirmed a feed's figures, judged at `now`. A read that finds nothing new writes nothing, so a
 * row's own time is when it last changed: while the ledger is connected (its reads run) and the feed is not failing,
 * what it committed is current; a failing feed's figures are as old as its failures (`status.failing`, from Bolt). A
 * ledger that is off or unverified confirms nothing.
 */
export type Ledger = { readonly active: boolean; readonly status: unknown };
export function confirmedAt(
	ledger: Ledger,
	feed: (typeof feeds)[keyof typeof feeds],
	now: string
): string | null {
	if (kingdeeConnectionStatus(ledger) !== 'connected') return null;
	return (Schema.is(Failing)(ledger.status) ? ledger.status.failing[feed] : undefined) ?? now;
}
