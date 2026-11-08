import type { Row } from '@norbital-ai/bolt';
import { minorDigits } from '@norbital-ai/std/decimal';

type Snapshot = NonNullable<Row<'orders'>['sealed_snapshot']>;
type Locale = Row<'document_templates'>['locale'];

const labels = {
	en: {
		reference: 'Reference',
		date: 'Order date',
		customer: 'Customer',
		supplier: 'Supplier',
		currency: 'Currency',
		inclusive: 'Unit prices include VAT',
		exclusive: 'Unit prices exclude VAT',
		validity: 'Validity',
		payment: 'Payment terms',
		delivery: 'Delivery terms',
		product: 'Product',
		quantity: 'Quantity',
		unitPrice: 'Unit price',
		discount: 'Discount',
		vat: 'VAT rate',
		amount: 'Line total',
		net: 'Subtotal before VAT',
		tax: 'VAT',
		total: 'Total including VAT'
	},
	zh: {
		reference: '单据编号',
		date: '单据日期',
		customer: '客户',
		supplier: '供应商',
		currency: '币种',
		inclusive: '单价含税',
		exclusive: '单价未税',
		validity: '有效期',
		payment: '付款条件',
		delivery: '交付条件',
		product: '品名',
		quantity: '数量',
		unitPrice: '单价',
		discount: '折扣',
		vat: '税率',
		amount: '价税合计',
		net: '未税合计',
		tax: '税额',
		total: '价税合计'
	}
} as const;

export const escape = (text: string) =>
	text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

export function paragraphs(text: string) {
	return text
		.split('\n')
		.map((line) => `<p>${line ? escape(line) : '<br>'}</p>`)
		.join('');
}

function paperAmount(value: string, currency: string) {
	const [whole, fraction = ''] = value.split('.');
	const decimals = fraction.padEnd(minorDigits(currency), '0');
	return decimals ? `${whole}.${decimals}` : (whole ?? '');
}

/** The published table layout projects only retained, customer-facing agreement fields. */
export function commercialDocument(
	seal: Snapshot,
	locale: Locale,
	reference: string,
	date: string
) {
	const label = labels[locale];
	const parties = seal.direction === 'purchasing' ? label.supplier : label.customer;
	const validity = [seal.valid_from, seal.valid_until].filter(Boolean).join(' – ');
	const terms = [
		[label.reference, reference],
		[label.date, date],
		[parties, seal.party_name],
		[label.currency, seal.currency],
		[label.validity, validity],
		[label.payment, seal.payment_terms],
		[label.delivery, seal.delivery_terms]
	].filter(([, value]) => value);
	const taxBasis = seal.tax_inclusive ? label.inclusive : label.exclusive;
	const columns = [
		label.product,
		label.quantity,
		label.unitPrice,
		label.discount,
		label.vat,
		label.amount
	];
	const amount = (value: string) => paperAmount(value, seal.currency);
	const lines = seal.lines.map((line) => ({
		product: [line.product_name, line.product_code, line.product_spec].filter(Boolean).join(' · '),
		numeric: [
			`${line.quantity} ${line.unit}`,
			amount(line.unit_price),
			`${line.discount_pct}%`,
			`${line.tax_rate}%`,
			amount(line.total)
		]
	}));
	const totals = [
		[label.net, amount(seal.net)],
		[label.tax, amount(seal.tax)],
		[label.total, `${amount(seal.total)} ${seal.currency}`]
	];
	const text = [
		...terms.map(([key, value]) => `${key}: ${value}`),
		taxBasis,
		columns.join(' | '),
		...lines.map(({ product, numeric }) => [product, ...numeric].join(' | ')),
		...totals.map(([key, value]) => `${key}: ${value}`)
	].join('\n');
	const html = `
		<div class="terms">${terms.map(([key, value]) => `<p><strong>${key}:</strong> ${escape(value ?? '')}</p>`).join('')}</div>
		<p class="tax-basis">${taxBasis}</p>
		<table class="items" cellspacing="0" cellpadding="5">
			<colgroup><col style="width:36%"><col style="width:13%"><col style="width:14%"><col style="width:11%"><col style="width:11%"><col style="width:15%"></colgroup>
			<thead><tr>${columns.map((column, index) => `<th scope="col" class="${index ? 'number' : ''}">${column}</th>`).join('')}</tr></thead>
			<tbody>${lines.map(({ product, numeric }) => `<tr><td>${escape(product)}</td>${numeric.map((value) => `<td class="number">${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody>
		</table>
		<table class="totals" cellspacing="0" cellpadding="5">
			<tbody>${totals.map(([key, value]) => `<tr><th scope="row">${key}</th><td class="number">${escape(value ?? '')}</td></tr>`).join('')}</tbody>
		</table>`;
	return { text, html };
}
