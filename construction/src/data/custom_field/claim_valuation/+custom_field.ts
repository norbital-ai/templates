import { custom_field } from '@norbital-ai/bolt';
import { BigDecimal, Option } from 'effect';

/**
 * Co-located client progress valuation breakdown for inflow payment claims.
 * All monetary and percentage fields are exact decimal strings (BigDecimal).
 */
export default custom_field({
	description: 'Client progress valuation figures and BOQ snapshot lines.',
	shape: {
		kind: 'object',
		fields: {
			gross_work_done: { kind: 'text' },
			approved_variations_amount: { kind: 'text' },
			retention_held: { kind: 'text' },
			previous_certified_amount: { kind: 'text' },
			lines: {
				kind: 'object',
				many: true,
				optional: true,
				fields: {
					code: { kind: 'text' },
					description: { kind: 'text' },
					cost_group: { kind: 'text' },
					contract_amount: { kind: 'text' },
					progress_pct: { kind: 'text' },
					gross_value: { kind: 'text' },
					retention_exempt: { kind: 'bool' }
				}
			}
		}
	},
	validate: (value) => {
		const nums = [
			value.gross_work_done,
			value.approved_variations_amount,
			value.retention_held,
			value.previous_certified_amount
		];
		for (const n of nums) {
			if (Option.isNone(BigDecimal.fromString(n.trim()))) {
				return 'Valuation totals must be exact decimal values.';
			}
		}
		return undefined;
	}
});
