import { model } from '@norbital-ai/bolt';
/** A helper the customer asked for, in order of preference. Written with its booking; read on its own by the booking view. */
export default model('booking_helpers', {
	description: 'A preferred helper of a booking, ranked.',
	icon: 'lucide:heart-handshake',
	label: 'rank',
	fields: {
		booking: { kind: 'ref', to: 'bookings', inverse: 'preferred_helpers', owned: true },
		helper: { kind: 'ref', to: 'helpers', inverse: 'preferred_by' },
		rank: { kind: 'int', min: 1, max: 5 }
	},
	unique: [{ fields: ['booking', 'helper'] }],
	read: 'all'
});
