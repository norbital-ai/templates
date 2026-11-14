import { model } from '../../../../../../.norbital/models/statutory_parameters.ts';
import { PARAMETER_FIELDS } from '../../../../../lib/person.js';
import { afterDated, datedWrite } from '../+model.js';

const named = (clears: readonly string[] | null | undefined) =>
	(clears ?? []).every((name) => PARAMETER_FIELDS.some((field) => field === name));

export default model({
	description:
		'One dated change to what the law is told about a person in a stint: from its date, the parameters it holds are now these. One left empty is unchanged; one named in clears is taken away. A change is dated the first of a month, or the stint’s first day, and may be edited, moved or deleted.',
	icon: 'lucide:landmark',
	record_label: 'record.effective_from',
	fields: {
		employment_id: { kind: 'ref', to: 'employment', inverse: 'parameters', on_delete: 'cascade' },
		effective_from: { kind: 'date' },
		residency_status: { kind: 'text', optional: true },
		work_authorisation_category: { kind: 'text', optional: true },
		work_authorisation_expires_on: { kind: 'date', optional: true },
		marital_status: {
			kind: 'enum',
			values: ['SINGLE', 'MARRIED', 'SEPARATED', 'DIVORCED', 'WIDOWED'],
			optional: true
		},
		nationality: { kind: 'text', optional: true },
		passport_number: { kind: 'text', optional: true },
		/** What the law's formulas read of the person: the fields its jurisdiction's employee extension schema declares. A row that sets it replaces it whole. */
		parameters: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			optional: true
		},
		/** The fields above taken away from this date. */
		clears: { kind: 'text', many: true, optional: true }
	},
	constraints: { one_change: { unique: ['employment_id', 'effective_from'] } },
	outputs: {
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
		columns: { fields: ['employment_id', 'effective_from', ...PARAMETER_FIELDS, 'clears'] },
		transform: function* (changes, ctx) {
			const unknown = changes.findIndex(({ after }) => !named(after.clears));
			if (unknown >= 0)
				return yield* ctx.refuse('errors.statutory_parameters_clears', {
					row: unknown,
					field: 'clears'
				});
			const { carried } = yield* datedWrite(ctx, 'create', 'statutory_parameters', changes);
			return { sets: changes.map(({ set }) => set), on_approved: carried };
		},
		effect: function* (changes, ctx) {
			yield* afterDated(ctx, 'create', 'statutory_parameters', changes);
		}
	},
	update: {
		columns: { fields: ['effective_from', ...PARAMETER_FIELDS, 'clears'] },
		transform: function* (changes, ctx) {
			// a stint whose first day moves carries its first rows along: it checked itself with them moved, and its own
			// reach holds the days between
			if (ctx.carried_by === 'employment') return changes.map(({ set }) => set);
			const unknown = changes.findIndex(({ after }) => !named(after.clears));
			if (unknown >= 0)
				return yield* ctx.refuse('errors.statutory_parameters_clears', {
					row: unknown,
					field: 'clears'
				});
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
