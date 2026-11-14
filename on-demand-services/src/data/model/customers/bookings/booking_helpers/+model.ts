import { model } from '@norbital-ai/bolt';
/** A helper the customer asked for, in order of preference. Written with its booking; read on its own by the booking view. */
export default model('booking_helpers', {
	description: 'A preferred helper of a booking, ranked.',
	icon: 'lucide:heart-handshake',
	record_label: "record.booking.number + ' · ' + record.helper.name",
	fields: {
		booking: { kind: 'ref', to: 'bookings', inverse: 'preferred_helpers', owned: true },
		helper: { kind: 'ref', to: 'helpers', inverse: 'preferred_by' },
		rank: { kind: 'int', min: 1, max: 5 }
	},
	constraints: { one_rank_per_helper: { unique: ['booking', 'helper'] } },
	outputs: {
		default: { fields: 'all', booking: { fields: ['number'] }, helper: { fields: ['name'] } }
	}
});
