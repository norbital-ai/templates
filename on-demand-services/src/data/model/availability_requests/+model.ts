import { model } from '@norbital-ai/bolt';
import { AREAS, REPEATS } from '../../../lib/matching.js';
export default model('availability_requests', {
	description:
		'A verified customer’s destination-specific availability, computed privately by dispatch.',
	icon: 'lucide:calendar-search',
	label: 'address',
	fields: {
		phone: { kind: 'text', format: 'phone' },
		address: { kind: 'text', max: 500 },
		area: { kind: 'enum', values: AREAS, optional: true },
		service: { kind: 'ref', to: 'services' },
		preference: { kind: 'enum', values: ['any', 'preferred'], default: 'any' },
		helper: { kind: 'ref', to: 'helpers', optional: true },
		repeat: { kind: 'enum', values: REPEATS, default: 'once' },
		location: { kind: 'point', optional: true },
		starts: { kind: 'text', many: true, default: [], hidden: true },
		estimated: { kind: 'bool', default: true },
		checked_at: { kind: 'instant', optional: true },
		problem: { kind: 'text', optional: true },
		status: {
			kind: 'state',
			initial: 'pending',
			states: {
				pending: { to: ['ready', 'failed'] },
				ready: { edit: 'none' },
				failed: { edit: 'none' }
			}
		}
	},
	read: 'all',
	outputs: {
		customer: {
			availability_requests: {
				fields: [
					'phone',
					'address',
					'area',
					'service',
					'preference',
					'helper',
					'repeat',
					'starts',
					'estimated',
					'status',
					'problem',
					'checked_at'
				]
			}
		}
	},
	create: {
		columns: {
			availability_requests: [
				'phone',
				'address',
				'location',
				'area',
				'service',
				'preference',
				'helper',
				'repeat'
			]
		}
	},
	update: {
		columns: {
			availability_requests: ['location', 'starts', 'estimated', 'checked_at', 'problem', 'status']
		}
	},
	// the writer (a customer) cannot time drives: `prepare_availability` does, as dispatch
	effect: {
		created: function* (rows, ctx) {
			yield* ctx.schedule('prepare_availability', { ids: rows.map((r) => r.id) });
		}
	}
});
