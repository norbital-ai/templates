import type { MessageKey, ReadAnswer } from '@norbital-ai/bolt';
import { addDays } from './calculations.js';
import { FACILITY_FIELDS, LINE_FIELDS, lineFigures, utilisation } from './treasury.js';

/** The page and morning notification share their facts and rules. */
export const ATTENTION_READ = {
	facility: {
		fields: [...FACILITY_FIELDS, 'review_date', 'expiry_date'],
		bank: { fields: ['code'] }
	},
	drawdown: {
		where: { status: { in: ['earmarked', 'applied', 'active'] } },
		fields: [
			...LINE_FIELDS,
			'fx_rate_to_usd',
			'bank_reference',
			'expected_draw_date',
			'earliest_invoice_date',
			'lc_expiry_date'
		]
	},
	purchase_order: {
		where: { lc_requested: { eq: true }, is_cancelled: { eq: false } },
		fields: ['po_number', 'po_date', 'currency'],
		financings: { fields: ['drawdown'], drawdown: { fields: ['product', 'lc_number'] } }
	},
	facility_form: {
		where: { facility_required: { eq: 'tt' } },
		fields: ['po_number', 'currency', 'amount', 'pay_by_date']
	}
} as const;

export type AttentionItem = {
	readonly id: string;
	readonly model: 'drawdown' | 'facility' | 'purchase_order' | 'facility_form';
	readonly reference: string;
	readonly date: string | null;
	readonly amount: string | null;
	readonly currency: string;
	readonly reasons: readonly MessageKey[];
};

/** One item per record; overlapping conditions become reasons on that item. */
export function attention(data: ReadAnswer<typeof ATTENTION_READ>, today: string): AttentionItem[] {
	const items: AttentionItem[] = [];
	for (const line of data.drawdown.rows) {
		const reasons: MessageKey[] = [];
		if (line.status === 'earmarked') {
			if (line.expected_draw_date !== null && line.expected_draw_date < today)
				reasons.push('app.alerts.stale');
		} else {
			if (line.due_date !== null && line.due_date <= addDays(today, 7))
				reasons.push(line.due_date < today ? 'app.alerts.past_due' : 'app.alerts.due');
			if (
				['lc', 'import_bill', 'da', 'tb'].includes(line.product) &&
				line.due_date !== null &&
				line.due_date <= addDays(today, 14)
			)
				reasons.push('app.alerts.bills');
			if (
				line.product === 'lc' &&
				line.lc_expiry_date !== null &&
				line.lc_expiry_date <= addDays(today, 14)
			)
				reasons.push('app.alerts.lc_expiry');
		}
		const latest = lineFigures(
			line,
			data.facility.rows.find((f) => f.id === line.facility) ?? null
		).latest_due_date;
		if (latest !== null && line.due_date !== null && line.due_date > latest)
			reasons.push('app.alerts.late');
		if (reasons.length > 0)
			items.push({
				id: line.id,
				model: 'drawdown',
				reference: line.bank_reference ?? line.product.toUpperCase(),
				date: line.due_date ?? line.expected_draw_date,
				amount: line.amount,
				currency: line.currency,
				reasons
			});
	}
	const high = new Set(
		utilisation(data.facility.rows, data.drawdown.rows)
			.banks.filter((b) => b.high)
			.map((b) => b.bank)
	);
	for (const facility of data.facility.rows) {
		if (facility.status !== 'active') continue;
		const reasons: MessageKey[] = [];
		if (high.has(facility.bank?.code ?? '—')) reasons.push('app.alerts.high');
		if (facility.review_date !== null && facility.review_date <= addDays(today, 60))
			reasons.push('app.alerts.reviews');
		if (reasons.length > 0)
			items.push({
				id: facility.id,
				model: 'facility',
				reference: facility.name,
				date: facility.review_date,
				amount: null,
				currency: 'USD',
				reasons
			});
	}
	for (const po of data.purchase_order.rows) {
		if (po.financings.some((f) => f.drawdown?.product === 'lc' || f.drawdown?.lc_number != null))
			continue;
		items.push({
			id: po.id,
			model: 'purchase_order',
			reference: po.po_number,
			date: po.po_date,
			amount: null,
			currency: po.currency,
			reasons: ['app.alerts.lcs']
		});
	}
	for (const form of data.facility_form.rows) {
		if (
			form.pay_by_date === null ||
			form.pay_by_date < addDays(today, -7) ||
			form.pay_by_date > addDays(today, 14)
		)
			continue;
		items.push({
			id: form.id,
			model: 'facility_form',
			reference: form.po_number,
			date: form.pay_by_date,
			amount: form.amount,
			currency: form.currency,
			reasons: ['app.alerts.tt']
		});
	}
	return items.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}
