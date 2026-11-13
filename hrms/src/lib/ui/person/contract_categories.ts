import { isJsonObject } from '../../payroll_engine/foundation.js';

const list = (value: unknown): readonly string[] | undefined =>
	Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
		? value
		: undefined;
const record = (value: unknown): Record<string, unknown> => (isJsonObject(value) ? value : {});

/** The values a jurisdiction allows in `employee_contract.terms`: its settings lookup, then its `CONTRACT_CATEGORIES` rule. */
export const contractCategories = (settingsLookupValue: unknown, ruleLookupValue: unknown) => {
	const settingsLookup = record(settingsLookupValue);
	const ruleLookup = record(ruleLookupValue);
	const nested = record(ruleLookup['categories']);
	return {
		residency:
			list(ruleLookup['residency_statuses']) ??
			list(nested['residency_status']) ??
			list(ruleLookup['residency_status']),
		statutory:
			list(settingsLookup['statutory_work_categories']) ??
			list(ruleLookup['statutory_work_categories']) ??
			list(nested['statutory_work_category']) ??
			list(ruleLookup['statutory_work_category']) ??
			list(ruleLookup['work_classification']) ??
			list(ruleLookup['work_classifications']),
		classification:
			list(ruleLookup['work_pass_categories']) === undefined
				? undefined
				: list(ruleLookup['work_classifications']),
		pass: list(ruleLookup['work_pass_categories'])
	};
};
