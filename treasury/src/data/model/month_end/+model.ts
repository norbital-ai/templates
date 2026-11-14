import { model } from '@norbital-ai/bolt';
/**
 * One month's figures. Locking a month copies every open line into `month_end_line`, so later
 * edits never change a closed month.
 */
export default model('month_end', {
	description: 'A month-end report, and whether it is locked.',
	icon: 'lucide:calendar-check',
	record_label: 'record.month',
	fields: {
		month: { kind: 'date' },
		is_locked: { kind: 'bool', default: false },
		source: { kind: 'enum', values: ['portal', 'excel'], default: 'portal' },
		credit_line: { kind: 'decimal', scale: 2, optional: true },
		bank_borrowings: { kind: 'decimal', scale: 2, optional: true },
		letters_of_credit: { kind: 'decimal', scale: 2, optional: true },
		term_bills: { kind: 'decimal', scale: 2, optional: true },
		banker_guarantee: { kind: 'decimal', scale: 2, optional: true },
		total_utilised: { kind: 'decimal', scale: 2, optional: true },
		accrued_interest: { kind: 'decimal', scale: 2, optional: true },
		highest_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		lowest_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		simple_average_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		weighted_average_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		average_tenor_days: { kind: 'decimal', scale: 2, optional: true },
		notes: { kind: 'text', optional: true }
	},
	constraints: {
		one_report_per_month: { unique: ['month'] }
	},
	outputs: {
		default: {
			fields: 'all',
			lines: {
				fields: [
					'bank_code',
					'product',
					'reference',
					'supplier',
					'currency',
					'amount',
					'amount_usd',
					'interest_rate_pct',
					'accrued_days',
					'accrued_interest',
					'interest_to_maturity',
					'charges'
				]
			}
		}
	},
	create: { fields: ['month', 'notes'] },
	update: {
		fields: [
			'month',
			'is_locked',
			'source',
			'credit_line',
			'bank_borrowings',
			'letters_of_credit',
			'term_bills',
			'banker_guarantee',
			'total_utilised',
			'accrued_interest',
			'highest_rate_pct',
			'lowest_rate_pct',
			'simple_average_rate_pct',
			'weighted_average_rate_pct',
			'average_tenor_days',
			'notes'
		],
		lines: {
			fields: [
				'bank_code',
				'product',
				'reference',
				'supplier',
				'currency',
				'amount',
				'amount_usd',
				'interest_rate_pct',
				'accrued_days',
				'accrued_interest',
				'interest_to_maturity',
				'charges'
			]
		}
	}
});
