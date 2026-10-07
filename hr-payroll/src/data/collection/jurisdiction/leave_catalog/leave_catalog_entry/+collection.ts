import { collection, type Id, type QueryCtx, type TransformCtx } from '@norbital-ai/bolt';
import { leaveState, transformEntries } from '../../../../../lib/payroll_engine/services.js';
import { callerReadAsHost, runEngine } from '../../../../../lib/payroll_engine/foundation.js';
import { dayKey, leaveBalances, previewLeave } from '../../../../../lib/payroll_engine/leave.js';

const BALANCE_FIELDS = {
	catalog_id: { kind: 'id', of: 'leave_catalog' },
	code: { kind: 'text' },
	name: { kind: 'text' },
	metered: { kind: 'bool' },
	entitlement: { kind: 'number' },
	carried: { kind: 'number' },
	taken: { kind: 'number' },
	reserved: { kind: 'number' },
	available: { kind: 'number' },
	window_key: { kind: 'text' }
} as const;

const c = collection('leave_catalog_entry', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'catalog_id',
				'employment_id',
				'occurred_on',
				'activity',
				'days',
				'half_day_start',
				'half_day_end',
				'from',
				'to',
				'amount',
				'incurred_on',
				'label',
				'facts',
				'reference'
			],
			filled: ['company_id']
		}
	},
	update: {
		input: {
			columns: [
				'catalog_id',
				'occurred_on',
				'activity',
				'days',
				'half_day_start',
				'half_day_end',
				'from',
				'to',
				'amount',
				'incurred_on',
				'label',
				'facts',
				'reference',
				'payslip_id'
			]
		}
	},
	delete: { transform: true },
	queries: {
		leave_balances: {
			description:
				'Computed entitlement, days taken, held reservations and remaining availability for each leave class in force on the day.',
			input: {
				employment_id: { kind: 'id', of: 'employment_contract' },
				as_of: { kind: 'date', optional: true }
			},
			output: {
				kind: 'object',
				fields: {
					balances: { kind: 'list', of: { kind: 'object', fields: BALANCE_FIELDS } }
				}
			}
		},
		preview_leave: {
			description:
				'The same planner a leave write uses: remaining days after this request and the calendar span it would cover.',
			input: {
				employment_id: { kind: 'id', of: 'employment_contract' },
				catalog_id: { kind: 'id', of: 'leave_catalog' },
				days: { kind: 'number', min: 0 },
				from: { kind: 'date', optional: true },
				to: { kind: 'date', optional: true },
				as_of: { kind: 'date', optional: true }
			},
			output: {
				kind: 'object',
				fields: {
					...BALANCE_FIELDS,
					requested: { kind: 'number' },
					remaining: { kind: 'number' },
					ok: { kind: 'bool' },
					covered_from: { kind: 'text' },
					covered_to: { kind: 'text' }
				}
			}
		}
	}
});
export default c;

c.transform((inputs, ctx: TransformCtx<'leave_catalog_entry'>) =>
	transformEntries('leave_catalog_entry', inputs, ctx)
);

/** One employment's leave state on a day, through the engine's own reads (`services.leaveState`). */
const leaveStateOf = (ctx: QueryCtx, employment_id: Id<'employment_contract'>, asOf: string) =>
	runEngine(leaveState(employment_id, asOf), callerReadAsHost(ctx.read), ctx.refuse);

c.query('leave_balances', async ({ employment_id, as_of }, ctx) => {
	const asOf = dayKey(as_of) ?? ctx.today;
	const state = await leaveStateOf(ctx, employment_id, asOf);
	return { balances: leaveBalances(state) };
});

c.query('preview_leave', async ({ employment_id, catalog_id, days, from, to, as_of }, ctx) => {
	const asOf = dayKey(as_of) ?? dayKey(from) ?? ctx.today;
	const state = await leaveStateOf(ctx, employment_id, asOf);
	const preview = previewLeave({ ...state, catalog_id, days, from, to });
	if (preview == null) return ctx.refuse('Choose the entry’s class.');
	return preview;
});
