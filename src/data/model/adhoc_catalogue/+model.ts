import { model } from '@norbital-ai/bolt';

/**
 * A class of one-off pay: a bonus, back pay, an ex-gratia sum, a separation payment, a claw-back. Its instances are
 * `adhoc_requests`, each due whole in one pay period.
 */
export default model({
	description:
		'The ad hoc catalogue of one jurisdiction settings version: the classes of one-off pay — bonus, back pay, ex-gratia, festival and separation payments, claw-backs — with the bands that price and cap them, the schemes each counts toward, the evidence a request demands and who raises one. Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:hand-coins',
	label: ['code', 'name'],
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text', optional: true },
		authority: { kind: 'text', optional: true },
		destination: { kind: 'enum', values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY'] },
		direction: { kind: 'enum', values: ['ADD', 'SUBTRACT'], optional: true },
		bands: { kind: 'custom', of: 'catalogue_band' },
		eligibility: { kind: 'text', default: '' },
		evidence: { kind: 'enum', values: ['NONE', 'OPTIONAL', 'REQUIRED'], default: 'NONE' },
		/** The schemes whose `ADHOC` base every line of this class enters; empty enters none. */
		counts_toward: { kind: 'custom', of: 'code_list' },
		/** MANUAL is HR; SEPARATION is raised for a leaver in the final period. */
		raised_by: { kind: 'enum', values: ['MANUAL', 'SEPARATION'], default: 'MANUAL' }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	search: { text: ['code', 'name'] }
});
