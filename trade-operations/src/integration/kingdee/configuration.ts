export const kingdeeConfiguration = {
	baseCurrency: { kind: 'text', default: 'CNY', label: 'Verified account-set base currency' },
	branchNo: { kind: 'text', default: '0', label: 'Kingdee branch number' },
	stockAvailabilityAccount: {
		kind: 'text',
		optional: true,
		label: 'Verified SQL account for stock availability'
	},
	stockLotCostAccount: {
		kind: 'text',
		optional: true,
		label: 'Verified SQL account for purchase lot costs'
	},
	deliveryCostAccount: {
		kind: 'text',
		optional: true,
		label: 'Verified SQL account for booked delivery costs'
	},
	writeAccount: { kind: 'text', optional: true, label: 'Verified SQL account for order writes' },
	invoiceAnalysisAccount: {
		kind: 'text',
		optional: true,
		label: 'Verified SQL account for invoice-only sales analysis'
	},
	receivablesAccount: {
		kind: 'text',
		optional: true,
		label: 'Verified SQL account for receivables aging'
	},
	receivablesExcludedContacts: {
		kind: 'text',
		optional: true,
		label: 'Verified legacy AR contact exclusions (comma-separated IDs)'
	},
	billerId: { kind: 'text', optional: true, label: 'Kingdee biller ID' },
	packagingId: { kind: 'text', optional: true, label: 'Kingdee packaging ID' },
	salespersonBindings: {
		kind: 'text',
		optional: true,
		label: 'Owner to employee/department bindings (JSON)'
	},
	currencyBindings: {
		kind: 'text',
		optional: true,
		label: 'Currency to Kingdee ID bindings (JSON)'
	},
	settlementRules: {
		kind: 'text',
		optional: true,
		label: 'Settlement-number credit rules (JSON)'
	},
	fullSnapshotMinutes: {
		kind: 'int',
		min: 1,
		default: 1440,
		label: 'Full reconciliation interval (minutes)'
	},
	maxWindowMinutes: { kind: 'int', min: 1, default: 15, label: 'Sync window age alert (minutes)' }
} as const;

const guid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const writeAccountPattern = new RegExp(`^${guid}/${guid}$`, 'i');
function accountPin(
	configuration: unknown,
	field:
		| 'writeAccount'
		| 'invoiceAnalysisAccount'
		| 'receivablesAccount'
		| 'stockAvailabilityAccount'
		| 'stockLotCostAccount'
		| 'deliveryCostAccount'
): string | null {
	if (configuration === null || typeof configuration !== 'object' || !(field in configuration))
		return null;
	const pin = (configuration as Record<string, unknown>)[field];
	return typeof pin === 'string' && writeAccountPattern.test(pin.trim())
		? pin.trim().toLowerCase()
		: null;
}
export const kingdeeWriteAccount = (configuration: unknown) =>
	accountPin(configuration, 'writeAccount');
export const kingdeeInvoiceAnalysisAccount = (configuration: unknown) =>
	accountPin(configuration, 'invoiceAnalysisAccount');
export const kingdeeReceivablesAccount = (configuration: unknown) =>
	accountPin(configuration, 'receivablesAccount');
export const kingdeeStockAvailabilityAccount = (configuration: unknown) =>
	accountPin(configuration, 'stockAvailabilityAccount');
export const kingdeeStockLotCostAccount = (configuration: unknown) =>
	accountPin(configuration, 'stockLotCostAccount');
export const kingdeeDeliveryCostAccount = (configuration: unknown) =>
	accountPin(configuration, 'deliveryCostAccount');

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
