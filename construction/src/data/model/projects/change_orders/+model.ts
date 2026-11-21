import { model } from '@norbital-ai/bolt';
import { computeChangeOrderImpact } from '../../../../lib/claims.js';
import { validateProjectZones } from '../../../../lib/zones.js';

const columns = [
	'title',
	'project_id',
	'zone',
	'cost_item_id',
	'change_type',
	'status',
	'currency',
	'lines',
	'cost_impact',
	'schedule_impact_days',
	'requested_by',
	'effective_date',
	'approved_date',
	'bim_file_id',
	'bim_pin',
	'description',
	'justification',
	'attachments',
	'source_message_id'
] as const;

export default model('change_orders', {
	description:
		'Project changes, variation orders (VOs), architect/site instructions, and EOT claims with co-located line pricing.',
	icon: 'lucide:git-pull-request',
	record_label:
		"record.change_number != null ? record.change_number + ' · ' + record.title : record.title",
	fields: {
		change_number: { kind: 'seq', pattern: 'VO-{yyyy}-{000}', per: ['project_id'] },
		title: { kind: 'text' },
		zone: { kind: 'text', optional: true },
		change_type: {
			kind: 'enum',
			values: [
				'variation_order',
				'architect_instruction',
				'site_instruction',
				'design_change',
				'eot',
				'omission'
			],
			default: 'variation_order'
		},
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['submitted', 'withdrawn'] },
				submitted: { to: ['under_review', 'approved', 'rejected', 'draft'] },
				under_review: { to: ['approved', 'rejected', 'draft'] },
				approved: { to: [] },
				rejected: { to: ['draft'] },
				withdrawn: { to: ['draft'] }
			}
		},
		currency: { kind: 'currency', default: 'SGD' },
		/** Co-located priced lines; when provided, `cost_impact` auto-sums from them. */
		lines: { kind: 'custom', of: 'priced_lines', optional: true },
		cost_impact: { kind: 'money', currency: 'currency', default: 0 },
		schedule_impact_days: { kind: 'int', default: 0 },
		requested_by: { kind: 'text', optional: true },
		effective_date: { kind: 'date', optional: true },
		approved_date: { kind: 'date', optional: true },
		/** Co-located 3D BIM element pin when a variation targets a specific IFC element. */
		bim_pin: { kind: 'custom', of: 'bim_pin', optional: true },
		description: { kind: 'text', format: 'markdown', optional: true },
		justification: { kind: 'text', format: 'markdown', optional: true },
		attachments: { kind: 'file', accept: ['*/*'], max: '20MiB', many: true, optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'change_orders', owned: true },
		cost_item_id: {
			kind: 'ref',
			to: 'cost_items',
			inverse: 'change_orders',
			optional: true,
			on_delete: 'set_null'
		},
		bim_file_id: {
			kind: 'ref',
			to: 'project_files',
			inverse: 'change_orders',
			optional: true,
			on_delete: 'set_null'
		},
		source_message_id: {
			kind: 'ref',
			to: 'project_messages',
			inverse: 'change_orders',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: {
		/** Submitted/under-review VOs lock pricing until returned to draft; approved VOs lock permanently. */
		submitted_locked: {
			locked: { status: { in: ['submitted', 'under_review'] } },
			except: ['status', 'approved_date', 'attachments', 'justification']
		},
		approved_locked: {
			locked: { status: { eq: 'approved' } },
			except: ['attachments', 'justification']
		}
	},
	indexes: {
		by_project_status: { on: ['project_id', 'status'] },
		find: { text: ['change_number', 'title', 'zone', 'description'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] },
			cost_item_id: { fields: ['item_code', 'description'] },
			bim_file_id: { fields: ['document_number', 'title'] },
			source_message_id: { fields: ['subject', 'transport'] }
		}
	},
	create: {
		fields: columns.filter((f) => f !== 'status'),
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			return changes.map(({ set, after }) => {
				const computed = computeChangeOrderImpact(after.lines, after.cost_impact);
				return {
					...set,
					...(computed.lines != null
						? { lines: computed.lines, cost_impact: computed.cost_impact }
						: {})
				};
			});
		}
	},
	update: {
		fields: columns.filter((f) => f !== 'project_id'),
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			const out = [];
			for (const [row, c] of changes.entries()) {
				if (
					c.changed('cost_impact') &&
					!c.changed('lines') &&
					c.after.lines != null &&
					c.after.lines.length > 0 &&
					c.before.status === 'draft'
				) {
					return yield* ctx.refuse('errors.vo_cost_managed_by_lines', {
						field: 'cost_impact',
						row
					});
				}
				const computed = c.changed('lines')
					? computeChangeOrderImpact(c.after.lines, c.after.cost_impact)
					: null;
				out.push({
					...c.set,
					...(computed?.lines != null
						? { lines: computed.lines, cost_impact: computed.cost_impact }
						: {}),
					...(c.changed('status') && c.after.status === 'approved' && c.after.approved_date == null
						? { approved_date: ctx.today }
						: {})
				});
			}
			return out;
		}
	}
});
