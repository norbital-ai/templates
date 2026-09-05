import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSelfHost } from '@norbital-ai/test-utilities';

const artifactDirectory = fileURLToPath(new URL('../.norbital/artifact/', import.meta.url));
const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 60_000;

type ReleaseManifest = {
	readonly code?: { readonly entrypoint?: string };
	readonly requiredFacilities?: ReadonlyArray<string>;
};

const readRelease = (): ReleaseManifest => {
	const path = join(artifactDirectory, 'release.json');
	assert.ok(existsSync(path), `compiled artifact is missing ${path}`);
	return JSON.parse(readFileSync(path, 'utf8')) as ReleaseManifest;
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
 * Listen-only smoke — `withSelfHost` + compiled hr-payroll artifact + `/readyz`.
 * `tasks` is injected by `startApplication`. AI is a catalog stub.
 */
test(
	'listens on PGlite selected by Effect Config against the compiled hr-payroll artifact',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async (t) => {
		const release = readRelease();
		const entrypoint = release.code?.entrypoint;
		assert.equal(typeof entrypoint, 'string');
		assert.ok(entrypoint.length > 0, 'release.json code.entrypoint must name the bundle');
		const bundlePath = join(artifactDirectory, entrypoint);
		assert.ok(existsSync(bundlePath), `compiled entrypoint is missing: ${bundlePath}`);
		assert.deepEqual([...(release.requiredFacilities ?? [])].toSorted(), [
			'ai',
			'connector',
			'database',
			'tasks'
		]);

		try {
			await withSelfHost(
				{ bundlePath, tenantId: 'hr-payroll-pglite', founder: false },
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
