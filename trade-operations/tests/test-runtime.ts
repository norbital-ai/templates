import type { Id } from '@norbital-ai/bolt';
import { Context, Effect, Layer, Schema } from 'effect';
import { TestWorkspace, type TestOptions, type TestPorts } from '@norbital-ai/bolt-cli/test';
import { inputSchema } from '@norbital-ai/std/kind';
import { Decimal } from '@norbital-ai/std/decimal';
import { expect } from '@effect/vitest';
expect.addEqualityTesters([
	(left: unknown, right: unknown) =>
		left instanceof Decimal && right instanceof Decimal
			? left.toString() === right.toString()
			: undefined
]);
/** Each caller owns this workspace's scope and every engine service it acquired. */
export const workspace = Effect.fnUntraced(function* <P extends TestPorts = never>(
	options: TestOptions<P>
) {
	const services = yield* Layer.build(TestWorkspace.layer({ ...options }));
	return { ...Context.get(services, TestWorkspace), services };
});
export type T = Effect.Success<ReturnType<typeof workspace>>;
/** Named integration slots use the catalogue's text identity; other fixture references use UUIDs. */
export const fixtureId = <C extends string>(model: C, value: string) =>
	Schema.decodeUnknownSync(
		Schema.declare<Id<C>>((input): input is Id<C> =>
			Schema.is(
				inputSchema(model === 'sys_integration' ? { kind: 'text' } : { kind: 'id', of: model })
			)(input)
		)
	)(value);
/** Native caller decimals retain the exact text previously asserted at the wire edge. */
export const decimalText = (expected: string) => ({
	asymmetricMatch: (value: unknown) => value instanceof Decimal && value.toString() === expected,
	toString: () => `Decimal(${expected})`,
	getExpectedType: () => 'Decimal'
});
export function firstRow<A>(rows: readonly A[]) {
	const row = rows[0];
	if (row === undefined) throw new Error('Fixture row required');
	return row;
}
