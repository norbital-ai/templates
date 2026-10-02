// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const ExcelJS = createRequire(import.meta.url)('exceljs') as typeof import('exceljs');
import type { WorkbookGrids } from '../../src/lib/workbook-rows.js';

const mocks = vi.hoisted(() => ({
	act: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn()
}));
vi.mock('exceljs/dist/exceljs.bare.min.js', async () => {
	const { createRequire } = await import('node:module');
	return { default: createRequire(import.meta.url)('exceljs/dist/exceljs.bare.min.js') };
});
vi.mock('$bolt', () => ({ bolt: { act: mocks.act } }));
vi.mock('../../src/lib/ui/t.js', () => ({ t: (key: string) => key }));
vi.mock('svelte-sonner', () => ({ toast: mocks }));
vi.mock('../../src/lib/ui/workbook-import-details.svelte', () => ({ default: {} }));
import { runWorkbookImport } from '../../src/lib/ui/workbook-import.js';

const options = {
	action: 'jurisdiction_holidays.import_workbook' as const,
	recordLabel: 'holidays',
	buildPayload: vi.fn((_grids: WorkbookGrids) => ({ rows: [] }))
};
afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	document.body.replaceChildren();
});

it('connects the native picker, imports the selected XLSX, then removes the input', async () => {
	const workbook = new ExcelJS.Workbook();
	workbook.addWorksheet('Holidays').addRow(['Holiday', 'Date']);
	const bytes = await workbook.xlsx.writeBuffer();
	const file = new File([new Uint8Array(bytes)], 'holidays.xlsx');
	mocks.act.mockResolvedValue({ kind: 'committed', output: { inserted: 0 }, records: [] });
	const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
		this: HTMLInputElement
	) {
		expect(this.isConnected).toBe(true);
		expect(this.hidden).toBe(true);
		expect(this.accept).toBe('.xlsx,.csv');
		Object.defineProperty(this, 'files', { value: [file] });
		this.dispatchEvent(new Event('change'));
	});
	await runWorkbookImport(options);
	expect(click).toHaveBeenCalledOnce();
	expect(options.buildPayload.mock.calls[0]?.[0].get('Holidays')).toEqual([['Holiday', 'Date']]);
	expect(mocks.act).toHaveBeenCalledWith(options.action, { rows: [] });
	expect(mocks.success).toHaveBeenCalledOnce();
	expect(mocks.error).not.toHaveBeenCalled();
	expect(document.querySelector('input[type=file]')).toBeNull();
});

it('settles cancellation, removes its input and supports the next picker', async () => {
	const inputs: HTMLInputElement[] = [];
	vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
		this: HTMLInputElement
	) {
		inputs.push(this);
	});
	const cancelled = runWorkbookImport(options);
	expect(inputs[0]!.isConnected).toBe(true);
	inputs[0]!.dispatchEvent(new Event('cancel'));
	await cancelled;
	expect(inputs[0]!.isConnected).toBe(false);
	expect(mocks.act).not.toHaveBeenCalled();
	const next = runWorkbookImport(options);
	expect(inputs[1]).not.toBe(inputs[0]);
	inputs[1]!.dispatchEvent(new Event('cancel'));
	await next;
	expect(document.querySelector('input[type=file]')).toBeNull();
});
