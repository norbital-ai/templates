import { Schema } from 'effect';

export const kingdeeCreditPolicy = 'kis-sales-out-v1';
export const kingdeeConfiguration = {
	baseCurrency: { kind: 'text', default: 'CNY' },
	branchNo: { kind: 'text', default: '0' },
	stockAvailabilityAccount: {
		kind: 'text',
		optional: true
	},
	stockLotCostAccount: {
		kind: 'text',
		optional: true
	},
	deliveryCostAccount: {
		kind: 'text',
		optional: true
	},
	writeAccount: { kind: 'text', optional: true },
	invoiceAnalysisAccount: {
		kind: 'text',
		optional: true
	},
	purchaseAccount: {
		kind: 'text',
		optional: true
	},
	receivablesAccount: {
		kind: 'text',
		optional: true
	},
	receivablesExcludedContacts: {
		kind: 'text',
		optional: true
	},
	creditAccount: { kind: 'text', optional: true },
	creditPolicy: { kind: 'enum', values: [kingdeeCreditPolicy], optional: true },
	billerId: { kind: 'text', optional: true },
	packagingId: { kind: 'text', optional: true },
	salespersonBindings: {
		kind: 'text',
		optional: true
	},
	currencyBindings: {
		kind: 'text',
		optional: true
	},
	settlementRules: {
		kind: 'text',
		optional: true
	},
	maxWindowMinutes: { kind: 'int', min: 1, default: 15 }
} as const;

const guid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const writeAccountPattern = new RegExp(`^${guid}/${guid}$`, 'i');
const isConfiguration = Schema.is(Schema.Record(Schema.String, Schema.Unknown));
function accountPin(
	configuration: unknown,
	field:
		| 'writeAccount'
		| 'invoiceAnalysisAccount'
		| 'purchaseAccount'
		| 'receivablesAccount'
		| 'stockAvailabilityAccount'
		| 'stockLotCostAccount'
		| 'deliveryCostAccount'
		| 'creditAccount'
): string | null {
	if (!isConfiguration(configuration)) return null;
	const pin = configuration[field];
	return typeof pin === 'string' && writeAccountPattern.test(pin.trim())
		? pin.trim().toLowerCase()
		: null;
}
export const kingdeeWriteAccount = (configuration: unknown) =>
	accountPin(configuration, 'writeAccount');
export const kingdeeInvoiceAnalysisAccount = (configuration: unknown) =>
	accountPin(configuration, 'invoiceAnalysisAccount');
export const kingdeePurchaseAccount = (configuration: unknown) =>
	accountPin(configuration, 'purchaseAccount');
export const kingdeeReceivablesAccount = (configuration: unknown) =>
	accountPin(configuration, 'receivablesAccount');
export const kingdeeStockAvailabilityAccount = (configuration: unknown) =>
	accountPin(configuration, 'stockAvailabilityAccount');
export const kingdeeStockLotCostAccount = (configuration: unknown) =>
	accountPin(configuration, 'stockLotCostAccount');
export const kingdeeDeliveryCostAccount = (configuration: unknown) =>
	accountPin(configuration, 'deliveryCostAccount');
export const kingdeeCreditAccount = (configuration: unknown) =>
	accountPin(configuration, 'creditAccount');

export function kingdeeWriteTarget(configuration: unknown) {
	const account = kingdeeWriteAccount(configuration);
	if (
		account === null ||
		configuration === null ||
		typeof configuration !== 'object' ||
		!('branchNo' in configuration) ||
		typeof configuration.branchNo !== 'string'
	)
		return null;
	return { account, branch: configuration.branchNo };
}
