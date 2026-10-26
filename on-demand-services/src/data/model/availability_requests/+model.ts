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
		starts: { kind: 'text', many: true, default: [] },
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
	create: {
		columns: ['phone', 'address', 'location', 'area', 'service', 'preference', 'helper', 'repeat']
	},
	update: { columns: ['location', 'starts', 'estimated', 'checked_at', 'problem', 'status'] }
});
