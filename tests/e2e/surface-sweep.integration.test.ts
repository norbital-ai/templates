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
	auditFill,
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
	'loan_repayments',
	'payslip_allowance_request_inputs',
	'payslip_leave_inputs',
	'payslip_loan_repayment_inputs'
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

/**
 * Scope is context, never a field.
 *
 * A scoped page knows the settings version, the legal entity and — in self-service — the
 * employment, and every create form it opens prefills them and hides them. That contract has only
 * ever been checked by grepping the source for `<Field ... hidden />`, which proves that a line was
 * written and nothing about what the browser drew: a hidden declaration on the wrong branch, a
 * renderer that ignores `hidden`, or a page that forgot to publish its scope all leave the picker
 * on screen with the source still reading correctly.
 *
 * So this walks the scoped forms and asks the DOM. The same probe asks the opposite question in
 * the same breath — the form still shows its first section title — because a form that renders
 * nothing at all would pass "no scope control is on screen" perfectly.
 */
const SCOPE_FIELDS = ['settings_id', 'company_id'] as const;

/** The seven tables of Settings → Catalog, by the tab that opens each. */
const CATALOGUE_TABS = [
	'Contribution',
	'Work',
	'Leave catalogue',
	'Claim catalogue',
	'Allowance catalogue',
	'Adhoc',
	'Loan catalogue'
] as const;

const SETTINGS_PATH = '/app/hr_controller/settings';

/**
 * Create forms this walk cannot open, as a declared fact.
 *
 * A create button that is absent or disabled is not a passing assertion — it is a form nobody
 * looked at — so each one is named here with the reason, and the walk fails when the set changes.
 * `<path> → <button>` is the surface and the button's own label.
 */
const UNOPENABLE_FORMS = new Set<string>([]);

/**
 * Scoped surfaces that offer no create button at all, as a declared fact for the same reason.
 *
 * The scheduling board is a month calendar: a person-day is created by opening the day, not by a
 * table's New. Its other tabs are the entity's shift codes and patterns, which are not events and
 * carry no scope contract.
 */
const NO_CREATE_SURFACES = new Set(['/app/hr_controller/events/work']);

const NEW_BUTTONS = `(() => JSON.stringify(
	[...document.querySelectorAll('button')]
		.filter((node) => /^New\\b/.test((node.textContent ?? '').trim()))
		.map((node) => ({
			label: (node.textContent ?? '').trim(),
			usable:
				!node.disabled &&
				node.getAttribute('aria-disabled') !== 'true' &&
				node.getBoundingClientRect().height > 0
		}))
))()`;

const activateNamed = (selector: string, label: string): string => `(() => {
	const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(
		(candidate) =>
			(candidate.textContent ?? '').trim() === ${JSON.stringify(label)} &&
			candidate.getBoundingClientRect().height > 0
	);
	if (!(node instanceof HTMLElement) || node.getAttribute('aria-disabled') === 'true' || node.matches(':disabled'))
		return false;
	node.scrollIntoView({ block: 'center' });
	node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
	node.click();
	return true;
})()`;

/** What the open form put on screen for the scope it was opened with, and for its own first section. */
/** The visible tab labels on screen right now, outermost first, as a JSON array. */
const TAB_LABELS = `(() => JSON.stringify(
	[...document.querySelectorAll('[role="tab"]')]
		.filter((node) => node.getBoundingClientRect().height > 0)
		.map((node) => (node.textContent ?? '').trim())
		.filter((label) => label.length > 0)
))()`;

/**
 * Every panel behind a tab, audited like any other surface.
 *
 * An app's tabs are component state, not routes: navigating to `/app/<name>` paints one panel, so a
 * walk that only navigates audits one panel and reports the app clean. Employee Self-Service alone
 * hides eleven panels behind two levels of tabs — My events → Work · Leave · Claim · Allowance ·
 * Payment · Loan — and every one of them was outside this sweep.
 *
 * Two levels is the depth the template actually nests, and the inner labels are re-read after the
 * outer tab is activated because activating one replaces the tablist beneath it.
 */
const walked: string[] = [];

/** Every box the walk found leaving most of its width empty, surface by surface. */
const underfilled: string[] = [];

/**
 * Underfilled boxes that are already known, and why they are not failures today.
 *
 * The fill audit is a ratchet, not a gate: a shape recorded here is debt with a fix that belongs
 * somewhere this template does not own, and anything the audit finds that is *not* one of these
 * fails the sweep on the spot. Each entry is asserted to still match something, so the day the
 * underlying fix lands the sweep tells you to delete the entry rather than quietly carrying it.
 */
const KNOWN_UNDERFILL: readonly { shape: RegExp; note: string }[] = [
	{
		shape: /\[data-data-renderer-control\]/,
		note:
			'a complex data renderer sized to its content inside a full-width field frame — the ' +
			'regional minimum-wage matrix draws 427px of table in a 976px field, and the interval, ' +
			'duration and shift renderers do the same in a record sheet. The frame ' +
			'(oss data-renderer/data-renderer-control.svelte) is `flex items-center` and stretches ' +
			'nothing; the input renderers carry their own `w-full` and the complex ones do not. The ' +
			'fix is in oss and it is shared by every template, so it is not made from here'
	}
];

const walkTabs = async (page: HeadedPage, path: string, seenErrors: number): Promise<number> => {
	const outer = JSON.parse(String(await page.evaluate(TAB_LABELS))) as string[];
	let errors = seenErrors;
	for (const label of outer) {
		if (!JSON.parse(String(await page.evaluate(activateNamed('[role="tab"]', label))))) continue;
		const surface = `${path} → ${label}`;
		await settle(page, () => true, surface, SETTLE_TIMEOUT_MS);
		errors = assertNoErrors(await readErrors(page), surface, errors);
		await auditScroll(page, surface);
		underfilled.push(...(await auditFill(page, surface)));
		walked.push(surface);
		const inner = (JSON.parse(String(await page.evaluate(TAB_LABELS))) as string[]).filter(
			(name) => !outer.includes(name)
		);
		for (const nested of inner) {
			if (!JSON.parse(String(await page.evaluate(activateNamed('[role="tab"]', nested))))) continue;
			const deeper = `${surface} → ${nested}`;
			await settle(page, () => true, deeper, SETTLE_TIMEOUT_MS);
			errors = assertNoErrors(await readErrors(page), deeper, errors);
			await auditScroll(page, deeper);
			underfilled.push(...(await auditFill(page, deeper)));
			walked.push(deeper);
		}
		// Back to the tab this app opens on, so the create-form probe below sees what it expects.
		if (outer[0] != null) await page.evaluate(activateNamed('[role="tab"]', outer[0]));
	}
	return errors;
};

/** What the open form put on screen for the scope it was opened with, and for its own first section. */
const scopeProbe = (names: readonly string[]): string => `(() => {
	const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1) ?? document;
	const form = dialog.querySelector('form');
	if (form == null) return JSON.stringify({ form: false, operable: [], section: '', fields: 0 });
	const operable = [];
	for (const name of ${JSON.stringify(names)})
		for (const node of form.querySelectorAll('[data-collection-field="' + name + '"]')) {
			const control = node.querySelector(
				'input, textarea, select, button, [role="combobox"], [role="switch"], [role="radiogroup"], [contenteditable="true"], .cm-content'
			);
			if (control != null && node.getBoundingClientRect().height > 0)
				operable.push({ name, label: (node.querySelector('label')?.innerText ?? '').trim() });
		}
	return JSON.stringify({
		form: true,
		operable,
		// A form is sectioned by a heading or, where its segments are tabs, by the tab strip.
		section: (
			form.querySelector('h3') ??
			[...form.querySelectorAll('[role="tab"]')].find(
				(node) => node.getBoundingClientRect().height > 0
			)
		)?.innerText?.trim() ?? '',
		fields: form.querySelectorAll('[data-collection-field]').length
	});
})()`;

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
		// Employee Self-Service finds the viewer by `employees.email`, and the sweep's founder is
		// nobody's employee — so it painted "No active employment on your record" and this walk
		// audited an empty state while calling the app clean. Eleven panels behind its tabs, the
		// leave balances among them, had never been on screen in any test. Binding the founder to a
		// seeded contract is what the headed self-service test already does.
		await session.query(
			'update employees set email = $1 where id = (select employee_id from employments where employee_number = $2)',
			[`${LABEL}-founder@example.test`, 'PUB-EMP-0001']
		);
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
			underfilled.push(...(await auditFill(page, path)));
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

			// Every in-page tab, and every tab inside those. An app's tabs are component state rather
			// than routes, so navigating to `/app/<name>` paints exactly one panel and the walk above
			// audits exactly one panel — which is how a scroll trap on Employee Self-Service →
			// My events → Leave sat in front of an operator while this sweep reported the app clean.
			// The panel a tab opens is a surface like any other and gets the same four questions.
			seenErrors = await walkTabs(page, path, seenErrors);

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
				underfilled.push(...(await auditFill(page, `${path} → create form`)));
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
			underfilled.push(...(await auditFill(page, label)));
			// A representation has tabs of its own — a payroll run's payslips, a settings version's
			// schemes — and opening the sheet paints one of them. Same reason as the apps above.
			seenErrors = await walkTabs(page, label, seenErrors);
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
		// repository-health:allow LOG1 -- wasted width is a layout finding; name every one of them.
		console.log(`underfilled boxes (${underfilled.length})\n${underfilled.join('\n')}`);
		const novel = underfilled.filter(
			(finding) => !KNOWN_UNDERFILL.some((known) => known.shape.test(finding))
		);
		assert.deepEqual(
			novel,
			[],
			`${novel.length} box(es) leave more than two fifths of their width empty, and none of ` +
				`them is a shape this sweep already knows about:\n${novel.join('\n')}`
		);
		for (const known of KNOWN_UNDERFILL)
			assert.ok(
				underfilled.some((finding) => known.shape.test(finding)),
				`no box matches ${known.shape} any more — ${known.note} appears to be fixed, so ` +
					`delete its entry from KNOWN_UNDERFILL and let the sweep hold the ground`
			);
		// repository-health:allow LOG1 -- the panels behind tabs are surfaces too; name them.
		console.log(`tab panels walked\n${JSON.stringify(walked, null, 2)}`);
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
		// The scroll trap this walk was written for lived two tabs deep. If the tab probe stops
		// finding panels — a renamed role, a lazier tablist — the walk silently becomes a no-op and
		// the sweep goes green over surfaces it never opened. Nested depth is what proves it works.
		assert.ok(
			walked.filter((surface) => surface.split(' \u2192 ').length > 2).length >= 4,
			`the tab walk opened no nested panels, so it audited nothing behind tabs: ${JSON.stringify(walked)}`
		);
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});

it('every scoped create form hides the scope it was opened with, and still draws its sections', async () => {
	const { apps } = authoredNames(generatedTypesPath, readFileSync(generatedTypesPath, 'utf8'));
	const eventPages = apps
		.filter((app) => app.startsWith('hr_controller/events/'))
		.map((app) => `/app/${app}`);
	assert.ok(eventPages.length > 0, 'the controller declares no events pages to walk');
	const surfaces = [
		...CATALOGUE_TABS.map((tab) => ({
			path: SETTINGS_PATH,
			tabs: ['Catalog', tab],
			forbidden: SCOPE_FIELDS
		})),
		...eventPages.map((path) => ({ path, tabs: [] as string[], forbidden: SCOPE_FIELDS })),
		// Self-service adds the employment: the record is the reader's own and is never picked.
		// Its two create forms are the leave and claim families under My events; allowances,
		// payments and loans are read-only there and declare `create: false`.
		...['Leave', 'Claim'].map((family) => ({
			path: '/app/hr_employee',
			tabs: ['My events', family],
			forbidden: [...SCOPE_FIELDS, 'employment_id']
		}))
	];

	const session = await startPublicSeedHost(`${LABEL}-scope`, { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		// Self-service resolves the reader's employee by their email, and its tables are disabled
		// while nobody is resolved — which would leave the one surface where `employment_id` is
		// hidden as the one surface this walk never opened. One seeded person is given the walker's
		// address, exactly as the H5 board test does.
		const bound = (await session.query(
			'update employees set email = $1 where id = (select employee_id from employments where exit_date is null order by employee_number limit 1) returning id',
			[`${LABEL}-founder@example.test`]
		)) as readonly unknown[];
		assert.equal(bound.length, 1, 'the public seed carries no employment to read self-service as');
		gateway = await openGateway(session);
		browser = await launchChromiumOrSkip(ERROR_RECORDER);
		assert.ok(
			browser !== undefined,
			'Playwright Chromium is not installed; this must not pass vacuously'
		);
		const page: HeadedPage = await browser.openPage(
			guestUrlForChromium('127.0.0.1', gateway.address.port, '/')
		);
		await page.setViewportSize({ width: 1280, height: 900 });
		await waitForShell(page, SETTLE_TIMEOUT_MS);
		await unlockDeferredQueries(page);

		let seenErrors = 0;
		const opened: string[] = [];
		const unopenable: string[] = [];
		const noCreate: string[] = [];
		for (const surface of surfaces) {
			const label = [surface.path, ...surface.tabs].join(' → ');
			await navigate(page, surface.path);
			await settle(
				page,
				(current) => current.path.startsWith(surface.path),
				label,
				SETTLE_TIMEOUT_MS
			);
			for (const tab of surface.tabs) {
				assert.equal(
					await page.evaluate(activateNamed('[role="tab"]', tab)),
					true,
					`${label}: the tab ${tab} is not on screen`
				);
				await settle(page, () => true, `${label}: ${tab}`, SETTLE_TIMEOUT_MS);
			}
			const buttons = JSON.parse(String(await page.evaluate(NEW_BUTTONS))) as readonly {
				readonly label: string;
				readonly usable: boolean;
			}[];
			if (buttons.length === 0) {
				noCreate.push(surface.path);
				continue;
			}
			for (const button of buttons) {
				const formLabel = `${label} → ${button.label}`;
				if (!button.usable) {
					unopenable.push(formLabel);
					continue;
				}
				assert.equal(
					await page.evaluate(activateNamed('button', button.label)),
					true,
					`${formLabel} could not be activated`
				);
				await settle(page, (current) => current.dialogs > 0, formLabel, SETTLE_TIMEOUT_MS);
				const probe = JSON.parse(String(await page.evaluate(scopeProbe(surface.forbidden)))) as {
					readonly form: boolean;
					readonly operable: readonly { readonly name: string; readonly label: string }[];
					readonly section: string;
					readonly fields: number;
				};
				assert.equal(probe.form, true, `${formLabel} opened no form`);
				assert.deepEqual(
					probe.operable,
					[],
					`${formLabel} offers a control for the scope it was opened with`
				);
				// The form is a form: it has fields, and its first section says what they decide.
				assert.ok(probe.fields > 0, `${formLabel} rendered a form with no fields`);
				assert.ok(
					probe.section.length > 0,
					`${formLabel} rendered no section title, so the form is not sectioned`
				);
				seenErrors = assertNoErrors(await readErrors(page), formLabel, seenErrors);
				opened.push(formLabel);
				await closeOverlay(page);
			}
		}
		// repository-health:allow LOG1 -- the forms this walk actually opened are the artefact.
		console.log(
			`scoped create forms\n${JSON.stringify({ opened, unopenable, noCreate }, null, 2)}`
		);
		assert.deepEqual(
			unopenable.toSorted(),
			[...UNOPENABLE_FORMS].toSorted(),
			'the set of create forms this walk cannot open has changed'
		);
		assert.deepEqual(
			noCreate.toSorted(),
			[...NO_CREATE_SURFACES].toSorted(),
			'the set of scoped surfaces offering no create button has changed'
		);
		assert.ok(
			opened.length >= surfaces.length - noCreate.length,
			'a scoped surface contributed no opened form'
		);
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});
