import { automation } from '@norbital-ai/bolt';
import { runCatalogEvents, type CatalogKind } from './utils/catalog-events.js';

/** One catalog dispatcher: which behaviours run is declared in the governing jurisdiction snapshot, not here. */
const families: readonly CatalogKind[] = ['LEAVE', 'CLAIM', 'LOAN', 'ADHOC'];

const catalog_events = automation({
	description:
		'Execute the configured catalog behaviours for accepted entries and their lifecycle events; operations remain declared in the governing snapshot.',
	on: [
		{ created: 'employee_profiles', where: { approval_id: { isNull: true } } },
		{ updated: 'employee_profiles', fields: ['effective_range'], where: { approval_id: { isNull: true } } },
		{ updated: 'payroll_runs', fields: ['calculation_state'], where: { calculation_state: { eq: 'CALCULATED' }, approval_id: { isNull: true } } },
		{ updated: 'entities', fields: ['input_originals'], where: { approval_id: { isNull: true } } },
		{ created: 'catalogue_entries', where: { approval_id: { isNull: true } } },
		{ updated: 'catalogue_entries', fields: ['values', 'occurred_on'], where: { approval_id: { isNull: true } } }
	],
	runAs: ['hr_controller'],
	delegations: [{ verb: 'obligations.create', policy: 'obligation_calendar_automation' }],
	concurrency: { max: 1 }
});
export default catalog_events;
catalog_events.run(async (input, ctx) => {
	for (const family of families) await runCatalogEvents(family, input, ctx);
});
