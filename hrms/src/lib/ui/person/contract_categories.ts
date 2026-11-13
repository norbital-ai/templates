import { isJsonObject } from '../../payroll_engine/foundation.js';
import type { Law } from '../../law.js';

const list = (value: unknown): readonly string[] | undefined =>
	Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
		? value
		: undefined;
const record = (value: unknown): Record<string, unknown> => (isJsonObject(value) ? value : {});

/** The values a jurisdiction allows in a person's categories: its settings lookup, then its `CONTRACT_CATEGORIES` rule. */
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

/** The values a law allows in each category field of a person's terms and statutory parameters, by field name. */
export const categoryValues = (
	law: Law | undefined
): Readonly<Record<string, readonly string[] | undefined>> => {
	const categories = contractCategories(
		law?.settings.lookup,
		law?.rows.registered_rule.find((row) => row.code === 'CONTRACT_CATEGORIES')?.lookup
	);
	return {
		residency_status: categories.residency,
		statutory_work_category: categories.statutory,
		work_authorisation_category: categories.pass,
		work_classification: categories.classification
	};
};
