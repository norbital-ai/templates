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
	bearerHeaders,
	guestUrlForChromium,
	launchChromiumOrSkip,
	postGuestCommand,
	requireAccepted,
	type HeadedBrowser,
	type HeadedPage
} from '@norbital-ai/test-utilities';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	JANUARY_2026,
	JURISDICTION_ID,
	SHIFT_WORK_ID,
	startPublicSeedHost
} from '../helpers/public-seed-host.ts';
import { writeRows } from '../helpers/write.ts';
import {
	ERROR_RECORDER,
	FAILURE_COPY,
	assertFormPresentable,
	assertNoErrors,
	auditScroll,
	auditFill,
	auditNarrow,
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
 * Every visible structured field has a dedicated renderer.
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
const NO_REPRESENTATION = new Set(['loan_repayments']);

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
				email: `${LABEL}-founder@example.test`,
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

/** Populate the record types absent from the public fixtures; payroll creates its own outputs. */
async function prepareRepresentations(session: Awaited<ReturnType<typeof startPublicSeedHost>>) {
	const create = async (collection: string, values: Readonly<Record<string, unknown>>) => {
		const response = await writeRows(session, collection, 'create', [values]);
		requireAccepted(response.value, `${collection} representation fixture`);
	};
	await create('payroll_runs', { company_id: COMPANY_ID, period: JANUARY_2026 });
	// Synthetic display state; the standalone funding integration test verifies calculation and settlement.
	await session.query(`update payslips set net = 0, total_deductions = gross + 1000,
		unfunded_contributions = 1000, funding_received_on = '2026-01-31', funding_reference = 'SURFACE-RECEIPT'`);
	for (const family of ['claim', 'adhoc'] as const) {
		const [catalogue] = await session.query(`select id from ${family}_catalogue limit 1`);
		assert.ok(catalogue);
		await create(`${family}_requests`, {
			employment_id: EMPLOYMENT_ID,
			catalogue_id: catalogue.id,
			amount: 100,
			...(family === 'claim'
				? { incurred_on: '2026-04-02', description: 'Client travel' }
				: { event_date: '2026-04-15', reason: 'Departure payment' })
		});
	}
	const loanCatalogueId = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
	await session.query(
		`insert into loan_catalogue (id, settings_id, code, loan_type, eligibility)
		 values ($1, $2, 'LOAN_RECOVERY', 'STAFF', '')`,
		[loanCatalogueId, JURISDICTION_ID]
	);
	await create('loans', {
		employment_id: EMPLOYMENT_ID,
		loan_catalogue_id: loanCatalogueId,
		principal: 1200,
		effective_range: { start: '2026-04-01T00:00:00Z', end: '2026-09-30T00:00:00Z' },
		reference: 'SURFACE-LOAN',
		repayment_loan: {
			create: [
				{ due_date: '2026-04-30', amount_due: 600, sequence: 1 },
				{ due_date: '2026-05-31', amount_due: 600, sequence: 2 }
			]
		}
	});
	await create('rosters', { employment_id: EMPLOYMENT_ID, period: '2026-05' });
	await create('work_days', {
		employment_id: EMPLOYMENT_ID,
		work_date: '2026-05-04',
		shift_definition_id: SHIFT_WORK_ID,
		worked_intervals: [{ start: '2026-05-04T01:00:00Z', end: '2026-05-04T09:00:00Z' }]
	});
	await create('payment_holds', {
		employment_id: EMPLOYMENT_ID,
		category: 'TAX_CLEARANCE',
		directive_reference: 'SURFACE-HOLD',
		held_on: '2026-01-31T00:00:00.000Z'
	});
	await create('company_facts', {
		company_id: COMPANY_ID,
		effective_range: { start: '2026-01-01T00:00:00.000Z', end: null },
		facts: {}
	});
	await create('employment_wage_periods', {
		employment_id: EMPLOYMENT_ID,
		period: { start: '2026-03-01T00:00:00Z', end: '2026-03-31T00:00:00Z' },
		ordinary_wages: { currency: 'MYR', value: 3100 },
		ordinary_days: 22,
		due_on: '2026-04-07T00:00:00.000Z',
		reference: 'SURFACE-WAGE'
	});
	// The junction is payroll output with no direct write surface; the sweep only needs one row
	// to open the representation.
	const [capturedPeriod] = await session.query(
		'select id from employment_wage_periods order by created_at desc limit 1'
	);
	const [capturedSlip] = await session.query('select id from payslips order by id limit 1');
	assert.ok(capturedPeriod && capturedSlip);
	await session.query(
		'insert into payslip_wage_periods (payslip_id, wage_period_id) values ($1, $2)',
		[capturedSlip.id, capturedPeriod.id]
	);
}

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

/** The four tables of Settings → Catalog, by the tab that opens each. */
const CATALOGUE_TABS = [
	'Leave catalogue',
	'Claim catalogue',
	'Allowance catalogue',
	'Loan catalogue'
] as const;

/**
 * The Settings tabs that open a create form outside Catalog, with the scope each form must hide.
 * Schemes inherit the version on screen, so `settings_id` is hidden.
 */
const SETTINGS_FORM_TABS: readonly {
	readonly tab: string;
	readonly forbidden: readonly string[];
}[] = [{ tab: 'Statutory contributions', forbidden: SCOPE_FIELDS }];

const SETTINGS_PATH = '/app/hr_controller/settings';

/**
 * A sealed version is frozen law and offers no create, so the Settings forms are walked on a
 * draft: PUB_1 cloned through the operator's own command, then picked in the jurisdiction
 * picker — `PUB_2`, the lineage's second snapshot.
 */
const DRAFT_SNAPSHOT = 'PUB_2';
const pickVersion = (snapshot: string): string => `(() => {
	const activate = (node) => {
		node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
		node.click();
	};
	const picker = document.querySelector('[data-jurisdiction-scope-combobox]');
	if (picker == null) return 'missing-picker';
	if ((picker.textContent ?? '').includes(${JSON.stringify(snapshot)})) return 'picked';
	const option = [...document.querySelectorAll('[role="option"]')].find((node) =>
		(node.textContent ?? '').includes(${JSON.stringify(snapshot)})
	);
	if (option instanceof HTMLElement) {
		activate(option);
		return 'clicked';
	}
	const trigger = picker.querySelector('button');
	if (!(trigger instanceof HTMLElement)) return 'missing-trigger';
	activate(trigger);
	return 'opened';
})()`;

/**
 * The entity record's Scheduling tabs: roster codes and shift patterns belong to the employing
 * entity, so a form opened from inside the entity inherits it and hides `company_id`.
 */
const ENTITY_SCHEDULING_TABS = ['Roster codes', 'Shift patterns'] as const;
const ENTITIES_PATH = '/app/hr_controller/entities';

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
 * carry no scope contract. Settings always offers its tabs' own New buttons (under Catalog and
 * Statutory contributions), so it is not one of these. Self-Service opens Leave on its Balances
 * chip; its New Leave Entry sits behind the Leave application chip, which this check does not open.
 */
const NO_CREATE_SURFACES = new Set(['/app/hr_controller/events/work', '/app/hr_employee']);

/**
 * The New buttons a surface offers: inside its open record sheet when it has one, else the page's.
 * Page-header actions (a `role="toolbar"` above the tabs) are not surface create forms: the settings
 * page keeps New version / Void version up there, and they belong to the page, not to a tab.
 */
const NEW_BUTTONS = `(() => JSON.stringify(
	[...([...document.querySelectorAll('[role="dialog"]')].at(-1) ?? document).querySelectorAll('button')]
		.filter((node) => !node.closest('[role="toolbar"]'))
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
/**
 * Phone findings this template still carries, each a fix waiting to land; the list only shrinks.
 */
const KNOWN_NARROW: ReadonlyArray<RegExp> = [];

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

	// A surface that mounts a dozen live queries registers them in one body, and this walk opens
	// every surface: the host reads what a deployed host reads (1 MiB), not the test default.
	const session = await startPublicSeedHost(LABEL, {
		host: '0.0.0.0',
		requestBodyLimitBytes: 1_048_576
	});
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
		await prepareRepresentations(session);
		const rowIds = await firstRowIds(session.query, representations);
		assert.equal(rowIds.size, representations.length, 'every representation needs a fixture');
		await session.query('update jurisdiction_settings set facts = $1::jsonb where id = $2', [
			JSON.stringify([
				{ key: 'audit_consent', type: 'boolean', label: 'Declared consent' },
				{
					key: 'audit_count',
					type: 'number',
					label: 'Declared count',
					required_when: 'company.facts.audit_consent',
					minimum: 0,
					maximum: 3,
					integer: true
				},
				{ key: 'audit_category', type: 'string', label: 'Declared category', options: ['A', 'B'] }
			]),
			JURISDICTION_ID
		]);
		// Use the actual Taiwan declaration keys to exercise its typed controls on the fixture.
		const declarations = JSON.parse(
			readFileSync(
				new URL('../../seed/jurisdiction/TW/statutory_contributions.json', import.meta.url),
				'utf8'
			)
		)
			.filter(
				(row: { code: string; settings_id: string }) =>
					row.settings_id === '1fcfa66f-40da-5792-b925-7c2fcaa8f92c' &&
					['INCOME_TAX', 'NHI'].includes(row.code)
			)
			.flatMap((row: { elections: readonly { key: string; type: string }[] }) => row.elections);
		const declarationSchemeId = 'c2222222-2222-4222-8222-222222222222';
		await session.query(
			`insert into statutory_contributions (id, settings_id, code, name, elections, rules)
			values ($1, $2, 'TW_DECLARATION_TEST', 'Taiwan withholding declaration', $3::jsonb, '[]'::jsonb)`,
			[declarationSchemeId, JURISDICTION_ID, JSON.stringify(declarations)]
		);
		await session.query(
			'update employment_statutory_facts set statutory_contribution_id = $1 where id = $2',
			[declarationSchemeId, rowIds.get('employment_statutory_facts')]
		);
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
		await waitForShell(page, SETTLE_TIMEOUT_MS).catch(async (cause: unknown) => {
			throw new Error(`Workspace startup errors: ${JSON.stringify(await readErrors(page))}`, {
				cause
			});
		});
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
			// Settings' New version action opens a lifecycle dialog. Its catalogue create forms
			// are exercised explicitly by the scoped-form walk below.
			const opened =
				path === SETTINGS_PATH
					? 'none'
					: String(
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

		// The same apps once more as a phone: 390 wide, coarse pointer, no hover. Structure changes
		// (the sidebar is a sheet, dialogs are bottom sheets) and the three phone tells are measured.
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateTouch(true);
		const narrow: string[] = [];
		for (const app of apps) {
			const path = `/app/${app}`;
			if (SKIPPED_SURFACES.has(path)) continue;
			await navigate(page, path);
			await settle(
				page,
				(current) => current.path.startsWith(path.split('/').slice(0, 3).join('/')),
				`${path} (narrow)`,
				SETTLE_TIMEOUT_MS
			);
			seenErrors = assertNoErrors(await readErrors(page), `${path} (narrow)`, seenErrors);
			narrow.push(...(await auditNarrow(page, `${path} (narrow)`)));
		}
		await page.emulateTouch(false);
		await page.setViewportSize({ width: 1280, height: 700 });
		assert.deepEqual(
			narrow.filter((finding) => !KNOWN_NARROW.some((known) => known.test(finding))),
			[],
			'a surface gives itself away on a phone'
		);

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
				(current) =>
					current.dialogs > 0 &&
					(collection !== 'companies' || current.dialogBody.includes('Declared consent')),
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
			if (collection === 'payslips') {
				assert.match(paint.dialogBody, /Contribution funding/);
				assert.match(paint.dialogBody, /Funding outstanding/);
				await page.evaluate(`(() => {
					const label = [...document.querySelectorAll('label')].find((node) => node.textContent.trim().startsWith('Funds received'));
					const input = label?.control ?? label?.querySelector('input');
					if (!input) throw new Error('Funds received control missing');
					input.value = '100';
					input.dispatchEvent(new Event('input', { bubbles: true }));
				})()`);
				await page.click('button:text-is("Save funding")');
				await settle(
					page,
					(current) => current.dialogBody.includes('900.00'),
					'funding receipt saved',
					SETTLE_TIMEOUT_MS
				);
				const [stored] = await session.query(
					'select funding_received, funding_reference from payslips where id = $1',
					[recordId]
				);
				assert.equal(Number(stored?.funding_received), 100);
				assert.equal(stored?.funding_reference, 'SURFACE-RECEIPT');
			}
			if (collection === 'companies') {
				assert.match(paint.dialogBody, /Required when applicable/);
				const declarations = await page.evaluate(`(async () => {
					const find = (name) => [...document.querySelectorAll('label')].find(node => {
						const label = node.cloneNode(true);
						label.querySelectorAll('input, select, textarea').forEach(control => control.remove());
						return label.textContent.trim() === name;
					});
					const consent = find('Declared consent')?.querySelector('select');
					const count = find('Declared count')?.querySelector('input');
					const category = find('Declared category')?.querySelector('select');
					if (!consent || !count || !category) throw new Error('Jurisdiction declarations did not generate entity controls: ' + document.querySelector('[role="dialog"]')?.textContent);
					if (consent.value !== '' || count.value !== '') throw new Error('Missing facts became recorded defaults');
					consent.value = 'false'; consent.dispatchEvent(new Event('change', { bubbles: true }));
					count.value = '0'; count.dispatchEvent(new Event('input', { bubbles: true }));
					await new Promise(requestAnimationFrame);
					return { consent: consent.value, count: count.value, min: count.min, max: count.max, step: count.step, options: [...category.options].map(option => option.textContent) };
				})()`);
				assert.deepEqual(declarations, {
					consent: 'false',
					count: '0',
					min: '0',
					max: '3',
					step: '1',
					options: ['Not recorded', 'A', 'B']
				});
			}
			if (collection === 'employment_statutory_facts') {
				const state = await page.evaluate(`(async () => {
					const label = [...document.querySelectorAll('label')].find((node) => node.textContent.trim() === 'Reference number');
					const input = label?.querySelector('input');
					if (!input) throw new Error('Registration reference input missing');
					input.value = '';
					input.dispatchEvent(new Event('input', { bubbles: true }));
					await new Promise(requestAnimationFrame);
					const add = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Add child claim');
					if (!add) throw new Error('Incomplete reference collapsed the registration editor');
					add.click();
					await new Promise(requestAnimationFrame);
					return document.body.innerText;
				})()`);
				assert.match(String(state), /Children claimed at 100%/);
				assert.match(String(state), /Children claimed at 50%/);
				assert.match(String(state), /Declaration reference/);
				const liabilityDate = await page.evaluate(`(async () => {
					const label = [...document.querySelectorAll('label')].find((node) => node.textContent.trim() === 'First contribution due date');
					const input = label?.querySelector('input[type="date"]');
					if (!input) throw new Error('First contribution liability date input missing');
					input.value = '2018-01-01';
					input.dispatchEvent(new Event('input', { bubbles: true }));
					await new Promise(requestAnimationFrame);
					return label.querySelector('input')?.value;
				})()`);
				assert.equal(liabilityDate, '2018-01-01');
				const deductionState = await page.evaluate(`(async () => {
					const details = [...document.querySelectorAll('details')].find((node) => node.querySelector('summary')?.textContent.trim() === 'Tax deductions · TP1 / TP3');
					if (!details) throw new Error('Deduction editor missing');
					details.open = true;
					const add = [...details.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Add deduction');
					add.click();
					await new Promise(requestAnimationFrame);
					const label = [...details.querySelectorAll('label')].find((node) => node.textContent.trim() === 'Claim amount (RM)');
					const amount = label?.querySelector('input');
					if (!amount) throw new Error('Deduction amount input missing');
					amount.value = '120';
					amount.dispatchEvent(new Event('input', { bubbles: true }));
					await new Promise(requestAnimationFrame);
					return details.innerText;
				})()`);
				assert.match(String(deductionState), /Deduction declaration reference/);
				assert.match(String(deductionState), /Current employer · TP1/);
				assert.match(String(deductionState), /120\.00/);
				const tableDeclaration = await page.evaluate(`(async () => {
					const find = (name) => [...document.querySelectorAll('label')].find((node) => node.textContent.trim() === name)?.querySelector('input');
					const reference = find('Tax table declaration reference');
					const count = find('Declared spouse and dependants');
					if (!reference || !count) throw new Error('Taiwan declaration controls missing');
					if (count.value !== '') throw new Error('Missing dependant count became a declared zero');
					reference.value = 'TW-DECL-01';
					reference.dispatchEvent(new Event('input', { bubbles: true }));
					await new Promise(requestAnimationFrame);
					count.value = '0';
					count.dispatchEvent(new Event('input', { bubbles: true }));
					await new Promise(requestAnimationFrame);
					return [find('Tax table declaration reference')?.value, find('Declared spouse and dependants')?.value];
				})()`);
				assert.deepEqual(tableDeclaration, ['TW-DECL-01', '0']);
				const enrolledCount = await page.evaluate(`(async () => {
					const find = () => [...document.querySelectorAll('label')].find((node) => node.textContent.trim() === 'NHI enrolled dependants')?.querySelector('input');
					const count = find();
					if (!count || count.value !== '') throw new Error('Missing NHI count became a declared zero');
					count.value = '0';
					count.dispatchEvent(new Event('input', { bubbles: true }));
					await new Promise(requestAnimationFrame);
					return find()?.value;
				})()`);
				assert.equal(enrolledCount, '0');
			}
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
		assert.deepEqual(unseeded, [], 'every authored representation must be rendered');
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
		...SETTINGS_FORM_TABS.map(({ tab, forbidden }) => ({
			path: SETTINGS_PATH,
			tabs: [tab],
			forbidden
		})),
		...ENTITY_SCHEDULING_TABS.map((tab) => ({
			path: ENTITIES_PATH,
			search: recordStackSearch('companies', COMPANY_ID),
			tabs: ['Scheduling', tab],
			forbidden: ['company_id']
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
	const cloned = await postGuestCommand(
		session.host.baseUrl,
		'invoke.new_settings_version',
		{ input: { settings_id: JURISDICTION_ID, starts_on: '2027-01-01' } },
		bearerHeaders(session.credential)
	);
	assert.ok(
		cloned.status >= 200 && cloned.status < 300,
		`cloning PUB_1 into a draft failed: ${JSON.stringify(cloned.value)}`
	);
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		// Self-service resolves the reader's employee by their email, and its tables are disabled
		// while nobody is resolved — which would leave the one surface where `employment_id` is
		// hidden as the one surface this walk never opened. One seeded person is given the walker's
		// address, exactly as the H5 board test does.
		const bound = (await session.query(
			"update employees set email = $1 where id = (select employee_id from employments where effective_range->>'end' is null order by employee_number limit 1) returning id",
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
		await waitForShell(page, SETTLE_TIMEOUT_MS).catch(async (cause: unknown) => {
			throw new Error(`Workspace startup errors: ${JSON.stringify(await readErrors(page))}`, {
				cause
			});
		});
		await unlockDeferredQueries(page);

		let seenErrors = 0;
		const opened: string[] = [];
		const unopenable: string[] = [];
		const noCreate: string[] = [];
		for (const surface of surfaces) {
			const search = 'search' in surface ? surface.search : '';
			const label = [surface.path, ...surface.tabs].join(' → ');
			await navigate(page, `${surface.path}${search}`);
			await settle(
				page,
				(current) =>
					current.path.startsWith(surface.path) && (search === '' || current.dialogs > 0),
				label,
				SETTLE_TIMEOUT_MS
			);
			// A record sheet is a dialog already; the create form is the one opened on top of it.
			const openDialogs = search === '' ? 0 : 1;
			if (surface.path === SETTINGS_PATH) {
				const deadline = Date.now() + SETTLE_TIMEOUT_MS;
				let picked = '';
				while (Date.now() < deadline && picked !== 'picked') {
					picked = String(await page.evaluate(pickVersion(DRAFT_SNAPSHOT)));
					if (picked !== 'picked') await new Promise((resolve) => setTimeout(resolve, 200));
				}
				assert.equal(picked, 'picked', `${label}: the draft ${DRAFT_SNAPSHOT} is not pickable`);
				await settle(page, () => true, `${label}: ${DRAFT_SNAPSHOT}`, SETTLE_TIMEOUT_MS);
			}
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
				await settle(
					page,
					(current) => current.dialogs > openDialogs,
					formLabel,
					SETTLE_TIMEOUT_MS
				);
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
