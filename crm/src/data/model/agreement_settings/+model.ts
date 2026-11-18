import { model } from '@norbital-ai/bolt';

const columns = [
	'provider_company',
	'provider_uen',
	'provider_address',
	'provider_signatory_name',
	'provider_signatory_title',
	'provider_signature'
] as const;

/** Workspace agreement settings: the company's legal details and who signs its documents (`provider_*` placeholders). One row. */
export default model('agreement_settings', {
	description: 'Your company’s legal details and who signs its documents.',
	icon: 'lucide:pen-line',
	record_label:
		'record.provider_company != null ? record.provider_company : record.provider_signatory_name',
	fields: {
		scope: { kind: 'enum', values: ['workspace'], default: 'workspace', hidden: true },
		provider_company: { kind: 'text', optional: true },
		provider_uen: { kind: 'text', optional: true },
		provider_address: { kind: 'text', optional: true },
		provider_signatory_name: { kind: 'text' },
		provider_signatory_title: { kind: 'text', optional: true },
		provider_signature: {
			kind: 'file',
			accept: ['image/png', 'image/jpeg'],
			max: '512KiB',
			optional: true
		}
	},
	constraints: { one_agreement_settings: { unique: ['scope'] } },
	outputs: { default: { fields: 'all' } },
	create: { fields: columns },
	update: { fields: columns }
});
