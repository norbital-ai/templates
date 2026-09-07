/**
 * One walk over every app this template declares and every representation it authors.
 *
 * Nothing in this workspace had ever loaded a page. For every surface a tenant can reach this
 * asks the four questions that fail silently: does it paint without an uncaught error, does
 * anything on it trap the scroll, does its create form lay out real renderers rather than a raw
 * JSON editor, and was it quick once the workspace was warm.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startSessionGateway, workspaceDocumentHtml } from '@norbital-ai/bolt-server';
import {
	guestUrlForChromium,
	launchChromiumOrSkip,
	type HeadedBrowser,
	type HeadedPage
} from '@norbital-ai/test-utilities';
import { startPublicSeedHost } from '../helpers/public-seed-host.ts';
import {
	ERROR_RECORDER,
	FAILURE_COPY,
	assertFormPresentable,
	assertNoErrors,
	auditScroll,
	authoredNames,
	closeOverlay,
	navigate,
	readErrors,
	readFormAudit,
	recordStackSearch,
	settle,
	unlockDeferredQueries,
	waitForShell
} from '../helpers/surface-walk.ts';

const LABEL = 'construction-sweep';
const ORGANIZATION = 'Construction public seed';

/** The columns whose value genuinely is a structured document, so the JSON editor is right. */
const STRUCTURED_FIELDS = new Set([
	'schedule_range',
	'validity_range',
	'assignment_range',
	'claim_period',
	'effective_range',
	'geo',
	'location',
	'metadata',
	'matrix',
	'payload'
]);

/**
 * Collections that author no representation, and are therefore never opened by this walk.
 *
 * `authoredRepresentations` reads the filesystem, so a representation that is deleted, renamed or
 * moved does not fail the sweep — it simply stops being walked, and the run stays green over a
 * surface nobody looks at any more. A filter over declarations is a silent-skip machine wherever
 * it appears; the fix is the same everywhere, which is to make the skipped set a declared fact
 * that has to be edited on purpose.
 */
const NO_REPRESENTATION = new Set([]);

/**
 * Collections the public seed carries no row for, so this walk cannot render them.
 *
 * Naming them rather than skipping quietly is the point: each is a representation no test has ever
 * painted. Adding one row to `tests/fixtures/seed/` is what removes a name from this list.
 */
const UNSEEDED_COLLECTIONS = new Set([
	'asset_documents',
	'bim_reference_matrix',
	'defects',
	'job_assignments',
	'jobs',
	'jobs_certification_types',
	'jobs_site_locations',
	'payment_claims',
	'permits_to_work',
	'permits_to_work_certification_types',
	'permits_to_work_workers',
	'rfis',
	'site_locations'
]);

const WARM_SURFACE_BUDGET_MS = 15_000;
const SETTLE_TIMEOUT_MS = 60_000;
const WALK_TIMEOUT_MS = 300_000;

const templateRoot = new URL('../../', import.meta.url);
const generatedTypesPath = fileURLToPath(
	new URL('.norbital/generated/authoring-types.ts', templateRoot)
);

const authoredRepresentations = (): readonly string[] =>
	readdirSync(fileURLToPath(new URL('src/collections/', templateRoot)), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) =>
			readdirSync(fileURLToPath(new URL(`src/collections/${name}/`, templateRoot))).includes(
				'+representation.svelte'
			)
		)
		.toSorted();

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

type Report = {
	readonly surface: string;
	readonly elapsedMs: number;
	readonly tables: number;
	readonly rows: number;
	readonly formFields: number | null;
};

test(
	'every app surface and every representation paints, scrolls and forms cleanly',
	{ timeout: WALK_TIMEOUT_MS },
	async () => {
		const { apps, collections } = authoredNames(
			generatedTypesPath,
			readFileSync(generatedTypesPath, 'utf8')
		);
		const representations = authoredRepresentations();
		assert.ok(apps.length > 0, 'the compiler emitted no apps to sweep');
		// Every collection either authors a representation this walk opens, or is named above as
		// authoring none. A file that disappears moves a name between those two sets and fails here.
		assert.deepEqual(
			collections.filter((name) => !representations.includes(name)).toSorted(),
			[...NO_REPRESENTATION].toSorted(),
			'a collection gained or lost its representation without this list being updated'
		);

		const session = await startPublicSeedHost(LABEL, { host: '0.0.0.0' });
		let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
		let browser: HeadedBrowser | undefined;
		try {
			assert.equal((await fetch(`${session.baseUrl}/readyz`)).status, 200);
			const rowIds = new Map<string, string>();
			for (const collection of representations) {
				const rows = (await session.query(`select id from "${collection}" limit 1`)) as
					readonly { readonly id?: unknown }[] | undefined;
				const id = rows?.[0]?.id;
				if (typeof id === 'string') rowIds.set(collection, id);
			}

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
						organizationName: ORGANIZATION,
						commandPrefix: '/__bolt/command/',
						syncStreamUrl: `/__bolt/sync/stream?norbital_headed=${browserSession}`,
						viewPath: '/',
						accessScope: 'operator',
						credential: session.credential
					})
			});
			browser = await launchChromiumOrSkip(ERROR_RECORDER);
			assert.ok(
				browser !== undefined,
				'Playwright Chromium is not installed, and this sweep must not pass vacuously'
			);

			const page: HeadedPage = await browser.openPage(
				guestUrlForChromium('127.0.0.1', gateway.address.port, '/')
			);
			// A short viewport is the point: a region only traps the scroll once its content outgrows
			// the box, and nothing outgrows a 900-pixel-tall window.
			await page.setViewportSize({ width: 1280, height: 700 });
			await waitForShell(page, SETTLE_TIMEOUT_MS);
			await unlockDeferredQueries(page);

			let seenErrors = 0;
			const reports: Report[] = [];
			const groups = new Set(
				apps.filter((app) => apps.some((other) => other.startsWith(`${app}/`)))
			);

			for (const [index, app] of apps.entries()) {
				const path = `/app/${app}`;
				await navigate(page, path);
				const { paint, elapsedMs } = await settle(
					page,
					(current) => current.path.startsWith(path.split('/').slice(0, 3).join('/')),
					path,
					SETTLE_TIMEOUT_MS
				);
				seenErrors = assertNoErrors(await readErrors(page), path, seenErrors);
				assert.doesNotMatch(
					paint.body,
					FAILURE_COPY,
					`${path} painted the shell's failure copy: ${paint.body.slice(0, 800)}`
				);
				assert.ok(
					paint.heading.length > 0,
					`${path} rendered no application header, so its module never mounted`
				);
				await auditScroll(page, path);
				if (index > 0) {
					assert.ok(
						elapsedMs < WARM_SURFACE_BUDGET_MS,
						`${path} took ${elapsedMs} ms on a warm workspace (budget ${WARM_SURFACE_BUDGET_MS} ms)`
					);
				}
				if (!groups.has(app)) {
					assert.ok(
						paint.tables > 0 || paint.length > 200,
						`${path} painted nothing but chrome: ${paint.body.slice(0, 400)}`
					);
				}

				let formFields: number | null = null;
				const opened = String(
					await page.evaluate(
						`(() => {
							const create = [...document.querySelectorAll('button')].find((node) =>
								/^New\\b/.test((node.textContent ?? '').trim())
							);
							if (create == null) return 'none';
							create.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
							create.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
							create.click();
							return 'opened';
						})()`
					)
				);
				if (opened === 'opened') {
					await settle(
						page,
						(current) => current.dialogs > 0,
						`${path} → create form`,
						SETTLE_TIMEOUT_MS
					);
					const audit = await readFormAudit(page);
					assertFormPresentable(audit, `${path} → create form`, STRUCTURED_FIELDS);
					await auditScroll(page, `${path} → create form`);
					seenErrors = assertNoErrors(await readErrors(page), `${path} → create form`, seenErrors);
					formFields = audit.fields.length;
					await closeOverlay(page);
				}

				reports.push({
					surface: path,
					elapsedMs,
					tables: paint.tables,
					rows: paint.rows,
					formFields
				});
			}

			// The workspace overview mounts no record-navigation surface, so the detail stack opens
			// over an application route — which is where a tenant opens one.
			const representationBase = `/app/${apps.find((app) => !groups.has(app)) ?? apps[0]}`;
			const unseeded: string[] = [];
			for (const collection of representations) {
				const recordId = rowIds.get(collection);
				if (recordId === undefined) {
					unseeded.push(collection);
					continue;
				}
				const label = `representation ${collection}`;
				await navigate(page, `${representationBase}${recordStackSearch(collection, recordId)}`);
				const { paint, elapsedMs } = await settle(
					page,
					(current) => current.dialogs > 0,
					label,
					SETTLE_TIMEOUT_MS
				);
				seenErrors = assertNoErrors(await readErrors(page), label, seenErrors);
				assert.doesNotMatch(
					paint.dialogBody,
					FAILURE_COPY,
					`${label} painted failure copy: ${paint.dialogBody.slice(0, 800)}`
				);
				assert.ok(
					paint.dialogBody.trim().length > 0,
					`${label} opened an empty sheet — the representation rendered nothing`
				);
				await auditScroll(page, label);
				assert.ok(
					elapsedMs < WARM_SURFACE_BUDGET_MS,
					`${label} took ${elapsedMs} ms on a warm workspace (budget ${WARM_SURFACE_BUDGET_MS} ms)`
				);
				reports.push({
					surface: label,
					elapsedMs,
					tables: paint.tables,
					rows: paint.rows,
					formFields: null
				});
				await closeOverlay(page);
			}

			// repository-health:allow LOG1 -- the walk's ledger is the artefact a human reads.
			console.log(`surface sweep\n${JSON.stringify(reports, null, 2)}`);
			assert.deepEqual(
				unseeded,
				[...UNSEEDED_COLLECTIONS].filter((name) => representations.includes(name)).toSorted(),
				'the set of representations no seeded row can render has changed'
			);
		} finally {
			if (browser !== undefined) await browser.close();
			if (gateway !== undefined) await gateway.stop();
			await session.stop();
		}
	}
);
