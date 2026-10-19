// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { PendingApproval } from '@norbital-ai/bolt';
import { runWorkbookImport } from '../../src/lib/ui/workbook/workbook_import.js';
import { fixtureId, nativeId } from '../fixture_values.ts';

const api = vi.hoisted(() => ({
	act: vi.fn(),
	success: vi.fn(),
	info: vi.fn(),
	warning: vi.fn(),
	error: vi.fn()
}));
vi.mock('$bolt', () => ({ bolt: { act: api.act, t: (key: string) => key } }));
vi.mock('@norbital-ai/ui', () => ({
	toast: { success: api.success, info: api.info, warning: api.warning, error: api.error }
}));
afterEach(() => {
	vi.restoreAllMocks();
	Object.values(api).forEach((mock) => mock.mockReset());
});

function pick(file: File | null): void {
	vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
		this: HTMLInputElement
	) {
		if (file !== null) Object.defineProperty(this, 'files', { value: [file] });
		this.dispatchEvent(new Event(file === null ? 'cancel' : 'change'));
	});
}

it('a proposed workbook shows submission only and skips committed counts, warnings and callbacks', async () => {
	pick(new File(['Date,Name\n2026-01-01,Holiday'], 'holidays.csv', { type: 'text/csv' }));
	api.act.mockReturnValue(
		Effect.succeed<PendingApproval<'holiday.create'>>({
			kind: 'pendingApproval',
			requestId: 'request-a',
			records: [
				{ collection: 'holiday', id: nativeId('holiday', fixtureId('holiday-a')), revision: 1 }
			]
		})
	);
	const afterImport = vi.fn(),
		importedCount = vi.fn(),
		overwritten = vi.fn(),
		warnings = vi.fn();
	await Effect.runPromise(
		runWorkbookImport({
			action: 'holiday.create',
			recordLabel: 'holidays',
			buildPayload: () => [],
			afterImport,
			importedCount,
			overwritten,
			warnings
		})
	);
	expect(api.act).toHaveBeenCalledOnce();
	expect(api.info).toHaveBeenCalledWith('offboarding.pending');
	for (const callback of [
		api.success,
		api.warning,
		api.error,
		afterImport,
		importedCount,
		overwritten,
		warnings
	])
		expect(callback).not.toHaveBeenCalled();
	expect(document.querySelector('input[type=file]')).toBeNull();
});

it('cancelled selection settles without a mutation or notification', async () => {
	pick(null);
	await Effect.runPromise(
		runWorkbookImport({
			action: 'holiday.create',
			recordLabel: 'holidays',
			buildPayload: () => []
		})
	);
	for (const callback of Object.values(api)) expect(callback).not.toHaveBeenCalled();
	expect(document.querySelector('input[type=file]')).toBeNull();
});

it('invalid workbooks produce an import error and do not call the mutation', async () => {
	pick(new File(['not an XLSX'], 'holidays.xlsx'));
	const buildPayload = vi.fn(() => []);
	await Effect.runPromise(
		runWorkbookImport({ action: 'holiday.create', recordLabel: 'holidays', buildPayload })
	);
	expect(buildPayload).not.toHaveBeenCalled();
	expect(api.act).not.toHaveBeenCalled();
	expect(api.error).toHaveBeenCalledWith(
		'component.workbook_not_spreadsheet',
		expect.objectContaining({ duration: 20_000 })
	);
	expect(api.success).not.toHaveBeenCalled();
});
