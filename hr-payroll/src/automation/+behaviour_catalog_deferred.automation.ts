import { automation } from '@norbital-ai/bolt';
import { runCatalogEvents } from './utils/catalog-events.js';

/** A future service boundary waits for its actual jurisdiction day, then runs as the run that deferred it. */
const catalog_deferred = automation({
	description:
		'Execute the catalog configuration for a lifecycle event whose actual jurisdiction day had not arrived when its source was accepted. Scheduled by the catalog dispatchers and run as the deferring run; the event keeps its original source identity.',
	input: {
		catalog: { kind: 'enum', values: ['LEAVE', 'CLAIM', 'LOAN', 'ADHOC'] },
		ids: { kind: 'list', of: { kind: 'text' }, min: 1 }
	},
	runAs: 'trigger',
	concurrency: { max: 1 }
});
export default catalog_deferred;
catalog_deferred.run((input, ctx) => runCatalogEvents(input.catalog, input, ctx));
