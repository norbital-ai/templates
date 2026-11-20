import { kingdeePurchaseAccount } from './configuration.js';

export type Direction = 'sales' | 'purchasing';
/**
 * The KIS tables one direction lives in: an SO (81) ships through deliveries (`ICStockBill` 21), billed by sales
 * invoices (`ICSale`) and settled by receipts against AR (`t_RP_Contact` FRP=1); a PO (71) arrives through receipts
 * (`ICStockBill` 1), billed by purchase invoices (`ICPurchase`) and settled by payments against AP (FRP=0).
 */
export const bills = {
	sales: {
		direction: 'sales',
		name: 'sales',
		label: 'SO',
		order: 'SEOrder',
		type: 81,
		party: 'FCustID',
		parties: 't_Organization',
		// an SO amendment archives the version it replaces; a PO keeps one live row
		versioned: true,
		price: { exclusive: 'FAuxPrice', inclusive: 'FTaxPrice', rate: 'FCESS', tax: 'FTaxAmt' },
		movement: 21,
		invoice: 'ICSale',
		invoiceTypes: { blue: ['80'], red: ['80', '86'] },
		dueOn: 'CONVERT(varchar(10),head.FSettleDate,23)',
		// the order's settlement method, copied onto its invoices: their terms run from delivery
		invoiceTerms: true,
		settlement: { rp: 1, type: 3, source: 5 },
		ids: { delivery: 'delivery', invoice: 'invoice', settlement: 'receipt' }
	},
	purchasing: {
		direction: 'purchasing',
		name: 'purchase',
		label: 'PO',
		order: 'POOrder',
		type: 71,
		party: 'FSupplyID',
		parties: 't_Supplier',
		versioned: false,
		price: { exclusive: 'FPrice', inclusive: 'FAuxTaxPrice', rate: 'FTaxRate', tax: 'FTaxAmount' },
		movement: 1,
		invoice: 'ICPurchase',
		invoiceTypes: { blue: ['75'], red: ['75', '76'] },
		// a purchase invoice is due when its payable is
		dueOn:
			'(SELECT CONVERT(varchar(10),MAX(due.FRPDate),23) FROM dbo.t_RP_Contact due WHERE due.FRP=0 AND due.FType=4 AND due.FInvoiceID=head.FInterID)',
		invoiceTerms: false,
		settlement: { rp: 0, type: 4, source: 6 },
		ids: { delivery: 'receipt', invoice: 'purchase_invoice', settlement: 'payment' }
	}
} as const;
export type Bill = (typeof bills)[Direction];
/** The directions a ledger syncs: its POs too once its purchase documents are verified. */
export const directionsOf = (configuration: unknown): readonly Direction[] =>
	kingdeePurchaseAccount(configuration) === null ? ['sales'] : ['sales', 'purchasing'];
