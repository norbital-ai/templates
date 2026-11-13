import { tap } from '../../../../lib/payroll_engine/taps.js';
import { model } from '../../../../../.norbital/models/pay_group.ts';
import { paidUnder } from '../../../../lib/amendments.js';
import { jsonObject, stableJson } from '../../../../lib/payroll_engine/foundation.js';

/** What of a schedule decides a paid period's days: its pay day and its name may still change. */
const paces = (schedule: unknown) => {
	const { pay_days: _days, business_day: _business, ...pace } = jsonObject(schedule ?? {});
	return stableJson(pace);
};

export default model({
	description:
		'One payroll of a company: the people paid together on one schedule. A company with staff paid monthly and staff paid twice a month has two. Every contract names its group, and a payroll run is for one group.',
	icon: 'lucide:calendar-clock',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text' },
		payment_schedule: {
			kind: 'json',
			default: {
				frequency: 'MONTHLY',
				business_day: 'PREVIOUS',
				non_working_weekdays: [0, 6],
				short_month: 'LAST_DAY',
				pay_days: [25],
				pay_cutoff_day: 1
			},
			shape: {
				kind: 'union',
				by: 'frequency',
				arms: {
					MONTHLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'int', min: 0, max: 6, many: true },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						pay_days: { kind: 'int', min: 1, max: 31, many: true, min_items: 1 },
						pay_cutoff_day: { kind: 'int', min: 1, max: 28, default: 1 }
					},
					SEMI_MONTHLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'int', min: 0, max: 6, many: true },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						pay_days: { kind: 'int', min: 1, max: 31, many: true, min_items: 1 },
						pay_cutoff_day: { kind: 'int', min: 1, max: 28, default: 1 }
					},
					TEN_DAY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'int', min: 0, max: 6, many: true },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						pay_days: { kind: 'int', min: 1, max: 31, many: true, min_items: 1 },
						pay_cutoff_day: { kind: 'int', min: 1, max: 28, default: 1 }
					},
					INTEGER_MONTHS: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'int', min: 0, max: 6, many: true },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						pay_days: { kind: 'int', min: 1, max: 31, many: true, min_items: 1 },
						pay_cutoff_day: { kind: 'int', min: 1, max: 28, default: 1 },
						month_interval: { kind: 'int', min: 1, max: 12 },
						anchor_date: { kind: 'date' }
					},
					WEEKLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'int', min: 0, max: 6, many: true },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						weekday: { kind: 'int', min: 0, max: 6 },
						anchor_date: { kind: 'date' }
					},
					BIWEEKLY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'int', min: 0, max: 6, many: true },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] },
						weekday: { kind: 'int', min: 0, max: 6 },
						anchor_date: { kind: 'date' }
					},
					DAILY: {
						business_day: { kind: 'enum', values: ['NONE', 'PREVIOUS', 'NEXT'] },
						non_working_weekdays: { kind: 'int', min: 0, max: 6, many: true },
						short_month: { kind: 'enum', values: ['LAST_DAY', 'REFUSE'] }
					}
				}
			}
		},
		entity_id: { kind: 'ref', to: 'entity', inverse: 'pay_groups' }
	},
	constraints: { entity_name: { unique: ['entity_id', 'name'] } },
	indexes: { search: { text: ['name'] } },
	outputs: { default: { fields: 'all' } },
	create: {
		columns: { fields: ['name', 'payment_schedule', 'entity_id'] },
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'pay_group',
				changes.map(({ after }) => ({ after }))
			);
		}
	},
	// a group stays with its company: its contracts and runs are that company's
	update: {
		columns: { fields: ['name', 'payment_schedule'] },
		transform: function* (changes, ctx) {
			// every schedule is a group: one that has paid keeps its schedule, so its periods can be worked out again
			const moved = changes.filter(
				({ before, after }) => paces(after.payment_schedule) !== paces(before.payment_schedule)
			);
			if (
				moved.length > 0 &&
				(yield* paidUnder(ctx.query, {
					pay_group_id: { in: moved.map(({ before }) => before.id) }
				}))
			)
				return yield* ctx.refuse('errors.pay_group_paid_schedule', { field: 'payment_schedule' });
			return changes.map((change) => change.set);
		},
		effect: function* (changes, ctx) {
			yield* tap(ctx, 'update', 'pay_group', changes);
		}
	}
});
