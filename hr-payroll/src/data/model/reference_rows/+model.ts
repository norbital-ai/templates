import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One row of a table a jurisdiction settings version declares: a code with its label, parent code, dates in force, optional value range and typed values. Option lists (the codes a `code` input picks from) and statutory tables (floors, bands, rates) are both rows. Sealed and cloned with its version; `table()`, `band()` and `bands()` read it.',
	icon: 'lucide:table',
	label: ['table', 'code'],
	fields: {
		/** The version's `tables` declaration this row belongs to. */
		table: { kind: 'text' },
		/** The row's code: what a `code` input stores and a key may name. */
		code: { kind: 'text' },
		/** The code this row sits under (a region's district, a class's group). */
		parent_code: { kind: 'text', optional: true },
		label: { kind: 'text', optional: true },
		/** The days the row is in force inside its version; a change is an end date and a successor row. */
		effective_range: { kind: 'period', of: 'date' },
		/** A band table's bounds on the looked-up value; inclusivity is the declaration's. Empty is unbounded. */
		range_from: { kind: 'decimal', scale: 4, optional: true },
		range_to: { kind: 'decimal', scale: 4, optional: true },
		/** The declared value columns, by key. */
		values: { kind: 'custom', of: 'entity_facts', default: {} }
	},
	index: [['settings_id', 'table']],
	// one code of one table claims each day once; the seal checks keys and ranges
	noOverlap: [
		{
			key: ['settings_id', 'table', 'code'],
			period: 'effective_range',
			name: 'reference_rows_code_no_overlap'
		}
	],
	search: { text: ['table', 'code', 'label'] }
});
