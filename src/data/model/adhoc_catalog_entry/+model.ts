import {
	model,
	type WriteCtx,
	type CreateRow,
	type UpdateSet,
	type StoredRow,
	type Id
} from '@norbital-ai/bolt';
import { transformEntries } from '../../../lib/payroll_engine/admit.js';
import { Effect } from 'effect';

type WriteInput = Omit<UpdateSet<'adhoc_catalog_entry'>, 'id'> &
	Partial<Omit<CreateRow<'adhoc_catalog_entry'>, 'id'>> & {
		readonly id?: Id<'adhoc_catalog_entry'>;
		readonly $delete?: true;
	};

const transformRows = Effect.fnUntraced(function* (
	inputs: readonly WriteInput[],
	existing: readonly (StoredRow<'adhoc_catalog_entry'> | undefined)[],
	ctx: WriteCtx<'adhoc_catalog_entry'>
) {
	return yield* transformEntries('adhoc_catalog_entry', inputs, existing, ctx, {
		adhoc_catalog_entry: inputs.flatMap((input, index) => {
			const row = { ...existing[index], ...input };
			return row.catalog_id == null ? [] : [row.catalog_id];
		})
	});
});

export default model('adhoc_catalog_entry', {
	description:
		'One ad hoc pay or recovery for one employment: a bonus, back pay or deduction priced by its ad hoc class.',
	icon: 'lucide:hand-coins',
	label: 'occurred_on',
	fields: {
		occurred_on: {
			kind: 'date'
		},
		activity: {
			kind: 'enum',
			values: ['AWARD', 'REVERSAL'],
			default: 'AWARD'
		},
		amount: {
			kind: 'decimal',
			scale: 2,
			optional: true,
			help: "The class's bands price this amount; a REVERSAL takes back an earlier award."
		},
		quantity: {
			kind: 'decimal',
			scale: 2,
			optional: true,
			help: 'Units awarded, for a class priced per unit rather than in full.'
		},
		label: {
			kind: 'text',
			optional: true
		},
		facts: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			optional: true,
			help: 'Payroll inputs required by the selected ad hoc item.'
		},
		catalog_id: { kind: 'ref', to: 'adhoc_catalog', inverse: 'entry' },
		company_id: { kind: 'ref', to: 'entity', inverse: 'adhoc_catalog_entry' },
		employment_id: {
			kind: 'ref',
			to: 'employment_contract',
			inverse: 'adhoc_catalog_entry',
			optional: true
		},
		payslip_id: {
			kind: 'ref',
			to: 'payslip',
			inverse: 'adhoc_catalog_entry',
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
			'amount',
			'quantity',
			'label',
			'facts'
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
			'amount',
			'quantity',
			'label',
			'facts',
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
	}
});
