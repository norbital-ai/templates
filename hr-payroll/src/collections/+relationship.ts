import type { Relationships } from './$types.js';
import { cascade } from '@norbital-ai/bolt/authoring';

/**
 * The relation graph. Foreign keys are derived from here, never declared in a `+model.ts`.
 *
 * ## Ownership is declared once, by `cascade(...)`
 *
 * A `cascade(...)` on the `one` side says the child cannot meaningfully exist without that parent:
 * deleting the parent deletes it, and a nested `many` in a `mutate` hard-deletes the children it
 * leaves out. Everything not wrapped is `restrict` — the parent cannot be deleted while children
 * point at it — and that is a deliberate answer, not an omission. Two cases are worth reading
 * twice:
 *
 * - `work_days` is NOT owned by its junction's inverse edge: the same day carries a plan and
 *   attendance together, and nobody's roster owns either half. The capture
 *   junction's `work_day_id` is `restrict`, which is what makes a consumed day un-deletable.
 * - the three capture junctions cascade FROM their payslip — the capture has no meaning after the
 *   payslip that captured it is gone — and restrict into their business sources. A single-use
 *   source (work day, claim, payment) instead names the payslip that settled it in
 *   `settled_payslip_id` — a plain pin, deliberately without a foreign key. Bolt stages a hook's
 *   writes after the row's own statement, so a restrict edge there could never be released ahead
 *   of the cascading payslip delete; the run's `after` hook stamps the pin and its delete hook
 *   clears it, and the sources' own delete hooks refuse while it is set.
 *
 * ## Where an edge is not declared here
 *
 * The remaining families deliberately have NO relation:
 *   - `leave_catalogue.treatments`       -> its two pay lines are its own; no pointer to follow
 *   - `payslips.base/proration/statutory/adjustments` -> codes, keys and source ids, never edges
 * The last of those is the point of inlining: a settled payslip is a frozen statement of what was
 * paid and does not become wrong because a catalogue row was later archived. See
 * docs/architecture.md (Provenance and audit).
 */
export default ((r) => ({
	/** Restrict: a holiday a work day pinned is history and cannot be deleted. */
	jurisdiction_holidays: {
		work_day_holiday: r.many.work_days(),
		/** The entity that observes the day. A holiday is the employer's, not the country's. */
		holiday_company: r.one.companies({
			from: r.jurisdiction_holidays.company_id,
			to: r.companies.id
		})
	},
	/**
	 * The sealed, shareable root. Every downstream rule row is owned by its version (`cascade`: a
	 * draft deleted takes its children; the version's own hook refuses deleting a sealed one), and
	 * a company binds to the lineage by `settings_code`, a text key with no edge, so a change of law
	 * never touches the company row and two entities can take one root.
	 */
	jurisdiction_settings: {
		work_catalogue_settings: r.many.work_catalogue(),
		contribution_settings: r.many.statutory_contributions(),
		leave_catalogue_settings: r.many.leave_catalogue(),
		loan_catalogue_settings: r.many.loan_catalogue(),
		claim_catalogue_settings: r.many.claim_catalogue(),
		allowance_catalogue_settings: r.many.allowance_catalogue(),
		payment_catalogue_settings: r.many.payment_catalogue(),
		/** The versions runs name as the law they were calculated under. */
		settings_payroll_run: r.many.payroll_runs()
	},

	work_catalogue: {
		work_catalogue_settings: cascade(
			r.one.jurisdiction_settings({
				from: r.work_catalogue.settings_id,
				to: r.jurisdiction_settings.id
			})
		)
	},

	statutory_contributions: {
		contribution_settings: cascade(
			r.one.jurisdiction_settings({
				from: r.statutory_contributions.settings_id,
				to: r.jurisdiction_settings.id
			})
		),
		statutory_fact_contribution: r.many.employment_statutory_facts()
	},

	companies: {
		/** Restrict, like every entity-scoped catalogue: an entity with a calendar is not deleted. */
		holiday_company: r.many.jurisdiction_holidays(),
		employment_company: r.many.employments(),
		payroll_run_company: r.many.payroll_runs()
	},

	/**
	 * Loans have a catalogue and no request family: a loan is not an event. The agreement is typed
	 * once with a schedule, and the engine emits one line per period from it.
	 */
	loan_catalogue: {
		loan_catalogue_settings: cascade(
			r.one.jurisdiction_settings({
				from: r.loan_catalogue.settings_id,
				to: r.jurisdiction_settings.id
			})
		),
		loan_loan_catalogue: r.many.loans()
	},

	claim_catalogue: {
		claim_catalogue_settings: cascade(
			r.one.jurisdiction_settings({
				from: r.claim_catalogue.settings_id,
				to: r.jurisdiction_settings.id
			})
		),
		claim_request_claim_catalogue: r.many.claim_requests()
	},

	allowance_catalogue: {
		allowance_catalogue_settings: cascade(
			r.one.jurisdiction_settings({
				from: r.allowance_catalogue.settings_id,
				to: r.jurisdiction_settings.id
			})
		),
		allowance_request_allowance_catalogue: r.many.allowance_requests()
	},

	payment_catalogue: {
		payment_catalogue_settings: cascade(
			r.one.jurisdiction_settings({
				from: r.payment_catalogue.settings_id,
				to: r.jurisdiction_settings.id
			})
		),
		payment_request_payment_catalogue: r.many.payment_requests()
	},

	leave_catalogue: {
		leave_catalogue_settings: cascade(
			r.one.jurisdiction_settings({
				from: r.leave_catalogue.settings_id,
				to: r.jurisdiction_settings.id
			})
		),
		leave_entry_leave_catalogue: r.many.leave_entries()
	},

	shift_definitions: {
		work_day_shift: r.many.work_days()
	},

	shift_patterns: {
		term_shift_pattern: r.many.employment_terms()
	},

	employees: {
		employment_employee: r.many.employments()
	},

	employments: {
		employment_employee: r.one.employees({
			from: r.employments.employee_id,
			to: r.employees.id
		}),
		employment_company: r.one.companies({
			from: r.employments.company_id,
			to: r.companies.id
		}),
		term_employment: r.many.employment_terms(),
		statutory_fact_employment: r.many.employment_statutory_facts(),
		claim_request_employment: r.many.claim_requests(),
		allowance_request_employment: r.many.allowance_requests(),
		payment_request_employment: r.many.payment_requests(),
		loan_employment: r.many.loans(),
		loan_repayment_employment: r.many.loan_repayments(),
		leave_entry_employment: r.many.leave_entries(),
		work_day_employment: r.many.work_days(),
		payslip_employment: r.many.payslips()
	},

	employment_terms: {
		term_employment: cascade(
			r.one.employments({
				from: r.employment_terms.employment_id,
				to: r.employments.id
			})
		),
		/** The base the terms project their days from. Restrict: a pattern in use cannot be deleted. */
		term_shift_pattern: r.one.shift_patterns({
			from: r.employment_terms.shift_pattern_id,
			to: r.shift_patterns.id
		})
	},

	employment_statutory_facts: {
		statutory_fact_employment: cascade(
			r.one.employments({
				from: r.employment_statutory_facts.employment_id,
				to: r.employments.id
			})
		),
		statutory_fact_contribution: r.one.statutory_contributions({
			from: r.employment_statutory_facts.statutory_contribution_id,
			to: r.statutory_contributions.id
		})
	},

	/**
	 * A pay request is money that moved, or is owed. Deleting an employment must not silently take a
	 * settled claim or a paid correction with it; the `restrict` this leaves in place is what says
	 * so. The same answer for loans: a settled repayment schedule is money history.
	 */
	claim_requests: {
		claim_request_employment: r.one.employments({
			from: r.claim_requests.employment_id,
			to: r.employments.id
		}),
		claim_request_claim_catalogue: r.one.claim_catalogue({
			from: r.claim_requests.claim_catalogue_id,
			to: r.claim_catalogue.id
		})
	},

	allowance_requests: {
		allowance_request_employment: r.one.employments({
			from: r.allowance_requests.employment_id,
			to: r.employments.id
		}),
		allowance_request_allowance_catalogue: r.one.allowance_catalogue({
			from: r.allowance_requests.allowance_catalogue_id,
			to: r.allowance_catalogue.id
		}),
		/**
		 * The capture that settled this request, when a run has. Declared so the page can carry its
		 * lock state on the row it lists rather than open a second live query for it (B12).
		 */
		payslip_allowance_request_input_allowance_request: r.many.payslip_allowance_request_inputs()
	},

	payment_requests: {
		payment_request_employment: r.one.employments({
			from: r.payment_requests.employment_id,
			to: r.employments.id
		}),
		payment_request_payment_catalogue: r.one.payment_catalogue({
			from: r.payment_requests.payment_catalogue_id,
			to: r.payment_catalogue.id
		})
	},

	leave_entries: {
		leave_entry_employment: r.one.employments({
			from: r.leave_entries.employment_id,
			to: r.employments.id
		}),
		leave_entry_leave_catalogue: r.one.leave_catalogue({
			from: r.leave_entries.leave_catalogue_id,
			to: r.leave_catalogue.id
		}),
		leave_reversal_original: r.one.leave_entries({
			from: r.leave_entries.reversal_of_id,
			to: r.leave_entries.id
		}),
		leave_original_reversals: r.many.leave_entries(),
		payslip_leave_input_leave_entry: r.many.payslip_leave_inputs()
	},

	work_days: {
		work_day_holiday: r.one.jurisdiction_holidays({
			from: r.work_days.holiday_id,
			to: r.jurisdiction_holidays.id
		}),
		work_day_employment: r.one.employments({
			from: r.work_days.employment_id,
			to: r.employments.id
		}),
		work_day_shift: r.one.shift_definitions({
			from: r.work_days.shift_definition_id,
			to: r.shift_definitions.id
		})
	},

	payroll_runs: {
		payroll_run_company: r.one.companies({
			from: r.payroll_runs.company_id,
			to: r.companies.id
		}),
		/**
		 * The jurisdiction settings version this run was calculated under. `restrict` on this end: a
		 * version a paid run used is an append-only historical record, and a draft's version id is
		 * replaced whole on recalculation rather than left dangling.
		 */
		settings_payroll_run: r.one.jurisdiction_settings({
			from: r.payroll_runs.settings_id,
			to: r.jurisdiction_settings.id
		}),
		payslip_payroll_run: r.many.payslips()
	},

	payslips: {
		payslip_payroll_run: cascade(
			r.one.payroll_runs({
				from: r.payslips.payroll_run_id,
				to: r.payroll_runs.id
			})
		),
		payslip_employment: r.one.employments({
			from: r.payslips.employment_id,
			to: r.employments.id
		}),
		payslip_allowance_request_input_payslip: r.many.payslip_allowance_request_inputs(),
		payslip_leave_input_payslip: r.many.payslip_leave_inputs(),
		payslip_loan_repayment_input_payslip: r.many.payslip_loan_repayment_inputs()
	},

	/**
	 * ENGINE-OWNED captures. Three remain as rows because one entry is consumed by many payslips: a
	 * recurring allowance, a Leave entry captured one date slice per period, and a loan repayment
	 * recovered in part and recaptured for its remainder. Each is owned by
	 * its payslip (cascade — deleting the run releases the capture) and restricted against its
	 * source. Every single-use source carries `settled_payslip_id` instead.
	 */

	payslip_allowance_request_inputs: {
		payslip_allowance_request_input_payslip: cascade(
			r.one.payslips({
				from: r.payslip_allowance_request_inputs.payslip_id,
				to: r.payslips.id
			})
		),
		payslip_allowance_request_input_allowance_request: r.one.allowance_requests({
			from: r.payslip_allowance_request_inputs.allowance_request_id,
			to: r.allowance_requests.id
		})
	},

	payslip_leave_inputs: {
		payslip_leave_input_payslip: cascade(
			r.one.payslips({
				from: r.payslip_leave_inputs.payslip_id,
				to: r.payslips.id
			})
		),
		leave_input_leave_entry: r.one.leave_entries({
			from: r.payslip_leave_inputs.leave_entry_id,
			to: r.leave_entries.id
		})
	},

	payslip_loan_repayment_inputs: {
		payslip_loan_repayment_input_payslip: cascade(
			r.one.payslips({
				from: r.payslip_loan_repayment_inputs.payslip_id,
				to: r.payslips.id
			})
		),
		loan_repayment_input_loan_repayment: r.one.loan_repayments({
			from: r.payslip_loan_repayment_inputs.loan_repayment_id,
			to: r.loan_repayments.id
		})
	},

	loans: {
		loan_employment: r.one.employments({
			from: r.loans.employment_id,
			to: r.employments.id
		}),
		loan_loan_catalogue: r.one.loan_catalogue({
			from: r.loans.loan_catalogue_id,
			to: r.loan_catalogue.id
		}),
		repayment_loan: r.many.loan_repayments()
	},

	loan_repayments: {
		loan_repayment_employment: r.one.employments({
			from: r.loan_repayments.employment_id,
			to: r.employments.id
		}),
		loan_repayment_loan: cascade(
			r.one.loans({
				from: r.loan_repayments.loan_id,
				to: r.loans.id
			})
		),
		payslip_loan_repayment_input_loan_repayment: r.many.payslip_loan_repayment_inputs()
	}
})) satisfies Relationships;
