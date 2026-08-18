import { Schema } from 'effect';
import { defineCustomType } from '@norbital-ai/bolt/authoring';

export const emergencyContactSchema = Schema.Struct({
	name: Schema.String,
	phone: Schema.String,
	relationship: Schema.NullOr(Schema.String)
});

export default defineCustomType({
	name: 'emergency_contact',
	description:
		'A next-of-kin name and phone number with their relationship to the worker, held so site supervision can reach someone after an incident.',
	schema: emergencyContactSchema
});
