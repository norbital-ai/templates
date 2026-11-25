import { model } from '@norbital-ai/bolt';

/** Ranked preferred provider associated with a booking. */
export default model('booking_providers', {
	was: 'booking_helpers',
	description: 'A preferred provider linked to a booking in priority order.',
	icon: 'lucide:heart-handshake',
	record_label: "record.booking.number + ' · ' + record.provider.name",
	fields: {
		booking: { kind: 'ref', to: 'bookings', inverse: 'preferred_providers', owned: true },
		provider: { kind: 'ref', to: 'providers', inverse: 'preferred_by' },
		rank: { kind: 'int', min: 1, max: 5 }
	},
	constraints: { one_rank_per_provider: { unique: ['booking', 'provider'] } },
	outputs: {
		default: { fields: 'all', booking: { fields: ['number'] }, provider: { fields: ['name'] } }
	}
});
