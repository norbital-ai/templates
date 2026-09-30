import { policy } from '@norbital-ai/bolt';

const SELF = { user: { eq: { actor: 'id' } } } as const;
const OWN = { helper: { is: SELF } } as const;

/**
 * A helper: their own visits and the customer details needed to reach them, their own record, and the position their
 * app reports. They answer the shift check and move a visit through its day; everything else is the scheduler's.
 */
export default policy({
	description: 'A helper’s own visits, shift check answers, completion and reported position.',
	capabilities: { apps: ['helper'] },
	grants: {
		helpers: {
			read: {
				where: SELF,
				fields: [
					'id',
					'user',
					'name',
					'phone',
					'skills',
					'work_days',
					'day_start',
					'day_end',
					'status',
					'last_location',
					'last_location_at'
				]
			},
			update: { where: SELF, fields: ['last_location'] }
		},
		helper_time_off: { read: { where: OWN } },
		services: { read: { fields: ['id', 'name', 'duration_minutes', 'description'] } },
		visits: {
			read: {
				where: OWN,
				fields: [
					'id',
					'number',
					'booking',
					'helper',
					'slot',
					'address',
					'location',
					'skill',
					'status',
					'shift_check',
					'mc',
					'started_at',
					'completed_at',
					'completion_notes'
				]
			},
			update: { where: OWN, fields: ['status', 'shift_check', 'mc', 'completion_notes'] },
			moves: { status: ['scheduled->in_progress', 'in_progress->done'] },
			actions: ['confirm_shift', 'decline_shift']
		},
		bookings: {
			read: {
				where: { visits: { some: OWN } },
				fields: ['id', 'number', 'service', 'customer', 'notes']
			}
		},
		customers: {
			read: {
				where: { bookings: { some: { visits: { some: OWN } } } },
				fields: ['id', 'name', 'email', 'phone', 'address']
			}
		}
	},
	limits: { act: '120/min', read: '600/min', agent: '50/h' }
});
