import { policy } from '@norbital-ai/bolt';
/** Only closing automations hold ledger-writing authority; people use native run permission. */
export default policy({
	description: 'Calculate, close and reopen month-end ledgers.',
	grants: {
		bank: { outputs: { default: {} } },
		business_partner: { outputs: { default: {} } },
		facility: { outputs: { default: {} } },
		drawdown: { outputs: { default: {} } },
		drawdown_charge: { outputs: { default: {} } },
		fx_rate: { outputs: { default: {} } },
		month_end: { outputs: { default: {} }, create: {}, update: {} },
		month_end_line: { outputs: { default: {} } }
	}
});
