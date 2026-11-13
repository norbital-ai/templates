import { model } from '../../../../../../.norbital/models/contract_change.ts';
import { instant } from '../../../../../lib/date.js';
import { changeable } from '../../../../../lib/payroll_engine/contract_change.js';

const scheduled = (on: string, today: string) => on > today && on.endsWith('-01');

export default model({
	description:
		'One dated change to one contract field, filed ahead of its day: its old and new value. Knowledge only; payroll and the ledger read the sealed version it is materialized into.',
	record_label: "record.field_path + ' · ' + string(record.effective_from)",
	fields: {
		employee_id: {
			kind: 'ref',
			to: 'employee_profile',
			inverse: 'contract_changes',
			on_delete: 'cascade'
		},
		field_path: { kind: 'text' },
		old_value: { kind: 'json', optional: true },
		new_value: { kind: 'json', optional: true },
		effective_from: { kind: 'date' },
		applied_version_id: {
			kind: 'ref',
			to: 'employee_contract',
			optional: true,
			on_delete: 'restrict'
		},
		notes: { kind: 'text', optional: true }
	},
	constraints: { applied_change: { locked: { applied_version_id: { is_null: false } } } },
	outputs: { default: { fields: 'all' } },
	create: {
		columns: {
			fields: ['employee_id', 'field_path', 'old_value', 'new_value', 'effective_from', 'notes']
		},
		transform: function* (changes, ctx) {
			const unknown = changes.findIndex(({ set }) => !changeable(set.field_path));
			if (unknown >= 0)
				return yield* ctx.refuse('errors.contract_change_field_path', {
					row: unknown,
					field: 'field_path'
				});
			const due = changes.findIndex(({ set }) => !scheduled(set.effective_from, ctx.today));
			if (due >= 0)
				return yield* ctx.refuse('errors.contract_change_effective_from', {
					row: due,
					field: 'effective_from'
				});
			return changes.map(({ set }) => set);
		},
		effect: function* (changes, ctx) {
			for (const on of new Set(changes.map(({ after }) => after.effective_from)))
				yield* ctx.schedule(
					'contract_materialize',
					{},
					{ at: instant(`${on}T00:00:00Z`), key: `contract_materialize:${on}` }
				);
		}
	},
	update: {
		columns: {
			fields: [
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
			const applied = changes.findIndex(({ set }) => set.applied_version_id !== undefined);
			if (applied >= 0 && !materializing)
				return yield* ctx.refuse('errors.contract_change_seal_applies', { row: applied });
			const unknown = changes.findIndex(
				({ set }) => set.field_path != null && !changeable(set.field_path)
			);
			if (unknown >= 0)
				return yield* ctx.refuse('errors.contract_change_field_path', {
					row: unknown,
					field: 'field_path'
				});
			const due = changes.findIndex(
				({ set }) => set.effective_from != null && !scheduled(set.effective_from, ctx.today)
			);
			if (due >= 0)
				return yield* ctx.refuse('errors.contract_change_effective_from', {
					row: due,
					field: 'effective_from'
				});
			return changes.map(({ set }) => set);
		},
		effect: function* (changes, ctx) {
			const moved = changes.filter((change) => change.changed('effective_from'));
			for (const on of new Set(moved.map(({ after }) => after.effective_from)))
				yield* ctx.schedule(
					'contract_materialize',
					{},
					{ at: instant(`${on}T00:00:00Z`), key: `contract_materialize:${on}` }
				);
		}
	},
	delete: {}
});
