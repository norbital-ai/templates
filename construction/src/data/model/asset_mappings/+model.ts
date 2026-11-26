import { model } from '@norbital-ai/bolt';

const columns = [
	'signature',
	'label',
	'ifc_class',
	'continuity',
	'service',
	'size_mm',
	'picture',
	'item_id',
	'source',
	'review_status',
	'confidence',
	'cleanup_note',
	'note'
] as const;

/**
 * What a unique BIM asset is priced as, remembered by its dimension-aware signature across takeoffs and projects.
 * System 1 decides it once; a human QS verifying or amending the item, class, continuity, or service makes it
 * `qs` + `verified`, which wins from then on; an approved System 2 proposal makes it `proposal`.
 */
export default model('asset_mappings', {
	description:
		'What each unique BIM asset is priced as, remembered across takeoffs and projects: decided by System 1, verified or amended by a QS, or an approved System 2 proposal.',
	icon: 'lucide:shapes',
	record_label: 'record.label',
	fields: {
		/** The asset's dimension-aware identity signature (`assetSignature`). */
		signature: { kind: 'text' },
		/** The names the asset was modelled under. */
		label: { kind: 'text' },
		/** Canonical IFC class (auto-cleaned from generic proxies/IFC2x3 types or amended by a QS). */
		ifc_class: { kind: 'text' },
		/** Whether this asset is discrete (`discontiguous`), a continuous run (`contiguous_linear`), or surface (`contiguous_planar`). */
		continuity: {
			kind: 'enum',
			values: ['discontiguous', 'contiguous_linear', 'contiguous_planar'],
			default: 'discontiguous'
		},
		/** Resolved MEP / trade service tag (e.g. `hydronic_hvac`, `domestic_cold_water`, `sanitary_dwv`). */
		service: { kind: 'text', optional: true },
		/** Nominal cross-section / thickness / dimension summary (e.g. `DN25`, `150mm`, `900×2100mm`). */
		size_mm: { kind: 'text', optional: true },
		/** The asset alone from four angles (with local context view for linear/proxy assets), as System 1 saw it. */
		picture: { kind: 'file', accept: ['image/jpeg'], max: '1MiB', optional: true },
		/** The Item Matrix item it is priced as; empty while nothing in the matrix covers it. */
		item_id: {
			kind: 'ref',
			to: 'item_matrix',
			inverse: 'asset_mappings',
			optional: true,
			on_delete: 'set_null'
		},
		source: { kind: 'enum', values: ['system_1', 'qs', 'proposal'], default: 'system_1' },
		/** Human-in-the-loop verification state: `flagged` (unmatched, low-confidence, auto-reclassified, or quantity variance), `pending`, or `verified`. */
		review_status: {
			kind: 'enum',
			values: ['pending', 'verified', 'flagged'],
			default: 'pending'
		},
		confidence: { kind: 'decimal', scale: 2, optional: true },
		/** Audit trail of automatic BIM cleanup applied to this asset (class upgrade, service propagation, etc.). */
		cleanup_note: { kind: 'text', optional: true },
		note: { kind: 'text', optional: true }
	},
	constraints: { one_per_signature: { unique: ['signature'], import_key: true } },
	indexes: {
		find: { text: ['label', 'ifc_class', 'service', 'size_mm'] },
		by_review: { on: ['review_status'] }
	},
	outputs: {
		default: {
			fields: 'all',
			item_id: { fields: ['code', 'name', 'unit', 'active', 'trade_specialty'] }
		}
	},
	create: { fields: columns },
	update: {
		fields: columns,
		transform: function* (changes, ctx) {
			// A person amending the item, class, continuity, service, or verifying makes it a QS override that wins from then on.
			return changes.map((c) => {
				if (ctx.actor.kind !== 'member') return c.set;
				const amended =
					c.changed('item_id') ||
					c.changed('ifc_class') ||
					c.changed('continuity') ||
					c.changed('service');
				const verified = c.changed('review_status') && c.after.review_status === 'verified';
				if (!amended && !verified) return c.set;
				return {
					...c.set,
					source: 'qs' as const,
					...(c.changed('review_status') ? {} : { review_status: 'verified' as const })
				};
			});
		}
	}
});
