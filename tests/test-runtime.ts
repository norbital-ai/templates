import type { Id } from '@norbital-ai/bolt';
import { inputSchema } from '@norbital-ai/std/kind';
import { Context, Effect, Layer, Schema } from 'effect';
import { TestWorkspace, type TestOptions, type TestPorts } from '@norbital-ai/bolt/test';
/** Each caller owns this workspace's scope and every engine service it acquired. */
export const workspace = Effect.fnUntraced(function* <P extends TestPorts = never>(
	options: TestOptions<P>
) {
	const services = yield* Layer.build(TestWorkspace.layer(options));
	return { ...Context.get(services, TestWorkspace), services };
});
export type T = Effect.Success<ReturnType<typeof workspace>>;
/** A fixture must actually contain the row or selected value its assertion uses. */
export const present = <A>(value: A | null | undefined): A => {
	if (value === null || value === undefined) throw new Error('Missing expected fixture value');
	return value;
};
/** A declared fixture ID passes the same UUID boundary as a host record reference. */
export const fixtureId = <C extends string>(collection: C, value: unknown) => {
	const schema = inputSchema({ kind: 'id', of: collection });
	const decoded = Schema.decodeUnknownSync(schema)(value);
	return Schema.decodeUnknownSync(
		Schema.declare<Id<C>>((input): input is Id<C> => Schema.is(Schema.toType(schema))(input))
	)(decoded);
};
