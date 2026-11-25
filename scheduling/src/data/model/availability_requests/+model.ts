import { model } from '@norbital-ai/bolt';
import { REPEATS } from '../../../lib/matching.js';

/** Address- and recurrence-specific availability quote computed privately for a portal customer. */
export default model('availability_requests', {
	description: 'A customer’s destination-specific availability quote computed by dispatch.',
	icon: 'lucide:calendar-search',
	record_label: 'record.address',
	fields: {
		phone: { kind: 'text', format: 'phone' },
		address: { kind: 'text', max: 500 },
		service: { kind: 'ref', to: 'services' },
		preference: { kind: 'enum', values: ['any', 'preferred'], default: 'any' },
		provider: { kind: 'ref', to: 'providers', optional: true },
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
		default: { fields: 'all', service: { fields: ['name'] }, provider: { fields: ['name'] } },
		customer: {
			fields: [
				'phone',
				'address',
				'service',
				'preference',
				'provider',
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
		fields: ['phone', 'address', 'location', 'service', 'preference', 'provider', 'repeat'],
		effect: function* (changes, ctx) {
			const ids = changes.map((c) => c.after.id).sort();
			yield* ctx.schedule(
				'prepare_availability',
				{ ids },
				{ key: `prepare-availability:${ids.join(',')}` }
			);
		}
	},
	update: {
		fields: ['location', 'starts', 'estimated', 'checked_at', 'problem', 'status']
	}
});
