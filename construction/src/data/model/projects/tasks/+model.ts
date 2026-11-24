import { model } from '@norbital-ai/bolt';
import { TRADE_SPECIALTIES } from '../../../../lib/trades.js';
import { validateProjectZones } from '../../../../lib/zones.js';

const columns = [
	'task_code',
	'wbs_path',
	'external_id',
	'title',
	'project_id',
	'parent_task_id',
	'contract_id',
	'is_milestone',
	'zone',
	'trade_specialty',
	'assignee',
	'subcontractor_id',
	'status',
	'priority',
	'baseline_range',
	'schedule_range',
	'actual_range',
	'progress_pct',
	'bim_express_ids',
	'latest_update',
	'last_updated_on',
	'source_message_id',
	'description',
	'attachments'
] as const;

export default model('tasks', {
	description:
		'Large-scale WBS work packages and milestones synced with Autodesk ACC, Primavera P6 (.xer), MS Project (.xml), and spreadsheets, with baseline vs actual progression and 4D BIM references.',
	icon: 'lucide:list-checks',
	record_label: "record.task_code != null ? record.task_code + ' · ' + record.title : record.title",
	fields: {
		task_code: { kind: 'text' },
		/** Hierarchical WBS path from Primavera P6, MS Project, or Autodesk Schedule (e.g. `1.2.4`). */
		wbs_path: { kind: 'text', optional: true },
		external_id: { kind: 'text', optional: true },
		title: { kind: 'text' },
		is_milestone: { kind: 'bool', default: false },
		zone: { kind: 'text', optional: true },
		trade_specialty: {
			kind: 'enum',
			values: [...TRADE_SPECIALTIES],
			default: 'general'
		},
		status: {
			kind: 'state',
			initial: 'todo',
			states: {
				todo: { to: ['in_progress', 'blocked', 'done', 'cancelled'] },
				in_progress: { to: ['blocked', 'done', 'todo', 'cancelled'] },
				blocked: { to: ['in_progress', 'todo', 'cancelled'] },
				done: { to: ['in_progress'] },
				cancelled: { to: ['todo'] }
			}
		},
		priority: {
			kind: 'enum',
			values: ['low', 'medium', 'high', 'critical'],
			default: 'medium'
		},
		baseline_range: { kind: 'period', of: 'date', optional: true },
		schedule_range: { kind: 'period', of: 'date', optional: true },
		actual_range: { kind: 'period', of: 'date', optional: true },
		progress_pct: { kind: 'decimal', scale: 1, default: 0 },
		/** IFC element expressIDs governed by this work package for 4D timeline highlighting. */
		bim_express_ids: { kind: 'int', many: true, optional: true },
		/** Concise latest status progression note (manual or extracted from WhatsApp/email). */
		latest_update: { kind: 'text', optional: true },
		last_updated_on: { kind: 'date', optional: true },
		description: { kind: 'text', format: 'markdown', optional: true },
		attachments: { kind: 'file', accept: ['*/*'], max: '20MiB', many: true, optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'tasks', owned: true },
		parent_task_id: {
			kind: 'ref',
			to: 'tasks',
			inverse: 'subtasks',
			optional: true,
			on_delete: 'set_null'
		},
		contract_id: {
			kind: 'ref',
			to: 'contracts',
			inverse: 'tasks',
			optional: true,
			on_delete: 'set_null'
		},
		assignee: { kind: 'ref', to: 'sys_user', optional: true },
		subcontractor_id: {
			kind: 'ref',
			to: 'contacts',
			inverse: 'tasks',
			optional: true,
			on_delete: 'set_null'
		},
		source_message_id: {
			kind: 'ref',
			to: 'project_messages',
			inverse: 'tasks',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: {
		task_code: { unique: ['project_id', 'task_code'], import_key: true },
		valid_progress: { check: { progress_pct: { gte: 0, lte: 100 } } }
	},
	indexes: {
		by_project_status: { on: ['project_id', 'status'] },
		find: { text: ['task_code', 'wbs_path', 'title', 'zone', 'latest_update'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] },
			parent_task_id: { fields: ['task_code', 'title'] },
			contract_id: { fields: ['contract_number', 'title'] },
			assignee: { fields: ['name'] },
			subcontractor_id: { fields: ['full_name', 'company_name', 'trade_specialty'] },
			source_message_id: { fields: ['subject', 'transport'] }
		}
	},
	create: {
		fields: columns.filter((f) => f !== 'status'),
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			const isRemoteSync = ctx.actor.kind === 'system' && 'sync' in ctx.actor.by;
			if (isRemoteSync) return changes.map(({ set }) => set);
			return changes.map(({ set, after }) => ({
				...set,
				...(after.baseline_range == null && after.schedule_range != null
					? { baseline_range: after.schedule_range }
					: {}),
				...(after.latest_update != null && after.last_updated_on == null
					? { last_updated_on: ctx.today }
					: {})
			}));
		}
	},
	update: {
		fields: columns.filter((f) => f !== 'project_id'),
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			const isRemoteSync = ctx.actor.kind === 'system' && 'sync' in ctx.actor.by;
			if (isRemoteSync) return changes.map(({ set }) => set);
			return changes.map((c) => {
				const updateDatePatch =
					c.changed('latest_update', 'progress_pct') && !c.changed('last_updated_on')
						? { last_updated_on: ctx.today }
						: {};
				if (c.changed('status') && c.after.status === 'done') {
					const existing = c.after.actual_range;
					return {
						...c.set,
						...updateDatePatch,
						progress_pct: '100',
						...(existing?.to == null
							? {
									actual_range: {
										from: existing?.from ?? ctx.today,
										to: ctx.today
									}
								}
							: {})
					};
				}
				if (
					c.changed('status') &&
					c.after.status === 'in_progress' &&
					c.after.actual_range == null
				) {
					return {
						...c.set,
						...updateDatePatch,
						actual_range: { from: ctx.today, to: null }
					};
				}
				return { ...c.set, ...updateDatePatch };
			});
		}
	}
});
