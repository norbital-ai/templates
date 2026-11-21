import { workspace } from '@norbital-ai/bolt';

/**
 * Main-contractor construction project management workspace: BIM IFC coordination with 3D issue & photo pinning,
 * 4D programme timeline and axis scrubbers, WhatsApp/Telegram/email coordination sync with AI extraction,
 * structured WBS tasks, variation orders, progress logs, and configurable BOQ claimable valuation.
 */
export default workspace({
	tz: 'Asia/Singapore',
	locale: 'en-SG',
	currency: 'SGD',
	apps: ['operations', 'configuration'],
	ai: {},
	convert: { to: ['pdf'] },
	limits: {
		construction_read: { act: '600/min', read: '600/min', agent: '100/h' }
	}
});
