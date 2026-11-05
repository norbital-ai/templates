import type { Id } from '@norbital-ai/bolt';
import { inputSchema } from '@norbital-ai/std/kind';
import { Schema } from 'effect';
/** A fixture must actually contain the row or selected value its assertion uses. */
export const present = <A>(value: A | null | undefined): A => {
	if (value === null || value === undefined) throw new Error('Missing expected fixture value');
	return value;
};
/** A declared fixture ID passes the same UUID boundary as a host record reference. */
export const fixtureId = <C extends string>(model: C, value: unknown) => {
	const schema = inputSchema({ kind: 'id', of: model });
	const decoded = Schema.decodeUnknownSync(schema)(value);
	return Schema.decodeUnknownSync(
		Schema.declare<Id<C>>((input): input is Id<C> => Schema.is(Schema.toType(schema))(input))
	)(decoded);
};
