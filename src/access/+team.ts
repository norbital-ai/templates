import { team } from '@norbital-ai/bolt';

/** Which policies each team holds; who is on a team is a team row, bound here by name. */
export default team({
	/** The service desk: bookings, dispatch, helpers; flagged visits are notified to this team. */
	Operations: ['operations'],
	/** Helpers in the field: their own visits and position. */
	Helpers: ['helper']
});
