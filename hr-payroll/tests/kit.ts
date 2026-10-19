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
	transforms: Schema.Array(Schema.String),
	projections: Schema.optionalKey(Schema.Array(Schema.String))
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
export type WorkspaceOptions<P extends TestPorts = never> = Omit<
	Extract<TestOptions<P>, { artifact?: never }>,
	'root' | 'manifest' | 'guest' | 'transforms' | 'projections'
> & {
	readonly sample?: true | undefined;
};

/** One scoped real workspace; source in node, prebuilt source and rows for the DOM sweep. */
export function workspace<P extends TestPorts = never>(options: WorkspaceOptions<P> = {}) {
	const { sample, ...rest } = options;
	if (typeof window === 'undefined')
		return TestWorkspace.layer({ root, ...(sample ? { seed: 'sample' } : {}), ...rest });
	return Layer.unwrap(
		Effect.gen(function* () {
			const manifest = yield* Effect.fromResult(decodeManifest(yield* json('manifest.json'))).pipe(
				Effect.mapError((cause) => new KitInvalid({ message: String(cause) }))
			);
			const artifact = yield* Schema.decodeUnknownEffect(Artifact)(
				yield* json('artifact.json')
			).pipe(Effect.mapError((cause) => new KitInvalid({ message: String(cause) })));
			const source = yield* built('guest.mjs');
			const supplied = rest.seed === 'none' || typeof rest.seed === 'object';
			const pack = supplied
				? undefined
				: yield* readPack(
						`${root}.norbital/seed/${sample || rest.seed === 'sample' ? 'sample' : 'base'}`
					).pipe(
						Effect.provide(NodeFileSystem.layer),
						Effect.mapError(
							(cause) =>
								new KitInvalid({ message: `Cannot read the built HR seed pack: ${String(cause)}` })
						)
					);
			return TestWorkspace.layer({
				...rest,
				manifest,
				guest: { source },
				transforms: artifact.transforms,
				projections: artifact.projections ?? [],
				...(pack === undefined ? {} : { pack, seed: 'none' })
			});
		})
	);
}
