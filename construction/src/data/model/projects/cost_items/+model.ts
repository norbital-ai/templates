import { model } from '@norbital-ai/bolt';
import { computeCostLine } from '../../../../lib/claims.js';
import { validateProjectZones } from '../../../../lib/zones.js';

const editableColumns = [
	'item_code',
	'description',
	'project_id',
	'zone',
	'cost_group',
	'unit',
	'currency',
	'contract_qty',
	'unit_rate',
	'claim_basis',
	'progress_pct',
	'completed_qty',
	'retention_exempt',
	'notes'
] as const;

export default model('cost_items', {
	description:
		'Configurable BOQ and Schedule of Values lines used to calculate claimable valuation and budget control.',
	icon: 'lucide:calculator',
	record_label:
		"record.item_code != null ? record.item_code + ' · ' + record.description : record.description",
	fields: {
		item_code: { kind: 'text', optional: true },
		description: { kind: 'text' },
		zone: { kind: 'text', optional: true },
		cost_group: {
			kind: 'enum',
			values: [
				'preliminaries',
				'substructure',
				'superstructure',
				'architecture',
				'mep',
				'external_works',
				'provisional_sum',
				'variation'
			],
			default: 'superstructure'
		},
		unit: { kind: 'text', optional: true },
		currency: { kind: 'currency', default: 'SGD' },
		contract_qty: { kind: 'decimal', scale: 3, default: 1 },
		unit_rate: { kind: 'money', currency: 'currency', default: 0 },
		contract_amount: { kind: 'money', currency: 'currency', default: 0 },
		claim_basis: {
			kind: 'enum',
			values: ['percentage', 'measured_qty', 'milestone'],
			default: 'percentage'
		},
		progress_pct: { kind: 'decimal', scale: 1, default: 0 },
		completed_qty: { kind: 'decimal', scale: 3, default: 0 },
		claimable_amount: { kind: 'money', currency: 'currency', default: 0 },
		retention_exempt: { kind: 'bool', default: false },
		notes: { kind: 'text', optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'cost_items', owned: true }
	},
	constraints: {
		valid_progress: { check: { progress_pct: { gte: 0, lte: 100 } } },
		valid_contract_qty: { check: { contract_qty: { gte: 0 } } },
		valid_completed_qty: { check: { completed_qty: { gte: 0 } } }
	},
	indexes: { find: { text: ['item_code', 'description', 'zone'] } },
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] }
		}
	},
	create: {
		fields: editableColumns,
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			return changes.map(({ set, after }) => {
				const computed = computeCostLine({
					contract_qty: after.contract_qty,
					unit_rate: after.unit_rate,
					completed_qty: after.completed_qty,
					progress_pct: after.progress_pct,
					claim_basis: after.claim_basis
				});
				return { ...set, ...computed };
			});
		}
	},
	update: {
		fields: editableColumns.filter((f) => f !== 'project_id'),
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			return changes.map(({ set, after }) => {
				const computed = computeCostLine({
					contract_qty: after.contract_qty,
					unit_rate: after.unit_rate,
					completed_qty: after.completed_qty,
					progress_pct: after.progress_pct,
					claim_basis: after.claim_basis
				});
				return { ...set, ...computed };
			});
		}
	},
	delete: {}
});
