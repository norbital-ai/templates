import { channel } from '@norbital-ai/bolt';

/** The workspace's mail address for customer notices; `deliver_notices` sends on it. */
export default channel({ transport: 'email', address: 'bookings' });
