import { relationship } from '@norbital-ai/bolt';

/**
 * A booking belongs to a customer and names a service; its visits are owned by it. A helper signs in as the member
 * `helpers.user` names. A visit's helper is optional: a visit nobody can take waits unassigned for dispatch.
 */
export default relationship({
	'helpers.user': { to: 'sys_user', optional: true, onDelete: 'setNull' },
	'helper_time_off.helper': { to: 'helpers', inverse: 'time_off', owned: true },
	'bookings.customer': { to: 'customers', inverse: 'bookings' },
	'bookings.service': { to: 'services', inverse: 'bookings' },
	'booking_helpers.booking': { to: 'bookings', inverse: 'preferred_helpers', owned: true },
	'booking_helpers.helper': { to: 'helpers', inverse: 'preferred_by' },
	'visits.booking': { to: 'bookings', inverse: 'visits', owned: true },
	'visits.helper': { to: 'helpers', inverse: 'visits', optional: true, onDelete: 'setNull' },
	'visits.proposed_helper': { to: 'helpers', optional: true, onDelete: 'setNull' },
	'helper_warnings.helper': { to: 'helpers', inverse: 'warnings' },
	'helper_warnings.visit': { to: 'visits', optional: true, onDelete: 'setNull' },
	'customer_notices.customer': { to: 'customers', inverse: 'notices' },
	'customer_notices.visit': { to: 'visits', optional: true, onDelete: 'setNull' },
	'booking_requests.service': { to: 'services', where: { active: { eq: true } } },
	'booking_requests.booking': { to: 'bookings', optional: true, onDelete: 'setNull' },
	'openings.service': { to: 'services', inverse: 'openings', owned: true }
});
