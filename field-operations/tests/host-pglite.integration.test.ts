import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSelfHost } from '@norbital-ai/test-utilities';

const artifactDirectory = fileURLToPath(new URL('../.norbital/artifact/', import.meta.url));
const releasePath = join(artifactDirectory, 'release.json');
const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 60_000;

type ReleaseManifest = {
	readonly code?: { readonly entrypoint?: string };
	readonly requiredFacilities?: ReadonlyArray<string>;
};

const readRelease = (): ReleaseManifest | undefined => {
	if (!existsSync(releasePath)) return undefined;
	return JSON.parse(readFileSync(releasePath, 'utf8')) as ReleaseManifest;
};

/**
 * Named refusal when the compiled guest cannot become a listening host without Colony.
 *
 * `schema.migrate` is the embedder's job, not a skip. Colony-only gaps are skipped with this name
 * rather than a fake `/readyz`.
 */
const colonyListenRefusal = (error: unknown): string | undefined => {
	const message = error instanceof Error ? error.message : String(error);
	const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
	const text = `${message}\n${cause}`;
	if (/Required facilities are not bound|unavailable facilities/i.test(text)) {
		return `missing_colony_facility: ${message}`;
	}
	if (/facility is not bound|facility_unavailable/i.test(text)) {
		return `missing_colony_facility: ${message}`;
	}
	return undefined;
};

/**
 * Listen-only smoke — `withSelfHost` + compiled field-operations artifact + `/readyz`.
 * `tasks` is injected by `startApplication`. AI is a catalog stub.
 * I5 owns mutate + Run now on the public seed.
 */
test(
	'listens on PGlite selected by Effect Config against the compiled field-operations artifact',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async (t) => {
		const release = readRelease();
		if (release === undefined) {
			t.skip(`missing_artifact: ${releasePath}`);
			return;
		}
		const entrypoint = release.code?.entrypoint;
		assert.equal(typeof entrypoint, 'string');
		assert.ok((entrypoint ?? '').length > 0, 'release.json code.entrypoint must name the bundle');
		assert.deepEqual([...(release.requiredFacilities ?? [])].toSorted(), [
			'ai',
			'connector',
			'database',
			'tasks'
		]);
		const bundlePath = join(artifactDirectory, entrypoint ?? '');
		assert.ok(existsSync(bundlePath), `compiled entrypoint is missing: ${bundlePath}`);

		try {
			await withSelfHost(
				{ bundlePath, tenantId: 'field-ops-pglite', founder: false },
				async (session) => {
					assert.notEqual(session.address.port, 0);
					const ready = await fetch(`${session.baseUrl}/readyz`);
					assert.equal(ready.status, 200);
					const snapshot = (await ready.json()) as { readonly ready?: unknown };
					assert.equal(snapshot.ready, true);
				}
			);
		} catch (error) {
			const reason = colonyListenRefusal(error);
			if (reason !== undefined) {
				t.skip(reason);
				return;
			}
			throw error;
		}
	}
);
