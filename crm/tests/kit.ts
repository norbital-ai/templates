import { readFileSync } from 'node:fs';
import { loadPack, readPack, type EngineManifest } from '@norbital-ai/bolt/engine';
import { testWorkspace } from '@norbital-ai/bolt/test';

/** The template root: `bolt test` runs from it (a DOM test environment has no file `import.meta.url`). */
const root = `${process.cwd()}/`;
const built = (file: string) => readFileSync(`${root}.norbital/artifact/${file}`, 'utf8');

/** The seeded members of the bank's crm tree. */
export const KW = '019fc6bb-7f21-76fd-8597-7de44181da68'; // Sales
export const DAVIN = '019fc6bb-7f21-76fd-8597-7de44181da69'; // Procurement
export const SALES = ['accounts_read', 'products_read', 'commercial_shared', 'sales_rep'];
export const PROCUREMENT = [
	'products_read',
	'suppliers_manage',
	'commercial_shared',
	'procurement_officer'
];

/**
 * This template on the test kit: compiled from source by `bolt check`, or, in a DOM environment (the sweep), where
 * the compiler cannot run, read from the build (`bolt build`). `sample` loads the build's sample pack (`bolt build
 * --bank=<seed bank>`), the bank's crm tree: identity rows, then the restore, exactly as provisioning does.
 */
export async function workspace(
	options: Omit<
		Parameters<typeof testWorkspace>[0],
		'root' | 'manifest' | 'guest' | 'transforms'
	> & { sample?: true } = {}
) {
	const { sample, ...rest } = options;
	const t = await testWorkspace(
		typeof window === 'undefined'
			? { root, ...(sample ? { seed: 'none' as const } : {}), ...rest }
			: {
					manifest: JSON.parse(built('manifest.json')) as EngineManifest,
					guest: { source: built('guest.mjs') },
					transforms: (JSON.parse(built('artifact.json')) as { transforms: string[] }).transforms,
					...rest
				}
	);
	if (sample)
		await loadPack(t.db, t.manifest, readPack(`${root}.norbital/seed/sample`), t.clock.now());
	return t;
}

/** The id an act committed, or the outcome as the failure message. */
export function committed(o: unknown): string {
	const x = o as { kind: string; records?: { id: string }[] };
	if (x.kind !== 'committed') throw new Error(JSON.stringify(o));
	return x.records![0]!.id;
}
