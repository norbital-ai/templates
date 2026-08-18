import { Schema } from 'effect';
import { defineCustomType } from '@norbital-ai/bolt/authoring';

const signatureSchema = Schema.Struct({
	name: Schema.String,
	date: Schema.String
});

export const permitSignaturesSchema = Schema.Struct({
	applicant: Schema.NullOr(signatureSchema),
	issuer: Schema.NullOr(signatureSchema),
	acceptor: Schema.NullOr(signatureSchema)
});

export default defineCustomType({
	name: 'permit_signatures',
	description:
		'The applicant, issuer, and acceptor sign-offs on a permit to work, each a name and a date, with a party who has not yet signed left explicitly empty.',
	schema: permitSignaturesSchema
});
