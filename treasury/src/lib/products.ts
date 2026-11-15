/**
 * Every financing product a line can be, and what each means for the figures: whether it uses the facility limit
 * while open, which month-end line it reports on,
 * whether it is trade financing compared on Costs, and what an LC or bill may convert into.
 */
export const PRODUCT_CODES = [
	'lc',
	'import_bill',
	'da',
	'dp',
	'tb',
	'ba',
	'bad',
	'if',
	'if_after_lc_or_da',
	'pif',
	'twc',
	'oaf',
	'apf',
	'psil',
	'psbl',
	'ofcl',
	'mctf',
	'tradepay',
	'packing',
	'fbep',
	'dbep',
	'ecr',
	'badd',
	'stl',
	'term',
	'efs',
	'lis',
	'tbl',
	'ma',
	'property',
	'bg',
	'sg',
	'awb',
	'sblc',
	'fx',
	'card',
	'cash'
] as const;
export type Product = (typeof PRODUCT_CODES)[number];

export type Bucket = 'borrowings' | 'lc' | 'tb' | 'guarantee' | 'other';
type Meta = { uses_limit: boolean; bucket: Bucket; trade: boolean };

const loan: Meta = { uses_limit: true, bucket: 'borrowings', trade: false };
const trade: Meta = { ...loan, trade: true };
const documentary = (bucket: Bucket): Meta => ({ ...loan, bucket });
const guarantee: Meta = documentary('guarantee');

export const PRODUCTS: Record<Product, Meta> = {
	lc: documentary('lc'),
	import_bill: documentary('lc'),
	da: documentary('tb'),
	dp: documentary('tb'),
	tb: documentary('tb'),
	ba: { ...trade, bucket: 'tb' },
	bad: { ...trade, bucket: 'tb' },
	if: trade,
	if_after_lc_or_da: trade,
	pif: trade,
	twc: trade,
	oaf: trade,
	apf: trade,
	psil: trade,
	psbl: trade,
	ofcl: trade,
	mctf: trade,
	tradepay: trade,
	packing: trade,
	fbep: loan,
	dbep: loan,
	ecr: loan,
	badd: loan,
	stl: loan,
	term: loan,
	efs: loan,
	lis: trade,
	tbl: loan,
	ma: loan,
	property: loan,
	bg: guarantee,
	sg: guarantee,
	awb: guarantee,
	sblc: guarantee,
	fx: { ...documentary('other'), uses_limit: false },
	card: { ...loan, bucket: 'other' },
	cash: { ...documentary('other'), uses_limit: false }
};

/** A bill that ends in a decision: paid in cash, or converted into financing. */
export const CONVERTIBLE: Partial<Record<Product, readonly Product[]>> = {
	lc: ['if', 'if_after_lc_or_da'],
	import_bill: ['if', 'if_after_lc_or_da'],
	da: ['if_after_lc_or_da'],
	tb: ['if_after_lc_or_da']
};

/** Invoice financing and its after-a-bill variant compare and filter as one product. */
export const family = (product: Product): readonly Product[] =>
	product === 'if' ? ['if', 'if_after_lc_or_da'] : [product];
