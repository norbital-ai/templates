/**
 * The template's tracker CSVs (`docs/inventory/*.csv`), loaded on first use and filtered to one
 * lineage. Vite-only (`import.meta.glob`), so kept out of `tracker.ts`, which Node tests import.
 */
import { trackerRows, trackerRowsOf, type TrackerRow } from './tracker.js';

let every: Promise<readonly TrackerRow[]> | null = null;

export function lineageTracker(version: {
	readonly code: string;
	readonly jurisdiction_code: string;
}): Promise<readonly TrackerRow[]> {
	every ??= Promise.all(
		Object.values(
			import.meta.glob('../../../docs/inventory/*.csv', {
				query: '?raw',
				import: 'default'
			}) as Record<string, () => Promise<string>>
		).map((load) => load())
	).then((texts) => texts.flatMap(trackerRows));
	return every.then((rows) => trackerRowsOf(rows, version));
}
