/**
 * One walk over every app this template declares and every representation it authors.
 *
 * The suite around this file proves payroll arithmetic in enormous detail and had never once
 * loaded most of the pages that arithmetic is entered on. This is the other half. For every
 * surface a tenant can reach it asks four questions, because all four fail the same way —
 * silently, on one page, long after a suite that only ever loaded one page went green:
 *
 *  1. Does it paint, without an uncaught error and without the shell's own failure copy?
 *  2. Is every region that clips its content also scrollable, and does no inert region contain
 *     scroll chaining? Those are the two shapes a scroll trap takes, and both are measurable from
 *     the layout — which matters, because the page wrapper cannot dispatch a real wheel.
 *  3. Does a create form lay out real renderers — a labelled, operable control per field, and no
 *     ordinary field fallen through to the raw JSON code editor?
 *  4. Was it snappy? The first surface pays for the cold start; every later one is measured.
 *
 * Representations are opened by URL (`?stack=`), not by hunting for a row, so a collection no app
 * puts a table in front of is still walked — and a collection with no seeded row is reported
 * rather than skipped in silence.
 */

import { it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

const LABEL = 'hr-payroll-sweep';

/**
 * Every visible structured field has a dedicated renderer. The one document without a renderer,
 * jurisdiction_settings.research_notes, is explicitly hidden by its representation.
 * A JSON editor on a create form therefore indicates a missing renderer, including on new fields.
 */
const STRUCTURED_FIELDS = new Set<string>();

/** The kiosk is a chromeless device surface that asks for a camera the runner has not got. */
const SKIPPED_SURFACES = new Set(['/app/hr_controller/kiosk']);

/**
 * Collections that author no representation, and are therefore never opened by this walk.
 *
 * `authoredRepresentations` reads the filesystem, so a representation that is deleted, renamed or
 * moved does not fail the sweep — it simply stops being walked, and the run stays green over a
 * surface nobody looks at any more. A filter over declarations is a silent-skip machine wherever
 * it appears; the fix is the same everywhere, which is to make the skipped set a declared fact
 * that has to be edited on purpose.
 */
const NO_REPRESENTATION = new Set([
	'employment_contract_inputs',
	'holiday_calendar_inputs',
	'loan_repayments',
	'payslip_allowance_request_inputs',
	'payslip_payment_request_inputs',
	'payslip_claim_request_inputs',
	'payslip_leave_inputs',
	'payslip_loan_repayment_inputs',
	'payslip_work_day_inputs'
]);

/**
 * Collections the public seed carries no row for, so this walk cannot render their representation.
 *
 * Behaviour suites create some of these records, but this independent walk starts from the public
 * fixtures alone. A fixture row removes the corresponding gap from this list.
 */
const UNSEEDED_COLLECTIONS = new Set([
	'claim_requests',
	'loan_catalogue',
	'loans',
	'payment_requests',
	'payroll_runs',
	'payslip_adjustments',
	'payslips',
	'work_days'
]);

/** A warm surface budget. The first navigation pays the cold start and is excluded. */
const WARM_SURFACE_BUDGET_MS = 15_000;
const SETTLE_TIMEOUT_MS = 60_000;

const templateRoot = new URL('../../', import.meta.url);
const generatedTypesPath = fileURLToPath(
	new URL('.norbital/generated/authoring-types.ts', templateRoot)
);
const collectionsDirectory = fileURLToPath(new URL('src/collections/', templateRoot));

/** The collections this template authors a representation for — the set the walk must reach. */
const authoredRepresentations = (): readonly string[] =>
	readdirSync(collectionsDirectory, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => {
			try {
				return readdirSync(
					fileURLToPath(new URL(`src/collections/${name}/`, templateRoot))
				).includes('+representation.svelte');
			} catch {
				return false;
			}
		})
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

const openGateway = async (session: Awaited<ReturnType<typeof startPublicSeedHost>>) =>
	startSessionGateway({
		upstream: session.host.address,
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
				organizationName: 'HR payroll public seed',
				commandPrefix: '/__bolt/command/',
				syncStreamUrl: `/__bolt/sync/stream?norbital_headed=${browserSession}`,
				viewPath: '/',
				accessScope: 'operator',
				credential: session.credential
			})
	});

/** One seeded row per collection, so a representation can be opened by URL. */
const firstRowIds = async (
	query: Awaited<ReturnType<typeof startPublicSeedHost>>['query'],
	collections: readonly string[]
): Promise<ReadonlyMap<string, string>> => {
	const found = new Map<string, string>();
	for (const collection of collections) {
		const rows = (await query(`select id from "${collection}" limit 1`)) as
			readonly { readonly id?: unknown }[] | undefined;
		const id = rows?.[0]?.id;
		if (typeof id === 'string') found.set(collection, id);
	}
	return found;
};

type Report = {
	readonly surface: string;
	readonly elapsedMs: number;
	readonly tables: number;
	readonly rows: number;
	readonly formFields: number | null;
};

it('every app surface and every representation paints, scrolls and forms cleanly', async () => {
	const { apps, collections } = authoredNames(
		generatedTypesPath,
		readFileSync(generatedTypesPath, 'utf8')
	);
	const representations = authoredRepresentations();
	assert.ok(apps.length > 0, 'the compiler emitted no apps to sweep');
	// Every collection either authors a representation this walk opens, or is named above as
	// authoring none. A file that disappears moves a name between those two sets and fails here.
	assert.deepEqual(
		[...representations, ...NO_REPRESENTATION].toSorted(),
		collections.toSorted(),
		'a collection gained or lost its representation without this list being updated'
	);
	assert.ok(representations.length > 0, 'this template authors no representation to sweep');
	for (const path of SKIPPED_SURFACES) {
		assert.ok(
			apps.includes(path.slice('/app/'.length)),
			`${path} is excluded from the sweep but is no longer an authored app`
		);
	}

	const session = await startPublicSeedHost(LABEL, { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		assert.equal((await fetch(`${session.host.baseUrl}/readyz`)).status, 200);
		const rowIds = await firstRowIds(session.query, representations);
		gateway = await openGateway(session);
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
		// A group's own route is the hero that introduces its children, never a catalogue.
		const groups = new Set(
			apps.filter((app) => apps.some((other) => other.startsWith(`${app}/`))).map((app) => app)
		);

		for (const [index, app] of apps.entries()) {
			const path = `/app/${app}`;
			if (SKIPPED_SURFACES.has(path)) continue;
			await navigate(page, path);
			const { paint, elapsedMs } = await settle(
				page,
				// A group route replaces itself with its default child, so the settled path is either.
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
				`${path} rendered no application header, so its module never mounted: ${paint.body.slice(0, 400)}`
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

			// One create form per app surface. The layout contract is the same for every collection,
			// so opening all of them on every page would multiply the walk for no new answer.
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

		// The workspace overview mounts no record-navigation surface, so the detail stack is opened
		// over an application route — which is also where a tenant opens one.
		const representationBase = `/app/${apps.find((app) => !groups.has(app) && !SKIPPED_SURFACES.has(`/app/${app}`)) ?? apps[0]}`;

		// Every authored representation, opened by URL from an application surface. A collection no
		// app puts a table in front of is still a surface a tenant reaches — from the finder, from a
		// relation chip, from a link — and it must render.
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

		// repository-health:allow LOG1 -- the walk's ledger is the artefact a human reads after a run.
		console.log(`surface sweep\n${JSON.stringify(reports, null, 2)}`);
		// Compare the exact declared gap set: a retired or renamed collection must not disappear
		// behind a filter, and a new representation without a fixture must be recorded explicitly.
		assert.deepEqual(
			unseeded,
			[...UNSEEDED_COLLECTIONS].toSorted(),
			'the set of representations no seeded row can render has changed'
		);
		assert.ok(
			reports.some((report) => report.formFields !== null && report.formFields > 0),
			'the sweep never opened a create form, so its layout contract proved nothing'
		);
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});
