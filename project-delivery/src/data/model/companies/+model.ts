import { model } from '@norbital-ai/bolt';

/** A client organisation Norbital delivers projects for. */
export default model({
	description: 'A client organisation engaged for project delivery.',
	icon: 'lucide:building-2',
	label: 'name',
	fields: {
		name: { kind: 'text' },
		status: { kind: 'enum', values: ['prospect', 'active', 'dormant', 'archived'], optional: true },
		industry: { kind: 'text', optional: true },
		region: { kind: 'text', optional: true },
		website: { kind: 'text', optional: true },
		nda_required: { kind: 'bool', optional: true },
		nda_signed_on: { kind: 'instant', optional: true },
		nda_document: {
			kind: 'file',
			accept: ['*/*'],
			max: '20MiB',
			optional: true
		},
		notes: { kind: 'text', optional: true }
	}
});
