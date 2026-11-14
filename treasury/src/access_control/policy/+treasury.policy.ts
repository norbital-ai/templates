import { policy } from '@norbital-ai/bolt';
/**
 * Treasury: sees every facility, line and supplier, and is the only team that changes them –
 * limits and terms, drawdowns and their charges, banks, fee rules, watch points, letters of offer,
 * sub-limits, month-ends and FX rates.
 */
export default policy({
	description:
		'Treasury: read everything and change banks, facilities, lines, charges and month-ends.',
	grants: {
		bank: { outputs: { default: {} }, create: {}, update: {} },
		bank_contact: { outputs: { default: {} } },
		watch_point: { outputs: { default: {} }, create: {}, update: {} },
		letter_of_offer: { outputs: { default: {} }, create: {}, update: {} },
		facility: { outputs: { default: {} }, create: {}, update: {} },
		facility_fee: { outputs: { default: {} } },
		sub_limit: { outputs: { default: {} }, create: {}, update: {} },
		supplier: { outputs: { default: {} }, create: {}, update: {} },
		drawdown: { outputs: { default: {} }, create: {}, update: {} },
		drawdown_charge: { outputs: { default: {} } },
		bank_document: { outputs: { default: {} }, create: {}, update: {} },
		month_end: { outputs: { default: {} }, create: {}, update: {} },
		month_end_line: { outputs: { default: {} } },
		fx_rate: { outputs: { default: {} }, create: {}, update: {} },
		purchase_order: { outputs: { default: {} } },
		po_line: { outputs: { default: {} } },
		invoice: { outputs: { default: {} } },
		po_document: { outputs: { default: {} }, create: {}, update: {} }
	}
});
