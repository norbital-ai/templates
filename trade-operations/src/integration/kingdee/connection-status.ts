import { Predicate, Schema } from 'effect';

const Connection = Schema.Struct({
	state: Schema.String,
	databaseVerified: Schema.optionalKey(Schema.Boolean)
});
const AttentionHealth = Schema.Struct({
	health: Schema.Struct({
		state: Schema.Literal('attention'),
		message: Schema.optionalKey(Schema.NullOr(Schema.String))
	})
});
const ErrorStatus = Schema.Struct({
	error: Schema.optionalKey(Schema.NullOr(Schema.String))
});
const DirectCreditConfig = Schema.Struct({
	baseCurrency: Schema.optionalKey(Schema.NullOr(Schema.String)),
	writeAccount: Schema.optionalKey(Schema.NullOr(Schema.String)),
	directWriteCreditLimit: Schema.optionalKey(Schema.NullOr(Schema.Boolean))
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

export type KingdeeInstance = {
	readonly id?: string;
	readonly name?: string;
	readonly active: boolean;
	readonly status: unknown;
	readonly configuration?: unknown;
};

export type WorkspaceKingdeeState = 'not_configured' | 'off' | 'connected' | 'connection_error';

export type WorkspaceKingdeeSummary = {
	readonly state: WorkspaceKingdeeState;
	readonly attention: boolean;
	readonly detail: string | null;
	readonly directCreditWrite: boolean;
};

export const kingdeeIntegrationRead = {
	sys_integration: {
		where: { integration: { eq: 'kingdee' } },
		fields: ['name', 'active', 'status', 'configuration'],
		limit: 20
	}
} as const;

export function kingdeeStatusDetail(instance: Pick<KingdeeInstance, 'status'>): string | null {
	if (Schema.is(ErrorStatus)(instance.status) && instance.status.error?.trim())
		return instance.status.error.trim();
	if (Schema.is(AttentionHealth)(instance.status) && instance.status.health.message?.trim())
		return instance.status.health.message.trim();
	return null;
}

export function kingdeeHasAttention(instance: Pick<KingdeeInstance, 'active' | 'status'>): boolean {
	if (!instance.active) return false;
	if (Schema.is(AttentionHealth)(instance.status)) return true;
	return (
		Schema.is(Failing)(instance.status) &&
		Predicate.isObject(instance.status.failing) &&
		Object.keys(instance.status.failing).length > 0
	);
}

export function kingdeeDirectCreditWrite(
	instance: Pick<KingdeeInstance, 'configuration'>
): boolean {
	if (!Schema.is(DirectCreditConfig)(instance.configuration)) return false;
	return (
		instance.configuration.directWriteCreditLimit === true &&
		instance.configuration.baseCurrency === 'CNY' &&
		Boolean(instance.configuration.writeAccount?.trim())
	);
}

export function workspaceKingdeeSummary(
	instances: readonly KingdeeInstance[]
): WorkspaceKingdeeSummary {
	if (instances.length === 0)
		return { state: 'not_configured', attention: false, detail: null, directCreditWrite: false };
	const connected = instances.filter((one) => kingdeeConnectionStatus(one) === 'connected');
	if (connected.length > 0) {
		const attentionOne = connected.find((one) => kingdeeHasAttention(one));
		return {
			state: 'connected',
			attention: Boolean(attentionOne),
			detail: attentionOne ? kingdeeStatusDetail(attentionOne) : null,
			directCreditWrite: connected.some((one) => kingdeeDirectCreditWrite(one))
		};
	}
	const errored = instances.find((one) => kingdeeConnectionStatus(one) === 'connection_error');
	if (errored)
		return {
			state: 'connection_error',
			attention: true,
			detail: kingdeeStatusDetail(errored),
			directCreditWrite: false
		};
	return {
		state: 'off',
		attention: false,
		detail: null,
		directCreditWrite: instances.some((one) => kingdeeDirectCreditWrite(one))
	};
}

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
