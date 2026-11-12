import { model } from '../../../../../../../.norbital/models/helper_warnings.ts';
/**
 * A warning letter: a helper missed a shift without a medical certificate. Append-only: a warning is filed once; only
 * its letter is attached afterwards, by the `warning_letter` run.
 */
export default model({
	description: 'A warning letter issued to a helper, with the visit it concerns.',
	icon: 'lucide:file-warning',
	record_label: 'record.reason',
	fields: {
		helper: { kind: 'ref', to: 'helpers', inverse: 'warnings' },
		visit: { kind: 'ref', to: 'visits', optional: true, on_delete: 'set_null' },
		reason: { kind: 'enum', values: ['no_response', 'declined_without_mc'] },
		issued_at: { kind: 'instant' },
		letter: { kind: 'file', accept: ['application/pdf'], max: '2MiB', optional: true },
		notes: { kind: 'text', optional: true }
	},
	indexes: {
		issued: { on: ['issued_at'] },
		find: { text: ['helper', 'visit', 'reason'] }
	},
	outputs: {
		default: {
			fields: 'all',
			helper: { fields: 'all' },
			visit: {
				fields: 'all',
				helper: { fields: ['name'] },
				booking: {
					fields: ['number'],
					customer: { fields: ['name', 'phone', 'email', 'address'] },
					service: { fields: ['name'] }
				}
			}
		}
	},
	create: {
		columns: { fields: ['helper', 'visit', 'reason', 'issued_at', 'notes'] },
		// the desk cannot attach the letter: `warning_letter` does, as dispatch
		effect: function* (changes, ctx) {
			yield* ctx.schedule('warning_letter', { ids: changes.map((c) => c.after.id) });
		}
	},
	update: { columns: { fields: ['letter'] } }
});
