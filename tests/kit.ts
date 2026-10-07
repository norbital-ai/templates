import { readFileSync } from 'node:fs';
import { loadPack, readPack, type EngineManifest } from '@norbital-ai/bolt/engine';
import { testWorkspace } from '@norbital-ai/bolt/test';

/** The template root: `bolt test` runs from it (a DOM test environment has no file `import.meta.url`). */
const root = `${process.cwd()}/`;
const built = (file: string) => readFileSync(`${root}.norbital/artifact/${file}`, 'utf8');

type Options = Omit<
	Parameters<typeof testWorkspace>[0],
	'root' | 'manifest' | 'guest' | 'transforms'
> & { sample?: true };

/**
 * This template on the test kit: compiled from source by `bolt check`, or, in a DOM environment (the sweep), where
 * the compiler cannot run, read from the build (`bolt build`). `sample` loads the build's sample pack (`bolt build
 * --bank=<seed bank>`); otherwise the public `base` pack.
 */
export async function workspace(options: Options = {}) {
	const { sample, ...rest } = options;
	const t = await testWorkspace(
		typeof window === 'undefined'
			? { root, ...(sample ? { seed: 'none' as const } : {}), ...rest }
			: {
					manifest: JSON.parse(built('manifest.json')) as EngineManifest,
					guest: { source: built('guest.mjs') },
					transforms: (JSON.parse(built('artifact.json')) as { transforms: string[] }).transforms,
					seed: 'none',
					...rest
				}
	);
	if (sample)
		await loadPack(t.db, t.manifest, readPack(`${root}.norbital/seed/sample`), t.clock.now());
	else if (typeof window !== 'undefined')
		await loadPack(t.db, t.manifest, readPack(`${root}.norbital/seed/base`), t.clock.now());
	await t.engine.refreshMessaging();
	if (sample) await t.engine.runs!.reconfigure();
	return t;
}
