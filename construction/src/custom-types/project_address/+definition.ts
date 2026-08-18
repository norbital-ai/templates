import { Schema } from 'effect';
import { defineCustomType } from '@norbital-ai/bolt/authoring';

export const projectAddressSchema = Schema.Struct({
	line_1: Schema.String,
	line_2: Schema.NullOr(Schema.String),
	city: Schema.String,
	state: Schema.NullOr(Schema.String),
	postal_code: Schema.String,
	country: Schema.String
});

export default defineCustomType({
	name: 'project_address',
	description:
		'A postal address for a project, broken into street lines, city, state, postal code, and country so it can be sorted and posted to rather than parsed out of one free-text line.',
	schema: projectAddressSchema
});
