import { model } from '@norbital-ai/bolt';

export default model('statutory_change', {
	description:
		'One dated change to one configuration field or row, under the finding that decides it: its old and new value and effective date. Knowledge only; payroll reads the sealed jurisdiction snapshot it is materialized into.',
	label: 'field_path',
	fields: {
		finding_id: {
			kind: 'ref',
			to: 'statutory_finding',
			inverse: 'changes',
			onDelete: 'cascade'
		},
		jurisdiction_code: { kind: 'text' },
		family: { kind: 'text' },
		row_code: { kind: 'text', optional: true },
		field_path: { kind: 'text' },
		old_value: { kind: 'json', optional: true },
		new_value: { kind: 'json', optional: true },
		effective_from: { kind: 'date', optional: true },
		baseline_version_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'statutory_changes',
			onDelete: 'restrict'
		},
		applied_version_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			optional: true,
			onDelete: 'restrict'
		},
		notes: { kind: 'text', optional: true }
	},
	// isolated research runs meet here: one finding names one path once per effective date
	unique: [{ fields: ['finding_id', 'family', 'row_code', 'field_path', 'effective_from'] }],
	locked: { applied_version_id: { isNull: false } },
	read: {
		statutory_change: { fields: 'all' },
		'statutory_change.finding_id': { fields: 'all' }
	},
	create: {
		columns: {
			statutory_change: [
				'finding_id',
				'jurisdiction_code',
				'family',
				'row_code',
				'field_path',
				'old_value',
				'new_value',
				'effective_from',
				'baseline_version_id',
				'notes'
			]
		}
	},
	update: {
		columns: {
			statutory_change: ['old_value', 'new_value', 'effective_from', 'notes', 'applied_version_id']
		}
	}
});
