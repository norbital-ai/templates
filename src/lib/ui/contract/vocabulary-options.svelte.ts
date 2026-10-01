import { bolt } from '$bolt';
import { VOCABULARY_DEFAULTS, type VocabularyField } from '../../datatypes/payroll_settings.js';
import { settingsInForce } from '../../jurisdiction_settings.js';
import { todayKey } from '../calendar.js';
import { liveRows } from '../live.svelte.js';
import { inForceSettings } from '../settings-scope.js';

/**
 * The classification codes (`payroll.vocabularies`) of the lineage's version in force on a day —
 * today where none is named — as options per terms field (the model default where it declares
 * none). Must be called during component
 * initialisation.
 */
export function vocabularyOptions(
	code: () => string | null | undefined,
	day: () => string | null | undefined
) {
	const on = () => day() || todayKey();
	const versions = liveRows(() => {
		const lineage = code();
		return lineage
			? bolt.read('jurisdiction_settings', {
					where: inForceSettings(lineage, on()),
					select: {
						code: true,
						name: true,
						sealed_at: true,
						voided_at: true,
						approval_id: true,
						effective_range: true,
						payroll: true
					},
					all: true
				})
			: null;
	});
	// A version declaring no codes for a field admits its model default (`vocabularyAdmits`).
	return (field: VocabularyField) => {
		const declared =
			settingsInForce(versions.current ?? [], code() ?? '', on())?.payroll.vocabularies?.[field] ??
			[];
		const fallback = VOCABULARY_DEFAULTS[field];
		return (declared.length === 0 && fallback != null ? [fallback] : declared).map((value) => ({
			value,
			label: value
		}));
	};
}
