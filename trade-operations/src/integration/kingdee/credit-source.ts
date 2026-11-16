import { BigDecimal, Effect, Schema } from 'effect';
import type { InstanceId, SyncCtx, Json } from '@norbital-ai/bolt';
import { kingdeeCreditAccount, simulatorCreditPolicy } from './configuration.js';
import { readChangedSnapshot, snapshotStatement } from './changed-snapshot.js';
import { checked } from './order-source.js';
import { SourceRowInvalid, SourceUnavailable, type DatabaseContext } from './polling.js';

// The simulator publishes its measured shipment formula and explicit hold/overdue policy separately from dbo.
const creditSnapshot = `IF DB_NAME()<>N'TradeOperationsProbe'
 OR OBJECT_ID(N'sim.IntegrationCredit',N'V') IS NULL
 THROW 50001,'The configured simulator credit policy is unavailable in this account',1;
${snapshotStatement(`/* kingdee-simulator-credit */
 SELECT TOP (1001) CONVERT(varchar(20),CustomerID) AS customer_id,
  Policy AS policy, Supported AS supported, Currency AS currency,
  CreditLimit AS credit_limit, CreditUsed AS credit_used, CreditHold AS credit_hold
 FROM sim.IntegrationCredit ORDER BY CustomerID FOR JSON PATH, INCLUDE_NULL_VALUES`)} `;
const precise = Schema.String.check(Schema.isPattern(/^-?\d+(\.\d+)?$/));
const payload = Schema.fromJsonString(
	Schema.Array(
		Schema.Struct({
			customer_id: Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
			policy: Schema.Literal(simulatorCreditPolicy),
			supported: Schema.Boolean,
			currency: Schema.Literal('CNY'),
			credit_limit: precise,
			credit_used: precise,
			credit_hold: Schema.Boolean
		})
	)
);
const checkpoint = Schema.Struct({
	protocol: Schema.Literal('kingdee-simulator-credit-v1'),
	account: Schema.String
});
const invalid = (column: string, reason: string) => new SourceRowInvalid({ column, reason });

const observe = Effect.fnUntraced(function* (ctx: DatabaseContext, account: string) {
	// A single serializable read keeps invoice/receipt/matching aggregates in one accounting position.
	const current = yield* readChangedSnapshot(
		{ request: (op) => ctx.request({ ...op, transaction: 'serializable' }) },
		creditSnapshot,
		account,
		''
	);
	const rows = yield* checked(() => {
		const rows = Schema.decodeUnknownSync(payload)(current.entries);
		if (rows.length > 1000)
			throw invalid('$result', 'The credit snapshot exceeds its customer bound');
		const seen = new Set<string>();
		for (const row of rows) {
			if (
				!row.supported ||
				seen.has(row.customer_id) ||
				BigDecimal.isNegative(BigDecimal.fromStringUnsafe(row.credit_limit))
			)
				throw invalid(
					'sim.IntegrationCredit',
					'Credit requires one supported formula and explicit hold policy per customer'
				);
			seen.add(row.customer_id);
		}
		return rows;
	});
	return { rows, observedAt: current.observed_at };
});
export const testCreditSource = (ctx: DatabaseContext, account: string) => observe(ctx, account);

export const readCreditSource = Effect.fnUntraced(function* (
	instance: InstanceId<'kingdee'>,
	cursor: Json | null,
	ctx: SyncCtx<'kingdee'>
) {
	const account = kingdeeCreditAccount(ctx.configuration);
	if (
		ctx.configuration.creditPolicy !== simulatorCreditPolicy ||
		account === null ||
		ctx.configuration.baseCurrency !== 'CNY'
	)
		return yield* new SourceUnavailable({
			reason: 'Credit requires an explicit simulator policy, CNY and a verified account identity'
		});
	const prior =
		cursor === null ? null : yield* checked(() => Schema.decodeUnknownSync(checkpoint)(cursor));
	if (prior && prior.account !== account)
		return yield* invalid(
			'$cursor',
			'The credit account changed. Review the retained snapshot before resetting.'
		);
	const { sys_integration: ledgers, parties } = yield* ctx.query({
		sys_integration: { where: { integration: { eq: 'kingdee' } }, fields: ['configuration'] },
		parties: {
			where: { source: { eq: instance }, active: { eq: true } },
			fields: ['external_code', 'kind', 'currency']
		}
	});
	if (
		ledgers.rows.some(
			(row) => row.id !== instance && kingdeeCreditAccount(row.configuration) === account
		)
	)
		return yield* new SourceUnavailable({
			reason: 'Enable account-wide credit on one ledger per account set'
		});
	const current = yield* observe(ctx, account);
	const rows = yield* checked(() =>
		current.rows.map((row) => {
			const party = parties.rows.filter(
				(party) =>
					party.external_code === row.customer_id &&
					party.kind !== 'supplier' &&
					party.currency === 'CNY'
			);
			if (party.length !== 1 || !party[0])
				throw invalid('customer_id', 'Credit requires one active synchronized CNY customer');
			return {
				$id: row.customer_id,
				external_code: row.customer_id,
				party: party[0].id,
				currency: row.currency,
				credit_limit: row.credit_limit,
				credit_used: row.credit_used,
				credit_hold: row.credit_hold,
				as_of: current.observedAt
			};
		})
	);
	// Even unchanged amounts receive the source's new observation time; unavailable reads refresh nothing.
	return {
		rows,
		cursor: { protocol: 'kingdee-simulator-credit-v1' as const, account },
		more: false
	};
});
