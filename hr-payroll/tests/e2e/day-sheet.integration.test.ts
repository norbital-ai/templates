/**
 * The roster board's two ways into a person-day.
 *
 * A cell with a stored row opens the workspace's own record sidesheet for that `work_days` record —
 * the URL stack, the collection's `+representation.svelte`, the lock seal in the header. A cell with
 * no row (the pattern-projected normal case) opens the create sheet rendering the very same
 * representation, with the person and the day the cell already names.
 *
 * Both are wiring, not arithmetic, and wiring is what silently stops working: the navigation
 * context is read during component initialisation, a cell click is not initialisation, and a sheet
 * that never opens leaves the board looking exactly as it did before the click. This walk is the
 * only thing that notices.
 */

import { it } from 'vitest';
import assert from 'node:assert/strict';
import { startSessionGateway, workspaceDocumentHtml } from '@norbital-ai/bolt-server';
import {
	guestUrlForChromium,
	launchChromiumOrSkip,
	type HeadedBrowser,
	type HeadedPage
} from '@norbital-ai/test-utilities';
import { EMPLOYMENT_ID, SHIFT_WORK_ID, startPublicSeedHost } from '../helpers/public-seed-host.ts';
import { unlockDeferredQueries, waitForShell } from '../helpers/surface-walk.ts';

const LABEL = 'hr-payroll-day-sheet';

const WORK_PATH = '/app/hr_controller/events/work';

const isBoltDocument = (pathname: string): boolean =>
	pathname === '/' ||
	pathname === '/__bolt' ||
	pathname === '/__bolt/' ||
	pathname.startsWith('/app/');

const rewriteBoltBrowserPath = (pathname: string): string => {
	if (pathname.startsWith('/__bolt/sync/'))
		return `/sync/${pathname.slice('/__bolt/sync/'.length)}`;
	if (pathname.startsWith('/__bolt/command/')) {
		return `/_bolt/command/${pathname.slice('/__bolt/command/'.length)}`;
	}
	return pathname;
};

const openGateway = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	viewPath: string
) =>
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
				viewPath,
				accessScope: 'operator',
				credential: session.credential
			})
	});

const poll = async (
	page: HeadedPage,
	expression: string,
	ok: (value: string) => boolean,
	label: string,
	ms = 30_000
): Promise<string> => {
	const deadline = Date.now() + ms;
	let last = '';
	while (Date.now() < deadline) {
		last = String(await page.evaluate(expression));
		if (ok(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`${label} timeout: ${last.slice(0, 1500)}`);
};

const activateCell = (selector: string) => `(() => {
	const node = document.querySelector(${JSON.stringify(selector)});
	if (node == null) return 'missing';
	node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
	node.click();
	return 'clicked';
})()`;

const cellLabel = (cell: string) =>
	`document.querySelector('[data-roster-cell="${cell}"]')?.getAttribute('aria-label') ?? ''`;

const DIALOG_TEXT = `document.querySelector('[role="dialog"]')?.innerText ?? ''`;

/** The month the board opens on, in the payroll zone: `todayKey()` reads the same clock. */
const payrollMonth = (): string =>
	new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Kuala_Lumpur',
		year: 'numeric',
		month: '2-digit'
	})
		.format(new Date())
		.slice(0, 7);

it('a board cell opens the record sheet for a stored day and the create sheet for a projected one', async () => {
	const session = await startPublicSeedHost(LABEL, { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		assert.equal((await fetch(`${session.host.baseUrl}/readyz`)).status, 200);
		gateway = await openGateway(session, WORK_PATH);
		browser = await launchChromiumOrSkip();
		assert.ok(browser !== undefined, 'Playwright Chromium is not installed');
		const page = await browser.openPage(
			guestUrlForChromium('127.0.0.1', gateway.address.port, WORK_PATH)
		);
		await waitForShell(page, 60_000);
		await unlockDeferredQueries(page);

		// The second of the month is a pattern-projected day: nothing has ever written it.
		await poll(
			page,
			cellLabel('0:1'),
			(label) => label.includes('Public Fixture Employee'),
			'the board painted no described cells'
		);
		assert.equal(await page.evaluate(activateCell('[data-roster-cell="0:1"]')), 'clicked');
		const createBody = await poll(
			page,
			DIALOG_TEXT,
			(text) => text.includes('Create day') && text.includes('PUB-EMP-0001'),
			'create sheet'
		);
		assert.match(createBody, /Planned/);
		assert.match(createBody, /Actual/);
		assert.match(createBody, /Why this day is locked/);
		await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);

		// A stored row is the other arm: the record sheet, opened from the URL stack. It carries
		// planned overtime, which is part of the plan: the cell prints it before any punch exists.
		const month = payrollMonth();
		await session.query(
			`insert into work_days (id, employment_id, work_date, shift_definition_id, approved_overtime_hours)
			 values (gen_random_uuid(), $1, $2::timestamptz, $3, 2)
			 on conflict (employment_id, work_date) do update
			 set approved_overtime_hours = excluded.approved_overtime_hours`,
			[EMPLOYMENT_ID, `${month}-01T00:00:00.000Z`, SHIFT_WORK_ID]
		);
		await page.evaluate('location.reload()');
		await poll(
			page,
			cellLabel('0:0'),
			(label) => label.includes('Rostered override') && label.includes('Planned overtime 2h'),
			'the board did not read the stored day and its planned overtime after reload'
		);
		assert.equal(
			await page.evaluate(
				`document.querySelector('[data-roster-cell="0:0"] [data-slot-planned-ot]')?.textContent?.trim() ?? ''`
			),
			'+2h OT',
			'the board cell does not show the planned overtime'
		);
		assert.equal(await page.evaluate(activateCell('[data-roster-cell="0:0"]')), 'clicked');
		const recordBody = await poll(
			page,
			DIALOG_TEXT,
			(text) => text.includes('PUB-EMP-0001') && text.includes('Planned'),
			'record sheet'
		);
		assert.doesNotMatch(recordBody, /Create day/);
		assert.match(recordBody, /Actual/);
		assert.match(recordBody, /Why this day is locked/);
		assert.match(recordBody, /Save assignment/);
		// The plan the row names is the plan the sheet shows.
		assert.match(recordBody, /7\.5AM/);
		// Planned overtime is keyed in the Planned section, beside the shift, not under attendance:
		// approved overtime and incentive hours as two figures, never split by the sheet.
		assert.match(
			recordBody,
			/Planned[\s\S]*Approved overtime \(hours\)[\s\S]*Incentive hours[\s\S]*Actual/
		);
		assert.doesNotMatch(recordBody, /beyond schedule/i);
		// The day's statutory maximum is stated beside the approved figure.
		assert.match(
			recordBody,
			/No overtime limit stated for this day|At most .+ of approved overtime this day \(limit .+\)/
		);

		// The sheet's write is the collection's own: an interval added and saved lands on the row
		// through the same transform every attendance write crosses (and is held for review).
		assert.equal(
			await page.evaluate(
				`(() => {
					const add = [...document.querySelectorAll('[role="dialog"] button')].find(
						(node) => node.textContent.trim() === 'Add interval'
					);
					if (add == null) return 'missing';
					add.click();
					return 'clicked';
				})()`
			),
			'clicked'
		);
		await poll(
			page,
			`[...document.querySelectorAll('[role="dialog"] button')].some((node) => node.textContent.trim() === 'Save attendance')`,
			(saved) => saved === 'true',
			'the attendance save never appeared'
		);
		await page.click('[role="dialog"] button:text-is("Save attendance")');
		const readRow = async () =>
			(await session.query(
				'select worked_intervals from work_days where employment_id = $1 and work_date = $2::timestamptz',
				[EMPLOYMENT_ID, `${month}-01T00:00:00.000Z`]
			)) as readonly { readonly worked_intervals: unknown }[];
		const deadline = Date.now() + 30_000;
		let row = (await readRow())[0];
		while (Date.now() < deadline && row?.worked_intervals == null) {
			await new Promise((resolve) => setTimeout(resolve, 250));
			row = (await readRow())[0];
		}
		assert.notEqual(row?.worked_intervals, null, 'the interval save did not land on the row');
	} finally {
		await browser?.close?.();
		await gateway?.stop?.();
		await session.stop?.();
	}
}, 300_000);
