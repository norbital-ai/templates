import { policy } from '@norbital-ai/bolt';
/** What Earmark it holds: read an order, its supplier and financing request, earmark it and link the two. */
export default policy({
	description: 'Earmark it: earmark a purchase order and link it to the earmark.',
	grants: {
		purchase_order: { outputs: { default: {} } },
		business_partner: { outputs: { default: {} } },
		facility_form: { outputs: { default: {} } },
		fx_rate: { outputs: { default: {} } },
		drawdown: { outputs: { default: {} }, create: {} },
		po_financing: { outputs: { default: {} }, create: {} }
	}
});
