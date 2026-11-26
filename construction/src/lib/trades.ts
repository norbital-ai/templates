/**
 * Canonical contractor & subcontractor trade specialties shared across contacts, contracts,
 * programme tasks, their issues, and the item matrix.
 */
export const TRADE_SPECIALTIES = [
	'general',
	'civil_earthworks',
	'piling',
	'structural',
	'roofing',
	'facade',
	'waterproofing',
	'flooring',
	'finishing',
	'mne',
	'electrical',
	'plumbing',
	'hvac',
	'fire_protection',
	'elv_security',
	'landscaping'
] as const;

export type TradeSpecialty = (typeof TRADE_SPECIALTIES)[number];
