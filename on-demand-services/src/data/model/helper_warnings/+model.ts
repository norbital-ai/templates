import { model } from '@norbital-ai/bolt';
/**
 * A warning letter: a helper missed a shift without a medical certificate. Append-only: a warning is filed once; only
 * its letter is attached afterwards, by the `warning_letter` run.
 */
export default model('helper_warnings', {
	description: 'A warning letter issued to a helper, with the visit it concerns.',
	icon: 'lucide:file-warning',
	label: 'reason',
	fields: {
		helper: { kind: 'ref', to: 'helpers', inverse: 'warnings' },
		visit: { kind: 'ref', to: 'visits', optional: true, onDelete: 'setNull' },
		reason: { kind: 'enum', values: ['no_response', 'declined_without_mc'] },
		issued_at: { kind: 'instant' },
		letter: { kind: 'file', accept: ['application/pdf'], max: '2MiB', optional: true },
		notes: { kind: 'text', optional: true }
	},
	index: ['issued_at'],
	search: { text: ['helper', 'visit', 'reason'] },
	read: {
		helper_warnings: { fields: 'all' },
		'helper_warnings.helper': { fields: 'all' },
		'helper_warnings.visit': { fields: 'all' },
		'helper_warnings.visit.helper': { fields: ['name'] },
		'helper_warnings.visit.booking': { fields: ['number'] },
		'helper_warnings.visit.booking.customer': { fields: ['name', 'phone', 'email', 'address'] },
		'helper_warnings.visit.booking.service': { fields: ['name'] }
	},
	create: { columns: { helper_warnings: ['helper', 'visit', 'reason', 'issued_at', 'notes'] } },
	update: { columns: { helper_warnings: ['letter'] } },
	// the desk cannot attach the letter: `warning_letter` does, as dispatch
	effect: {
		created: function* (rows, ctx) {
			yield* ctx.schedule('warning_letter', { ids: rows.map((r) => r.id) });
		}
	}
});
