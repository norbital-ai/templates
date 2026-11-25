import { model } from '@norbital-ai/bolt';
import { REPEATS } from '../../../lib/matching.js';

/**
 * Customer service booking: one-off or recurring series with optional preferred providers. Each
 * scheduled occurrence is an owned child row in `appointments`.
 */
export default model('bookings', {
	description:
		'A booking: customer, service, address, provider preference, and recurrence cadence.',
	icon: 'lucide:calendar-check',
	record_label: 'record.number',
	fields: {
		number: { kind: 'seq', pattern: 'BK-{yyyy}-{0000}' },
		customer: { kind: 'ref', to: 'customers', inverse: 'bookings' },
		service: { kind: 'ref', to: 'services', inverse: 'bookings' },
		address: { kind: 'text', max: 500 },
		location: { kind: 'point', optional: true },
		preference: { kind: 'enum', values: ['any', 'preferred'] },
		repeat: { kind: 'enum', values: REPEATS },
		status: {
			kind: 'state',
			initial: 'active',
			states: { active: { to: ['cancelled'] }, cancelled: {} }
		},
		notes: { kind: 'text', max: 2000, optional: true },
		appointment_count: { kind: 'count', of: 'appointments' }
	},
	constraints: {
		cancelled: { locked: { status: { eq: 'cancelled' } }, except: ['appointments'] }
	},
	indexes: {
		status: { on: ['status'] },
		find: { text: ['number', 'customer', 'service'] }
	},
	outputs: {
		default: {
			fields: 'all',
			customer: { fields: ['name', 'phone', 'email', 'address'] },
			service: { fields: ['name'] }
		},
		customer: {
			fields: ['number', 'customer', 'service', 'repeat', 'status', 'appointment_count'],
			customer: { fields: ['name', 'phone', 'email', 'address'] },
			service: { fields: ['name'] }
		},
		provider: {
			fields: ['number', 'service', 'customer', 'notes'],
			customer: { fields: ['name', 'phone', 'email', 'address'] },
			service: { fields: ['name'] }
		}
	},
	create: {
		fields: ['customer', 'service', 'address', 'location', 'preference', 'repeat', 'notes'],
		preferred_providers: { fields: ['provider', 'rank'] },
		appointments: { fields: ['slot', 'address', 'location', 'skill', 'provider', 'attention'] },
		effect: function* (_, ctx) {
			yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
			yield* ctx.schedule('check_drives', {}, { key: 'check_drives' });
		}
	},
	update: {
		fields: ['notes', 'status'],
		preferred_providers: { fields: ['provider', 'rank'] }
	}
});
