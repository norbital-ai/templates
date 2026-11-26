import { model } from '@norbital-ai/bolt';

const columns = [
	'signature',
	'label',
	'ifc_class',
	'picture',
	'item_id',
	'source',
	'confidence',
	'note'
] as const;

/**
 * What a unique BIM asset is priced as, remembered by its signature (identity and size, names left out) across
 * takeoffs and projects. System 1 decides it once; a QS correcting the item makes it `qs`, which wins from then on;
 * an approved System 2 proposal makes it `proposal`.
 */
export default model('asset_mappings', {
	description:
		'What each unique BIM asset is priced as, remembered across takeoffs and projects: decided by System 1, corrected by a QS, or an approved System 2 proposal.',
	icon: 'lucide:shapes',
	record_label: 'record.label',
	fields: {
		/** The asset's identity and size, names left out (`assetSignature`). */
		signature: { kind: 'text' },
		/** The names the asset was modelled under. */
		label: { kind: 'text' },
		ifc_class: { kind: 'text' },
		/** The asset alone from four angles, as System 1 saw it. */
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
		confidence: { kind: 'decimal', scale: 2, optional: true },
		note: { kind: 'text', optional: true }
	},
	constraints: { one_per_signature: { unique: ['signature'], import_key: true } },
	indexes: { find: { text: ['label', 'ifc_class'] } },
	outputs: {
		default: {
			fields: 'all',
			item_id: { fields: ['code', 'name', 'unit', 'active'] }
		}
	},
	create: { fields: columns },
	update: {
		fields: columns,
		transform: function* (changes, ctx) {
			// a person choosing what an asset is priced as is a QS correction: it wins over System 1 from then on
			return changes.map((c) =>
				ctx.actor.kind === 'member' && c.changed('item_id')
					? { ...c.set, source: 'qs' as const }
					: c.set
			);
		}
	}
});
