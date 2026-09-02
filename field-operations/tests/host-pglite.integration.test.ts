import test from 'node:test';
import assert from 'node:assert/strict';
import { HealthSnapshot } from '@norbital-ai/bolt-server';
import { Effect, Schema } from 'effect';
import { contractorAssignmentQuery } from './helpers/contractor-assignment-query.js';
import { openFieldOpsPgliteHost, readRelease } from './helpers/field-ops-pglite-host.js';

const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 60_000;

const asRecord = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${label} was not an object: ${JSON.stringify(value)}`);
	}
	return value as Readonly<Record<string, unknown>>;
};

const isRow = (row: unknown): row is Readonly<Record<string, unknown>> =>
	typeof row === 'object' && row !== null && !Array.isArray(row);

/**
 * The compiled field-operations guest (bolt 0.0.16) binds `collections.export` / `collections.count`
 * with the same `collectionQuery` / `where.status.eq` the board uses. `collections.findMany` is not
 * on that guest's command surface.
 */
const rowsOf = (
	value: unknown,
	label: string
): ReadonlyArray<Readonly<Record<string, unknown>>> => {
	if (Array.isArray(value)) return value.filter(isRow);
	const page = asRecord(value, label);
	const rows = page.rows ?? page.records;
	if (!Array.isArray(rows)) throw new Error(`${label} had no rows: ${JSON.stringify(value)}`);
	return rows.filter(isRow);
};

const countOf = (value: unknown, label: string): number => {
	if (typeof value === 'number') return value;
	const record = asRecord(value, label);
	const count = record.count;
	if (typeof count === 'number') return count;
	throw new Error(`${label} was not a count: ${JSON.stringify(value)}`);
};

const mutationPush = (
	schemaFingerprint: string,
	graph: Readonly<Record<string, unknown>>,
	baseVersions: ReadonlyArray<Readonly<Record<string, unknown>>> = []
) => ({
	protocolVersion: 2,
	idempotencyKey: crypto.randomUUID(),
	issuedAtEpochMs: Date.now(),
	partitionKey: crypto.randomUUID(),
	schemaFingerprint,
	graph,
	baseVersions
});

/**
 * The embedder a template would call: Effect Config selects PGlite, `startApplication` binds the
 * compiled field-operations artifact, and `/readyz` is the real health endpoint — not a fixture
 * bundle. `tasks` is injected by `startApplication`. AI is a catalog stub; Obscura and a live
 * model are still required for B6–B9.
 */
test(
	'listens on PGlite selected by Effect Config against the compiled field-operations artifact',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async (t) => {
		const release = readRelease();
		assert.equal(typeof release.code?.entrypoint, 'string');
		assert.ok(
			(release.code?.entrypoint ?? '').length > 0,
			'release.json code.entrypoint must name the bundle'
		);
		assert.deepEqual([...(release.requiredFacilities ?? [])].toSorted(), [
			'ai',
			'database',
			'tasks'
		]);

		const host = await openFieldOpsPgliteHost();
		try {
			if (host.application === undefined) {
				t.skip('missing_colony_facility: startApplication did not listen');
				return;
			}

			const base = `http://${host.application.address.host}:${host.application.address.port}`;
			const ready = await fetch(`${base}/readyz`);
			assert.equal(ready.status, 200);
			const snapshot = await Effect.runPromise(
				Schema.decodeUnknownEffect(HealthSnapshot)(await ready.json())
			);
			assert.equal(snapshot.ready, true);
			assert.equal(snapshot.accepting, true);
			assert.notEqual(host.application.address.port, 0);
		} finally {
			await host.stop();
		}
	}
);

/**
 * B3 query half + B5 persist half on the same PGlite guest the listener boots.
 *
 * The contractor board sends `where.status.eq` when Status=Completed, and omits `where` when the
 * filter is cleared (`null`). A kanban drop mutates `{ id, status }`; the assignment hook stamps
 * `completed_at`. Drag+reload stays headed.
 */
test(
	'Status=Completed query is empty until a mutate { id, status } persists completed_at',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const completedQuery = contractorAssignmentQuery('completed');
		const clearedQuery = contractorAssignmentQuery(null);
		assert.deepEqual(completedQuery.where, { status: { eq: 'completed' } });
		assert.equal(clearedQuery.where, undefined);

		const host = await openFieldOpsPgliteHost({ listen: false });
		try {
			const founder = asRecord(
				await host.dispatchSigned('identity.bootstrapFounder', {
					email: 'field-ops-founder@example.test',
					claimId: 'field-ops-pglite-founder'
				}),
				'identity.bootstrapFounder'
			);
			assert.equal(founder.admitted, true);
			const credential = founder.credential;
			const userId = founder.userId;
			assert.equal(typeof credential, 'string');
			assert.equal(typeof userId, 'string');
			if (typeof credential !== 'string' || typeof userId !== 'string') return;

			let schemaFingerprint = host.schemaFingerprint;
			try {
				const printed = asRecord(
					await host.dispatchSession('schema.fingerprint', credential, {}),
					'schema.fingerprint'
				);
				if (typeof printed.fingerprint === 'string' && printed.fingerprint.length > 0) {
					schemaFingerprint = printed.fingerprint;
				}
			} catch {
				// The compiled guest may refuse schema.fingerprint to a session; release.json is the
				// fingerprint mutateBrowser compared on the previous run.
			}

			const queryAssignments = (filter: ReturnType<typeof contractorAssignmentQuery>) => ({
				collection: 'job_assignments',
				...filter,
				limit: 250
			});
			const exportAssignments = (filter: ReturnType<typeof contractorAssignmentQuery>) =>
				host.dispatchSession('collections.export', credential, queryAssignments(filter));
			const countAssignments = (filter: ReturnType<typeof contractorAssignmentQuery>) =>
				host.dispatchSession('collections.count', credential, queryAssignments(filter));

			assert.equal(countOf(await countAssignments(completedQuery), 'completed count (virgin)'), 0);
			const virginCompleted = rowsOf(
				await exportAssignments(completedQuery),
				'completed export (virgin)'
			);
			assert.equal(virginCompleted.length, 0);

			const siteId = crypto.randomUUID();
			const jobId = crypto.randomUUID();
			const assignmentId = crypto.randomUUID();

			const createdSite = asRecord(
				await host.dispatchSession(
					'collections.mutate',
					credential,
					mutationPush(schemaFingerprint, {
						action: 'create',
						collection: 'sites',
						values: { id: siteId, name: 'Hillview Crescent' }
					})
				),
				'sites create'
			);
			assert.equal(createdSite.resolution, 'accepted', JSON.stringify(createdSite));

			const createdJob = asRecord(
				await host.dispatchSession(
					'collections.mutate',
					credential,
					mutationPush(schemaFingerprint, {
						action: 'create',
						collection: 'jobs',
						values: {
							id: jobId,
							site_id: siteId,
							title: 'Installation — 112, Hillview Crescent',
							description: 'Install the approved handrail.',
							scheduled_for: '2026-07-03T00:00:00.000Z',
							status: 'unassigned'
						}
					})
				),
				'jobs create'
			);
			assert.equal(createdJob.resolution, 'accepted', JSON.stringify(createdJob));

			const createdAssignment = asRecord(
				await host.dispatchSession(
					'collections.mutate',
					credential,
					mutationPush(schemaFingerprint, {
						action: 'create',
						collection: 'job_assignments',
						values: {
							id: assignmentId,
							job_id: jobId,
							assignee_user_id: userId,
							status: 'assigned'
						}
					})
				),
				'job_assignments create'
			);
			assert.equal(createdAssignment.resolution, 'accepted', JSON.stringify(createdAssignment));

			const assignedRows = rowsOf(
				await exportAssignments(clearedQuery),
				'cleared export (assigned seed)'
			);
			assert.equal(assignedRows.length, 1);
			assert.equal(assignedRows[0]?.id, assignmentId);
			assert.equal(assignedRows[0]?.status, 'assigned');

			assert.equal(
				countOf(await countAssignments(completedQuery), 'completed count (assigned seed)'),
				0
			);
			const stillEmpty = rowsOf(
				await exportAssignments(completedQuery),
				'completed export (assigned seed)'
			);
			assert.equal(stillEmpty.length, 0);

			const rowVersion = Number(assignedRows[0]?.row_version ?? 1);
			const completed = asRecord(
				await host.dispatchSession(
					'collections.mutate',
					credential,
					mutationPush(
						schemaFingerprint,
						{
							action: 'update',
							collection: 'job_assignments',
							values: { id: assignmentId, status: 'completed' }
						},
						[
							{
								row: { collection: 'job_assignments', recordId: assignmentId },
								rowVersion
							}
						]
					)
				),
				'job_assignments complete'
			);
			assert.equal(completed.resolution, 'accepted', JSON.stringify(completed));

			assert.equal(
				countOf(await countAssignments(completedQuery), 'completed count (after mutate)'),
				1
			);
			const completedRows = rowsOf(
				await exportAssignments(completedQuery),
				'completed export (after mutate)'
			);
			assert.equal(completedRows.length, 1);
			assert.equal(completedRows[0]?.id, assignmentId);
			assert.equal(completedRows[0]?.status, 'completed');
			assert.equal(typeof completedRows[0]?.completed_at, 'string');
			assert.ok(
				String(completedRows[0]?.completed_at).length > 0,
				'completed_at must be stamped by the mutate hook'
			);

			const reloaded = rowsOf(
				await exportAssignments(clearedQuery),
				'cleared export (after mutate)'
			);
			assert.equal(reloaded.length, 1);
			assert.equal(reloaded[0]?.status, 'completed');
			assert.equal(reloaded[0]?.completed_at, completedRows[0]?.completed_at);
		} finally {
			await host.stop();
		}
	}
);
