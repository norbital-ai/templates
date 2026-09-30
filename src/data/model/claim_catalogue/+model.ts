import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'The claim catalogue of one jurisdiction settings version: code, destination and direction, the bands that price and cap a claim (with the schemes each opts into) and the evidence it demands. Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:receipt-text',
	label: ['code', 'name'],
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text', optional: true },
		authority: { kind: 'text', optional: true },
		/** PAY earns or reduces gross, NET pays or deducts outside it, EMPLOYER costs the employer, DISPLAY prints only. */
		destination: { kind: 'enum', values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY'] },
		/** Null where destination is EMPLOYER or DISPLAY. */
		direction: { kind: 'enum', values: ['ADD', 'SUBTRACT'], optional: true },
		bands: { kind: 'custom', of: 'catalogue_band' },
		eligibility: { kind: 'text', default: '' },
		/** A claim-level predicate; a mismatch refuses instead of consuming the claim. */
		qualifies_when: { kind: 'text', default: '' },
		evidence: { kind: 'enum', values: ['NONE', 'OPTIONAL', 'REQUIRED'], default: 'NONE' },
		/**
		 * What a request of this class needs before it is priced (`request_requirements`): its event
		 * inside the employment, dated terms, and person conditions with the refusal naming what to record.
		 */
		request_requirements: { kind: 'custom', of: 'request_requirements', optional: true },
		/** The inputs each request of this class records (`facts` on the request; `entry.facts.<key>`). */
		request_facts: { kind: 'custom', of: 'fact_keys', default: [] },
		/** The schemes whose base a paid claim of this class enters (`CLAIMS`). */
		counts_toward: { kind: 'custom', of: 'code_list' }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	search: { text: ['code', 'name'] }
});
