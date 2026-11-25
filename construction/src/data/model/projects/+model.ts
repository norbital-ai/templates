import { model } from '@norbital-ai/bolt';

const columns = [
	'project_name',
	'project_number',
	'project_role',
	'client_id',
	'project_manager',
	'status',
	'schedule_range',
	'currency',
	'autodesk_project_id',
	'bim_file',
	'bim_version',
	'zones',
	'address',
	'description'
] as const;

export default model('projects', {
	description:
		"Construction projects run as main contractor or subcontractor, with a single federated BIM IFC model, programme, Autodesk project link and spatial zones. Contract terms live on the project's contracts.",
	icon: 'lucide:building-2',
	record_label:
		"record.project_number != null ? record.project_number + ' · ' + record.project_name : record.project_name",
	fields: {
		project_name: { kind: 'text' },
		project_number: { kind: 'text', optional: true },
		/** Defines whether this workspace acts as main contractor, subcontractor, or specialist trade contractor. */
		project_role: {
			kind: 'enum',
			values: ['main_contractor', 'subcontractor', 'specialist_contractor'],
			default: 'main_contractor'
		},
		/** The business partner who engaged us: the client, or the main contractor when we subcontract. */
		client_id: {
			kind: 'ref',
			to: 'contacts',
			inverse: 'client_projects',
			optional: true,
			on_delete: 'set_null'
		},
		/** The member accountable for delivering the project. */
		project_manager: { kind: 'ref', to: 'sys_user', optional: true },
		status: {
			kind: 'state',
			initial: 'active',
			states: {
				tendering: { to: ['active', 'cancelled'] },
				active: { to: ['tendering', 'on_hold', 'defects_liability', 'complete', 'cancelled'] },
				on_hold: { to: ['active', 'cancelled'] },
				defects_liability: { to: ['complete', 'active'] },
				complete: { to: ['defects_liability'] },
				cancelled: { to: ['tendering', 'active'] }
			}
		},
		schedule_range: { kind: 'period', of: 'date', optional: true },
		/** The currency the project's figures are reported in. */
		currency: { kind: 'currency', default: 'SGD' },
		/** Optional Autodesk Construction Cloud / BIM 360 project ID for schedule and document sync. */
		autodesk_project_id: { kind: 'text', optional: true },
		/** Single federated BIM IFC model for this project (updated in place with revision history). */
		bim_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		/** Revision label for the project's BIM model (e.g. P01, P04); record history keeps earlier files. */
		bim_version: { kind: 'text', optional: true },
		/** True when a new or updated BIM file awaits AI takeoff costing (manual run or daily EOD sweep). */
		bim_costing_dirty: { kind: 'bool', default: false },
		/** Automatically populated summary once the BIM pipeline parses the project's IFC model. */
		bim_summary: {
			kind: 'json',
			optional: true,
			shape: {
				kind: 'object',
				fields: {
					schema: { kind: 'text' },
					asset_count: { kind: 'int' },
					storey_count: { kind: 'int' },
					storeys: { kind: 'text', many: true },
					analyzed_at: { kind: 'text' }
				}
			}
		},
		/** Co-located storeys, zones, grid axes, and elevations owned by this project. */
		zones: { kind: 'custom', of: 'project_zones', optional: true },
		address: { kind: 'custom', of: 'project_address', optional: true },
		description: { kind: 'text', format: 'markdown', optional: true },
		open_task_count: {
			kind: 'count',
			of: 'tasks',
			where: { status: { in: ['todo', 'in_progress', 'blocked'] } }
		},
		open_issue_count: {
			kind: 'count',
			of: 'issues',
			where: { status: { in: ['open', 'in_progress', 'ready_for_verification'] } }
		},
		active_contract_count: {
			kind: 'count',
			of: 'contracts',
			where: { status: { in: ['under_review', 'active'] } }
		},
		open_document_count: {
			kind: 'count',
			of: 'commercial_documents',
			where: { status: { in: ['issued', 'verified', 'certified', 'disputed'] } }
		}
	},
	constraints: { project_number: { unique: ['project_number'] } },
	indexes: { find: { text: ['project_name', 'project_number'] } },
	outputs: {
		default: {
			fields: 'all',
			client_id: { fields: ['full_name', 'company_name'] },
			project_manager: { fields: ['name'] }
		}
	},
	create: {
		fields: columns.filter((f) => f !== 'status'),
		transform: function* (changes) {
			return changes.map(({ set, after }) => {
				if (after.bim_file == null) return set;
				return { ...set, bim_version: after.bim_version?.trim() || 'P01', bim_costing_dirty: true };
			});
		}
	},
	update: {
		fields: [...columns, 'bim_summary', 'bim_costing_dirty'],
		transform: function* (changes) {
			return changes.map((c) => {
				if (!c.changed('bim_file')) return c.set;
				return { ...c.set, bim_costing_dirty: c.after.bim_file != null };
			});
		},
		effect: function* (changes, ctx) {
			const changedProjectIds = changes.filter((c) => c.changed('bim_file')).map((c) => c.after.id);
			if (changedProjectIds.length === 0) return;
			const existing = (yield* ctx.query({
				cost_estimates: {
					where: { project_id: { in: changedProjectIds }, status: { ne: 'void' } },
					fields: ['revision', 'project_id', 'status'],
					limit: changedProjectIds.length + 10
				}
			})).cost_estimates.rows;
			if (existing.length === 0) return;
			yield* ctx.act(
				{
					'cost_estimates.update': existing.map((est) => ({
						target: { id: est.id, revision: est.revision },
						set: { status: 'void' as const }
					}))
				},
				{ key: `bim-void-${changedProjectIds.join(',')}-${ctx.now}` }
			);
		}
	}
});
