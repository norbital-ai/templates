import { model, type Actor } from '@norbital-ai/bolt';
import { monthStart } from '../../../lib/calculations.js';

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
		imported_report: {
			locked: { source: { eq: 'excel' } },
			except: ['notes'],
			message: 'errors.month_imported'
		},
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
		lines: { fields: [...LINE_FIELDS] },
		transform: function* (changes, ctx) {
			const closing = isCloser(ctx.actor, 'month_end_lock');
			const row = changes.findIndex(
				(c) => c.after.source === 'portal' && (c.after.is_locked || hasFigures(c.set)) && !closing
			);
			if (row >= 0) return yield* ctx.refuse('errors.month_figures_readonly', { row });
			return changes.map((c) => ({
				...c.set,
				month: monthStart(c.after.month),
				...(c.after.source === 'excel' ? { is_locked: true } : {})
			}));
		}
	},
	update: {
		fields: ['is_locked', 'locked_at', ...FIGURES, 'notes'],
		lines: { fields: [...LINE_FIELDS] },
		transform: function* (changes, ctx) {
			const locked = changes.findIndex((c) => c.before.is_locked && c.set.lines !== undefined);
			if (locked >= 0) return yield* ctx.refuse('errors.month_locked', { row: locked });
			const closing = isCloser(ctx.actor, 'month_end_lock');
			const opening = isCloser(ctx.actor, 'month_end_unlock');
			const row = changes.findIndex(
				(c) =>
					(hasFigures(c.set) && !closing) ||
					(c.changed('is_locked') && !(c.after.is_locked ? closing : opening))
			);
			if (row >= 0) return yield* ctx.refuse('errors.month_figures_readonly', { row });
			return changes.map((c) => c.set);
		}
	}
});

/** Figures are immutable closing evidence, owned by the native calculation run rather than hand-entered fields. */
const hasFigures = (set: object) =>
	['locked_at', 'lines', ...FIGURES].some((field) => Object.hasOwn(set, field));
const isCloser = (actor: Actor, automation: 'month_end_lock' | 'month_end_unlock') =>
	actor.kind === 'system' && 'automation' in actor.by && actor.by.automation === automation;
