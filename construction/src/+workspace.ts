import { workspace } from '@norbital-ai/bolt';

/**
 * Contractor workspace for both main contractors managing subcontractors and subcontractors managing
 * their own projects: structures WhatsApp, email, Autodesk ACC, and BIM IFC inputs into cashflow
 * (contracts, PO/DO/invoices/claims), progression (large-scale WBS schedules with their activity: comments, issues and meetings), and
 * quantifiable BIM + non-BIM cost estimations.
 */
export default workspace({
	tz: 'Asia/Singapore',
	locale: 'en-SG',
	languages: ['en', 'zh'],
	currency: 'SGD',
	theme: { palette: 'warm', accent: 'amber', radius: 'default' },
	apps: ['operations', 'configuration'],
	connections: ['whatsapp', 'email'],
	ai: {},
	convert: { to: ['pdf'] },
	limits: {
		construction_read: { act: '600/min', read: '600/min', agent: '100/h' }
	}
});
