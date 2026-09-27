import { model } from '@norbital-ai/bolt';

/** Documents attached to projects: brief, sow, signed_sow, supporting docs. */
export default model({
	description: 'Documents linked to a project, including signed SOWs',
	icon: 'lucide:file-text',
	label: 'title',
	fields: {
		title: { kind: 'text' },
		kind: { kind: 'enum', values: ['brief', 'sow', 'signed_sow', 'supporting'], optional: true },
		status: { kind: 'enum', values: ['draft', 'review', 'signed', 'submitted'], optional: true },
		markdown_body: { kind: 'text', optional: true },
		attachment: {
			kind: 'file',
			accept: ['*/*'],
			max: '20MiB',
			optional: true
		},
		signed_by: { kind: 'text', optional: true },
		signed_on: { kind: 'instant', optional: true },
		submitted_on: { kind: 'instant', optional: true }
	}
});
