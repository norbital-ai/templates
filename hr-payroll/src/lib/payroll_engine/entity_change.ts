/** What a dated employer change may name: the sealed version's own facts. Entity, jurisdiction and status are not changes. */
const ROOTS = new Set([
	'name',
	'representative_name',
	'registered_address',
	'time_zone',
	'final_pay_loan_floor_percent',
	'overtime_full_award_percent',
	'bank',
	'entity_extension_data'
]);

const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);

export const entityChangeable = (path: string): boolean => {
	const parts = path.split('.');
	return ROOTS.has(parts[0] ?? '') && parts.every((part) => part !== '' && !UNSAFE.has(part));
};
