import { model } from '@norbital-ai/bolt';

/**
 * A class of one-off pay: a bonus, back pay, an ex-gratia sum, a separation payment, a claw-back. Its instances are
 * `adhoc_requests`, each due whole in one pay period.
 */
export default model({
	description:
		'The ad hoc catalogue of one jurisdiction settings version: the classes of one-off pay — bonus, back pay, ex-gratia, festival and separation payments, claw-backs — with the bands that price and cap them, the schemes each counts toward, the evidence a request demands and who raises one. Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:hand-coins',
	label: 'name',
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text', optional: true },
		authority: { kind: 'text', optional: true },
		destination: { kind: 'enum', values: ['PAY', 'NET', 'EMPLOYER', 'DISPLAY'] },
		direction: { kind: 'enum', values: ['ADD', 'SUBTRACT'], optional: true },
		bands: { kind: 'custom', of: 'catalogue_band' },
		eligibility: { kind: 'text', default: '' },
		evidence: { kind: 'enum', values: ['NONE', 'OPTIONAL', 'REQUIRED'], default: 'NONE' },
		/**
		 * What a request of this class needs before it is priced (`request_requirements`): its event
		 * inside the employment, dated terms, and person conditions with the refusal naming what to record.
		 */
		request_requirements: { kind: 'custom', of: 'request_requirements', optional: true },
		/** The inputs each request of this class records (`facts` on the request; `entry.facts.<key>`). */
		request_facts: { kind: 'custom', of: 'fact_keys', default: [] },
		/** The schemes whose `ADHOC` base every line of this class enters; empty enters none. */
		counts_toward: { kind: 'custom', of: 'code_list' },
		/**
		 * A line of this class comes off the unpaid salary later classes read as
		 * `entry.unpaid_salary`: a forfeiture of unpaid salary (PH RA 10361 s.32) spends what it takes.
		 */
		reduces_unpaid_salary: { kind: 'bool', optional: true },
		/**
		 * MANUAL is HR; SEPARATION is raised for a leaver in the final period; SCHEDULED is raised by
		 * `scheduled_entries` for everyone its `schedule` names, on or before each due day.
		 */
		raised_by: { kind: 'enum', values: ['MANUAL', 'SEPARATION', 'SCHEDULED'], default: 'MANUAL' },
		/** SCHEDULED only: the due days, who is owed them and the duty each occurrence records. */
		schedule: { kind: 'custom', of: 'catalogue_schedule', optional: true }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	search: { text: ['code', 'name'] }
});
