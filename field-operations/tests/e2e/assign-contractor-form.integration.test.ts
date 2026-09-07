/**
 * A record created through the form, by the interaction a dispatcher performs.
 *
 * Everything else in this workspace creates rows over `collections.mutate`, which skips the whole
 * of `CollectionForm` — its relation pickers, its validators, its submit path, and the create hook
 * that derives `search_text` and stamps `dispatched_at` from the chosen job. "Assign contractor"
 * appears in the headed suite only as a sentinel string proving the app painted; nothing had ever
 * clicked it. So the sheet in `+field_ops_controller.svelte` was unreachable from any test, in a
 * workspace whose whole purpose is dispatching work.
 *
 * Three submits, because the form has three outcomes and only one of them writes a row.
 */

import { it } from 'vitest';
import assert from 'node:assert/strict';
import { startSessionGateway, workspaceDocumentHtml } from '@norbital-ai/bolt-server';
import {
	guestUrlForChromium,
	launchChromiumOrSkip,
	mutationPush,
	postGuestCommand,
	requireAccepted,
	type HeadedBrowser,
	type HeadedPage
} from '@norbital-ai/test-utilities';
import { bootPublicSeedGuest } from '../helpers/public-seed-guest.ts';
import { unlockDeferredQueries, waitForShell } from '../helpers/surface-walk.ts';

const LABEL = 'field-ops-assign-form';
const SEEDED_ASSIGNMENTS = 26;
const SETTLE_TIMEOUT_MS = 45_000;
/** Every seeded job is already dispatched, so the happy path needs one that is not. */
const FREE_JOB_ID = '01990000-0000-7000-8004-000000000900';
const FREE_JOB_TITLE = 'Zulu unassigned probe job';
const AMBER_QUAY_SITE_ID = '01990000-0000-7000-8003-000000000001';

const isBoltDocument = (pathname: string): boolean =>
	pathname === '/__bolt' ||
	pathname === '/__bolt/' ||
	pathname === '/' ||
	pathname.startsWith('/app/');

const rewriteBoltBrowserPath = (pathname: string): string => {
	if (pathname.startsWith('/__bolt/sync/'))
		return `/sync/${pathname.slice('/__bolt/sync/'.length)}`;
	if (pathname.startsWith('/__bolt/command/'))
		return `/_bolt/command/${pathname.slice('/__bolt/command/'.length)}`;
	return pathname;
};

const poll = async (
	page: HeadedPage,
	expression: string,
	ok: (value: string) => boolean,
	label: string,
	timeoutMs = 20_000
): Promise<string> => {
	const deadline = Date.now() + timeoutMs;
	let last = '';
	while (Date.now() < deadline) {
		last = String(await page.evaluate(expression));
		if (ok(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`${label} timeout: ${last.slice(0, 800)}`);
};

const dialogText = (page: HeadedPage): Promise<string> =>
	page
		.evaluate(
			`(() => {
				const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
				return dialog == null ? 'closed' : dialog.innerText;
			})()`
		)
		.then(String);

const fieldText = (page: HeadedPage, field: string): string =>
	`(() => {
		const wrapper = document.querySelector(${JSON.stringify(`[data-collection-field="${field}"]`)});
		return wrapper == null ? 'gone' : (wrapper.innerText ?? '').trim();
	})()`;

/**
 * Open one relation picker and take an option, with real input.
 *
 * Synthetic pointer events cannot drive this. The option list is portaled out of `Sheet.Content`,
 * so a dispatched `pointerdown` on an option reads to the sheet's layer stack as an interaction
 * *outside* it, and the whole sheet closes before any value is set. Trusted input passes through
 * the same layers a person's does and the sheet stays open.
 */
const pickOption = async (page: HeadedPage, field: string, option?: string): Promise<void> => {
	await page.click(`[data-collection-field="${field}"] button`);
	await page.click(
		option === undefined
			? '[role="option"], [cmdk-item] >> nth=0'
			: `[role="option"]:has-text(${JSON.stringify(option)}), [cmdk-item]:has-text(${JSON.stringify(option)}) >> nth=0`
	);
	await poll(
		page,
		fieldText(page, field),
		(value) => value !== 'gone' && value !== '' && !/Value…/.test(value),
		`${field} value`
	);
};

it('the assign-contractor form refuses an empty submit and a taken job, then creates one', async () => {
	const session = await bootPublicSeedGuest({
		tenantId: LABEL,
		releaseId: LABEL,
		gatewaySecret: `${LABEL}-gateway`,
		founderEmail: `${LABEL}@example.test`,
		founderClaimId: `${LABEL}-founder`,
		secretsKey: `${LABEL}-secrets-key`,
		host: '0.0.0.0'
	});
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		const countAssignments = async (): Promise<number> => {
			const rows = (await session.query('select count(*)::int as n from "job_assignments"')) as
				readonly { readonly n: number }[] | undefined;
			return rows?.[0]?.n ?? -1;
		};
		assert.equal(await countAssignments(), SEEDED_ASSIGNMENTS, 'the seed did not load as expected');

		const mutated = await postGuestCommand(
			session.baseUrl,
			'collections.mutate',
			mutationPush(session.schemaFingerprint, {
				action: 'mutate',
				collection: 'jobs',
				rows: [
					{
						action: 'create',
						values: {
							id: FREE_JOB_ID,
							external_ref: 'PUB-JOB-0900',
							site_id: AMBER_QUAY_SITE_ID,
							title: FREE_JOB_TITLE,
							nature: 'public-fixture-inspect',
							scheduled_for: '2026-09-08T00:00:00.000Z',
							status: 'unassigned',
							description: 'Invented job for the assign-contractor form walk.'
						}
					}
				]
			}),
			{ authorization: `Bearer ${session.credential}` }
		);
		assert.ok(mutated.status >= 200 && mutated.status < 300, JSON.stringify(mutated.value));
		requireAccepted(mutated.value, 'create the unassigned probe job');

		gateway = await startSessionGateway({
			upstream: session.address,
			credential: session.credential,
			cookieName: 'norbital_headed',
			listen: { host: '0.0.0.0' },
			isDocument: isBoltDocument,
			rewritePath: rewriteBoltBrowserPath,
			document: ({ browserSession }) =>
				workspaceDocumentHtml({
					tenantId: LABEL,
					workspaceId: LABEL,
					environment: 'test',
					releaseId: LABEL,
					principal: `${LABEL}-founder`,
					syncPrincipal: `${LABEL}-founder`,
					organizationName: 'Field operations public seed',
					commandPrefix: '/__bolt/command/',
					syncStreamUrl: `/__bolt/sync/stream?norbital_headed=${browserSession}`,
					viewPath: '/app/field_ops_controller',
					accessScope: 'operator',
					credential: session.credential
				})
		});
		browser = await launchChromiumOrSkip();
		assert.ok(browser !== undefined, 'Chromium is required; this test must not pass vacuously');

		const page: HeadedPage = await browser.openPage(
			guestUrlForChromium('127.0.0.1', gateway.address.port, '/app/field_ops_controller')
		);
		await waitForShell(page, SETTLE_TIMEOUT_MS);
		await unlockDeferredQueries(page);

		// Open the sheet from the control a dispatcher clicks, not by setting state.
		await page.click('button:text-is("Assign contractor")');
		await poll(
			page,
			`(() => (document.querySelector('form [data-collection-field="job_id"]') == null ? 'no' : 'yes'))()`,
			(value) => value === 'yes',
			'assign sheet'
		);

		/**
		 * An empty submit is refused before the row.
		 *
		 * Both relation columns are non-nullable, so the field validators answer first and the
		 * sheet's own `assignmentSemantic` never runs — its "Choose a job and a contractor" sentence
		 * is not what a person sees here. What matters is that the submit stops, the sheet stays open
		 * naming what is wrong, and nothing reaches the database.
		 */
		await page.click('[role="dialog"] button[type="submit"]');
		const empty = await poll(
			page,
			`(() => {
				const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
				return dialog == null ? 'closed' : dialog.innerText;
			})()`,
			(value) => /required|Fix the highlighted/i.test(value),
			'empty submit refusal'
		);
		assert.match(empty, /Fix the highlighted fields/);
		assert.equal(await countAssignments(), SEEDED_ASSIGNMENTS, 'an empty submit wrote a row');

		/**
		 * The picker offers every job, and the create hook refuses one already dispatched.
		 *
		 * The sheet's copy says "choose an unassigned job", but `job_id`'s `relationOptions` carry no
		 * `where`, so the first option is a seeded, already-assigned job. Taking it is the refusal
		 * path, and it must leave the database alone.
		 */
		await pickOption(page, 'job_id');
		await pickOption(page, 'assignee_user_id');
		await page.click('[role="dialog"] button[type="submit"]');
		const taken = await poll(
			page,
			`(() => {
				const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
				return dialog == null ? 'closed' : dialog.innerText;
			})()`,
			(value) => /already has an assignment/.test(value),
			'double-dispatch refusal'
		);
		assert.match(taken, /This job already has an assignment/);
		assert.equal(
			await countAssignments(),
			SEEDED_ASSIGNMENTS,
			'a hook-refused submit still wrote a row'
		);

		// The same form, the same two picks, on a job nothing is dispatched to. This one lands.
		await pickOption(page, 'job_id', FREE_JOB_TITLE);
		await page.click('[role="dialog"] button[type="submit"]');
		const created = await (async (): Promise<number> => {
			const deadline = Date.now() + 20_000;
			let total = await countAssignments();
			while (Date.now() < deadline && total !== SEEDED_ASSIGNMENTS + 1) {
				await new Promise((resolve) => setTimeout(resolve, 250));
				total = await countAssignments();
			}
			return total;
		})();
		assert.equal(
			created,
			SEEDED_ASSIGNMENTS + 1,
			`the form did not create an assignment: ${await dialogText(page)}`
		);

		const rows = (await session.query(
			'select status, dispatched_at, search_text, assignee_user_id from "job_assignments" where job_id = $1',
			[FREE_JOB_ID]
		)) as readonly Record<string, unknown>[];
		assert.equal(rows.length, 1, 'exactly one assignment for the probe job');
		const row = rows[0];
		assert.ok(row !== undefined);
		assert.equal(row.status, 'assigned', "the sheet's default status did not reach the row");
		assert.equal(
			typeof row.assignee_user_id,
			'string',
			'the contractor pick did not reach the row'
		);
		assert.equal(typeof row.dispatched_at, 'string', 'the create hook did not stamp dispatch');
		assert.ok(
			typeof row.search_text === 'string' && row.search_text.includes(FREE_JOB_TITLE),
			`the create hook did not derive search text from the chosen job: ${JSON.stringify(row)}`
		);
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});
