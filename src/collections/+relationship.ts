import type { Relationships } from './$types.js';
import { cascade } from '@norbital-ai/bolt/authoring';

/**
 * The relation graph. Foreign keys are derived from here, never declared in a `+model.ts`.
 *
 * ## Ownership is declared once, by `cascade(...)`
 *
 * A `cascade(...)` on the `one` side says the child cannot meaningfully exist without that parent:
 * deleting the parent deletes it, and a nested `many` in a `mutate` may hard-delete the children it
 * leaves out. Everything not wrapped is `restrict` — the parent cannot be deleted while children
 * point at it — and that is a deliberate answer, not an omission. Two cases are worth reading
 * twice:
 *
 * - `work_days` is NOT owned by its junction's inverse edge and NOT by a roster: a `rosters` row
 *   owns a *plan*, but the same day also carries attendance nobody's roster owns. The capture
 *   junction's `work_day_id` is `restrict`, which is what makes a consumed day un-deletable.
 * - the four input junctions cascade FROM their payslip — the capture has no meaning after the
 *   payslip that captured it is gone — and restrict into their business sources, which is what
 *   makes a captured source immutable while any run stands.
 *
 * ## Where an edge is not declared here
 *
 * `payslip_adjustments.input` is a `reference(...)`, and a reference owns its own target edges —
 * one real foreign key per arm, plus the exclusive-arc check that makes exactly one of them set.
 * Only the payslip ownership of that row is declared below.
 *
 * The remaining families deliberately have NO relation:
 *   - `leave_types.payroll_effect`   -> component_id on the UNPAID arm
 *   - `payslips.base/proration/statutory` -> component codes, scheme codes, band and term keys
 * The last of those is the point of inlining: a settled payslip is a frozen statement of what was
 * paid and does not become wrong because a catalogue row was later archived. See
 * docs/architecture.md (Provenance and audit).
 */
export default ((r) => ({
	jurisdictions: {
		company_jurisdiction: r.many.companies(),
		/**
		 * Two edges reach statutory_contributions from here — provenance (`jurisdiction_id`) and
		 * profile scoping (`statutory_profile_id`) — so neither `many` can leave its endpoints to
		 * inverse resolution: with two candidate `one` edges the pair is ambiguous by construction.
		 */
		contribution_jurisdiction: r.many.statutory_contributions({
			from: r.jurisdictions.id,
			to: r.statutory_contributions.jurisdiction_id
		}),
		/** The effective-dated snapshot rows runs name as the law they were calculated under. */
		statutory_snapshot_payroll_run: r.many.payroll_runs(),
		/** The catalogue rows scoped to this profile version and sealed with it. */
		statutory_profile_leave_type: r.many.leave_types(),
		statutory_profile_pay_component: r.many.pay_components(),
		statutory_profile_statutory_contribution: r.many.statutory_contributions({
			from: r.jurisdictions.id,
			to: r.statutory_contributions.statutory_profile_id
		})
	},

	statutory_contributions: {
		/** Provenance: the jurisdiction whose law this scheme transcribes. */
		contribution_jurisdiction: r.one.jurisdictions({
			from: r.statutory_contributions.jurisdiction_id,
			to: r.jurisdictions.id
		}),
		/** Version scoping: the profile revision this scheme is sealed with. */
		statutory_profile_statutory_contribution: r.one.jurisdictions({
			from: r.statutory_contributions.statutory_profile_id,
			to: r.jurisdictions.id
		}),
		rate_contribution: r.many.contribution_rates(),
		statutory_fact_contribution: r.many.employment_statutory_facts()
	},

	contribution_rates: {
		rate_contribution: cascade(
			r.one.statutory_contributions({
				from: r.contribution_rates.statutory_contribution_id,
				to: r.statutory_contributions.id
			})
		)
	},

	companies: {
		company_jurisdiction: r.one.jurisdictions({
			from: r.companies.jurisdiction_id,
			to: r.jurisdictions.id
		}),
		employment_company: r.many.employments(),
		pay_component_company: r.many.pay_components(),
		leave_type_company: r.many.leave_types(),
		shift_definition_company: r.many.shift_definitions(),
		company_holiday_company: r.many.company_holidays(),
		roster_company: r.many.rosters(),
		payroll_run_company: r.many.payroll_runs()
	},

	pay_components: {
		pay_component_company: r.one.companies({
			from: r.pay_components.company_id,
			to: r.companies.id
		}),
		statutory_profile_pay_component: r.one.jurisdictions({
			from: r.pay_components.statutory_profile_id,
			to: r.jurisdictions.id
		}),
		component_entry_pay_component: r.many.component_entries(),
		loan_pay_component: r.many.loans()
	},

	leave_types: {
		leave_type_company: r.one.companies({
			from: r.leave_types.company_id,
			to: r.companies.id
		}),
		/** Version scoping: the profile revision this catalogue row is sealed with. */
		statutory_profile_leave_type: r.one.jurisdictions({
			from: r.leave_types.statutory_profile_id,
			to: r.jurisdictions.id
		}),
		leave_request_type: r.many.leave_requests()
	},

	shift_definitions: {
		shift_definition_company: r.one.companies({
			from: r.shift_definitions.company_id,
			to: r.companies.id
		}),
		work_day_shift: r.many.work_days()
	},

	rosters: {
		roster_company: r.one.companies({
			from: r.rosters.company_id,
			to: r.companies.id
		}),
		work_day_roster: r.many.work_days()
	},

	company_holidays: {
		company_holiday_company: cascade(
			r.one.companies({
				from: r.company_holidays.company_id,
				to: r.companies.id
			})
		)
	},

	employees: {
		employment_employee: r.many.employments()
	},

	employments: {
		employment_employee: r.one.employees({
			from: r.employments.employee_id,
			to: r.employees.id
		}),
		child_employment: r.many.employee_children(),
		employment_company: r.one.companies({
			from: r.employments.company_id,
			to: r.companies.id
		}),
		term_employment: r.many.employment_terms(),
		statutory_fact_employment: r.many.employment_statutory_facts(),
		component_entry_employment: r.many.component_entries(),
		loan_employment: r.many.loans(),
		leave_request_employment: r.many.leave_requests(),
		work_day_employment: r.many.work_days(),
		payslip_employment: r.many.payslips()
	},

	employment_terms: {
		term_employment: cascade(
			r.one.employments({
				from: r.employment_terms.employment_id,
				to: r.employments.id
			})
		)
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

	employee_children: {
		child_employment: cascade(
			r.one.employments({
				from: r.employee_children.employment_id,
				to: r.employments.id
			})
		),
		/**
		 * A correction supersedes the fact it fixes; the superseded row stays as the record of what
		 * was believed. Declared one-side only (self-reference): the writable-pair resolution would
		 * be ambiguous with a `many` inverse, and nothing nests "the corrections of this fact".
		 */
		child_fact_supersedes: r.one.employee_children({
			from: r.employee_children.supersedes_id,
			to: r.employee_children.id
		})
	},

	/**
	 * Not owned by the employment, deliberately.
	 *
	 * A component entry is money that moved, or is owed. Deleting an employment must not silently
	 * take a settled claim or a paid correction with it; the `restrict` this leaves in place is what
	 * says so. The same answer for loans: a settled repayment schedule is money history.
	 */
	component_entries: {
		component_entry_employment: r.one.employments({
			from: r.component_entries.employment_id,
			to: r.employments.id
		}),
		component_entry_pay_component: r.one.pay_components({
			from: r.component_entries.pay_component_id,
			to: r.pay_components.id
		}),
		/**
		 * A `MANUAL_ADJUSTMENT` entry points at the settled output it corrects, and the database
		 * holds that edge. NOT a cascade: a correction is the evidence that a settled output was
		 * fixed, so the settled adjustment cannot be deleted while the correction names it, and
		 * deleting the correction never touches the adjustment.
		 *
		 * Declared as the `one` side only, with no `many` inverse, for the same reason
		 * a self-reference under the removed model had none: `resolveWritableManyRelation` identifies a writable pair
		 * by reversed collections and endpoints, and an edge that exists only to be ambiguous is
		 * worse than one that is not declared.
		 */
		component_entry_corrects_adjustment: r.one.payslip_adjustments({
			from: r.component_entries.corrects_adjustment_id,
			to: r.payslip_adjustments.id
		})
	},

	leave_requests: {
		leave_request_employment: r.one.employments({
			from: r.leave_requests.employment_id,
			to: r.employments.id
		}),
		leave_request_type: r.one.leave_types({
			from: r.leave_requests.leave_type_id,
			to: r.leave_types.id
		}),
		/**
		 * The engine-owned captures that name this request. Not a cascade: the junction's
		 * `leave_request_id` restrict is what refuses to delete a leave request a run has read.
		 */
		payslip_leave_request_input_leave_request: r.many.payslip_leave_request_inputs()
	},

	work_days: {
		work_day_employment: r.one.employments({
			from: r.work_days.employment_id,
			to: r.employments.id
		}),
		work_day_shift: r.one.shift_definitions({
			from: r.work_days.shift_definition_id,
			to: r.shift_definitions.id
		}),
		work_day_roster: r.one.rosters({
			from: r.work_days.roster_id,
			to: r.rosters.id
		}),
		payslip_work_day_input_work_day: r.many.payslip_work_day_inputs()
	},

	payroll_runs: {
		payroll_run_company: r.one.companies({
			from: r.payroll_runs.company_id,
			to: r.companies.id
		}),
		/**
		 * The statutory snapshot this run was calculated under. `restrict` on this end: a snapshot a
		 * paid run used is an append-only historical record, and a draft's snapshot id is replaced
		 * whole on recalculation rather than left dangling.
		 */
		statutory_snapshot_jurisdiction: r.one.jurisdictions({
			from: r.payroll_runs.statutory_snapshot_id,
			to: r.jurisdictions.id
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
		payslip_adjustment_payslip: r.many.payslip_adjustments(),
		payslip_work_day_input_payslip: r.many.payslip_work_day_inputs(),
		payslip_component_entry_input_payslip: r.many.payslip_component_entry_inputs(),
		payslip_leave_request_input_payslip: r.many.payslip_leave_request_inputs(),
		payslip_loan_repayment_input_payslip: r.many.payslip_loan_repayment_inputs()
	},

	/**
	 * ENGINE-OWNED junctions. Engine-owned means the engine emits them inside the run's graph and
	 * no user policy grants writes on them; the edges below are what the database enforces.
	 *
	 * Each junction is owned by its payslip (cascade — deleting the run releases every capture) and
	 * restricted against its business source (plain edge — a consumed source cannot be deleted out
	 * from under the run that read it). Each also carries the `many` inverse the payslip's writable
	 * `many` resolves against, and the adjustment side is reached through the
	 * `payslip_adjustments.input` reference's own per-arm edges.
	 */
	payslip_work_day_inputs: {
		payslip_work_day_input_payslip: cascade(
			r.one.payslips({
				from: r.payslip_work_day_inputs.payslip_id,
				to: r.payslips.id
			})
		),
		payslip_work_day_input_work_day: r.one.work_days({
			from: r.payslip_work_day_inputs.work_day_id,
			to: r.work_days.id
		})
	},

	payslip_component_entry_inputs: {
		payslip_component_entry_input_payslip: cascade(
			r.one.payslips({
				from: r.payslip_component_entry_inputs.payslip_id,
				to: r.payslips.id
			})
		),
		component_entry_input_component_entry: r.one.component_entries({
			from: r.payslip_component_entry_inputs.component_entry_id,
			to: r.component_entries.id
		})
	},

	payslip_leave_request_inputs: {
		payslip_leave_request_input_payslip: cascade(
			r.one.payslips({
				from: r.payslip_leave_request_inputs.payslip_id,
				to: r.payslips.id
			})
		),
		leave_request_input_leave_request: r.one.leave_requests({
			from: r.payslip_leave_request_inputs.leave_request_id,
			to: r.leave_requests.id
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
		loan_pay_component: r.one.pay_components({
			from: r.loans.pay_component_id,
			to: r.pay_components.id
		}),
		repayment_loan: r.many.loan_repayments()
	},

	loan_repayments: {
		loan_repayment_loan: cascade(
			r.one.loans({
				from: r.loan_repayments.loan_id,
				to: r.loans.id
			})
		),
		payslip_loan_repayment_input_loan_repayment: r.many.payslip_loan_repayment_inputs()
	},

	/**
	 * Owned by its payslip, which is owned by its run.
	 *
	 * That chain is what makes a recalculation a REPLACEMENT rather than a merge: a nested `many`
	 * in a `mutate` treats the array it is given as the child relationship's complete desired state
	 * and removes every row left out of it, and a parent delete only reaches children through a
	 * cascade edge. Without this an adjustment would outlive the payslip that computed it and the
	 * capture it holds would never be released.
	 *
	 * `input: reference(...)` owns its four target edges; only payslip ownership is declared here.
	 */
	payslip_adjustments: {
		payslip_adjustment_payslip: cascade(
			r.one.payslips({
				from: r.payslip_adjustments.payslip_id,
				to: r.payslips.id
			})
		)
	}
})) satisfies Relationships;
