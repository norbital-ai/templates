import { BigDecimal, Effect } from 'effect';
import { model, type EffectCtx, type Id } from '@norbital-ai/bolt';
import {
	logisticsCreditRelease,
	logisticsDocument,
	logisticsOrder
} from '../../../lib/logistics.js';

type Recipient =
	{ readonly policy: 'manager' | 'finance' | 'logistics' } | { readonly user: Id<'sys_user'> };

const syncFields = [
	'external_code',
	'source',
	'delivery_fid',
	'bill_number',
	'bill_on',
	'party',
	'order',
	'delivery',
	'settlement_name',
	'currency',
	'source_status',
	'bill_amount',
	'credit_limit',
	'credit_days',
	'credit_used',
	'over_limit',
	'overdue_days',
	'oldest_overdue_bill',
	'block_reasons',
	'source_oper_date',
	'content_hash',
	'audit_seen_at',
	'temp_bump_status',
	'released_by',
	'released_at',
	'release_log_key',
	'observed_at'
] as const;

const orderOwners = Effect.fnUntraced(function* (
	ctx: Pick<EffectCtx<'credit_releases'>, 'query'>,
	orderIds: readonly (Id<'orders'> | null)[]
) {
	const ids = [...new Set(orderIds.flatMap((id) => (id ? [id] : [])))];
	if (!ids.length) return new Map<Id<'orders'>, Id<'sys_user'>>();
	const { orders } = yield* ctx.query({
		orders: { where: { id: { in: ids } }, fields: ['owner'] }
	});
	return new Map(orders.rows.map((row) => [row.id, row.owner]));
});

export default model('credit_releases', {
	description:
		'Credit-blocked Kingdee delivery orders, release approvals, and audit-release confirmation.',
	record_label: 'record.bill_number',
	fields: {
		external_code: { kind: 'text', hidden: true },
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		delivery_fid: { kind: 'text' },
		bill_number: { kind: 'text' },
		bill_on: { kind: 'date', optional: true },
		party: { kind: 'ref', to: 'parties' },
		order: { kind: 'ref', to: 'orders', optional: true },
		delivery: { kind: 'ref', to: 'transactions', optional: true },
		settlement_name: { kind: 'text', optional: true },
		currency: { kind: 'currency' },
		source_status: {
			kind: 'enum',
			values: ['blocked', 'released', 'cleared', 'superseded', 'withdrawn', 'bypassed'],
			default: 'blocked',
			transitions: {
				blocked: ['released', 'cleared', 'superseded', 'withdrawn', 'bypassed'],
				released: [],
				cleared: [],
				superseded: [],
				withdrawn: [],
				bypassed: []
			}
		},
		approval_status: {
			kind: 'enum',
			values: ['none', 'approved'],
			default: 'none',
			transitions: {
				none: ['approved'],
				approved: []
			}
		},
		status: {
			kind: 'text',
			computed:
				"source_status == 'blocked' && approval_status == 'approved' ? 'approved' : source_status"
		},
		bill_amount: { kind: 'money', currency: 'currency', optional: true },
		credit_limit: { kind: 'money', currency: 'currency', optional: true },
		credit_days: { kind: 'int', optional: true },
		credit_used: { kind: 'money', currency: 'currency', optional: true },
		over_limit: { kind: 'money', currency: 'currency', optional: true },
		overdue_days: { kind: 'int', optional: true },
		oldest_overdue_bill: { kind: 'text', optional: true },
		block_reasons: { kind: 'enum', values: ['over_limit', 'overdue'], many: true, optional: true },
		route: { kind: 'enum', values: ['one_time', 'permanent'], optional: true },
		proposed_limit: { kind: 'money', currency: 'currency', optional: true },
		temp_bump_amount: { kind: 'money', currency: 'currency', optional: true },
		temp_bump_days: { kind: 'int', optional: true },
		temp_bump_status: {
			kind: 'enum',
			values: ['none', 'active', 'restored'],
			default: 'none'
		},
		reason: { kind: 'text', optional: true },
		source_oper_date: { kind: 'text', hidden: true, optional: true },
		content_hash: { kind: 'text', hidden: true, optional: true },
		approved_content_hash: { kind: 'text', hidden: true, optional: true },
		audit_seen_at: { kind: 'instant', hidden: true, optional: true },
		released_by: { kind: 'text', optional: true },
		released_at: { kind: 'instant', optional: true },
		release_log_key: { kind: 'text', hidden: true, optional: true },
		observed_at: { kind: 'instant' }
	},
	outputs: {
		default: {
			fields: 'all',
			party: { fields: ['name', 'external_code'] },
			order: { fields: ['number', 'title', 'owner'] },
			delivery: { fields: ['reference', 'status'] },
			source: { fields: ['name'] }
		},
		logistics: {
			fields: logisticsCreditRelease,
			party: { fields: ['name'] },
			order: { fields: logisticsOrder },
			delivery: { fields: logisticsDocument }
		}
	},
	constraints: { natural_key: { unique: ['source', 'external_code'], import_key: true } },
	indexes: {
		search: { text: ['bill_number', 'delivery_fid', 'oldest_overdue_bill', 'released_by'] }
	},
	create: {
		fields: [...syncFields],
		effect: function* (changes, ctx) {
			if (ctx.event.kind !== 'write') return;
			const owners = yield* orderOwners(
				ctx,
				changes.map(({ after }) => after.order)
			);
			const notices = changes.flatMap(({ after }) => {
				if (after.source_status === 'bypassed') {
					const to: Recipient[] = [{ policy: 'manager' }, { policy: 'finance' }];
					return [
						{
							to,
							title: `Unapproved Kingdee credit release: ${after.bill_number}`,
							description: `${after.bill_number} was released in Kingdee KIS by ${after.released_by ?? 'unknown'} without a matching approval.`,
							link: { model: 'credit_releases' as const, id: after.id },
							once: `cr:bypass:${after.id}`
						}
					];
				}
				if (after.source_status === 'blocked') {
					const owner = after.order ? owners.get(after.order) : undefined;
					const to: Recipient[] = [
						{ policy: 'manager' },
						{ policy: 'finance' },
						...(owner ? [{ user: owner } as const] : [])
					];
					return [
						{
							to,
							title: `Credit-blocked delivery: ${after.bill_number}`,
							description: `Delivery ${after.bill_number} is blocked by Kingdee credit control and needs release approval or settlement.`,
							link: { model: 'credit_releases' as const, id: after.id },
							once: `cr:blocked:${after.id}`
						}
					];
				}
				return [];
			});
			if (notices.length > 0) yield* ctx.notify(notices);
		}
	},
	update: {
		fields: [
			...syncFields,
			'approval_status',
			'route',
			'proposed_limit',
			'temp_bump_amount',
			'temp_bump_days',
			'reason',
			'approved_content_hash'
		],
		transform: function* (changes, ctx) {
			const sets = [];
			for (const [i, { before, set, after }] of changes.entries()) {
				if (before.approval_status === 'none' && after.approval_status === 'approved') {
					if (before.source_status !== 'blocked')
						return yield* ctx.refuse('errors.credit_release_not_blocked', { row: i });
					if (after.route !== 'one_time' && after.route !== 'permanent')
						return yield* ctx.refuse('errors.credit_route_required', { row: i, field: 'route' });
					if (after.route === 'permanent') {
						if (after.proposed_limit == null)
							return yield* ctx.refuse('errors.credit_proposed_limit', {
								row: i,
								field: 'proposed_limit'
							});
						const proposed = BigDecimal.fromStringUnsafe(after.proposed_limit);
						const current =
							before.credit_limit == null ? null : BigDecimal.fromStringUnsafe(before.credit_limit);
						if (
							BigDecimal.isNegative(proposed) ||
							(current !== null && !BigDecimal.isGreaterThan(proposed, current))
						)
							return yield* ctx.refuse('errors.credit_proposed_limit', {
								row: i,
								field: 'proposed_limit'
							});
					}
					const tempBumpAmount =
						after.route === 'one_time' &&
						before.over_limit != null &&
						BigDecimal.isGreaterThan(
							BigDecimal.fromStringUnsafe(before.over_limit),
							BigDecimal.fromBigInt(0n)
						)
							? before.over_limit
							: null;
					const tempBumpDays =
						after.route === 'one_time' && before.overdue_days != null && before.overdue_days > 0
							? before.overdue_days
							: null;
					sets.push({
						...set,
						...(after.route === 'one_time' ? { proposed_limit: null } : {}),
						temp_bump_amount: tempBumpAmount,
						temp_bump_days: tempBumpDays,
						approved_content_hash: before.content_hash
					});
					continue;
				}
				sets.push(set);
			}
			return sets;
		},
		effect: function* (changes, ctx) {
			if (ctx.event.kind !== 'write') return;
			const owners = yield* orderOwners(
				ctx,
				changes.map(({ after }) => after.order)
			);
			const notices = changes.flatMap(({ before, after }) => {
				const owner = after.order ? owners.get(after.order) : undefined;
				if (before.approval_status === 'none' && after.approval_status === 'approved') {
					const to: Recipient[] = [
						{ policy: 'finance' },
						{ policy: 'logistics' },
						...(owner ? [{ user: owner } as const] : [])
					];
					const description =
						after.route === 'permanent' && after.proposed_limit != null
							? `Raise customer credit limit to ${after.proposed_limit} ${after.currency} in Kingdee KIS and audit ${after.bill_number}.`
							: `Release ${after.bill_number} in Kingdee KIS using the credit-manager password.`;
					return [
						{
							to,
							title: `Credit release approved: ${after.bill_number}`,
							description,
							link: { model: 'credit_releases' as const, id: after.id },
							once: `cr:approved:${after.id}:${after.revision}`
						}
					];
				}
				if (before.source_status !== 'bypassed' && after.source_status === 'bypassed') {
					const to: Recipient[] = [{ policy: 'manager' }, { policy: 'finance' }];
					return [
						{
							to,
							title: `Unapproved Kingdee credit release: ${after.bill_number}`,
							description: `${after.bill_number} was released in Kingdee KIS by ${after.released_by ?? 'unknown'} without a matching approval.`,
							link: { model: 'credit_releases' as const, id: after.id },
							once: `cr:bypass:${after.id}:${after.revision}`
						}
					];
				}
				if (
					before.approval_status === 'approved' &&
					before.source_status === 'blocked' &&
					after.source_status === 'superseded'
				) {
					const to: Recipient[] = [
						{ policy: 'finance' },
						{ policy: 'logistics' },
						...(owner ? [{ user: owner } as const] : [])
					];
					return [
						{
							to,
							title: `Approved credit release superseded: ${after.bill_number}`,
							description: `${after.bill_number} was edited in Kingdee KIS after approval; do not release under the prior approval.`,
							link: { model: 'credit_releases' as const, id: after.id },
							once: `cr:superseded:${after.id}:${after.revision}`
						}
					];
				}
				return [];
			});
			if (notices.length > 0) yield* ctx.notify(notices);
		}
	}
});
