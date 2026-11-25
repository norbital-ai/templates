import { model } from '@norbital-ai/bolt';

const columns = [
	'project_name',
	'project_number',
	'project_role',
	'client',
	'main_contractor',
	'project_manager',
	'project_type',
	'status',
	'schedule_range',
	'currency',
	'contract_value',
	'retention_rate',
	'retention_cap_rate',
	'tax_rate',
	'payment_terms_days',
	'autodesk_project_id',
	'bim_file',
	'bim_version',
	'zones',
	'capture_rules',
	'address',
	'description'
] as const;

export default model('projects', {
	description:
		'Construction projects usable by main contractors managing subcontractors or subcontractors managing their own works, with a single federated BIM IFC model, programme, cashflow terms, Autodesk project link, zones, and WhatsApp/email capture rules.',
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
		client: { kind: 'text', optional: true },
		main_contractor: { kind: 'text', optional: true },
		project_manager: { kind: 'text', optional: true },
		project_type: { kind: 'text', optional: true },
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
		currency: { kind: 'currency', default: 'SGD' },
		contract_value: { kind: 'money', currency: 'currency', optional: true },
		retention_rate: { kind: 'decimal', scale: 2, default: 10 },
		retention_cap_rate: { kind: 'decimal', scale: 2, default: 5 },
		tax_rate: { kind: 'decimal', scale: 2, default: 9 },
		/** Standard payment cycle in calendar days used to forecast cashflow due dates. */
		payment_terms_days: { kind: 'int', min: 0, max: 180, default: 30 },
		/** Optional Autodesk Construction Cloud / BIM 360 project ID for schedule and document sync. */
		autodesk_project_id: { kind: 'text', optional: true },
		/** Single federated BIM IFC model for this project (updated in place with revision history). */
		bim_file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		/** Revision label for the project's BIM model (e.g. P01, P04). */
		bim_version: { kind: 'text', optional: true },
		/** Revision trail for the project's BIM IFC model. */
		bim_revisions: { kind: 'custom', of: 'revision_trail', optional: true },
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
		/** Project-specific WhatsApp and email routing and extraction rules. */
		capture_rules: { kind: 'text', format: 'markdown', optional: true },
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
	constraints: {
		project_number: { unique: ['project_number'] },
		valid_retention_rate: { check: { retention_rate: { gte: 0, lte: 100 } } },
		valid_retention_cap: { check: { retention_cap_rate: { gte: 0, lte: 100 } } },
		valid_tax_rate: { check: { tax_rate: { gte: 0, lte: 100 } } }
	},
	indexes: { find: { text: ['project_name', 'project_number', 'client', 'main_contractor'] } },
	outputs: { default: { fields: 'all' } },
	create: {
		fields: columns.filter((f) => f !== 'status'),
		transform: function* (changes, ctx) {
			return changes.map(({ set, after }) => {
				if (after.bim_file == null) return set;
				const version = after.bim_version?.trim() || 'P01';
				return {
					...set,
					bim_version: version,
					bim_costing_dirty: true,
					...(after.bim_revisions != null && after.bim_revisions.length > 0
						? {}
						: {
								bim_revisions: [
									{
										version,
										saved_on: ctx.today,
										reference: after.bim_file.name,
										summary: 'Initial BIM model'
									}
								]
							})
				};
			});
		}
	},
	update: {
		fields: [...columns, 'bim_summary', 'bim_costing_dirty'],
		transform: function* (changes, ctx) {
			return changes.map((c) => {
				if (c.changed('bim_file') && c.after.bim_file == null) {
					return { ...c.set, bim_costing_dirty: false };
				}
				if (!c.changed('bim_file') && !c.changed('bim_version')) return c.set;
				if (c.after.bim_file == null) return c.set;
				const prev = c.before.bim_revisions ?? [];
				const version =
					c.after.bim_version?.trim() || `P${String(prev.length + 1).padStart(2, '0')}`;
				return {
					...c.set,
					bim_version: version,
					...(c.changed('bim_file') ? { bim_costing_dirty: true } : {}),
					bim_revisions: [
						...prev,
						{
							version,
							saved_on: ctx.today,
							reference: c.after.bim_file.name,
							summary: c.changed('bim_file') ? 'Updated BIM model revision' : 'BIM version updated'
						}
					]
				};
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
