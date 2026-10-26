import {
	model,
	type Id,
	type QueryCtx,
	type CreateRow,
	type UpdateSet,
	type StoredRow,
	type WriteCtx
} from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { leaveState } from '../../../lib/payroll_engine/payslip/context.js';
import { transformEntries } from '../../../lib/payroll_engine/admit.js';
import * as Predicate from 'effect/Predicate';
import { runEngine } from '../../../lib/payroll_engine/foundation.js';
import { leaveBalances, previewLeave } from '../../../lib/payroll_engine/leave.js';
import { requestDays } from '../../../lib/payroll_engine/leave_days.js';

const BALANCE_FIELDS = {
	catalog_id: { kind: 'id', of: 'leave_catalog' },
	code: { kind: 'text' },
	name: { kind: 'text' },
	metered: { kind: 'bool' },
	entitlement: { kind: 'number' },
	carried: { kind: 'number' },
	taken: { kind: 'number' },
	available: { kind: 'number' },
	window_key: { kind: 'text' }
} as const;

const REQUEST = {
	employment_id: { kind: 'id', of: 'employment_contract' },
	catalog_id: { kind: 'id', of: 'leave_catalog' },
	from: { kind: 'date' },
	to: { kind: 'date', optional: true },
	half_day_start: { kind: 'bool', optional: true },
	half_day_end: { kind: 'bool', optional: true }
} as const;

const leaveStateOf = (ctx: QueryCtx, employment_id: Id<'employment_contract'>, asOf: string) =>
	runEngine(leaveState(employment_id, asOf), ctx.query, ctx.refuse);

type WriteInput = Omit<UpdateSet<'leave_catalog_entry'>, 'id'> &
	Partial<Omit<CreateRow<'leave_catalog_entry'>, 'id'>> & {
		readonly id?: Id<'leave_catalog_entry'>;
		readonly $delete?: true;
	};

const transformRows = Effect.fnUntraced(function* (
	inputs: readonly WriteInput[],
	existing: readonly (StoredRow<'leave_catalog_entry'> | undefined)[],
	ctx: WriteCtx<'leave_catalog_entry'>
) {
	const catalogueIds = inputs.flatMap((input, index) => {
		const row = { ...existing[index], ...input };
		return row.catalog_id == null ? [] : [row.catalog_id];
	});
	return yield* transformEntries('leave_catalog_entry', inputs, existing, ctx, {
		leave_catalog_entry: catalogueIds
	});
});

export default model('leave_catalog_entry', {
	description:
		'One leave movement for one employment: time off taken, encashment, carry forward or an adjustment under its leave class.',
	icon: 'lucide:calendar-off',
	label: 'occurred_on',
	fields: {
		reference: {
			kind: 'text',
			optional: true
		},
		occurred_on: {
			kind: 'date'
		},
		activity: {
			kind: 'enum',
			values: ['TIME_OFF', 'ENCASHMENT', 'CARRY_FORWARD', 'ADJUSTMENT', 'REVERSAL'],
			default: 'TIME_OFF'
		},
		days: {
			kind: 'decimal',
			scale: 2,
			optional: true,
			help: 'Units the movement charges. A time-off range is counted by the write over the employment’s plan, in its class’s unit.'
		},
		from: {
			kind: 'date',
			optional: true,
			help: 'First day of the period this movement covers. The entry day is used when unset.'
		},
		to: {
			kind: 'date',
			optional: true
		},
		amount: {
			kind: 'decimal',
			scale: 2,
			optional: true,
			help: 'Cash for an encashment or an adjustment. Time off carries no amount.'
		},
		half_day_start: {
			kind: 'bool',
			optional: true,
			help: 'The first day is the second half of that day.'
		},
		half_day_end: {
			kind: 'bool',
			optional: true,
			help: 'The last day is the first half of that day.'
		},
		label: {
			kind: 'text',
			optional: true
		},
		facts: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			optional: true,
			help: 'Payroll inputs required by the selected leave item, such as the event whose leave balance is used.'
		},
		catalog_id: { kind: 'ref', to: 'leave_catalog', inverse: 'entry' },
		company_id: { kind: 'ref', to: 'entity', inverse: 'leave_catalog_entry' },
		employment_id: {
			kind: 'ref',
			to: 'employment_contract',
			inverse: 'leave_catalog_entry',
			optional: true
		},
		payslip_id: {
			kind: 'ref',
			to: 'payslip',
			inverse: 'leave_catalog_entry',
			optional: true,
			onDelete: 'setNull'
		}
	},
	locked: { payslip_id: { isNull: false } },
	read: 'all',
	create: {
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
			'label',
			'facts',
			'reference'
		],
		transform: function* (rows, ctx) {
			const transformed = yield* transformRows(
				rows,
				rows.map(() => undefined),
				ctx
			);
			return rows.map((row, index) => {
				const { id: _id, $delete: _delete, ...set } = transformed[index] ?? {};
				return { ...row, ...set };
			});
		}
	},
	update: {
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
			'label',
			'facts',
			'reference',
			'payslip_id'
		],
		transform: function* (changes, ctx) {
			const transformed = yield* transformRows(
				changes.map(({ set }) => set),
				changes.map(({ before }) => before),
				ctx
			);
			return changes.map(({ set: original }, index) => {
				const { id: _id, $delete: _delete, ...set } = transformed[index] ?? {};
				return { ...original, ...set };
			});
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* transformRows(
				rows.map(({ id }) => ({ id, $delete: true })),
				rows,
				ctx
			);
		}
	},
	queries: {
		leave_balances: {
			description:
				'Computed entitlement, committed days taken and remaining availability for each leave class in force on the day.',
			input: {
				employment_id: { kind: 'id', of: 'employment_contract' },
				as_of: { kind: 'date' }
			},
			output: {
				kind: 'object',
				fields: {
					balances: {
						kind: 'list',
						of: { kind: 'object', fields: BALANCE_FIELDS }
					}
				}
			},
			run: function* ({ employment_id, as_of }, ctx) {
				const asOf = String(as_of);
				const state = yield* leaveStateOf(ctx, employment_id, asOf);
				// what the employee is offered: the classes their eligibility admits
				return { balances: leaveBalances({ ...state, offeredOnly: true }) };
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
			},
			run: function* (request, ctx) {
				const charge = yield* requestDays(request, ctx.query);
				return Predicate.isString(charge)
					? yield* ctx.refuse(charge)
					: { ...charge, off: [...charge.off] };
			}
		},
		preview_leave: {
			description:
				'The same planner a leave write uses: the units the range charges, the remaining days after it and the calendar span it covers.',
			input: { ...REQUEST, as_of: { kind: 'date' } },
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
			},
			run: function* ({ as_of, ...request }, ctx) {
				const charge = yield* requestDays(request, ctx.query);
				if (Predicate.isString(charge)) return yield* ctx.refuse(charge);
				const asOf = String(as_of);
				const state = yield* leaveStateOf(ctx, request.employment_id, asOf);
				const preview = previewLeave({
					...state,
					catalog_id: request.catalog_id,
					days: charge.days,
					from: request.from,
					to: request.to
				});
				if (preview == null) return yield* ctx.refuse('Choose the entry’s class.');
				return { ...preview, unit: charge.unit };
			}
		}
	}
});
