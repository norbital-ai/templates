import { model } from '@norbital-ai/bolt';
import { Instant } from '@norbital-ai/std/date';
import { changeable } from '../../../../../lib/payroll_engine/contract_change.js';

const REFUSED = {
	field_path: 'Only a contract term or fact can be scheduled; an entity move is a transfer.',
	effective_from:
		'A scheduled change takes effect on the first of a month to come. One due now is a new contract version.'
};
const scheduled = (on: string, today: string) => on > today && on.endsWith('-01');

export default model('contract_change', {
	description:
		'One dated change to one contract field, filed ahead of its day: its old and new value. Knowledge only; payroll and the ledger read the sealed version it is materialized into.',
	label: 'field_path',
	fields: {
		employee_id: {
			kind: 'ref',
			to: 'employee_profile',
			inverse: 'contract_changes',
			onDelete: 'cascade'
		},
		field_path: { kind: 'text' },
		old_value: { kind: 'json', optional: true },
		new_value: { kind: 'json', optional: true },
		effective_from: { kind: 'date' },
		applied_version_id: {
			kind: 'ref',
			to: 'employee_contract',
			optional: true,
			onDelete: 'restrict'
		},
		notes: { kind: 'text', optional: true }
	},
	locked: { applied_version_id: { isNull: false } },
	read: { contract_change: { fields: 'all' } },
	create: {
		columns: {
			contract_change: [
				'employee_id',
				'field_path',
				'old_value',
				'new_value',
				'effective_from',
				'notes'
			]
		},
		transform: function* (rows, ctx) {
			if (rows.some((row) => !changeable(row.field_path)))
				return yield* ctx.refuse(REFUSED.field_path, { field: 'field_path' });
			if (rows.some((row) => !scheduled(row.effective_from, ctx.today)))
				return yield* ctx.refuse(REFUSED.effective_from, { field: 'effective_from' });
			return rows;
		}
	},
	update: {
		columns: {
			contract_change: [
				'field_path',
				'old_value',
				'new_value',
				'effective_from',
				'notes',
				'applied_version_id'
			]
		},
		transform: function* (changes, ctx) {
			const materializing = ctx.policies.includes('payroll_execution');
			if (changes.some(({ set }) => set.applied_version_id !== undefined) && !materializing)
				return yield* ctx.refuse('Only the seal applies a change.');
			if (changes.some(({ set }) => set.field_path != null && !changeable(set.field_path)))
				return yield* ctx.refuse(REFUSED.field_path, { field: 'field_path' });
			if (
				changes.some(
					({ set }) => set.effective_from != null && !scheduled(set.effective_from, ctx.today)
				)
			)
				return yield* ctx.refuse(REFUSED.effective_from, { field: 'effective_from' });
			return changes.map(({ set }) => set);
		}
	},
	delete: {},
	effect: {
		created: function* (rows, ctx) {
			for (const on of new Set(rows.map((row) => row.effective_from)))
				yield* ctx.schedule(
					'contract_materialize',
					{},
					{ at: Instant(`${on}T00:00:00Z`), key: `contract_materialize:${on}` }
				);
		},
		updated: function* (changes, ctx) {
			const moved = changes.filter(
				({ before, after }) => before.effective_from !== after.effective_from
			);
			for (const on of new Set(moved.map(({ after }) => after.effective_from)))
				yield* ctx.schedule(
					'contract_materialize',
					{},
					{ at: Instant(`${on}T00:00:00Z`), key: `contract_materialize:${on}` }
				);
		}
	}
});
