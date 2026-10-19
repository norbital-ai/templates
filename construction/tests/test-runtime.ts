import type { Id } from '@norbital-ai/bolt';
import { inputSchema } from '@norbital-ai/std/kind';
import { Context, Effect, Layer, Schema } from 'effect';
import { TestWorkspace, type TestOptions } from '@norbital-ai/bolt/test';
/** Each caller owns this workspace's scope and every engine service it acquired. */
export const workspace = Effect.fnUntraced(function* (options: TestOptions) {
	const services = yield* Layer.build(TestWorkspace.layer(options));
	return { ...Context.get(services, TestWorkspace), services };
});
export type T = Effect.Success<ReturnType<typeof workspace>>;
/** A declared fixture ID passes the same UUID boundary as a host record reference. */
export function fixtureId<const C extends string>(collection: C, value: string): Id<C> {
	const codec = inputSchema({ kind: 'id', of: collection });
	const decoded = Schema.decodeUnknownSync(codec)(value);
	const branded = Schema.declare<Id<C>>(
		(input): input is Id<C> => typeof input === 'string' && Schema.is(Schema.toType(codec))(input)
	);
	return Schema.decodeUnknownSync(branded)(decoded);
}
