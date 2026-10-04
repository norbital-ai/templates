import { model } from '@norbital-ai/bolt';
import { AREAS, REPEATS } from '../../../lib/matching.js';

export default model({
	description:
		'A verified customer’s destination-specific availability, computed privately by dispatch.',
	icon: 'lucide:calendar-search',
	label: 'address',
	fields: {
		phone: { kind: 'text', format: 'phone' },
		address: { kind: 'text', max: 500 },
		area: { kind: 'enum', values: AREAS, optional: true },
		preference: { kind: 'enum', values: ['any', 'preferred'], default: 'any' },
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
	}
});
