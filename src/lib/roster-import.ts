import { importCollectionRecords } from '@norbital-ai/pod/client';
import templateCsv from '../assets/weekly-dispatch-roster.template.csv?raw';
import { readCsvCell, readCsvRecords } from './csv-import.js';

const ROSTER_HEADERS = [
	'week_start',
	'site_name',
	'scheduled_for',
	'job_title',
	'contractor_company',
	'summary'
] as const;

const ACCEPTED_FILE_TYPES = '.csv';
const TEMPLATE_FILENAME = 'weekly-dispatch-roster.template.csv';

export function downloadRosterTemplate(): void {
	if (typeof document === 'undefined') {
		throw new Error('Roster template download is only available in the browser.');
	}
	const blob = new Blob([templateCsv], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = TEMPLATE_FILENAME;
	anchor.click();
	URL.revokeObjectURL(url);
}

async function pickCsvFile(): Promise<File | null> {
	if (typeof document === 'undefined') {
		throw new Error('Roster import is only available in the browser.');
	}
	return new Promise<File | null>((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = ACCEPTED_FILE_TYPES;
		let settled = false;
		const finish = (file: File | null): void => {
			if (settled) return;
			settled = true;
			resolve(file);
		};
		input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
		input.addEventListener('cancel', () => finish(null), { once: true });
		input.click();
	});
}

function buildImportPayload(records: readonly Record<string, string>[]) {
	const weekStarts = [
		...new Set(records.map((record) => readCsvCell(record, 'week_start')).filter(Boolean))
	];
	if (weekStarts.length === 0) {
		throw new Error('Every row must include week_start (YYYY-MM-DD).');
	}
	if (weekStarts.length > 1) {
		throw new Error(
			`Every row must share the same week_start. Found:\n${weekStarts.map((value) => `• ${value}`).join('\n')}`
		);
	}

	const weekStart = weekStarts[0]!;
	return {
		week_start: weekStart,
		rows: records.map((record) => {
			const siteName = readCsvCell(record, 'site_name');
			const scheduledFor = readCsvCell(record, 'scheduled_for');
			const jobTitle = readCsvCell(record, 'job_title');
			const contractorCompany = readCsvCell(record, 'contractor_company');
			const summary = readCsvCell(record, 'summary');
			if (!siteName || !scheduledFor || !jobTitle || !contractorCompany) {
				throw new Error(
					'Each row needs site_name, scheduled_for, job_title, and contractor_company.'
				);
			}
			return {
				site_name: siteName,
				scheduled_for: scheduledFor,
				job_title: jobTitle,
				contractor_company: contractorCompany,
				...(summary ? { summary } : {})
			};
		})
	};
}

/** Pick a roster CSV, import assignments, and return how many were created. */
export async function importWeeklyRoster(): Promise<number> {
	const file = await pickCsvFile();
	if (file == null) return 0;
	const payload = buildImportPayload(readCsvRecords(await file.text(), ROSTER_HEADERS));
	const created = await importCollectionRecords({
		collection_name: 'job_assignments',
		import_data: payload
	});
	return created.length;
}
