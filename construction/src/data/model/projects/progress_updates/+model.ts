import { model, type Id } from '@norbital-ai/bolt';
import { BigDecimal } from 'effect';
import { computeCostLine, toDecimal } from '../../../../lib/claims.js';
import { validateProjectZones } from '../../../../lib/zones.js';

const createColumns = [
	'title',
	'project_id',
	'zone',
	'task_id',
	'cost_item_id',
	'update_date',
	'category',
	'reported_progress_pct',
	'measured_quantity',
	'headcount',
	'weather',
	'reported_by',
	'summary',
	'photos',
	'source_message_id'
] as const;

const HUNDRED = BigDecimal.fromBigInt(100n);

export default model('progress_updates', {
	description:
		'Append-only site diary and progression logs recorded on site or extracted from WhatsApp/Telegram messages.',
	icon: 'lucide:trending-up',
	record_label: 'record.title',
	fields: {
		title: { kind: 'text' },
		zone: { kind: 'text', optional: true },
		update_date: { kind: 'date', default: { var: 'today' } },
		category: {
			kind: 'enum',
			values: ['progress', 'milestone', 'site_diary', 'delivery', 'inspection', 'delay', 'safety'],
			default: 'progress'
		},
		reported_progress_pct: { kind: 'decimal', scale: 1, optional: true },
		measured_quantity: { kind: 'decimal', scale: 3, optional: true },
		headcount: { kind: 'int', min: 0, optional: true },
		weather: {
			kind: 'enum',
			values: ['clear', 'rain', 'heavy_rain', 'storm', 'windy'],
			optional: true
		},
		reported_by: { kind: 'text', optional: true },
		summary: { kind: 'text', format: 'markdown', optional: true },
		photos: {
			kind: 'file',
			accept: ['image/jpeg', 'image/png', 'image/webp'],
			max: '20MiB',
			many: true,
			optional: true
		},
		project_id: { kind: 'ref', to: 'projects', inverse: 'progress_updates', owned: true },
		task_id: {
			kind: 'ref',
			to: 'tasks',
			inverse: 'progress_updates',
			optional: true,
			on_delete: 'set_null'
		},
		cost_item_id: {
			kind: 'ref',
			to: 'cost_items',
			inverse: 'progress_updates',
			optional: true,
			on_delete: 'set_null'
		},
		source_message_id: {
			kind: 'ref',
			to: 'project_messages',
			inverse: 'progress_updates',
			optional: true,
			on_delete: 'set_null'
		}
	},
	constraints: {
		valid_progress: {
			check: {
				or: [
					{ reported_progress_pct: { is_null: true } },
					{ reported_progress_pct: { gte: 0, lte: 100 } }
				]
			}
		},
		/** Append-only diary: posted progression figures never mutate in place; only summary/photos may be amended. */
		posted_diary_locked: {
			locked: { project_id: { is_null: false } },
			except: ['summary', 'photos']
		}
	},
	indexes: {
		by_project_date: { on: ['project_id', 'update_date'] },
		find: { text: ['title', 'summary', 'zone', 'reported_by'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] },
			task_id: { fields: ['task_code', 'title'] },
			cost_item_id: { fields: ['item_code', 'description'] },
			source_message_id: { fields: ['subject', 'transport'] }
		}
	},
	create: {
		fields: createColumns,
		transform: function* (changes, ctx) {
			yield* validateProjectZones(changes, ctx);
			const taskIds = [
				...new Set(
					changes.flatMap(({ after }) =>
						after.task_id != null && after.reported_progress_pct != null ? [after.task_id] : []
					)
				)
			];
			const costIds = [
				...new Set(
					changes.flatMap(({ after }) =>
						after.cost_item_id != null &&
						(after.reported_progress_pct != null || after.measured_quantity != null)
							? [after.cost_item_id]
							: []
					)
				)
			];
			if (taskIds.length === 0 && costIds.length === 0) return changes.map((c) => c.set);
			const { tasks, cost_items } = yield* ctx.query({
				tasks: {
					where: { id: { in: taskIds } },
					fields: ['revision', 'progress_pct', 'status', 'actual_range']
				},
				cost_items: {
					where: { id: { in: costIds } },
					fields: [
						'revision',
						'contract_qty',
						'unit_rate',
						'claim_basis',
						'progress_pct',
						'completed_qty'
					]
				}
			});
			const taskMap = new Map(tasks.rows.map((r) => [r.id, r]));
			const costMap = new Map(cost_items.rows.map((r) => [r.id, r]));

			// Aggregate highest reported progress per task and latest/highest per cost item across the batch
			const bestTaskPct = new Map<Id<'tasks'>, string>();
			const bestCostInput = new Map<
				Id<'cost_items'>,
				{ progress_pct: string | null; measured_quantity: string | null }
			>();
			for (const { after } of changes) {
				if (after.task_id != null && after.reported_progress_pct != null) {
					const prev = bestTaskPct.get(after.task_id);
					if (
						prev === undefined ||
						BigDecimal.isGreaterThan(toDecimal(after.reported_progress_pct), toDecimal(prev))
					) {
						bestTaskPct.set(after.task_id, after.reported_progress_pct);
					}
				}
				if (
					after.cost_item_id != null &&
					(after.reported_progress_pct != null || after.measured_quantity != null)
				) {
					const prev = bestCostInput.get(after.cost_item_id);
					bestCostInput.set(after.cost_item_id, {
						progress_pct:
							after.reported_progress_pct != null &&
							(prev?.progress_pct == null ||
								BigDecimal.isGreaterThan(
									toDecimal(after.reported_progress_pct),
									toDecimal(prev.progress_pct)
								))
								? after.reported_progress_pct
								: (prev?.progress_pct ?? null),
						measured_quantity:
							after.measured_quantity != null &&
							(prev?.measured_quantity == null ||
								BigDecimal.isGreaterThan(
									toDecimal(after.measured_quantity),
									toDecimal(prev.measured_quantity)
								))
								? after.measured_quantity
								: (prev?.measured_quantity ?? null)
					});
				}
			}

			const taskUpdates: {
				target: { id: (typeof tasks.rows)[number]['id']; revision: number };
				set: {
					progress_pct: string;
					status?: 'in_progress' | 'done';
					actual_range?: { readonly from: string; readonly to: string | null };
				};
			}[] = [];
			for (const [taskId, pctStr] of bestTaskPct) {
				const t = taskMap.get(taskId);
				if (t === undefined) continue;
				const nextDec = toDecimal(pctStr);
				if (!BigDecimal.isGreaterThan(nextDec, toDecimal(t.progress_pct))) continue;
				const done = BigDecimal.isGreaterThanOrEqualTo(nextDec, HUNDRED);
				taskUpdates.push({
					target: { id: t.id, revision: t.revision },
					set: {
						progress_pct: pctStr,
						...(done && t.status !== 'done'
							? {
									status: 'done',
									actual_range: { from: t.actual_range?.from ?? ctx.today, to: ctx.today }
								}
							: t.status === 'todo'
								? {
										status: 'in_progress',
										...(t.actual_range == null
											? { actual_range: { from: ctx.today, to: null } }
											: {})
									}
								: {})
					}
				});
			}

			const costUpdates: {
				target: { id: (typeof cost_items.rows)[number]['id']; revision: number };
				set: {
					contract_amount: string;
					progress_pct: string;
					completed_qty: string;
					claimable_amount: string;
				};
			}[] = [];
			for (const [costId, latest] of bestCostInput) {
				const ci = costMap.get(costId);
				if (ci === undefined) continue;
				const computed = computeCostLine({
					contract_qty: ci.contract_qty,
					unit_rate: ci.unit_rate,
					claim_basis: ci.claim_basis,
					progress_pct: latest.progress_pct ?? ci.progress_pct,
					completed_qty: latest.measured_quantity ?? ci.completed_qty
				});
				costUpdates.push({
					target: { id: ci.id, revision: ci.revision },
					set: computed
				});
			}

			return {
				sets: changes.map((c) => c.set),
				with: {
					...(taskUpdates.length > 0 ? { tasks: { update: taskUpdates } } : {}),
					...(costUpdates.length > 0 ? { cost_items: { update: costUpdates } } : {})
				}
			};
		}
	},
	update: { fields: ['summary', 'photos'] }
});
