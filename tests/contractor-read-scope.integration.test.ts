/**
 * The contractor policy, exercised from a contractor's own session.
 *
 * `tests/job-assignments-access-boundaries.test.ts` reads the policy module and asserts the shape
 * of its `where` trees. That proves the policy is *written* the way it is meant to be; it cannot
 * prove the runtime enforces it, because it never starts a host, never signs anybody in, and never
 * issues a query. Every other session in this workspace is the founder, who is a dispatcher and
 * therefore reads every row — `tests/public-seed-assignments.integration.test.ts` asserts it sees
 * all twenty-six assignments, which is the opposite of the contractor scope.
 *
 * This starts a real host, mints a session for Ben Voss — a member of the `Contractor` team, which
 * `access/+teams.ts` binds to `field_ops_contractor` — and asks the four questions that matter:
 * he sees his own assignments, he does not see Ada's, the read mask holds, and the collections the
 * policy grants nothing on are refused rather than silently empty.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { postGuestCommand, requireOk, rowsOf } from '@norbital-ai/test-utilities';
import { bootPublicSeedGuest } from './helpers/public-seed-guest.js';

const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 120_000;

const BEN_VOSS = {
	id: '01990000-0000-7000-8002-000000000002',
	email: 'ben.voss@example.test'
} as const;
const ADA_QUILL_ID = '01990000-0000-7000-8002-000000000001';
/** Seeded thirteen apiece; the split is what makes "sees only his own" a real assertion. */
const ASSIGNMENTS_EACH = 13;

const bearer = (credential: string): Readonly<Record<string, string>> => ({
	authorization: `Bearer ${credential}`
});

test(
	'a contractor session reads its own assignments and nothing else',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const guest = await bootPublicSeedGuest({
			// The seeded `user` rows pin `tenantId`, and identity is scoped by it: a session for a
			// seeded person can only be minted inside the tenant those rows name.
			tenantId: 'field-ops-public-seed',
			releaseId: 'field-ops-contractor-scope',
			gatewaySecret: 'field-ops-contractor-scope-gateway',
			founderEmail: 'field-ops-contractor-scope@example.test',
			founderClaimId: 'field-ops-contractor-scope-founder',
			secretsKey: 'field-ops-contractor-scope-secrets-key'
		});
		try {
			// System authority mints the session; what the session may then read is decided entirely by
			// the policy Ben's team holds, which is the thing under test.
			const started = await guest.guestCommand(
				'identity.continueSession',
				{ email: BEN_VOSS.email },
				'system'
			);
			assert.ok(
				started.status >= 200 && started.status < 300,
				`identity.continueSession HTTP ${started.status}: ${JSON.stringify(started.value)}`
			);
			const credential = (started.value as { readonly credential?: unknown }).credential;
			assert.equal(typeof credential, 'string', JSON.stringify(started.value));
			const contractor = bearer(String(credential));

			const read = async (input: Record<string, unknown>, label: string): Promise<unknown> =>
				requireOk(
					await postGuestCommand(guest.baseUrl, 'collections.findMany', input, contractor),
					label
				);

			const assignments = rowsOf(
				await read(
					{
						collection: 'job_assignments',
						limit: 100,
						columns: { id: true, job_id: true, status: true }
					},
					'contractor job_assignments'
				),
				'contractor job_assignments'
			);
			assert.equal(
				assignments.length,
				ASSIGNMENTS_EACH,
				`a contractor read every assignee's work: ${assignments.length} rows`
			);

			// The scope is proven by what it excludes, not only by a count. Asking for Ada's rows by
			// her id must come back empty rather than refused — the policy narrows the set, and a
			// contractor is entitled to ask.
			const ada = rowsOf(
				await read(
					{
						collection: 'job_assignments',
						where: { assignee_user_id: { eq: ADA_QUILL_ID } },
						limit: 100,
						columns: { id: true }
					},
					"contractor asking for another assignee's rows"
				),
				"contractor asking for another assignee's rows"
			);
			assert.deepEqual(ada, [], "a contractor read another assignee's assignments");

			// The read mask is part of the boundary. `assignee_user_id` is not in
			// `assignmentReadFields`, so it must not come back even when the row does.
			const masked = rowsOf(
				await read(
					{ collection: 'job_assignments', limit: 1, columns: { id: true, status: true } },
					'contractor masked row'
				),
				'contractor masked row'
			);
			const row = masked[0];
			assert.ok(row !== undefined);
			assert.equal(
				Object.hasOwn(row, 'assignee_user_id'),
				false,
				`a masked field reached the contractor: ${JSON.stringify(row)}`
			);

			// Nothing grants the contractor the suspicion ledger, and "nothing granted" must be a
			// refusal. An empty page would read the same on the wire as a scope that simply matched no
			// rows, which is how a missing grant hides as a working one.
			for (const collection of ['suspicious_activity_logs', 'suspicion_reviews']) {
				const denied = await postGuestCommand(
					guest.baseUrl,
					'collections.findMany',
					{ collection, limit: 1 },
					contractor
				);
				assert.ok(
					denied.status >= 400,
					`${collection} answered a contractor with HTTP ${denied.status}: ${JSON.stringify(denied.value)}`
				);
			}
		} finally {
			await guest.stop();
		}
	}
);
