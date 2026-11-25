import { model } from '@norbital-ai/bolt';
import { recomputeCostEstimateTotals } from '../../../../lib/bim-pipeline.js';

const editableColumns = [
	'title',
	'project_id',
	'status',
	'currency',
	'bim_assets',
	'contingency_pct',
	'analyzed_at',
	'notes'
] as const;

export default model('cost_estimates', {
	description:
		'Single BIM cost estimation per project built by classifying IFC assets from the project BIM model against the Costing Matrix.',
	icon: 'lucide:calculator',
	record_label:
		"record.estimate_number != null ? record.estimate_number + ' · ' + record.title : record.title",
	fields: {
		estimate_number: { kind: 'seq', pattern: 'EST-{yyyy}-{000}', per: ['project_id'] },
		title: { kind: 'text' },
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['reviewed', 'baselined', 'void'] },
				reviewed: { to: ['baselined', 'draft', 'void'] },
				baselined: { to: ['draft', 'void'] },
				void: { to: ['draft'] }
			}
		},
		currency: { kind: 'currency', default: 'SGD' },
		bim_asset_count: { kind: 'int', min: 0, default: 0 },
		classified_asset_count: { kind: 'int', min: 0, default: 0 },
		unmatched_asset_count: { kind: 'int', min: 0, default: 0 },
		/** Quantified BIM asset takeoff lines classified and cross-checked against `cost_matrix`. */
		bim_assets: { kind: 'custom', of: 'bim_takeoff', optional: true },
		bim_subtotal: { kind: 'money', currency: 'currency', default: 0 },
		contingency_pct: { kind: 'decimal', scale: 2, default: 5 },
		contingency_amount: { kind: 'money', currency: 'currency', default: 0 },
		total_estimate: { kind: 'money', currency: 'currency', default: 0 },
		analyzed_at: { kind: 'instant', optional: true },
		notes: { kind: 'text', format: 'markdown', optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'cost_estimates', owned: true }
	},
	constraints: {
		one_per_project: { unique: ['project_id'] },
		valid_contingency: { check: { contingency_pct: { gte: 0, lte: 100 } } },
		/** Baselined estimates lock takeoff, rates, and totals until explicitly returned to draft. */
		baselined_locked: {
			locked: { status: { eq: 'baselined' } },
			except: ['status', 'notes']
		}
	},
	indexes: {
		by_project_status: { on: ['project_id', 'status'] },
		find: { text: ['estimate_number', 'title', 'notes'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] }
		}
	},
	create: {
		fields: editableColumns.filter((f) => f !== 'status'),
		transform: function* (changes) {
			return changes.map(({ set, after }) => {
				const computed = recomputeCostEstimateTotals({
					bim_assets: after.bim_assets,
					contingency_pct: after.contingency_pct
				});
				return {
					...set,
					bim_asset_count: computed.bim_asset_count,
					classified_asset_count: computed.classified_asset_count,
					unmatched_asset_count: computed.unmatched_asset_count,
					...(computed.bim_assets ? { bim_assets: computed.bim_assets } : {}),
					bim_subtotal: computed.bim_subtotal,
					contingency_amount: computed.contingency_amount,
					total_estimate: computed.total_estimate
				};
			});
		}
	},
	update: {
		fields: editableColumns.filter((f) => f !== 'project_id'),
		transform: function* (changes) {
			return changes.map((c) => {
				const recompute = c.changed('bim_assets', 'contingency_pct');
				if (!recompute) return c.set;
				const computed = recomputeCostEstimateTotals({
					bim_assets: c.after.bim_assets,
					contingency_pct: c.after.contingency_pct
				});
				return {
					...c.set,
					bim_asset_count: computed.bim_asset_count,
					classified_asset_count: computed.classified_asset_count,
					unmatched_asset_count: computed.unmatched_asset_count,
					...(computed.bim_assets ? { bim_assets: computed.bim_assets } : {}),
					bim_subtotal: computed.bim_subtotal,
					contingency_amount: computed.contingency_amount,
					total_estimate: computed.total_estimate
				};
			});
		}
	}
});
