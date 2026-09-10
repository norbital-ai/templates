import { it } from 'vitest';
import assert from 'node:assert/strict';
import { success } from '@norbital-ai/bolt-protocol';
import { startSessionGateway, workspaceDocumentHtml } from '@norbital-ai/bolt-server';
import { dateKey } from '../../src/lib/iso-day.ts';
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
/**
 * Holidays are the entity's, so both surfaces live on the entity record rather than on the
 * jurisdiction-scoped Settings app. The walk opens the seeded fixture entity and works its
 * Holidays tab: the Google source form, the import, and publication one day at a time.
 */
const ENTITIES = '/app/hr_controller/entities';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const CALENDAR_ID = 'browser-fixture#holiday@group.v.calendar.google.com';
const FAKE_KEY = 'invented-holiday-browser-key';
const YEAR = new Date().getFullYear() + 1;
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
	await navigate(page, `${ENTITIES}${recordStackSearch(collection, id)}`);
	await perform(
		page,
		`document.querySelector(${JSON.stringify(fieldInput(field))}) != null`,
		`open ${collection}`
	);
};

it('the entity saves a Google source, imports unpublished holidays and publishes one by one', async () => {
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
				assert.equal(url.searchParams.get('timeMin'), `${YEAR - 1}-12-31T16:00:00.000Z`);
				assert.equal(url.searchParams.get('timeMax'), `${YEAR}-12-31T16:00:00.000Z`);
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
									start: { date: next === null ? `${YEAR}-01-03` : `${YEAR}-02-02` },
									end: { date: next === null ? `${YEAR}-01-04` : `${YEAR}-02-03` }
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
					viewPath: ENTITIES,
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
			guestUrlForChromium('127.0.0.1', gateway.address.port, ENTITIES)
		);
		await page.setViewportSize({ width: 1280, height: 800 });
		await waitForShell(page, 45_000);
		await unlockDeferredQueries(page);
		// Open the entity, then its Holidays tab: the source form and the calendar sit together
		// there, because both belong to the entity that observes the days.
		await navigate(page, `${ENTITIES}${recordStackSearch('companies', COMPANY_ID)}`);
		await clickNamed(page, '[role="tab"]', 'Holidays');
		const sourceInput = (name: string) =>
			`[data-holiday-source-form] [data-holiday-source="${name}"]`;
		await perform(
			page,
			`document.querySelector(${JSON.stringify(sourceInput('calendar_id'))}) != null`,
			'source form'
		);
		await fill(page, sourceInput('calendar_id'), 'initial-browser-fixture');
		await fill(page, sourceInput('time_zone'), 'UTC');
		const sourceField = await page.evaluate(
			`(() => { const node = document.querySelector('[data-holiday-source-form] [data-collection-field="holiday_source"]'); return node == null ? null : { label: (node.querySelector('label')?.innerText ?? '').trim(), height: Math.round(node.getBoundingClientRect().height) }; })()`
		);
		assert.ok(
			sourceField != null && sourceField.label !== '' && sourceField.height > 0,
			`Google source field: ${JSON.stringify(sourceField)}`
		);
		const submitSource = () =>
			perform(
				page,
				`(() => {
				${ACTIVATE}
				const node = document.querySelector('[data-holiday-source-form] button[type="submit"]');
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
					'select holiday_source from companies where id = $1 and holiday_source is not null',
					[COMPANY_ID]
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
					'select holiday_source from companies where id = $1 and holiday_source is not null',
					[COMPANY_ID]
				),
			(rows) =>
				rows.length === 1 &&
				sourceOf(rows[0]).calendar_id === CALENDAR_ID &&
				sourceOf(rows[0]).enabled === false &&
				sourceOf(rows[0]).time_zone === 'Asia/Singapore',
			'source edits persisted'
		);
		// Holidays: import from the Google source set above, then publish one day.
		await clickNamed(page, 'button', 'Import from Google');
		const imported = await until(
			() =>
				session.query(
					'select id, date, name, published_at, source from jurisdiction_holidays where company_id = $1 and date >= $2 order by date',
					[COMPANY_ID, `${YEAR}-01-01`]
				),
			(rows) => rows.length === 2,
			'google import completed'
		);
		assert.deepEqual(requests, ['first', 'fixture-page-two']);
		assert.deepEqual(
			imported.map((row) => {
				const holiday = asRecord(row, 'imported holiday');
				return [dateKey(String(holiday.date)), holiday.name, holiday.published_at];
			}),
			[
				[`${YEAR}-01-03`, 'Fixture festival', null],
				[`${YEAR}-02-02`, 'Fixture observance', null]
			]
		);
		assert.ok(
			imported.every((row) =>
				String(asRecord(row, 'imported holiday').source).includes('/events/')
			),
			'each imported holiday names its Google event'
		);
		await perform(
			page,
			`document.body.innerText.includes('Imported 2 holidays; 0 already present')`,
			'durable import progress'
		);
		// A second import adds nothing: the same two days are already there.
		await clickNamed(page, 'button', 'Import from Google');
		await perform(
			page,
			`document.body.innerText.includes('Imported 0 holidays; 2 already present')`,
			'second import skipped every day'
		);
		assert.equal(
			(
				await session.query(
					'select count(*)::int as count from jurisdiction_holidays where company_id = $1 and date >= $2',
					[COMPANY_ID, `${YEAR}-01-01`]
				)
			).map((row) => asRecord(row, 'count').count)[0],
			2
		);

		// Publish the festival from its row; the observance stays a draft.
		const festival = asRecord(imported[0], 'festival');
		// Publishing is a bulk operation: select the festival's row, then run Publish selected.
		await perform(
			page,
			`(() => {
				${ACTIVATE}
				const box = [...document.querySelectorAll('[aria-label="Select row"]')].find((node) => {
					let scope = node.parentElement;
					while (scope != null && !scope.textContent?.includes('Fixture festival')) scope = scope.parentElement;
					return scope != null && !scope.textContent?.includes('Fixture observance');
				});
				if (!(box instanceof HTMLElement)) return false;
				activate(box);
				return true;
			})()`,
			'select the festival row'
		);
		await perform(
			page,
			`(() => {
				${ACTIVATE}
				const node = document.querySelector('[title="Collection actions"]');
				if (!(node instanceof HTMLElement)) return false;
				activate(node);
				return true;
			})()`,
			'open the collection actions'
		);
		await perform(
			page,
			`(() => {
				${ACTIVATE}
				const node = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim().startsWith('Bulk actions'));
				if (!(node instanceof HTMLElement)) return false;
				if (node.getAttribute('aria-expanded') !== 'true') activate(node);
				return document.querySelector('[aria-label="Run Publish selected"]') != null;
			})()`,
			'open the operations'
		);
		await perform(
			page,
			`(() => {
				${ACTIVATE}
				const node = document.querySelector('[aria-label="Run Publish selected"]');
				if (!(node instanceof HTMLElement) || node.matches(':disabled')) return false;
				activate(node);
				return true;
			})()`,
			'publish selected'
		);
		await until(
			() =>
				session.query('select published_at from jurisdiction_holidays where id = $1', [
					festival.id
				]),
			(rows) => rows.length === 1 && asRecord(rows[0], 'published holiday').published_at != null,
			'publication persisted'
		);
		assert.equal(
			asRecord(
				(
					await session.query('select published_at from jurisdiction_holidays where id = $1', [
						imported[1] == null ? '' : asRecord(imported[1], 'observance').id
					])
				)[0],
				'observance'
			).published_at,
			null,
			'publication is per holiday'
		);

		// The record sheet is a presentable form, with the publication as its own control.
		await openRecord(page, 'jurisdiction_holidays', String(festival.id), 'name');
		assertFormPresentable(await readFormAudit(page), 'holiday', new Set<string>());
		await closeOverlay(page);
		assertNoErrors(await readErrors(page), 'holiday source/import/publication', 0);
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
