import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'Regulatory rule sets grouped by family. Dated jurisdiction sets belong to a sealed jurisdiction version; original global policy sources retain explicit global ownership. Configuration holds eligibility, legal parameters and ordered programs, with qualified source identity.',
	icon: 'lucide:list-checks',
	label: 'name',
	fields: {
		scope: {
			kind: 'text',
			default: 'JURISDICTION'
		},
		family: {
			kind: 'text'
		},
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		content_hash: {
			kind: 'text',
			optional: true
		},
		source_identity: {
			kind: 'json',
			optional: true,
			help: 'Original jurisdiction/source location and hash plus retained source IDs. Newly authored native identity never impersonates a retired source row.'
		},
		rules: {
			kind: 'json',
			shape: {
				kind: 'record',
				of: { kind: 'json' }
			},
			help: 'Authoritative family data, ordered entries and digest-keyed executable programs. No jurisdiction fallback supplies regulatory policy.'
		}
	}
});
