import { automation } from '@norbital-ai/bolt';
import { PRODUCT_CODES } from '../lib/products.js';

/**
 * Treasury puts an earmark on a bank line: the facility, the product and, if negotiated, the agreed rate and charge
 * rate. The line takes the facility's day basis; the agreed charge rate replaces the bank's commission in estimates
 * until the advice arrives. Allocating past the line's headroom is allowed and shown as a warning on the line.
 */
export default automation({
	description: 'Allocate an earmark to a bank line, with the product and any agreed rate.',
	input: {
		earmark: { kind: 'rows', of: 'drawdown' },
		facility: { kind: 'ref', to: 'facility' },
		product: { kind: 'enum', values: PRODUCT_CODES, optional: true },
		interest_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		charge_rate_pct: { kind: 'decimal', scale: 6, optional: true }
	},
	policies: ['treasury'],
	run: function* ({ earmark, facility, product, interest_rate_pct, charge_rate_pct }, ctx) {
		const row = earmark.findIndex((d) => d.status !== 'earmarked');
		if (row >= 0) return yield* ctx.refuse('errors.not_earmark', { row });
		const { facility: found } = yield* ctx.query({
			facility: { where: { id: { eq: facility } }, fields: ['day_count_basis', 'status'], limit: 1 }
		});
		const terms = found.rows[0];
		if (terms === undefined || terms.status !== 'active')
			return yield* ctx.refuse('errors.facility_inactive');
		yield* ctx.act({
			'drawdown.update': earmark.map((target) => ({
				target,
				set: {
					facility,
					day_count_basis: terms.day_count_basis,
					...(product == null ? {} : { product }),
					...(interest_rate_pct == null
						? {}
						: { interest_rate_pct, rate_source: 'manual' as const }),
					charge_rate_pct: charge_rate_pct ?? null
				}
			}))
		});
	}
});
