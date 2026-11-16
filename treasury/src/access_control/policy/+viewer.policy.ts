import { policy } from '@norbital-ai/bolt';
/** View: every treasury and purchasing page, read only. */
export default policy({
	description: 'View: read every treasury and purchasing record; change nothing.',
	capabilities: {
		apps: ['treasury', 'purchasing', 'configuration'],
		automations: ['facility_form_pack']
	},
	grants: {
		bank: { outputs: { default: {} } },
		watch_point: { outputs: { default: {} } },
		letter_of_offer: { outputs: { default: {} } },
		facility: { outputs: { default: {} } },
		facility_fee: { outputs: { default: {} } },
		sub_limit: { outputs: { default: {} } },
		business_partner: { outputs: { default: {} } },
		supplier_bank: { outputs: { default: {} } },
		drawdown: { outputs: { default: {} } },
		drawdown_charge: { outputs: { default: {} } },
		bank_document: { outputs: { default: {} } },
		month_end: { outputs: { default: {} } },
		month_end_line: { outputs: { default: {} } },
		fx_rate: { outputs: { default: {} } },
		purchase_order: { outputs: { default: {} } },
		po_line: { outputs: { default: {} } },
		invoice: { outputs: { default: {} } },
		invoice_line: { outputs: { default: {} } },
		po_document: { outputs: { default: {} } },
		po_financing: { outputs: { default: {} } },
		facility_form: { outputs: { default: {} } },
		facility_attachment: { outputs: { default: {} } }
	}
});
