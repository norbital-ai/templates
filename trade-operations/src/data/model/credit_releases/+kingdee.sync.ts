import { BigDecimal } from 'effect';
import { sync } from '@norbital-ai/bolt';
import {
	kingdeeCreditPolicyOf,
	kingdeeOrgCreditPolicy
} from '../../../integration/kingdee/configuration.js';
import {
	applyTempCreditBump,
	writeCustomerCreditLimit
} from '../../../integration/kingdee/credit-limit-write.js';
import { readCreditReleaseSource } from '../../../integration/kingdee/credit-release-source.js';
import { fromSource } from '../../../integration/kingdee/polling.js';
import { fixedDecimal } from '../../../lib/purchase-listing.js';

export default sync('credit_releases', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '1min',
	read: function* ({ cursor, instance, local_unchanged }, ctx) {
		return fromSource(
			yield* readCreditReleaseSource(instance, cursor, ctx, local_unchanged),
			instance
		);
	},
	write: function* ({ op, row, changed, instance }, ctx) {
		if (
			op !== 'update' ||
			row.source !== instance ||
			row.approval_status !== 'approved' ||
			row.source_status !== 'blocked' ||
			!changed.some(
				(field) =>
					field === 'approval_status' ||
					field === 'route' ||
					field === 'proposed_limit' ||
					field === 'temp_bump_amount' ||
					field === 'temp_bump_days'
			)
		)
			return null;
		// Re-read the live row so a delayed outbox delivery after a network outage never bumps a DO
		// that was already released, cleared, superseded, or withdrawn while offline.
		const live = (yield* ctx.query({
			credit_releases: {
				where: { id: { eq: row.id } },
				fields: [
					'external_code',
					'party',
					'source_status',
					'approval_status',
					'route',
					'proposed_limit',
					'credit_limit',
					'credit_days',
					'temp_bump_amount',
					'temp_bump_days',
					'temp_bump_status'
				],
				limit: 1
			}
		})).credit_releases.rows[0];
		if (!live || live.source_status !== 'blocked' || live.approval_status !== 'approved')
			return null;
		const party = (yield* ctx.query({
			parties: {
				where: { id: { eq: live.party } },
				fields: ['external_code', 'kind', 'currency'],
				limit: 1
			}
		})).parties.rows[0];
		if (!party || party.kind === 'supplier' || party.currency !== 'CNY') return null;
		if (live.route === 'permanent' && live.proposed_limit != null) {
			const written = yield* writeCustomerCreditLimit(
				{ partyCode: party.external_code, limit: live.proposed_limit },
				ctx
			);
			return written && { $id: live.external_code };
		}
		if (
			live.route === 'one_time' &&
			kingdeeCreditPolicyOf(ctx.configuration.creditPolicy) !== kingdeeOrgCreditPolicy &&
			live.temp_bump_status !== 'restored' &&
			(live.temp_bump_amount != null || live.temp_bump_days != null)
		) {
			// Accumulate across any concurrently active approved one-time bumps on the same customer
			// so overlapping DOs have enough combined headroom without shifting the unbumped baseline.
			const { credit_releases: sameParty } = yield* ctx.query({
				credit_releases: {
					where: {
						source: { eq: instance },
						party: { eq: live.party },
						approval_status: { eq: 'approved' },
						route: { eq: 'one_time' },
						temp_bump_status: { ne: 'restored' }
					},
					fields: [
						'source_status',
						'credit_limit',
						'credit_days',
						'temp_bump_amount',
						'temp_bump_days',
						'temp_bump_status'
					],
					limit: 200
				}
			});
			const activeWave = sameParty.rows.filter(
				(r) => r.id === live.id || r.source_status === 'blocked' || r.temp_bump_status === 'active'
			);
			let baseLimit: BigDecimal.BigDecimal | null = null;
			let totalBump = BigDecimal.fromBigInt(0n);
			let hasBumpAmount = false;
			let baseDays: number | null = null;
			let maxBumpDays: number | null = null;
			for (const entry of activeWave) {
				if (entry.credit_limit != null) {
					const val = BigDecimal.fromStringUnsafe(entry.credit_limit);
					if (baseLimit === null || BigDecimal.isLessThan(val, baseLimit)) baseLimit = val;
				}
				if (entry.temp_bump_amount != null) {
					const amt = BigDecimal.fromStringUnsafe(entry.temp_bump_amount);
					if (BigDecimal.isPositive(amt)) {
						totalBump = BigDecimal.sum(totalBump, amt);
						hasBumpAmount = true;
					}
				}
				if (entry.credit_days != null) {
					if (baseDays === null || entry.credit_days < baseDays) baseDays = entry.credit_days;
				}
				if (entry.temp_bump_days != null && entry.temp_bump_days > 0) {
					if (maxBumpDays === null || entry.temp_bump_days > maxBumpDays)
						maxBumpDays = entry.temp_bump_days;
				}
			}
			const written = yield* applyTempCreditBump(
				{
					partyCode: party.external_code,
					baseLimit: baseLimit !== null ? fixedDecimal(baseLimit, 2) : live.credit_limit,
					bumpAmount: hasBumpAmount ? fixedDecimal(totalBump, 2) : live.temp_bump_amount,
					baseDays: baseDays ?? live.credit_days,
					bumpDays: maxBumpDays ?? live.temp_bump_days
				},
				ctx
			);
			return written && { $id: live.external_code };
		}
		return null;
	}
});
