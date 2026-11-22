import { model } from '@norbital-ai/bolt';
import { RUN_STINT } from '../../../../../lib/run_output.js';
import { PARAMETER_FIELDS } from '../../service/person.js';
import { afterDated, datedWrite } from '../+model.js';

export default model('statutory_parameters', {
	description:
		'One dated change to what the law is told about a person in a stint: from its date, the parameters it holds are now these. One left empty is unchanged; one named in clears is taken away. A change is dated the first of a month, or the stint’s first day, and may be edited, moved or deleted.',
	icon: 'lucide:landmark',
	record_label: 'record.effective_from',
	fields: {
		employment_id: { kind: 'ref', to: 'employment', inverse: 'parameters', on_delete: 'cascade' },
		effective_from: { kind: 'date' },
		/** What the law is told of the person: the values of the parameters its jurisdiction's employee statutory parameters declare. A row sets the parameters it names; the others stand. */
		parameters: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			optional: true
		},
		/** The parameters taken away from this date, by name. */
		clears: { kind: 'text', many: true, optional: true }
	},
	constraints: { one_change: { unique: ['employment_id', 'effective_from'] } },
	outputs: {
		// the payroll run's named read: this model through the stint a run finds it by
		run: { fields: 'all', employment_id: RUN_STINT },
		default: {
			fields: 'all',
			// a read reaches a stint's rows through the stint, its person and its company
			employment_id: {
				fields: 'all',
				employee_id: { fields: 'all', employment: { fields: 'all' } },
				entity_id: { fields: 'all' }
			}
		}
	},
	// every write is checked on the stint it leaves, on its date and at every later change, and carries the amendment
	// rows of the paid periods it reaches
	create: {
		fields: ['employment_id', 'effective_from', ...PARAMETER_FIELDS, 'clears'],
		transform: function* (changes, ctx) {
			const { carried } = yield* datedWrite(ctx, 'create', 'statutory_parameters', changes);
			return { sets: changes.map(({ set }) => set), on_approved: carried };
		},
		effect: function* (changes, ctx) {
			yield* afterDated(ctx, 'create', 'statutory_parameters', changes);
		}
	},
	update: {
		fields: ['effective_from', ...PARAMETER_FIELDS, 'clears'],
		transform: function* (changes, ctx) {
			const { carried } = yield* datedWrite(ctx, 'update', 'statutory_parameters', changes);
			return { sets: changes.map(({ set }) => set), on_approved: carried };
		},
		effect: function* (changes, ctx) {
			yield* afterDated(ctx, 'update', 'statutory_parameters', changes);
		}
	},
	delete: {
		transform: function* (changes, ctx) {
			const { carried } = yield* datedWrite(ctx, 'delete', 'statutory_parameters', changes);
			return { on_approved: carried };
		},
		effect: function* (changes, ctx) {
			yield* afterDated(ctx, 'delete', 'statutory_parameters', changes);
		}
	}
});
