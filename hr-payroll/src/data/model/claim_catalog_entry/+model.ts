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
import { moved, tap } from '../../../lib/payroll_engine/taps.js';

type WriteInput = Omit<UpdateSet<'claim_catalog_entry'>, 'id'> &
	Partial<Omit<CreateRow<'claim_catalog_entry'>, 'id'>> & {
		readonly id?: Id<'claim_catalog_entry'>;
		readonly $delete?: true;
	};

const transformRows = Effect.fnUntraced(function* (
	inputs: readonly WriteInput[],
	existing: readonly (StoredRow<'claim_catalog_entry'> | undefined)[],
	ctx: WriteCtx<'claim_catalog_entry'>
) {
	return yield* transformEntries('claim_catalog_entry', inputs, existing, ctx, {
		claim_catalog_entry: inputs.flatMap((input, index) => {
			const row = { ...existing[index], ...input };
			return row.catalog_id == null ? [] : [row.catalog_id];
		})
	});
});

export default model('claim_catalog_entry', {
	description:
		'One expense or benefit claim for one employment, reimbursed through payroll under its claim class.',
	icon: 'lucide:receipt',
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
			help: 'What was incurred.'
		},
		quantity: {
			kind: 'decimal',
			scale: 2,
			optional: true,
			help: 'Units claimed, for a class priced per unit rather than in full.'
		},
		incurred_on: {
			kind: 'date',
			optional: true,
			help: 'When the cost was incurred. The entry day is used when unset.'
		},
		due_on: {
			kind: 'date',
			optional: true
		},
		label: {
			kind: 'text',
			optional: true
		},
		facts: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			optional: true,
			help: 'Payroll inputs required by the selected claim item.'
		},
		catalog_id: { kind: 'ref', to: 'claim_catalog', inverse: 'entry' },
		company_id: { kind: 'ref', to: 'entity', inverse: 'claim_catalog_entry' },
		employment_id: {
			kind: 'ref',
			to: 'employment_contract',
			inverse: 'claim_catalog_entry',
			optional: true
		},
		payslip_id: {
			kind: 'ref',
			to: 'payslip',
			inverse: 'claim_catalog_entry',
			optional: true,
			onDelete: 'setNull'
		}
	},
	locked: { payslip_id: { isNull: false } },
	// the toolbar finds an entry by its own words or its person's: the contract's number, the person's name
	search: { text: ['label', 'employment_id'] },
	read: {
		claim_catalog_entry: { fields: 'all' },
		'claim_catalog_entry.catalog_id': { fields: 'all' },
		'claim_catalog_entry.employment_id': { fields: 'all' },
		'claim_catalog_entry.employment_id.employee_id': { fields: ['name', 'email', 'phone'] }
	},
	create: {
		columns: {
			claim_catalog_entry: [
				'catalog_id',
				'employment_id',
				'occurred_on',
				'activity',
				'amount',
				'quantity',
				'incurred_on',
				'due_on',
				'label',
				'facts'
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
			claim_catalog_entry: [
				'catalog_id',
				'occurred_on',
				'activity',
				'amount',
				'quantity',
				'incurred_on',
				'due_on',
				'label',
				'facts',
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
	},
	// The jurisdiction behaviour rules for this model's writes (`behaviour_taps`), started as the writer.
	effect: {
		created: function* (rows, ctx) {
			yield* tap(ctx, 'created', { model: 'claim_catalog_entry', ids: rows.map((row) => row.id) });
		},
		updated: function* (changes, ctx) {
			const ids = moved(changes, ['amount', 'facts']);
			yield* tap(ctx, 'updated', { model: 'claim_catalog_entry', ids });
		}
	}
});
