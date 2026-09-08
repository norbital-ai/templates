import { it } from 'vitest';
import assert from 'node:assert/strict';
import { success } from '@norbital-ai/bolt-protocol';
import { startSessionGateway, workspaceDocumentHtml } from '@norbital-ai/bolt-server';
import {
	asRecord,
	bearerHeaders,
	guestUrlForChromium,
	launchChromiumOrSkip,
	postGuestCommand,
	type HeadedBrowser,
	type HeadedPage
} from '@norbital-ai/test-utilities';
import { startPublicSeedHost } from '../helpers/public-seed-host.ts';
import {
	ERROR_RECORDER,
	assertFormPresentable,
	assertNoErrors,
	closeOverlay,
	navigate,
	readErrors,
	readFormAudit,
	recordStackSearch,
	unlockDeferredQueries,
	waitForShell
} from '../helpers/surface-walk.ts';

const LABEL = 'hr-payroll-holiday-form';
const SETTINGS = '/app/hr_controller/settings';
const CALENDAR_ID = 'browser-fixture#holiday@group.v.calendar.google.com';
const FAKE_KEY = 'invented-holiday-browser-key';
const YEAR = 2028;
const ACTIVATE = `const activate = (node) => {
	if (!(node instanceof HTMLElement)) return;
	node.scrollIntoView({ block: 'center' });
	node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
	node.click();
};`;
const DIALOG = `[...document.querySelectorAll('[role="dialog"]')].at(-1)`;

const until = async <T>(
	read: () => Promise<T>,
	ready: (value: T) => boolean,
	label: string
): Promise<T> => {
	const deadline = Date.now() + 20_000;
	let last: T;
	do {
		last = await read();
		if (ready(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 150));
	} while (Date.now() < deadline);
	throw new Error(`${label} did not settle: ${JSON.stringify(last)}`);
};

const perform = (page: HeadedPage, expression: string, label: string) =>
	until(
		() => page.evaluate(expression),
		(value) => value === true,
		label
	);

const clickNamed = (page: HeadedPage, selector: string, label: string) =>
	perform(
		page,
		`(() => {
			${ACTIVATE}
			const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((candidate) =>
				candidate.textContent?.trim() === ${JSON.stringify(label)} && candidate.getBoundingClientRect().height > 0
			);
			if (!(node instanceof HTMLElement) || node.getAttribute('aria-disabled') === 'true' || node.matches(':disabled')) return false;
			activate(node);
			return true;
		})()`,
		label
	);

const fill = (page: HeadedPage, selector: string, value: string) =>
	perform(
		page,
		`(() => {
			const node = document.querySelector(${JSON.stringify(selector)});
			if (!(node instanceof HTMLInputElement) || node.disabled || node.getBoundingClientRect().height === 0) return false;
			node.focus();
			node.value = ${JSON.stringify(value)};
			node.dispatchEvent(new Event('input', { bubbles: true }));
			node.dispatchEvent(new Event('change', { bubbles: true }));
			return true;
		})()`,
		`fill ${selector}`
	);

const fieldInput = (name: string) => `[role="dialog"] [data-collection-field="${name}"] input`;

const submit = (page: HeadedPage) =>
	perform(
		page,
		`(() => {
			${ACTIVATE}
			const node = (${DIALOG})?.querySelector('button[type="submit"]');
			if (!(node instanceof HTMLButtonElement) || node.disabled) return false;
			activate(node);
			return true;
		})()`,
		'submit holiday form'
	);

const openRecord = async (page: HeadedPage, collection: string, id: string, field: string) => {
	await navigate(page, `${SETTINGS}${recordStackSearch(collection, id)}`);
	await perform(
		page,
		`document.querySelector(${JSON.stringify(fieldInput(field))}) != null`,
		`open ${collection}`
	);
};

it('Settings saves a Google source, imports a reviewed draft and publishes only on explicit save', async () => {
	const requests: string[] = [];
	const session = await startPublicSeedHost(LABEL, {
		host: '0.0.0.0',
		connector: {
			call: async (_metadata, request) => {
				assert.equal(request.connector, 'http');
				assert.equal(request.operation, 'http.request');
				const input = asRecord(request.input, 'managed Google request');
				const url = new URL(String(input.url));
				assert.equal(input.method, 'GET');
				assert.equal(asRecord(input.headers, 'managed authentication')['X-Goog-Api-Key'], FAKE_KEY);
				assert.equal(url.origin, 'https://www.googleapis.com');
				assert.equal(
					url.pathname,
					`/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`
				);
				assert.equal(url.searchParams.get('timeMin'), '2027-12-31T16:00:00.000Z');
				assert.equal(url.searchParams.get('timeMax'), '2028-12-31T16:00:00.000Z');
				assert.equal(url.searchParams.get('timeZone'), 'Asia/Singapore');
				const next = url.searchParams.get('pageToken');
				requests.push(next ?? 'first');
				assert.ok(next === null || next === 'fixture-page-two');
				return success({
					output: {
						status: 200,
						headers: {},
						body: {
							kind: 'calendar#events',
							...(next === null ? { nextPageToken: 'fixture-page-two' } : {}),
							items: [
								{
									id: next === null ? 'festival' : 'observance',
									etag: 'fixture-revision-one',
									summary: next === null ? 'Fixture festival' : 'Fixture observance',
									start: { date: next === null ? '2028-01-03' : '2028-02-02' },
									end: { date: next === null ? '2028-01-04' : '2028-02-03' }
								}
							]
						}
					}
				});
			}
		}
	});
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		const secret = await postGuestCommand(
			session.host.baseUrl,
			'secrets.write',
			{
				name: 'GOOGLE_CALENDAR_API_KEY',
				value: FAKE_KEY
			},
			bearerHeaders(session.credential)
		);
		assert.equal(secret.status, 200, JSON.stringify(secret.value));
		gateway = await startSessionGateway({
			upstream: session.host.address,
			credential: session.credential,
			cookieName: 'norbital_headed',
			listen: { host: '0.0.0.0' },
			isDocument: (path) =>
				path === '/' || path === '/__bolt' || path === '/__bolt/' || path.startsWith('/app/'),
			rewritePath: (path) =>
				path.startsWith('/__bolt/sync/')
					? `/sync/${path.slice('/__bolt/sync/'.length)}`
					: path.startsWith('/__bolt/command/')
						? `/_bolt/command/${path.slice('/__bolt/command/'.length)}`
						: path,
			document: ({ browserSession }) =>
				workspaceDocumentHtml({
					tenantId: LABEL,
					workspaceId: LABEL,
					environment: 'test',
					releaseId: LABEL,
					principal: `${LABEL}-founder`,
					syncPrincipal: `${LABEL}-founder`,
					organizationName: 'Holiday browser fixture',
					commandPrefix: '/__bolt/command/',
					syncStreamUrl: `/__bolt/sync/stream?norbital_headed=${browserSession}`,
					viewPath: SETTINGS,
					accessScope: 'operator',
					credential: session.credential
				})
		});
		browser = await launchChromiumOrSkip(ERROR_RECORDER);
		assert.ok(
			browser,
			'Chromium is required; the holiday browser regression must not pass without rendering'
		);
		const page = await browser.openPage(
			guestUrlForChromium('127.0.0.1', gateway.address.port, SETTINGS)
		);
		await page.setViewportSize({ width: 1280, height: 800 });
		await waitForShell(page, 45_000);
		await unlockDeferredQueries(page);
		await clickNamed(page, '[role="tab"]', 'Holidays');
		await clickNamed(page, '[role="tab"]', 'Google sources');
		const sourceInput = (name: string) => `[role="tabpanel"] [data-holiday-source="${name}"]`;
		await perform(
			page,
			`document.querySelector(${JSON.stringify(sourceInput('calendar_id'))}) != null`,
			'source form'
		);
		await fill(page, sourceInput('calendar_id'), 'initial-browser-fixture');
		await fill(page, sourceInput('time_zone'), 'UTC');
		const sourceForm = await readFormAudit(page);
		assertFormPresentable(sourceForm, 'Google source', new Set<string>());
		assert.deepEqual(
			sourceForm.fields.map((field) => field.name),
			['holiday_source']
		);
		const submitSource = () =>
			perform(
				page,
				`(() => {
				${ACTIVATE}
				const node = document.querySelector('[role="tabpanel"] form button[type="submit"]');
				if (!(node instanceof HTMLButtonElement) || node.disabled) return false;
				activate(node);
				return true;
			})()`,
				'submit holiday source'
			);
		await submitSource();
		const sourceOf = (row: unknown) =>
			asRecord(asRecord(row, 'settings version').holiday_source, 'saved source');
		const sources = await until(
			() =>
				session.query(
					'select holiday_source from jurisdiction_settings where jurisdiction_code = $1 and holiday_source is not null',
					['TEST-JUR']
				),
			(rows) => rows.length === 1,
			'source persisted on the settings version'
		);
		assert.equal(sourceOf(sources[0]).calendar_id, 'initial-browser-fixture');
		assert.equal(sourceOf(sources[0]).time_zone, 'UTC');
		assert.equal(sourceOf(sources[0]).enabled, true);
		await fill(page, sourceInput('calendar_id'), CALENDAR_ID);
		await fill(page, sourceInput('time_zone'), 'Asia/Singapore');
		await perform(
			page,
			`(() => {
			${ACTIVATE}
			const node = document.querySelector(${JSON.stringify(sourceInput('enabled'))});
			if (!(node instanceof HTMLInputElement)) return false;
			if (node.checked) activate(node);
			return true;
		})()`,
			'disable automatic source preparation'
		);
		await submitSource();
		await until(
			() =>
				session.query(
					'select holiday_source from jurisdiction_settings where jurisdiction_code = $1 and holiday_source is not null',
					['TEST-JUR']
				),
			(rows) =>
				rows.length === 1 &&
				sourceOf(rows[0]).calendar_id === CALENDAR_ID &&
				sourceOf(rows[0]).enabled === false &&
				sourceOf(rows[0]).time_zone === 'Asia/Singapore',
			'source edits persisted'
		);
		await navigate(page, SETTINGS);
		// The import controls sit above the observed holidays; the inner strip still remembers the
		// Google sources panel from the save above, so the panel is named rather than assumed.
		await clickNamed(page, '[role="tab"]', 'Holidays');
		await clickNamed(page, '[role="tab"]', 'Observed holidays');
		await fill(page, '[role="tabpanel"] input[type="number"]', String(YEAR));
		await clickNamed(page, 'button', 'Import selected year');
		const drafts = await until(
			() =>
				session.query(
					'select id, published_at, observations, import_review from jurisdiction_holiday_calendars where jurisdiction_code = $1 and year = $2',
					['TEST-JUR', YEAR]
				),
			(rows) => rows.length === 1 && asRecord(rows[0], 'imported draft').import_review != null,
			'manual import completed'
		);
		assert.deepEqual(requests, ['first', 'fixture-page-two']);
		const draft = asRecord(drafts[0], 'imported draft');
		assert.equal(draft.published_at, null);
		assert.deepEqual(draft.observations, []);
		const imported = asRecord(draft.import_review, 'import evidence');
		assert.equal(imported.calendar_id, CALENDAR_ID);
		assert.ok(Array.isArray(imported.events));
		assert.equal(imported.events.length, 2);
		assert.ok(
			imported.events.every((event) => asRecord(event, 'import event').review_required === true)
		);
		await perform(
			page,
			`document.body.innerText.includes('Holiday drafts are ready for review')`,
			'durable import progress'
		);
		await openRecord(page, 'jurisdiction_holiday_calendars', String(draft.id), 'year');
		await perform(
			page,
			`(() => {
			const dialog = ${DIALOG};
			return dialog?.innerText.includes('Fixture festival') && dialog?.innerText.includes('Fixture observance') && dialog?.querySelectorAll('input[type="checkbox"]').length === 1 && !dialog.querySelector('input[type="checkbox"]').checked;
		})()`,
			'pending review and unchecked publication control'
		);
		assertFormPresentable(await readFormAudit(page), 'holiday draft', new Set<string>());
		for (const [name, decision] of [
			['Fixture festival', 'Observe these dates'],
			['Fixture observance', 'Do not observe']
		]) {
			await perform(
				page,
				`(() => {
				${ACTIVATE}
				const event = [...(${DIALOG})?.querySelectorAll('span') ?? []].find((node) => node.textContent?.trim() === ${JSON.stringify(name)});
				const row = event?.closest('.border-b');
				const button = [...row?.querySelectorAll('button') ?? []].find((node) => node.textContent?.trim() === ${JSON.stringify(decision)});
				if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
				activate(button); return true;
			})()`,
				`review ${name}`
			);
		}
		await clickNamed(page, '[role="dialog"] button', 'Add observed holiday');
		const observationInputs = '[role="dialog"] [data-collection-field="observations"] input';
		for (const [index, value] of [
			'2028-03-04',
			'Manual observed holiday',
			'2028-03-03',
			'Invented browser fixture'
		].entries()) {
			await perform(
				page,
				`(() => {
				const nodes = [...document.querySelectorAll(${JSON.stringify(observationInputs)})];
				if (nodes.length !== 8) return false;
				const node = nodes[${index + 4}];
				if (!(node instanceof HTMLInputElement) || node.disabled) return false;
				node.value = ${JSON.stringify(value)};
				node.dispatchEvent(new Event('input', { bubbles: true }));
				return true;
			})()`,
				`edit observed holiday control ${index}`
			);
		}
		await submit(page);
		const reviewedRows = await until(
			() =>
				session.query(
					'select observations, import_review, published_at from jurisdiction_holiday_calendars where id = $1',
					[draft.id]
				),
			(rows) =>
				rows.length === 1 &&
				Array.isArray(asRecord(rows[0], 'reviewed draft').observations) &&
				(asRecord(rows[0], 'reviewed draft').observations as unknown[]).length === 2,
			'review choices saved as draft'
		);
		const reviewed = asRecord(reviewedRows[0], 'reviewed draft');
		assert.equal(reviewed.published_at, null, 'saving a review must not publish implicitly');
		assert.deepEqual(reviewed.observations, [
			{
				date: '2028-01-03',
				name: 'Fixture festival',
				original_date: null,
				source: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/festival`
			},
			{
				date: '2028-03-04',
				name: 'Manual observed holiday',
				original_date: '2028-03-03',
				source: 'Invented browser fixture'
			}
		]);
		const events = asRecord(reviewed.import_review, 'reviewed evidence').events;
		assert.ok(Array.isArray(events));
		assert.ok(events.every((event) => asRecord(event, 'reviewed event').review_required === false));
		await closeOverlay(page);
		await openRecord(page, 'jurisdiction_holiday_calendars', String(draft.id), 'year');
		await perform(
			page,
			`(() => {
			const node = (${DIALOG})?.querySelector('input[type="checkbox"]');
			if (!(node instanceof HTMLInputElement) || node.disabled || node.checked) return false;
			node.click(); return true;
		})()`,
			'explicit publication selection'
		);
		await submit(page);
		await until(
			() =>
				session.query('select published_at from jurisdiction_holiday_calendars where id = $1', [
					draft.id
				]),
			(rows) => rows.length === 1 && asRecord(rows[0], 'published calendar').published_at != null,
			'explicit publication persisted'
		);
		await closeOverlay(page);
		await openRecord(page, 'jurisdiction_holiday_calendars', String(draft.id), 'year');
		await perform(
			page,
			`(() => {
			const dialog = ${DIALOG};
			const inputs = [...dialog?.querySelectorAll('input') ?? []].filter((node) => node.type !== 'hidden');
			return inputs.length > 4 && inputs.every((node) => node.disabled) && dialog?.innerText.includes('This published calendar is immutable.');
		})()`,
			'published calendar controls are sealed'
		);
		assertNoErrors(await readErrors(page), 'holiday source/import/review/publication', 0);
		assert.equal(
			await page.evaluate(`document.body.innerText.includes(${JSON.stringify(FAKE_KEY)})`),
			false
		);
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});
