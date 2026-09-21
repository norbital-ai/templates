import { it } from 'vitest';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { startSessionGateway, workspaceDocumentHtml } from '@norbital-ai/bolt-server';
import {
	guestUrlForChromium,
	launchChromiumOrSkip,
	type HeadedBrowser,
	type HeadedPage
} from '@norbital-ai/test-utilities';
import { EMPLOYMENT_ID, startPublicSeedHost } from '../helpers/public-seed-host.ts';

/**
 * The work-entries import, end to end in a browser: the sheet the app hands out comes back in
 * through the file dialog and its rows land in `work_days`.
 *
 * The reader, the payload and the pipeline are already exercised by
 * `scripts/verify-workbook-import.mjs`; what this covers is the half that script stubs out — the
 * browser's file input, ExcelJS in the page, the toast, and the write.
 */

const EVALUATE_TIMEOUT_MS = 45_000;
const WORKER = 'hr-payroll-work-import';
const EMPLOYEE_NUMBER = 'PUB-EMP-0001';
const TIMEZONE = 'Asia/Kuala_Lumpur';

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

const waitFor = async (
	page: HeadedPage,
	expression: string,
	ok: (value: string) => boolean,
	label: string,
	ms = EVALUATE_TIMEOUT_MS
): Promise<string> => {
	const deadline = Date.now() + ms;
	let last = '';
	while (Date.now() < deadline) {
		last = String(await page.evaluate(expression));
		if (ok(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	const pageText = String(await page.evaluate('document.body.innerText'));
	throw new Error(`${label} timeout: ${last.slice(0, 1200)}\n${pageText.slice(-4000)}`);
};

/** The current month, so the imported rows land on the board the page already shows. */
const monthOf = (at: Date): string =>
	`${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;

const nextMonth = (month: string): string => {
	const [year, index] = month.split('-').map(Number);
	return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`;
};

const daysInMonth = (month: string): readonly string[] => {
	const [year, index] = month.split('-').map(Number);
	const count = new Date(Date.UTC(year, index, 0)).getUTCDate();
	return Array.from({ length: count }, (_, day) => `${month}-${String(day + 1).padStart(2, '0')}`);
};

/**
 * The issued workbook, filled: a whole month of shifts for one person — the roster rule is whole or
 * it is not one — and two days of actual punches.
 */
const filledWorkbook = async (month: string): Promise<string> => {
	const workbook = new ExcelJS.Workbook();
	const settings = workbook.addWorksheet('Settings');
	settings.addRow(['Setting', 'Value']);
	settings.addRow(['legal_entity', 'Public Fixture Co']);
	settings.addRow(['month', month]);
	settings.addRow(['timezone', TIMEZONE]);

	const days = daysInMonth(month);
	const roster = workbook.addWorksheet('Roster');
	roster.addRow(['employee_number', ...days.map((day) => String(Number(day.slice(-2))))]);
	roster.addRow([
		EMPLOYEE_NUMBER,
		...days.map((day) => {
			const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
			return weekday === 0 || weekday === 6 ? 'REST' : '7.5AM';
		})
	]);

	const attendance = workbook.addWorksheet('Time entries');
	attendance.addRow(['employee_number', 'work_date', 'clock_in', 'clock_out']);
	attendance.addRow([EMPLOYEE_NUMBER, days[0], '08:00', '17:00']);
	attendance.addRow([EMPLOYEE_NUMBER, days[1], '08:05', '17:10']);

	return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
};

it('uploads the scheduling workbook through the file dialog and imports its work days', async () => {
	const month = monthOf(new Date());
	const session = await startPublicSeedHost(WORKER, { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		assert.equal((await fetch(`${session.host.baseUrl}/readyz`)).status, 200);
		const before = await session.query(
			'select count(*)::int as count from work_days where work_date >= $1 and work_date < $2',
			[`${month}-01`, `${nextMonth(month)}-01`]
		);
		assert.equal(Number(before[0]?.count ?? -1), 0, 'the fixture seeds no attendance');
		const base64 = await filledWorkbook(month);

		gateway = await startSessionGateway({
			upstream: session.host.address,
			credential: session.credential,
			cookieName: 'norbital_headed',
			listen: { host: '0.0.0.0' },
			isDocument: isBoltDocument,
			rewritePath: rewriteBoltBrowserPath,
			document: ({ browserSession }) =>
				workspaceDocumentHtml({
					tenantId: WORKER,
					workspaceId: WORKER,
					environment: 'test',
					releaseId: WORKER,
					principal: `${WORKER}-founder`,
					email: `${WORKER}-founder@example.test`,
					syncPrincipal: `${WORKER}-founder`,
					organizationName: 'HR payroll public seed',
					commandPrefix: '/__bolt/command/',
					syncStreamUrl: `/__bolt/sync/stream?norbital_headed=${browserSession}`,
					viewPath: '/app/hr_controller/events/work',
					accessScope: 'operator',
					credential: session.credential
				})
		});
		browser = await launchChromiumOrSkip();
		if (browser === undefined) return;
		const page = await browser.openPage(
			guestUrlForChromium('127.0.0.1', gateway.address.port, '/app/hr_controller/events/work')
		);
		await waitFor(
			page,
			`document.querySelector('button[aria-label="Roster month"]') === null ? 'waiting' : 'ready'`,
			(value) => value === 'ready',
			'work-board'
		);

		// The import builds its own `<input type="file">` and clicks it. Capturing that click is what
		// lets the test hand the page a real file the way a person would.
		await page.evaluate(`(() => {
			window.__workImport = { input: null };
			const original = HTMLInputElement.prototype.click;
			HTMLInputElement.prototype.click = function () {
				if (this.type === 'file') {
					window.__workImport.input = this;
					return;
				}
				return original.call(this);
			};
		})()`);
		await page.click('button[aria-label="Open collection actions"]');
		// The Import section starts collapsed (Export is the default-open section once an export
		// exists), so it is opened by its own trigger rather than by matching the word.
		await page.evaluate(`(() => {
			const trigger = [...document.querySelectorAll('button')].find((button) =>
				/^Import\\s/.test((button.textContent ?? '').trim())
			);
			trigger?.click();
		})()`);
		await waitFor(
			page,
			`String(document.querySelectorAll('button[aria-label="Run Import"]').length)`,
			(count) => count === '1',
			'import-pipeline'
		);
		await page.click('button[aria-label="Run Import"]');
		await waitFor(
			page,
			'window.__workImport.input === null ? "waiting" : "captured"',
			(value) => value === 'captured',
			'file-input'
		);
		const attached = await page.evaluate(`(() => {
			const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (character) =>
				character.charCodeAt(0)
			);
			const file = new File([bytes], 'scheduling.xlsx', {
				type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			});
			const transfer = new DataTransfer();
			transfer.items.add(file);
			const input = window.__workImport.input;
			input.files = transfer.files;
			input.dispatchEvent(new Event('change'));
			return input.files.length;
		})()`);
		assert.equal(Number(attached), 1, 'the page received the workbook');

		await waitFor(
			page,
			'document.body.innerText',
			(text) => /Imported \d+/.test(text),
			'import-toast',
			60_000
		);
		const imported = await session.query(
			'select count(*)::int as count from work_days where work_date >= $1 and work_date < $2',
			[`${month}-01`, `${nextMonth(month)}-01`]
		);
		assert.equal(
			Number(imported[0]?.count ?? -1),
			daysInMonth(month).length,
			'the month imported whole'
		);
		const punched = await session.query(
			`select work_date, worked_intervals from work_days
			 where employment_id = $1
			 order by work_date asc
			 limit 2`,
			[EMPLOYMENT_ID]
		);
		assert.equal(punched.length, 2, 'the two punched days were written');
		for (const day of punched) {
			assert.ok(Array.isArray(day.worked_intervals), 'the punch was written');
			assert.equal(day.worked_intervals.length, 1);
		}
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});
