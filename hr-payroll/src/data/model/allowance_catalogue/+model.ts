import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'The allowance catalogue of one jurisdiction settings version: the static classes a contract may carry — code, destination and direction, the bands that price them, the schemes each counts toward. An allowance is assigned on the employment terms with its monthly figure and prorated like basic salary; one-off pay belongs to the ad hoc catalogue. Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:calendar-clock',
	label: ['code', 'name'],
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text', optional: true },
		authority: { kind: 'text', optional: true },
		destination: { kind: 'enum', values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY'] },
		direction: { kind: 'enum', values: ['ADD', 'SUBTRACT'], optional: true },
		bands: { kind: 'custom', of: 'catalogue_band' },
		eligibility: { kind: 'text', default: '' },
		/** The schemes whose `ALLOWANCES` base every line of this class enters. */
		counts_toward: { kind: 'custom', of: 'code_list' },
		/** Whether an unpaid day comes off this class; null follows `payroll.allowance_npl_prorates`. */
		npl_prorates: { kind: 'bool', optional: true },
		/** A class the statute owes whoever its eligibility admits: priced with no contract row (VN LC art.168(3)). */
		owed: { kind: 'bool', optional: true }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	search: { text: ['code', 'name'] }
});
