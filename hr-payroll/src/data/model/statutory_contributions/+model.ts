import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One statutory scheme of one jurisdiction settings version — EPF, SOCSO, EIS, PCB, HRDF and their equivalents — with the rules that select and price its charge. Sealed with its version. A rule that names `produced.<code>.employee|employer` depends on that scheme; there is no sequence and no relief junction. Each scheme states what it is assessed on as one expression over the reserved lines and its version’s catalogue rows.',
	icon: 'lucide:landmark',
	label: 'name',
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text' },
		/** The section of law transcribed; a scheme that cites one is statutory and the drift automation watches it. */
		authority: { kind: 'text', optional: true },
		/**
		 * MONTH: the rules are a monthly schedule (a semi-monthly company charges the month once). MONTH_TO_DATE charges
		 * on actual receipts so far, less prior withholding, at every cut-off without projecting unpaid wages. QUARTER and
		 * YEAR charge once, in the month that closes the tax year's quarter or the tax year (and in an employment's final
		 * period), priced as a MONTH scheme there; the base states the window it reads (`year.*`, `history.*`).
		 */
		assessment_period: {
			kind: 'enum',
			values: ['PAY_PERIOD', 'MONTH', 'MONTH_TO_DATE', 'QUARTER', 'YEAR'],
			default: 'PAY_PERIOD'
		},
		/** COMPANY: one charge on the whole run, the employer's own levy. */
		assessment_scope: { kind: 'enum', values: ['EMPLOYMENT', 'COMPANY'], default: 'EMPLOYMENT' },
		/** How the employer-month sum of this scheme's charges becomes a remittance payable. */
		remittance_rounding: {
			kind: 'enum',
			values: ['NONE', 'FLOOR_MAJOR_UNIT'],
			default: 'NONE'
		},
		/**
		 * CEL over the person: whose charges the rounded employer-month total covers; every other
		 * charge is remitted at its actual amount. Empty: every charge (SG SDL: the local employees
		 * submitted with CPF are floored, foreign employees' levy is paid as it is).
		 */
		remittance_rounding_when: { kind: 'text', default: '' },
		/** How an explicit NOT_REGISTERED fact affects liability when its legal meaning is known. */
		unregistered_action: { kind: 'enum', values: ['SKIP', 'ASSESS', 'REFUSE'], default: 'REFUSE' },
		/** COMPANY: this scheme reads employer facts and ignores per-employment registration rows. */
		registration_subject: { kind: 'enum', values: ['PERSON', 'COMPANY'], default: 'PERSON' },
		/** Whether a declared opening follows the person or this employer's annual ceiling. */
		opening_scope: { kind: 'enum', values: ['PERSON', 'EMPLOYER'], default: 'PERSON' },
		/** The elections this scheme reads from its employments; `[]` when none (set by the transform). */
		elections: { kind: 'custom', of: 'fact_keys' },
		/** Annual ceiling on the employee share when another scheme reads it as a relief; null is no cap. */
		employee_share_annual_cap: { kind: 'int', optional: true },
		/** Schemes in one pool share the tightest cap they name. */
		shared_cap_group: { kind: 'text', optional: true },
		project_relief_annually: { kind: 'bool', default: false },
		/** The ladder; `[]` when none (set by the transform). */
		rules: { kind: 'custom', of: 'contribution_rules' },
		/** One CEL over the reserved lines and catalogue words: what the scheme is assessed on. */
		assessed_on: { kind: 'text', default: '' },
		/**
		 * Overrides of `assessed_on`, read in order: the first whose `when` holds states the base instead (a daily-paid
		 * worker's declared day wage times the days, a base the law fixes from the prior year). Same site as
		 * `assessed_on`; an override reads no other scheme. Absent or empty: `assessed_on` always.
		 */
		base_when: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						when: { kind: 'text' },
						base: { kind: 'text' },
						authority: { kind: 'text' }
					}
				}
			},
			optional: true
		},
		/** The parts a scheme splits its base into (SG CPF ordinary and additional); `[]` when none. */
		parts: { kind: 'custom', of: 'code_list' },
		/** The ordinary part of the base, where a ceiling splits it. */
		ordinary_on: { kind: 'text', default: '' },
		/**
		 * When a cumulative method starts: a prior period of this scheme triggers it when its ordinary
		 * base, less the employee shares of `less_employee_of`, is at most the cadence's threshold and
		 * supplementary pay exists, or when supplementary pay is at least that ordinary base. Read as
		 * `history.<code>.triggered`; absent, that is false.
		 */
		history_trigger: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					less_employee_of: { kind: 'list', of: { kind: 'text' } },
					ordinary_threshold: {
						kind: 'object',
						fields: {
							MONTHLY: { kind: 'number' },
							SEMI_MONTHLY: { kind: 'number' },
							WEEKLY: { kind: 'number' }
						}
					},
					authority: { kind: 'text' }
				}
			},
			optional: true
		},
		/** The relief categories an employee declares against this scheme, in display order; absent when none. */
		deduction_categories: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: { kind: 'object', fields: { code: { kind: 'text' }, label: { kind: 'text' } } }
			},
			optional: true
		},
		/** The authority's rule for child relief claims, shown beside them; absent when none. */
		child_claims_hint: { kind: 'text', optional: true },
		/** The listing: short name, position, and the column it folds into. */
		short_name: { kind: 'text', optional: true },
		listing_order: { kind: 'int', optional: true },
		listing_group: { kind: 'text', optional: true }
	},
	unique: [{ fields: ['settings_id', 'code'] }],
	search: { text: ['code', 'name'] }
});
