import { customField } from '@norbital-ai/bolt';

/** One signed party: the name entered and the date it was signed on; a party who has not signed is null. */
const signature = {
	kind: 'object',
	optional: true,
	fields: { name: { kind: 'text' }, date: { kind: 'text' } }
} as const;

export default customField({
	description:
		'The applicant, issuer, and acceptor sign-offs on a permit to work, each a name and a date, with a party who has not yet signed left explicitly empty.',
	shape: {
		kind: 'object',
		fields: { applicant: signature, issuer: signature, acceptor: signature }
	}
});
