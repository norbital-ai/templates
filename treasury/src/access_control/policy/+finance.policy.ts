import { policy } from '@norbital-ai/bolt';
/**
 * Finance: opens every treasury page and plans payments (earmarks), keeps the supplier list and
 * records supplier invoices against purchase orders, but changes nothing else.
 */
export default policy({
	description: 'Finance: plan earmarks, keep suppliers, record invoices; read everything else.',
	grants: {
		bank: { outputs: { default: {} } },
		bank_contact: { outputs: { default: {} } },
		watch_point: { outputs: { default: {} } },
		letter_of_offer: { outputs: { default: {} } },
		facility: { outputs: { default: {} } },
		facility_fee: { outputs: { default: {} } },
		sub_limit: { outputs: { default: {} } },
		supplier: { outputs: { default: {} }, create: {}, update: {} },
		drawdown: { outputs: { default: {} }, create: {}, update: {} },
		drawdown_charge: { outputs: { default: {} } },
		bank_document: { outputs: { default: {} }, create: {} },
		month_end: { outputs: { default: {} } },
		month_end_line: { outputs: { default: {} } },
		fx_rate: { outputs: { default: {} } },
		purchase_order: { outputs: { default: {} }, update: {} },
		po_line: { outputs: { default: {} } },
		invoice: { outputs: { default: {} } },
		po_document: { outputs: { default: {} }, create: {} }
	}
});
