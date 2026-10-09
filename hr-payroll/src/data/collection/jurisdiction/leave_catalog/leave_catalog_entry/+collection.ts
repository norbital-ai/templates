import { collection, type Id, type QueryCtx, type TransformCtx } from '@norbital-ai/bolt';
import { leaveState, transformEntries } from '../../../../../lib/payroll_engine/services.js';
import * as Predicate from 'effect/Predicate';
import {
	callerReadAsHost,
	eachBatched,
	runEngine,
	workspaceReadAsHost
} from '../../../../../lib/payroll_engine/foundation.js';
import { dayKey, leaveBalances, previewLeave } from '../../../../../lib/payroll_engine/leave.js';
import { requestDays } from '../../../../../lib/payroll_engine/leave_days.js';

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

/** A time-off range as requested; the server counts what it charges. */
const REQUEST = {
	employment_id: { kind: 'id', of: 'employment_contract' },
	catalog_id: { kind: 'id', of: 'leave_catalog' },
	from: { kind: 'date' },
	to: { kind: 'date', optional: true },
	half_day_start: { kind: 'bool', optional: true },
	half_day_end: { kind: 'bool', optional: true }
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
		leave_days: {
			description:
				'What a time-off range charges, counted as the leave write counts it: over the employment’s own plan and the published holidays, in the class’s unit, with the days that charge nothing.',
			input: REQUEST,
			output: {
				kind: 'object',
				fields: {
					days: { kind: 'number' },
					unit: { kind: 'text' },
					off: { kind: 'list', of: { kind: 'text' } }
				}
			}
		},
		preview_leave: {
			description:
				'The same planner a leave write uses: the units the range charges, the remaining days after it and the calendar span it covers.',
			input: { ...REQUEST, as_of: { kind: 'date', optional: true } },
			output: {
				kind: 'object',
				fields: {
					...BALANCE_FIELDS,
					unit: { kind: 'text' },
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

/** The range columns a time-off row's charge is counted from. */
const RANGE = ['catalog_id', 'from', 'to', 'half_day_start', 'half_day_end', 'activity'] as const;

c.transform(async (inputs, ctx: TransformCtx<'leave_catalog_entry'>) => {
	// A time-off range charges what the server counts on the employment's own plan, never a client's number: every
	// row counted at once over one batched reader.
	const counted = await eachBatched(
		inputs,
		workspaceReadAsHost(ctx.db.read),
		async (input, i, read): Promise<(typeof inputs)[number]> => {
			const before = ctx.existing[i];
			if ('$delete' in input) return input;
			const row = { ...before, ...input };
			const moved = before === undefined || RANGE.some((key) => row[key] !== before[key]);
			if (!moved || row.activity !== 'TIME_OFF' || row.from == null || row.employment_id == null)
				return input;
			const charge = await requestDays(
				{
					employment_id: String(row.employment_id),
					catalog_id: String(row.catalog_id),
					from: row.from,
					to: row.to,
					half_day_start: row.half_day_start ?? null,
					half_day_end: row.half_day_end ?? null
				},
				read
			);
			if (Predicate.isString(charge)) return ctx.refuse(charge);
			if (!(charge.days > 0))
				return ctx.refuse(
					'This leave charges nothing: every day of it is a rest day, an off day or a holiday.'
				);
			return { ...input, days: charge.days };
		}
	);
	return transformEntries('leave_catalog_entry', counted, ctx);
});

/** One employment's leave state on a day, through the engine's own reads (`services.leaveState`). */
const leaveStateOf = (ctx: QueryCtx, employment_id: Id<'employment_contract'>, asOf: string) =>
	runEngine(leaveState(employment_id, asOf), callerReadAsHost(ctx.read), ctx.refuse);

c.query('leave_balances', async ({ employment_id, as_of }, ctx) => {
	const asOf = dayKey(as_of) ?? ctx.today;
	const state = await leaveStateOf(ctx, employment_id, asOf);
	// what the employee is offered: the classes their eligibility admits
	return { balances: leaveBalances({ ...state, offeredOnly: true }) };
});

c.query('leave_days', async (request, ctx) => {
	const charge = await requestDays(request, callerReadAsHost(ctx.read));
	return Predicate.isString(charge) ? ctx.refuse(charge) : { ...charge, off: [...charge.off] };
});

c.query('preview_leave', async ({ as_of, ...request }, ctx) => {
	const charge = await requestDays(request, callerReadAsHost(ctx.read));
	if (Predicate.isString(charge)) return ctx.refuse(charge);
	const asOf = dayKey(as_of) ?? dayKey(request.from) ?? ctx.today;
	const state = await leaveStateOf(ctx, request.employment_id, asOf);
	const preview = previewLeave({
		...state,
		catalog_id: request.catalog_id,
		days: charge.days,
		from: request.from,
		to: request.to
	});
	if (preview == null) return ctx.refuse('Choose the entry’s class.');
	return { ...preview, unit: charge.unit };
});
