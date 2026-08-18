import { Schema } from 'effect';
import { defineCustomType } from '@norbital-ai/bolt/authoring';

export const siteCoordinatesSchema = Schema.Struct({
	x: Schema.NullOr(Schema.Number),
	y: Schema.NullOr(Schema.Number),
	z: Schema.NullOr(Schema.Number)
});

export default defineCustomType({
	name: 'site_coordinates',
	description:
		'An x, y, and z point in the site model, used to place a location or defect inside the building rather than on a map, with any axis that was never surveyed left empty.',
	schema: siteCoordinatesSchema
});
