import { model } from '@norbital-ai/bolt';
import { validateProjectZones } from '../../../../lib/zones.js';

const columns = [
	'document_number',
	'title',
	'project_id',
	'kind',
	'discipline',
	'status',
	'zone',
	'current_version',
	'autodesk_urn',
	'file',
	'notes'
] as const;

export default model('project_files', {
	description:
		'BIM IFC models, Autodesk ACC models/sheets, construction drawings, schedules, and contract documentation with revision history and automatic BIM asset analysis.',
	icon: 'lucide:file-box',
	record_label:
		"record.document_number != null ? record.document_number + ' · ' + record.title : record.title",
	fields: {
		document_number: { kind: 'text' },
		title: { kind: 'text' },
		kind: {
			kind: 'enum',
			values: [
				'ifc_model',
				'autodesk_model',
				'drawing',
				'spec',
				'schedule',
				'contract_doc',
				'handover'
			],
			default: 'drawing'
		},
		discipline: {
			kind: 'enum',
			values: ['architecture', 'structural', 'mep', 'civil', 'federated', 'commercial'],
			optional: true
		},
		status: {
			kind: 'state',
			initial: 'draft',
			states: {
				draft: { to: ['in_review', 'issued', 'archived'] },
				in_review: { to: ['issued', 'draft', 'archived'] },
				issued: { to: ['superseded', 'in_review', 'archived'] },
				superseded: { to: ['archived'] },
				archived: { to: ['draft'] }
			}
		},
		zone: { kind: 'text', optional: true },
		current_version: { kind: 'text', default: 'P01' },
		/** Optional Autodesk ACC / BIM 360 item URN when synced from Autodesk Platform Services. */
		autodesk_urn: { kind: 'text', optional: true },
		file: { kind: 'file', accept: ['*/*'], max: '20MiB', optional: true },
		revisions: { kind: 'custom', of: 'revision_trail', optional: true },
		/** Automatically populated summary once the BIM pipeline parses an uploaded IFC file. */
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
		notes: { kind: 'text', format: 'markdown', optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'project_files', owned: true }
	},
	constraints: { document_number: { unique: ['project_id', 'document_number'], import_key: true } },
	indexes: { find: { text: ['document_number', 'title', 'zone'] } },
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] }
		}
	},
	create: {
		fields: columns.filter((f) => f !== 'status'),
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			const isRemoteSync = ctx.actor.kind === 'system' && 'sync' in ctx.actor.by;
			if (isRemoteSync) return changes.map(({ set }) => set);
			return changes.map(({ set, after }) => {
				if (after.revisions != null && after.revisions.length > 0) return set;
				return {
					...set,
					revisions: [
						{
							version: after.current_version ?? 'P01',
							saved_on: ctx.today,
							reference: after.file?.name ?? after.autodesk_urn ?? null,
							summary: 'Initial issue'
						}
					]
				};
			});
		},
		effect: function* (changes, ctx) {
			for (const { after } of changes) {
				if (after.kind === 'ifc_model' && after.file != null) {
					yield* ctx.schedule(
						'analyze_bim_file',
						{ project_file_id: after.id },
						{ at: ctx.now, key: `bim-analyze-${after.id}-${after.file.id}` }
					);
				}
			}
		}
	},
	update: {
		fields: [...columns.filter((f) => f !== 'project_id'), 'bim_summary'],
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			const isRemoteSync = ctx.actor.kind === 'system' && 'sync' in ctx.actor.by;
			if (isRemoteSync) return changes.map(({ set }) => set);
			return changes.map((c) => {
				if (!c.changed('current_version') && !c.changed('file')) {
					return c.set;
				}
				const prev = c.before.revisions ?? [];
				return {
					...c.set,
					revisions: [
						...prev,
						{
							version: c.after.current_version ?? 'P01',
							saved_on: ctx.today,
							reference: c.after.file?.name ?? c.after.autodesk_urn ?? null,
							summary: c.changed('file') ? 'Updated file revision' : 'Version updated'
						}
					]
				};
			});
		},
		effect: function* (changes, ctx) {
			for (const c of changes) {
				if (c.after.kind === 'ifc_model' && c.after.file != null && c.changed('file')) {
					yield* ctx.schedule(
						'analyze_bim_file',
						{ project_file_id: c.after.id },
						{ at: ctx.now, key: `bim-analyze-${c.after.id}-${c.after.file.id}` }
					);
				}
			}
		}
	}
});
