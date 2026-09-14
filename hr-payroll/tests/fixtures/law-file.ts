// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * One reader for the statutory fixture files.
 *
 * A deployed workspace carries the whole template checkout and refuses any text file over 1 MiB
 * (`hosting/source.ts`), and a lineage whose EPF schedule is transcribed rule by rule is over
 * twice that. Such a fixture is committed gzipped — a `.json.gz` is neither source nor media to
 * the host, so it is skipped rather than refused — and read back here; a fixture under the
 * ceiling stays plain JSON. `scripts/refresh-statutory-fixtures.mjs` decides the form on write.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/** The host's ceiling on one authored text file. */
export const HOST_TEXT_FILE_CEILING = 1_048_576;

/** Whether `<path>.json` or `<path>.json.gz` exists, `path` given without its extension. */
export function lawFileExists(pathWithoutExtension: string): boolean {
	return (
		existsSync(`${pathWithoutExtension}.json`) || existsSync(`${pathWithoutExtension}.json.gz`)
	);
}

/** Parse `<path>.json`, or `<path>.json.gz` when the plain file is absent. */
export function readLawFile(pathWithoutExtension: string): any {
	const plain = `${pathWithoutExtension}.json`;
	if (existsSync(plain)) return JSON.parse(readFileSync(plain, 'utf8'));
	return JSON.parse(gunzipSync(readFileSync(`${plain}.gz`)).toString('utf8'));
}
