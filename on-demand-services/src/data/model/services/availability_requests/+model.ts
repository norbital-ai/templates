import { model } from '../../../../../.norbital/models/availability_requests.ts';
import { AREAS, REPEATS } from '../../../../lib/matching.js';
export default model({
	description:
		'A verified customer’s destination-specific availability, computed privately by dispatch.',
	icon: 'lucide:calendar-search',
	record_label: 'record.address',
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
				ready: {},
				failed: {}
			}
		}
	},
	constraints: { settled: { locked: { status: { in: ['ready', 'failed'] } } } },
	outputs: {
		default: { fields: 'all', service: { fields: ['name'] }, helper: { fields: ['name'] } },
		customer: {
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
	},
	create: {
		columns: {
			fields: ['phone', 'address', 'location', 'area', 'service', 'preference', 'helper', 'repeat']
		},
		// the writer (a customer) cannot time drives: `prepare_availability` does, as dispatch
		effect: function* (changes, ctx) {
			yield* ctx.schedule('prepare_availability', { ids: changes.map((c) => c.after.id) });
		}
	},
	update: {
		columns: {
			fields: ['location', 'starts', 'estimated', 'checked_at', 'problem', 'status']
		}
	}
});
