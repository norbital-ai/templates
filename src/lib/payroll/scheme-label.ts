/**
 * What a statutory scheme is called where a person reads it.
 *
 * The scheme's `code` is a key — the catalogue row, the payslip line, the fact that opts a
 * person in — and stays what the law's acronym made it. The label is what the authority calls
 * itself today: the Philippine Home Development Mutual Fund is Pag-IBIG on every form a clerk
 * files, and PHIC is PhilHealth. Every label, export header and payslip line reads through here.
 */
const SCHEME_LABELS: Readonly<Record<string, string>> = {
	HDMF: 'Pag-IBIG',
	PHIC: 'PhilHealth'
};

export const schemeLabel = (code: string): string => SCHEME_LABELS[code] ?? code;

/**
 * The order each jurisdiction's own listing reads its schemes in, employee block and employer
 * block alike: the Philippine sheet runs SSS, PhilHealth, Pag-IBIG then the tax; the Malaysian one
 * EPF, SOCSO, EIS then PCB. A code no listing ranks follows the ranked ones, by code.
 */
const LISTING_ORDER: readonly string[] = [
	'SSS',
	'SSS_EC',
	'PHIC',
	'HDMF',
	'WTAX',
	'EPF',
	'EPF_PR',
	'EPF_NON_CITIZEN',
	'SOCSO',
	'EIS',
	'PCB',
	'HRDF',
	'SKBBK',
	'CPF',
	'CDAC',
	'ECF',
	'MBMF',
	'SINDA',
	'SDL',
	'JHT',
	'JP',
	'JKK',
	'JKM',
	'KESEHATAN',
	'JKP',
	'PPH21',
	'SI',
	'HI',
	'UI',
	'UNION_FEE',
	'PIT',
	'LI',
	'EI',
	'NHI',
	'LABOR_PENSION',
	'OCC_INJURY',
	'INCOME_TAX',
	'INCOME_TAX_NON_RESIDENT'
];

/** Sort scheme codes the way the entity's listing reads them. */
export const bySchemeListing = (left: string, right: string): number => {
	const a = LISTING_ORDER.indexOf(left);
	const b = LISTING_ORDER.indexOf(right);
	if (a === -1 && b === -1) return left.localeCompare(right);
	if (a === -1) return 1;
	if (b === -1) return -1;
	return a - b;
};
