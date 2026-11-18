import { policy } from '@norbital-ai/bolt';

/** Publishing a new version of a supplied template: the version is a new row, earlier ones and customer copies stay. */
export default policy({
	description: 'Publishes a new version of a supplied agreement template.',
	grants: { template_documents: { outputs: { default: {} }, create: {} } }
});
