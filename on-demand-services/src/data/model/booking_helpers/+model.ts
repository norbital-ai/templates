import { model } from '@norbital-ai/bolt';

/** A helper the customer asked for, in order of preference. */
export default model({
	description: 'A preferred helper of a booking, ranked.',
	icon: 'lucide:heart-handshake',
	label: 'rank',
	fields: { rank: { kind: 'int', min: 1, max: 5 } },
	unique: [{ fields: ['booking', 'helper'] }]
});
