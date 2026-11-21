import { model } from '@norbital-ai/bolt';
import { validateProjectZones } from '../../../../lib/zones.js';

const columns = [
	'task_code',
	'title',
	'project_id',
	'parent_task_id',
	'is_milestone',
	'zone',
	'cost_item_id',
	'trade',
	'assignee',
	'subcontractor_id',
	'status',
	'priority',
	'schedule_range',
	'actual_range',
	'progress_pct',
	'bim_express_ids',
	'source_message_id',
	'description',
	'attachments'
] as const;

export default model('tasks', {
	description:
		'Structured WBS work packages and milestones with programme dates, progress tracking, cost-item links, and 4D BIM element references.',
	icon: 'lucide:list-checks',
	record_label: "record.task_code != null ? record.task_code + ' · ' + record.title : record.title",
	fields: {
		task_code: { kind: 'text', optional: true },
		title: { kind: 'text' },
		/** Marks a programme milestone (rendered as a diamond marker on the 4D timeline axis). */
		is_milestone: { kind: 'bool', default: false },
		zone: { kind: 'text', optional: true },
		trade: { kind: 'text', optional: true },
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
		schedule_range: { kind: 'period', of: 'date', optional: true },
		actual_range: { kind: 'period', of: 'date', optional: true },
		progress_pct: { kind: 'decimal', scale: 1, default: 0 },
		/** IFC element expressIDs governed by this work package for 4D timeline highlighting. */
		bim_express_ids: { kind: 'int', many: true, optional: true },
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
		cost_item_id: {
			kind: 'ref',
			to: 'cost_items',
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
		task_code: { unique: ['task_code'] },
		valid_progress: { check: { progress_pct: { gte: 0, lte: 100 } } }
	},
	indexes: {
		by_project_status: { on: ['project_id', 'status'] },
		find: { text: ['task_code', 'title', 'trade', 'zone'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] },
			parent_task_id: { fields: ['task_code', 'title'] },
			cost_item_id: { fields: ['item_code', 'description', 'progress_pct'] },
			assignee: { fields: ['name'] },
			subcontractor_id: { fields: ['full_name', 'company_name'] },
			source_message_id: { fields: ['subject', 'transport'] }
		}
	},
	create: {
		fields: columns.filter((f) => f !== 'status'),
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			return changes.map(({ set }) => set);
		}
	},
	update: {
		fields: columns.filter((f) => f !== 'project_id'),
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			return changes.map((c) => {
				if (c.changed('status') && c.after.status === 'done') {
					const existing = c.after.actual_range;
					return {
						...c.set,
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
						actual_range: { from: ctx.today, to: null }
					};
				}
				return c.set;
			});
		}
	}
});
