import {
	model,
	type Id,
	type CreateRow,
	type UpdateSet,
	type StoredRow,
	type WriteCtx
} from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { transformEntries } from '../../../lib/payroll_engine/admit.js';

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
	// the toolbar finds an entry by its own words or its person's: the contract's number, the person's name
	search: { text: ['reference', 'label', 'employment_id'] },
	read: {
		leave_catalog_entry: { fields: 'all' },
		'leave_catalog_entry.catalog_id': { fields: 'all' },
		'leave_catalog_entry.employment_id': { fields: ['employee_number', 'company_id'] },
		'leave_catalog_entry.employment_id.employee_id': { fields: ['name', 'email', 'phone'] }
	},
	create: {
		columns: {
			leave_catalog_entry: [
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
			]
		},
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
		columns: {
			leave_catalog_entry: [
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
			]
		},
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
	}
});
