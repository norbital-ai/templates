import { currencyFractionDigits, fromMinorUnits, toMinorUnits } from '@norbital-ai/std/finance';
import { Effect } from 'effect';
import type { Hooks, WorkspaceRow } from './$types.js';

function roundHalfUp(value: number, digits: number): number {
	if (!Number.isFinite(value)) {
		throw new Error('Cannot round a value that is not a finite number.');
	}
	const magnitude = Math.abs(shiftExponent(value, digits));
	const rounded = Math.round(magnitude);
	return shiftExponent(value < 0 ? -rounded : rounded, -digits);
}

function shiftExponent(value: number, places: number): number {
	if (value === 0) return 0;
	const [mantissa, exponent] = value.toExponential().split('e');
	return Number(`${mantissa}e${Number(exponent) + places}`);
}

interface LinePricing {
	readonly quantity: number;
	readonly unit_price: number;
	readonly discount_pct?: number | null;
	readonly tax_rate?: number | null;
	readonly tax_inclusive: boolean;
	readonly currency: string;
}

interface LineAmounts {
	readonly net: number;
	readonly tax: number;
	readonly gross: number;
}

function lineAmounts(line: LinePricing): LineAmounts {
	const digits = currencyFractionDigits(line.currency);
	const discount = line.discount_pct ?? 0;
	const rate = (line.tax_rate ?? 0) / 100;
	const base = line.quantity * line.unit_price * (1 - discount / 100);

	if (line.tax_inclusive) {
		const gross = roundHalfUp(base, digits);
		const net = roundHalfUp(gross / (1 + rate), digits);
		return { net, tax: roundHalfUp(gross - net, digits), gross };
	}

	const net = roundHalfUp(base, digits);
	const tax = roundHalfUp(net * rate, digits);
	return { net, tax, gross: roundHalfUp(net + tax, digits) };
}

function documentTotals(lines: readonly LineAmounts[], currency: string): LineAmounts {
	let net = 0n;
	let tax = 0n;
	let gross = 0n;
	for (const line of lines) {
		net += toMinorUnits(line.net, currency);
		tax += toMinorUnits(line.tax, currency);
		gross += toMinorUnits(line.gross, currency);
	}
	return {
		net: fromMinorUnits(net, currency),
		tax: fromMinorUnits(tax, currency),
		gross: fromMinorUnits(gross, currency)
	};
}

type AfterApi = Parameters<NonNullable<NonNullable<Hooks['create']>['after']>['handler']>[0]['api'];
type BeforeApi = Parameters<
	NonNullable<NonNullable<Hooks['create']>['before']>['handler']
>[0]['api'];

const LINE_LIMIT = 5000;

function requireCurrency(currency: string | null): string {
	if (!currency) throw new Error('Document currency is required.');
	return currency;
}

interface ResolvedLineInput {
	readonly quantity: number;
	readonly unit_price: number;
	readonly tax_rate?: number | null;
}

function validateLineFields(input: ResolvedLineInput): void {
	const quantity = Number(input.quantity);
	if (Number.isNaN(quantity) || quantity <= 0) {
		throw new Error('Quantity must be greater than zero.');
	}
	const unitPrice = Number(input.unit_price);
	if (Number.isNaN(unitPrice) || unitPrice < 0) {
		throw new Error('Unit price cannot be negative.');
	}
	const taxRate = Number(input.tax_rate ?? 0);
	if (taxRate < 0 || taxRate > 100) {
		throw new Error('Tax rate must be between 0 and 100.');
	}
}

/** Allocated quantity on live (non-cancelled) invoices for one quote line. */
function liveAllocatedQuantity(api: BeforeApi, quoteLineId: string): Effect.Effect<number> {
	return Effect.gen(function* () {
		const lines = yield* api.db.query.sales_invoice_lines.findMany({
			where: {
				quote_line_id: { eq: quoteLineId },
				sales_invoice_line_invoice: { status: { ne: 'cancelled' } }
			},
			columns: { sales_invoice_id: true, quantity: true },
			limit: LINE_LIMIT
		});
		return lines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
	});
}

function computeLineAmounts(
	invoice: WorkspaceRow<'sales_invoices'>,
	line: ResolvedLineInput
): LineAmounts {
	return lineAmounts({
		quantity: line.quantity,
		unit_price: line.unit_price,
		tax_rate: line.tax_rate ?? 0,
		tax_inclusive: invoice.tax_inclusive,
		currency: requireCurrency(invoice.currency)
	});
}

function rollupInvoice(api: AfterApi, invoiceId: string): Effect.Effect<void> {
	return Effect.gen(function* () {
		const invoice = yield* api.db.query.sales_invoices.findFirst({
			where: { norbital_id: { eq: invoiceId } }
		});
		if (!invoice) return;

		const lines = yield* api.db.query.sales_invoice_lines.findMany({
			where: { sales_invoice_id: { eq: invoiceId } },
			columns: { net: true, tax: true, line_total: true },
			limit: LINE_LIMIT
		});

		const totals = documentTotals(
			lines.map((line) => ({
				net: Number(line.net ?? 0),
				tax: Number(line.tax ?? 0),
				gross: Number(line.line_total ?? 0)
			})),
			requireCurrency(invoice.currency)
		);

		yield* api.db.mutate('sales_invoices', [
			{ norbital_id: invoiceId, net: totals.net, tax: totals.tax, gross: totals.gross }
		]);
	});
}

const afterRollup = ({
	record,
	api
}: {
	readonly record: { readonly sales_invoice_id: string };
	readonly api: AfterApi;
}) =>
	Effect.gen(function* () {
		yield* rollupInvoice(api, record.sales_invoice_id);
	});

export default {
	create: {
		before: {
			description:
				'Bills a quote line belonging to the same quote as the invoice and refuses to bill more than was quoted, counting only lines on invoices that are not cancelled.',
			handler: ({ input, api }) =>
				Effect.gen(function* () {
					if (!input.sales_invoice_id) {
						throw new Error('A sales invoice line must reference a sales invoice.');
					}
					const invoice = yield* api.db.query.sales_invoices.findFirst({
						where: { norbital_id: { eq: input.sales_invoice_id } }
					});
					if (!invoice) throw new Error('Referenced sales invoice does not exist.');
					if (invoice.status !== 'draft') {
						throw new Error('Lines can only be added to draft sales invoices.');
					}

					if (!input.quote_line_id) {
						throw new Error('A sales invoice line must reference a quote line.');
					}
					const quoteLine = yield* api.db.query.quote_lines.findFirst({
						where: { norbital_id: { eq: input.quote_line_id } }
					});
					if (!quoteLine) throw new Error('Referenced quote line does not exist.');
					if (quoteLine.quote_id !== invoice.quote_id) {
						throw new Error('The billed line belongs to a different quote.');
					}

					const resolved = {
						...input,
						quantity: input.quantity,
						product_code: input.product_code ?? quoteLine.product_code,
						product_name: input.product_name ?? quoteLine.product_name,
						product_unit: input.product_unit ?? quoteLine.product_unit ?? '',
						unit_price: input.unit_price ?? quoteLine.unit_price,
						tax_rate: input.tax_rate ?? quoteLine.tax_rate ?? 0
					};
					validateLineFields(resolved);

					const allocated = yield* liveAllocatedQuantity(api, quoteLine.norbital_id);
					const quoted = Number(quoteLine.quantity ?? 0);
					if (allocated + Number(resolved.quantity) > quoted) {
						throw new Error(
							`Over-allocation: ${allocated} of ${quoted} billed so far; this line would exceed the quoted quantity.`
						);
					}

					const amounts = computeLineAmounts(invoice, resolved);
					return { ...resolved, net: amounts.net, tax: amounts.tax, line_total: amounts.gross };
				})
		},
		after: {
			description:
				'Recomputes the sales invoice net, tax and gross from its lines after a line is added.',
			handler: afterRollup
		}
	},
	update: {
		before: {
			description:
				'Keeps a line on its own draft invoice, re-prices it from the changed quantity or unit price, and refuses to push the billed quantity past the quantity quoted.',
			handler: ({ input, existing, api }) =>
				Effect.gen(function* () {
					if (
						input.sales_invoice_id != null &&
						input.sales_invoice_id !== existing.sales_invoice_id
					) {
						throw new Error('A line cannot be moved to a different sales invoice.');
					}

					const invoice = yield* api.db.query.sales_invoices.findFirst({
						where: { norbital_id: { eq: existing.sales_invoice_id } }
					});
					if (!invoice) throw new Error('Referenced sales invoice does not exist.');
					if (invoice.status !== 'draft') {
						throw new Error('Lines can only be modified on draft sales invoices.');
					}

					const resolved = { ...existing, ...input };
					validateLineFields(resolved);

					const quoteLine = yield* api.db.query.quote_lines.findFirst({
						where: { norbital_id: { eq: existing.quote_line_id } }
					});
					if (quoteLine) {
						const allocated = yield* liveAllocatedQuantity(api, quoteLine.norbital_id);
						const quoted = Number(quoteLine.quantity ?? 0);
						const own = Number(existing.quantity ?? 0);
						if (allocated - own + Number(resolved.quantity) > quoted) {
							throw new Error(
								`Over-allocation: this line would push billed quantity past the quoted ${quoted}.`
							);
						}
					}

					const amounts = computeLineAmounts(invoice, resolved);
					return { ...input, net: amounts.net, tax: amounts.tax, line_total: amounts.gross };
				})
		},
		after: {
			description:
				'Recomputes the sales invoice net, tax and gross from its lines after a line is changed.',
			handler: afterRollup
		}
	},
	delete: {
		after: {
			description:
				'Recomputes the sales invoice net, tax and gross from its lines after a line is removed.',
			handler: afterRollup
		}
	}
} satisfies Hooks;
