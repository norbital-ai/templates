import { readFileSync } from 'node:fs';
import { decodeManifest, readPack } from '@norbital-ai/bolt/engine';
import {
	KitInvalid,
	TestWorkspace,
	type TestOptions,
	type TestPorts
} from '@norbital-ai/bolt/test';
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem';
import { Effect, Layer, Schema } from 'effect';

const root = `${process.cwd()}/`;
const Artifact = Schema.Struct({
	transforms: Schema.Array(Schema.String)
});
const built = (file: string) =>
	Effect.try({
		try: () => readFileSync(`${root}.norbital/artifact/${file}`, 'utf8'),
		catch: (cause) =>
			new KitInvalid({ message: `Cannot read the built HR artifact ${file}: ${String(cause)}` })
	});
const json = (file: string) =>
	built(file).pipe(
		Effect.flatMap((source) =>
			Effect.try({
				try: (): unknown => JSON.parse(source),
				catch: (cause) =>
					new KitInvalid({ message: `Malformed HR artifact ${file}: ${String(cause)}` })
			})
		)
	);
/** The template alone: its source and public base pack, or rows a test writes; never a private sample pack. */
export type WorkspaceOptions<P extends TestPorts = never> = Omit<
	Extract<TestOptions<P>, { artifact?: never }>,
	'root' | 'manifest' | 'guest' | 'transforms' | 'seed'
> & {
	readonly seed?: Exclude<NonNullable<TestOptions<P>['seed']>, 'sample'>;
};

/** One scoped real workspace; source in node, prebuilt source and rows for the DOM sweep. */
export function workspace<P extends TestPorts = never>(options: WorkspaceOptions<P> = {}) {
	if (typeof window === 'undefined') return TestWorkspace.layer({ root, ...options });
	return Layer.unwrap(
		Effect.gen(function* () {
			const manifest = yield* Effect.fromResult(decodeManifest(yield* json('manifest.json'))).pipe(
				Effect.mapError((cause) => new KitInvalid({ message: String(cause) }))
			);
			const artifact = yield* Schema.decodeUnknownEffect(Artifact)(
				yield* json('artifact.json')
			).pipe(Effect.mapError((cause) => new KitInvalid({ message: String(cause) })));
			const source = yield* built('guest.mjs');
			const supplied = options.seed === 'none' || typeof options.seed === 'object';
			const pack = supplied
				? undefined
				: yield* readPack(`${root}.norbital/seed/base`).pipe(
						Effect.provide(NodeFileSystem.layer),
						Effect.mapError(
							(cause) =>
								new KitInvalid({ message: `Cannot read the built HR seed pack: ${String(cause)}` })
						)
					);
			return TestWorkspace.layer({
				...options,
				manifest,
				guest: { source },
				transforms: artifact.transforms,
				...(pack === undefined ? {} : { pack, seed: 'none' })
			});
		})
	);
}
