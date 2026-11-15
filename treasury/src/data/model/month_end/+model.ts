import { model } from '@norbital-ai/bolt';

const FIGURES = [
	'credit_line',
	'bank_borrowings',
	'letters_of_credit',
	'term_bills',
	'banker_guarantee',
	'total_utilised',
	'available',
	'accrued_interest',
	'highest_rate_pct',
	'lowest_rate_pct',
	'simple_average_rate_pct',
	'weighted_average_rate_pct',
	'average_tenor_days'
] as const;
const LINE_FIELDS = [
	'drawdown',
	'bank_code',
	'product',
	'reference',
	'supplier',
	'currency',
	'amount',
	'fx_rate_to_usd',
	'amount_usd',
	'interest_rate_pct',
	'day_count_basis',
	'start_date',
	'due_date',
	'tenor_days',
	'accrued_days',
	'accrued_interest',
	'interest_to_maturity',
	'charges'
] as const;

/**
 * A closed month: `month_end_lock` copies every line owed at the month-end and the headline figures, so later edits
 * never change it. While locked only the lock itself and the notes change; unlocking lets the month follow live data
 * until it is locked again. A month never locked is reported live (Month-end page).
 */
export default model('month_end', {
	description: 'A month-end report, and whether it is locked.',
	icon: 'lucide:calendar-check',
	record_label: 'string(record.month)',
	fields: {
		month: { kind: 'date' },
		is_locked: { kind: 'bool', default: false },
		locked_at: { kind: 'instant', optional: true },
		source: { kind: 'enum', values: ['portal', 'excel'], default: 'portal' },
		credit_line: { kind: 'decimal', scale: 2, optional: true },
		bank_borrowings: { kind: 'decimal', scale: 2, optional: true },
		letters_of_credit: { kind: 'decimal', scale: 2, optional: true },
		term_bills: { kind: 'decimal', scale: 2, optional: true },
		banker_guarantee: { kind: 'decimal', scale: 2, optional: true },
		total_utilised: { kind: 'decimal', scale: 2, optional: true },
		available: { kind: 'decimal', scale: 2, optional: true },
		accrued_interest: { kind: 'decimal', scale: 2, optional: true },
		highest_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		lowest_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		simple_average_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		weighted_average_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		average_tenor_days: { kind: 'decimal', scale: 2, optional: true },
		notes: { kind: 'text', optional: true }
	},
	constraints: {
		one_report_per_month: { unique: ['month'] },
		locked_month: {
			locked: { is_locked: { eq: true } },
			except: ['is_locked', 'notes'],
			message: 'errors.month_locked'
		}
	},
	outputs: {
		default: { fields: 'all', lines: { fields: [...LINE_FIELDS] } }
	},
	create: {
		fields: ['month', 'is_locked', 'locked_at', 'source', ...FIGURES, 'notes'],
		lines: { fields: [...LINE_FIELDS] }
	},
	update: {
		fields: ['is_locked', 'locked_at', 'source', ...FIGURES, 'notes'],
		lines: { fields: [...LINE_FIELDS] }
	}
});
