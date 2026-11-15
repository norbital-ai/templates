import { model, type Id, type WriteCtx } from '@norbital-ai/bolt';
import { addDays, interest, tenorDays } from '../../../lib/calculations.js';
import { PRODUCT_CODES } from '../../../lib/products.js';

const EDITABLE = [
	'facility',
	'supplier',
	'product',
	'status',
	'bank_reference',
	'lc_number',
	'lc_expiry_date',
	'bill_number',
	'terms_days',
	'currency',
	'amount',
	'fx_rate_to_usd',
	'application_date',
	'released_date',
	'start_date',
	'due_date',
	'interest_rate_pct',
	'rate_source',
	'charge_rate_pct',
	'day_count_basis',
	'expected_draw_date',
	'earliest_invoice_date',
	'requested_by',
	'purpose',
	'notes'
] as const;
const CHARGE_FIELDS = [
	'charge_type',
	'stage',
	'description',
	'currency',
	'amount',
	'fx_rate_to_usd'
] as const;
/** Figures the write fills from the line and its facility: tenor, interest to maturity, latest due date. */
const FILLED = ['tenor_days', 'interest_to_maturity', 'latest_due_date'] as const;

/**
 * One financing line: an earmark planned by the team, then applied to a bank, drawn, and settled (repaid, paid in
 * cash, or converted into new financing). The bank's own numbers, dates, rate and settlement figures are kept exactly
 * as its advice gives them. Actual charges are its `charges`; until a stage has one, the fee rules estimate it.
 * A settled or cancelled line is sealed.
 */
export default model('drawdown', {
	description: 'One financing line, from earmark through drawdown to settlement.',
	icon: 'lucide:hand-coins',
	record_label:
		"(record.bank_reference != null ? record.bank_reference : string(record.product)) + ' · ' + record.currency + ' ' + string(record.amount)",
	fields: {
		facility: {
			kind: 'ref',
			to: 'facility',
			inverse: 'drawdowns',
			optional: true,
			on_delete: 'restrict'
		},
		supplier: {
			kind: 'ref',
			to: 'supplier',
			inverse: 'drawdowns',
			optional: true,
			on_delete: 'restrict'
		},
		product: { kind: 'enum', values: PRODUCT_CODES, default: 'if' },
		status: {
			kind: 'enum',
			values: ['earmarked', 'applied', 'active', 'settled', 'cancelled', 'unclear'],
			default: 'active',
			transitions: {
				earmarked: ['applied', 'active', 'cancelled'],
				applied: ['active', 'cancelled'],
				active: ['settled', 'cancelled'],
				settled: [],
				cancelled: [],
				unclear: ['active', 'settled', 'cancelled']
			}
		},
		is_archived: { kind: 'bool', default: false },
		bank_reference: { kind: 'text', optional: true },
		lc_number: { kind: 'text', optional: true },
		lc_expiry_date: { kind: 'date', optional: true },
		bill_number: { kind: 'text', optional: true },
		terms_days: { kind: 'int', min: 0, optional: true },
		currency: { kind: 'currency', default: 'USD' },
		amount: { kind: 'decimal', scale: 2, min: 0 },
		fx_rate_to_usd: { kind: 'decimal', scale: 12, default: 1 },
		amount_usd: { kind: 'decimal', scale: 2, computed: 'round(amount * fx_rate_to_usd, 2)' },
		application_date: { kind: 'date', optional: true },
		released_date: { kind: 'date', optional: true },
		start_date: { kind: 'date', optional: true },
		due_date: { kind: 'date', optional: true },
		tenor_days: { kind: 'int', optional: true },
		interest_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		rate_source: { kind: 'enum', values: ['manual', 'bank_advice'], optional: true },
		interest_to_maturity: { kind: 'decimal', scale: 2, optional: true },
		charge_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		day_count_basis: {
			kind: 'enum',
			values: ['actual_360', 'actual_365'],
			default: 'actual_360'
		},
		expected_draw_date: { kind: 'date', optional: true },
		earliest_invoice_date: { kind: 'date', optional: true },
		latest_due_date: { kind: 'date', optional: true },
		requested_by: { kind: 'text', optional: true },
		purpose: { kind: 'text', optional: true },
		settlement_date: { kind: 'date', optional: true },
		settled_principal: { kind: 'decimal', scale: 2, optional: true },
		settled_interest: { kind: 'decimal', scale: 2, optional: true },
		settled_by: { kind: 'enum', values: ['repaid', 'cash', 'converted'], optional: true },
		converted_from: {
			kind: 'ref',
			to: 'drawdown',
			inverse: 'converted_into',
			optional: true,
			on_delete: 'set_null'
		},
		needs_review: { kind: 'bool', default: false },
		review_note: { kind: 'text', optional: true },
		notes: { kind: 'text', optional: true }
	},
	constraints: {
		sealed_line: {
			locked: { status: { in: ['settled', 'cancelled'] } },
			except: ['is_archived', 'needs_review', 'review_note', 'notes'],
			message: 'errors.line_sealed'
		}
	},
	indexes: {
		by_status_due: { on: ['status', 'due_date'] },
		by_reference: { text: ['bank_reference', 'lc_number', 'bill_number'] }
	},
	outputs: {
		default: {
			fields: 'all',
			facility: {
				fields: [
					'name',
					'currency',
					'limit',
					'max_tenor_days',
					'day_count_basis',
					'interest_rounding'
				],
				bank: { fields: ['code', 'name', 'cut_off_time'] }
			},
			supplier: { fields: ['name'] },
			converted_from: { fields: ['bank_reference', 'product', 'currency', 'amount'] },
			charges: { fields: [...CHARGE_FIELDS] },
			invoices: { fields: ['invoice_number', 'invoice_date', 'amount', 'bank_bill_number'] },
			documents: { fields: ['doc_type', 'advice_reference', 'advice_date', 'read_status'] },
			financings: { fields: ['purchase_order', 'is_lc'] }
		}
	},
	create: {
		fields: [...EDITABLE, 'converted_from', ...FILLED],
		filled: { fields: [...FILLED] },
		charges: { fields: [...CHARGE_FIELDS] },
		transform: function* (changes, ctx) {
			const facilities = yield* facilitiesOf(
				changes.map((c) => c.after.facility),
				ctx
			);
			return changes.map((c) => ({ ...c.set, ...figures(c.after, facilities) }));
		}
	},
	update: {
		fields: [
			...EDITABLE,
			'is_archived',
			'settlement_date',
			'settled_principal',
			'settled_interest',
			'settled_by',
			'needs_review',
			'review_note',
			// recomputed by the transform on every write, whatever a writer sends
			...FILLED
		],
		charges: { fields: [...CHARGE_FIELDS] },
		transform: function* (changes, ctx) {
			const facilities = yield* facilitiesOf(
				changes.map((c) => c.after.facility),
				ctx
			);
			return changes.map((c) => ({ ...c.set, ...figures(c.after, facilities) }));
		}
	}
});

type Terms = {
	readonly interest_rounding: 'nearest_cent' | 'down_to_cent';
	readonly max_tenor_days: number | null;
};

function* facilitiesOf(
	ids: readonly (Id<'facility'> | null | undefined)[],
	ctx: WriteCtx<'drawdown'>
) {
	const wanted = [...new Set(ids.flatMap((id) => (id == null ? [] : [id])))];
	if (wanted.length === 0) return new Map<string, Terms>();
	const { facility } = yield* ctx.query({
		facility: { where: { id: { in: wanted } }, fields: ['interest_rounding', 'max_tenor_days'] }
	});
	return new Map<string, Terms>(facility.rows.map((f) => [f.id, f]));
}

function figures(
	line: {
		readonly facility?: string | null;
		readonly amount: string;
		readonly interest_rate_pct?: string | null;
		readonly start_date?: string | null;
		readonly due_date?: string | null;
		readonly day_count_basis?: 'actual_360' | 'actual_365';
		readonly earliest_invoice_date?: string | null;
	},
	facilities: ReadonlyMap<string, Terms>
) {
	const terms = line.facility == null ? undefined : facilities.get(line.facility);
	const tenor = tenorDays(line.start_date ?? null, line.due_date ?? null);
	return {
		tenor_days: tenor,
		interest_to_maturity: interest(
			line.amount,
			line.interest_rate_pct ?? null,
			tenor,
			line.day_count_basis ?? 'actual_360',
			terms?.interest_rounding
		),
		latest_due_date:
			line.earliest_invoice_date == null || terms?.max_tenor_days == null
				? null
				: addDays(line.earliest_invoice_date, terms.max_tenor_days)
	};
}
