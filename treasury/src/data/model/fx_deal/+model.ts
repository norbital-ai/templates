import { model } from '@norbital-ai/bolt';
import { FX_STRUCTURES } from '../../../lib/fx.js';

const TERMS = [
	'bank',
	'bank_reference',
	'structure',
	'structure_as_written',
	'pair',
	'side',
	'trade_date',
	'notional_currency',
	'notional',
	'leveraged_notional',
	'strike',
	'knock_out',
	'knock_out_type',
	'knock_in',
	'spot_reference',
	'forward_reference',
	'forward_reference_date',
	'target',
	'target_rule',
	'dci_deposit_currency',
	'dci_deposit_amount',
	'dci_yield_pct',
	'terms',
	'status',
	'ended_on',
	'view_direction',
	'view_rate',
	'view_date',
	'notes'
] as const;
const FIXING_FIELDS = [
	'fixing_date',
	'settlement_date',
	'notional',
	'leveraged_notional',
	'strike',
	'firm',
	'condition',
	'condition_side',
	'condition_level',
	'fixing_rate',
	'outcome',
	'settled_amount',
	'note'
] as const;

/**
 * One FX hedge with a bank, or a banker's proposal for one: a forward, target redemption forward, knock-out forward,
 * dual currency investment and the rest, on a pair of currencies where the company sells or buys the first. Its terms
 * come from the term sheet or confirmation (read automatically) or a proposal; each fixing is a child row. A proposal
 * becomes a deal to confirm when it is traded, and a deal to confirm becomes live once its terms are checked. Whether
 * a live deal has ended (its last fixing passed, a knock-out or its target reached, a termination notice) is worked
 * out from its fixings, never typed in.
 */
export default model('fx_deal', {
	description: 'An FX hedge with a bank, or a proposal for one, with its fixings.',
	icon: 'lucide:arrow-left-right',
	record_label:
		"(record.bank_reference != null ? record.bank_reference : record.pair) + ' · ' + string(record.structure)",
	fields: {
		bank: { kind: 'ref', to: 'bank', inverse: 'fx_deals', optional: true, on_delete: 'set_null' },
		proposal: {
			kind: 'ref',
			to: 'fx_proposal',
			inverse: 'alternatives',
			optional: true,
			on_delete: 'set_null'
		},
		bank_reference: { kind: 'text', max: 100, optional: true },
		structure: { kind: 'enum', values: FX_STRUCTURES, default: 'fwd' },
		/** The bank's own name for the structure. */
		structure_as_written: { kind: 'text', optional: true },
		/** Six letters, the base currency first: USDSGD is one USD in SGD. */
		pair: { kind: 'text', max: 6 },
		/** Whether the company sells or buys the base currency. */
		side: { kind: 'enum', values: ['sell', 'buy'], optional: true },
		trade_date: { kind: 'date', optional: true },
		/** The currency amounts are printed in; empty means the base currency. */
		notional_currency: { kind: 'currency', optional: true },
		notional: { kind: 'decimal', scale: 2, optional: true },
		/** The amount on a fixing that goes against the company, when leveraged. */
		leveraged_notional: { kind: 'decimal', scale: 2, optional: true },
		strike: { kind: 'decimal', scale: 8, optional: true },
		knock_out: { kind: 'decimal', scale: 8, optional: true },
		knock_out_type: { kind: 'enum', values: ['at_expiry', 'continuous'], optional: true },
		knock_in: { kind: 'decimal', scale: 8, optional: true },
		spot_reference: { kind: 'decimal', scale: 8, optional: true },
		forward_reference: { kind: 'decimal', scale: 8, optional: true },
		forward_reference_date: { kind: 'date', optional: true },
		/** A target redemption forward's target, in quote currency per unit of base. */
		target: { kind: 'decimal', scale: 8, optional: true },
		/** What the fixing that reaches the target pays: its share, all of it, or nothing. */
		target_rule: { kind: 'enum', values: ['prorata', 'full', 'none'], default: 'prorata' },
		dci_deposit_currency: { kind: 'currency', optional: true },
		dci_deposit_amount: { kind: 'decimal', scale: 2, optional: true },
		dci_yield_pct: { kind: 'decimal', scale: 4, optional: true },
		terms: { kind: 'text', optional: true },
		status: {
			kind: 'enum',
			values: ['proposal', 'draft', 'live'],
			default: 'draft',
			transitions: { proposal: ['draft'], draft: ['live'], live: [] }
		},
		/** Ended early from this date (a termination notice). */
		ended_on: { kind: 'date', optional: true },
		/** A person's view of the pair, weighed against the deal. */
		view_direction: { kind: 'enum', values: ['up', 'down', 'flat'], optional: true },
		view_rate: { kind: 'decimal', scale: 8, optional: true },
		view_date: { kind: 'date', optional: true },
		notes: { kind: 'text', optional: true }
	},
	indexes: { by_reference: { text: ['bank_reference', 'pair', 'structure_as_written'] } },
	outputs: {
		default: {
			fields: 'all',
			bank: { fields: ['code', 'name'] },
			proposal: { fields: ['title'] },
			fixings: { fields: [...FIXING_FIELDS] },
			documents: { fields: ['kind', 'bank_reference', 'trade_date', 'read_status', 'file'] }
		}
	},
	create: {
		fields: [...TERMS, 'proposal'],
		fixings: { fields: [...FIXING_FIELDS] },
		transform: function* (changes, ctx) {
			const row = changes.findIndex((c) => pairOf(c.after.pair) === null);
			if (row >= 0) return yield* ctx.refuse('errors.fx_pair', { row });
			return changes.map((c) => ({ ...c.set, pair: pairOf(c.after.pair) ?? c.after.pair }));
		}
	},
	update: {
		fields: [...TERMS],
		fixings: { fields: [...FIXING_FIELDS] },
		transform: function* (changes, ctx) {
			const row = changes.findIndex((c) => c.changed('pair') && pairOf(c.after.pair) === null);
			if (row >= 0) return yield* ctx.refuse('errors.fx_pair', { row });
			return changes.map((c) =>
				c.changed('pair') ? { ...c.set, pair: pairOf(c.after.pair) ?? c.after.pair } : c.set
			);
		}
	},
	delete: {}
});

/** A pair as six capital letters ("usd/sgd" → USDSGD), or null. */
const pairOf = (pair: string) => {
	const letters = pair.toUpperCase().replace(/[^A-Z]/g, '');
	return letters.length === 6 ? letters : null;
};
