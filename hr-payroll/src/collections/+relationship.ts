import type { Relationships } from './$types.js';
import { cascade, deferrable, setNull } from '@norbital-ai/bolt/authoring';

/**
 * The relation graph. Foreign keys are derived from here, never declared in a `+model.ts`.
 *
 * ## Ownership is declared once, by `cascade(...)`
 *
 * A `cascade(...)` on the `one` side says the child cannot meaningfully exist without that parent:
 * deleting the parent deletes it. Nothing is ever deleted by omission: a child goes only through an
 * explicit `delete` action or its parent's cascade. Everything not wrapped is `restrict` — the
 * parent cannot be deleted while children point at it — and that is a deliberate answer, not an
 * omission. Two cases are worth reading twice:
 *
 * - `work_days` is NOT owned by the payroll: the same day carries a plan and attendance together,
 *   and nobody's roster owns either half. Its `payslip_id` is a nullable pin, not an edge: payroll
 *   stamps it on capture and clears it when the draft that holds it is released.
 * - every entry family and `work_days` carries a nullable `payslip_id` foreign key. The run sets
 *   it on consumption; deleting a `DRAFT` run (or one `DRAFT`/`ON_HOLD` payslip) clears it through
 *   the database's `ON DELETE SET NULL`, not authored code. A `PAID` payslip is never deleted, so
 *   a paid source stays locked.
 *
 * ## Where an edge is not declared here
 *
 * The remaining families deliberately have NO relation:
 *   - `payslips.base/proration/statutory/adjustments` -> codes, keys and source ids, never edges
 * The last of those is the point of inlining: a settled payslip is a frozen statement of what was
 * paid and does not become wrong because a catalogue row was later archived. See
 * docs/architecture.md (Provenance and audit).
 */
export default ((r) => ({
	/** Restrict: a holiday a work day pinned is history and cannot be deleted. */
	jurisdiction_holidays: {
		/** The entity that observes the day. A holiday is the employer's, not the country's. */
		holiday_company: r.one.companies({
			from: r.jurisdiction_holidays.company_id,
			to: r.companies.id
		})
	},
	/**
	 * The sealed, shareable root. Every downstream rule row is owned by its version (`cascade`: a
	 * draft deleted takes its children; the delete grant refuses deleting a sealed one), and
	 * a company binds to the lineage by `settings_code`, a text key with no edge, so a change of law
	 * never touches the company row and two entities can take one root.
	 */
	jurisdiction_settings: {
		contribution_settings: r.many.statutory_contributions(),
		leave_catalogue_settings: r.many.leave_catalogue(),
		loan_catalogue_settings: r.many.loan_catalogue(),
		claim_catalogue_settings: r.many.claim_catalogue(),
		allowance_catalogue_settings: r.many.allowance_catalogue(),
		/** The versions runs name as the law they were calculated under. */
		settings_payroll_run: r.many.payroll_runs()
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
		company_shift_definition: r.many.shift_definitions(),
		company_shift_pattern: r.many.shift_patterns(),
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
		allowance_allowance_catalogue: r.many.allowances(),
		allowance_entry_allowance_catalogue: r.many.allowance_entries()
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
		work_day_shift: r.many.work_days(),
		/** The entity the vocabulary belongs to; entity-owned like its holidays. */
		shift_definition_company: r.one.companies({
			from: r.shift_definitions.company_id,
			to: r.companies.id
		})
	},

	shift_patterns: {
		term_shift_pattern: r.many.employment_terms(),
		/** The entity the pattern belongs to; entity-owned like its holidays. */
		shift_pattern_company: r.one.companies({
			from: r.shift_patterns.company_id,
			to: r.companies.id
		})
	},

	employees: {
		employment_employee: r.many.employments(),
		statutory_fact_employee: r.many.employment_statutory_facts()
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
		claim_request_employment: r.many.claim_requests(),
		allowance_employment: r.many.allowances(),
		allowance_entry_employment: r.many.allowance_entries(),
		loan_employment: r.many.loans(),
		loan_repayment_employment: r.many.loan_repayments(),
		leave_entry_employment: r.many.leave_entries(),
		work_day_employment: r.many.work_days(),
		roster_employment: r.many.rosters(),
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
		statutory_fact_employee: cascade(
			r.one.employees({
				from: r.employment_statutory_facts.employee_id,
				to: r.employees.id
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
		/** The one payslip that consumed this entry; a deleted slip clears the key. */
		claim_request_payslip: deferrable(
			setNull(r.one.payslips({ from: r.claim_requests.payslip_id, to: r.payslips.id }))
		),
		claim_request_claim_catalogue: r.one.claim_catalogue({
			from: r.claim_requests.catalogue_id,
			to: r.claim_catalogue.id
		})
	},

	/**
	 * A standing allowance is the source; its entries are the lines. Restrict on every edge: an
	 * allowance a payslip has priced is money history, and its employment stays with it.
	 */
	allowances: {
		allowance_employment: r.one.employments({
			from: r.allowances.employment_id,
			to: r.employments.id
		}),
		allowance_allowance_catalogue: r.one.allowance_catalogue({
			from: r.allowances.catalogue_id,
			to: r.allowance_catalogue.id
		}),
		allowance_entry_allowance: r.many.allowance_entries()
	},

	/**
	 * An entry is owned by the payslip that priced it (`cascade`: a deleted draft slip takes its
	 * entries) and repeats a standing allowance (restrict: the allowance outlives no entry).
	 */
	allowance_entries: {
		allowance_entry_payslip: cascade(
			r.one.payslips({ from: r.allowance_entries.payslip_id, to: r.payslips.id })
		),
		allowance_entry_allowance: r.one.allowances({
			from: r.allowance_entries.derived_from_id,
			to: r.allowances.id
		}),
		allowance_entry_employment: r.one.employments({
			from: r.allowance_entries.employment_id,
			to: r.employments.id
		}),
		allowance_entry_allowance_catalogue: r.one.allowance_catalogue({
			from: r.allowance_entries.catalogue_id,
			to: r.allowance_catalogue.id
		})
	},

	leave_entries: {
		leave_entry_employment: r.one.employments({
			from: r.leave_entries.employment_id,
			to: r.employments.id
		}),
		leave_entry_payslip: deferrable(
			setNull(r.one.payslips({ from: r.leave_entries.payslip_id, to: r.payslips.id }))
		),
		leave_entry_leave_catalogue: r.one.leave_catalogue({
			from: r.leave_entries.catalogue_id,
			to: r.leave_catalogue.id
		}),
		leave_reversal_original: r.one.leave_entries({
			from: r.leave_entries.reversal_of_id,
			to: r.leave_entries.id
		}),
		leave_original_reversals: r.many.leave_entries()
	},

	rosters: {
		roster_employment: r.one.employments({
			from: r.rosters.employment_id,
			to: r.employments.id
		})
	},

	work_days: {
		work_day_payslip: deferrable(
			setNull(r.one.payslips({ from: r.work_days.payslip_id, to: r.payslips.id }))
		),
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
		/**
		 * The sources this slip consumed. The run's transform pins them as `link` actions on the
		 * slip and creates the per-period allowance entries it materialised under it; a deleted
		 * draft slip releases every pin and takes its entries with it.
		 */
		work_day_payslip: r.many.work_days(),
		claim_request_payslip: r.many.claim_requests(),
		allowance_entry_payslip: r.many.allowance_entries(),
		leave_entry_payslip: r.many.leave_entries(),
		loan_repayment_payslip: r.many.loan_repayments()
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
		loan_repayment_payslip: deferrable(
			setNull(r.one.payslips({ from: r.loan_repayments.payslip_id, to: r.payslips.id }))
		),
		loan_repayment_loan: cascade(
			r.one.loans({
				from: r.loan_repayments.loan_id,
				to: r.loans.id
			})
		)
	}
})) satisfies Relationships;
