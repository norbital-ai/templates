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
 *   - `leave_catalogue.payroll_effect`   -> component_id on the UNPAID arm
 *   - `payslips.base/proration/statutory` -> component codes, scheme codes, band and term keys
 * The last of those is the point of inlining: a settled payslip is a frozen statement of what was
 * paid and does not become wrong because a catalogue row was later archived. See
 * docs/architecture.md (Provenance and audit).
 */
export default ((r) => ({
	/**
	 * The sealed, shareable root. Every downstream rule row is owned by its version (`cascade`: a
	 * draft deleted takes its children; the version's own hook refuses deleting a sealed one), and
	 * a company binds to the lineage by `settings_code`, a text key with no edge, so a change of law
	 * never touches the company row and two entities can take one root.
	 */
	jurisdiction_settings: {
		contribution_settings: r.many.statutory_contributions(),
		leave_catalogue_settings: r.many.leave_catalogue(),
		component_catalogue_settings: r.many.component_catalogue(),
		holiday_settings: r.many.company_holidays(),
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
		employment_company: r.many.employments(),
		shift_definition_company: r.many.shift_definitions(),
		shift_pattern_company: r.many.shift_patterns(),
		payroll_run_company: r.many.payroll_runs()
	},

	component_catalogue: {
		component_catalogue_settings: cascade(
			r.one.jurisdiction_settings({
				from: r.component_catalogue.settings_id,
				to: r.jurisdiction_settings.id
			})
		),
		claim_request_component_catalogue: r.many.claim_requests(),
		allowance_request_component_catalogue: r.many.allowance_requests(),
		bonus_request_component_catalogue: r.many.bonus_requests(),
		arrears_request_component_catalogue: r.many.arrears_requests(),
		correction_request_component_catalogue: r.many.correction_requests(),
		loan_component_catalogue: r.many.loans()
	},

	leave_catalogue: {
		leave_catalogue_settings: cascade(
			r.one.jurisdiction_settings({
				from: r.leave_catalogue.settings_id,
				to: r.jurisdiction_settings.id
			})
		),
		leave_request_leave_catalogue: r.many.leave_requests(),
		leave_entitlement_leave_catalogue: r.many.leave_entitlements()
	},

	leave_entitlements: {
		leave_entitlement_employment: r.one.employments({
			from: r.leave_entitlements.employment_id,
			to: r.employments.id
		}),
		leave_entitlement_leave_catalogue: r.one.leave_catalogue({
			from: r.leave_entitlements.leave_catalogue_id,
			to: r.leave_catalogue.id
		}),
		request_leave_entitlement: r.many.leave_requests(),
		entry_leave_entitlement: r.many.leave_entries()
	},

	leave_entries: {
		entry_leave_entitlement: r.one.leave_entitlements({
			from: r.leave_entries.leave_entitlement_id,
			to: r.leave_entitlements.id
		}),
		leave_entry_request: cascade(
			r.one.leave_requests({
				from: r.leave_entries.source_request_id,
				to: r.leave_requests.id
			})
		)
	},

	shift_definitions: {
		shift_definition_company: r.one.companies({
			from: r.shift_definitions.company_id,
			to: r.companies.id
		}),
		work_day_shift: r.many.work_days()
	},

	shift_patterns: {
		shift_pattern_company: r.one.companies({
			from: r.shift_patterns.company_id,
			to: r.companies.id
		}),
		term_shift_pattern: r.many.employment_terms()
	},

	company_holidays: {
		holiday_settings: cascade(
			r.one.jurisdiction_settings({
				from: r.company_holidays.settings_id,
				to: r.jurisdiction_settings.id
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
		claim_request_employment: r.many.claim_requests(),
		allowance_request_employment: r.many.allowance_requests(),
		bonus_request_employment: r.many.bonus_requests(),
		arrears_request_employment: r.many.arrears_requests(),
		correction_request_employment: r.many.correction_requests(),
		loan_employment: r.many.loans(),
		leave_request_employment: r.many.leave_requests(),
		/**
		 * Not a cascade, on purpose. The employment's `before` hook returns this edge as the complete
		 * set of the employment's generated entitlements, and `cascade(...)` would make every
		 * omission a delete: a restatement that missed a sealed year would erase audit evidence,
		 * and deleting an employment would take its ledger with it. Restrict refuses both.
		 * Authority is not on the edge: what the hook returns is the workspace's own work.
		 */
		leave_entitlement_employment: r.many.leave_entitlements(),
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
	 * A pay request is money that moved, or is owed. Deleting an employment must not silently take a
	 * settled claim or a paid correction with it; the `restrict` this leaves in place is what says
	 * so. The same answer for loans: a settled repayment schedule is money history.
	 */
	claim_requests: {
		claim_request_employment: r.one.employments({
			from: r.claim_requests.employment_id,
			to: r.employments.id
		}),
		claim_request_component_catalogue: r.one.component_catalogue({
			from: r.claim_requests.component_catalogue_id,
			to: r.component_catalogue.id
		}),
		/**
		 * The capture that settled this request, when a run has. Declared so the page can carry its
		 * lock state on the row it lists rather than open a second live query for it (B12).
		 */
		payslip_claim_request_input_claim_request: r.many.payslip_claim_request_inputs()
	},

	allowance_requests: {
		allowance_request_employment: r.one.employments({
			from: r.allowance_requests.employment_id,
			to: r.employments.id
		}),
		allowance_request_component_catalogue: r.one.component_catalogue({
			from: r.allowance_requests.component_catalogue_id,
			to: r.component_catalogue.id
		}),
		/**
		 * The capture that settled this request, when a run has. Declared so the page can carry its
		 * lock state on the row it lists rather than open a second live query for it (B12).
		 */
		payslip_allowance_request_input_allowance_request: r.many.payslip_allowance_request_inputs()
	},

	bonus_requests: {
		bonus_request_employment: r.one.employments({
			from: r.bonus_requests.employment_id,
			to: r.employments.id
		}),
		bonus_request_component_catalogue: r.one.component_catalogue({
			from: r.bonus_requests.component_catalogue_id,
			to: r.component_catalogue.id
		}),
		/**
		 * The capture that settled this request, when a run has. Declared so the page can carry its
		 * lock state on the row it lists rather than open a second live query for it (B12).
		 */
		payslip_bonus_request_input_bonus_request: r.many.payslip_bonus_request_inputs()
	},

	arrears_requests: {
		arrears_request_employment: r.one.employments({
			from: r.arrears_requests.employment_id,
			to: r.employments.id
		}),
		arrears_request_component_catalogue: r.one.component_catalogue({
			from: r.arrears_requests.component_catalogue_id,
			to: r.component_catalogue.id
		}),
		/**
		 * The capture that settled this request, when a run has. Declared so the page can carry its
		 * lock state on the row it lists rather than open a second live query for it (B12).
		 */
		payslip_arrears_request_input_arrears_request: r.many.payslip_arrears_request_inputs()
	},

	correction_requests: {
		correction_request_employment: r.one.employments({
			from: r.correction_requests.employment_id,
			to: r.employments.id
		}),
		correction_request_component_catalogue: r.one.component_catalogue({
			from: r.correction_requests.component_catalogue_id,
			to: r.component_catalogue.id
		}),
		/**
		 * The capture that settled this request, when a run has. Declared so the page can carry its
		 * lock state on the row it lists rather than open a second live query for it (B12).
		 */
		payslip_correction_request_input_correction_request: r.many.payslip_correction_request_inputs(),
		/**
		 * The settled output this corrects, held by the database. NOT a cascade: a correction is the
		 * evidence that a settled output was fixed, so the adjustment cannot be deleted while a
		 * correction names it, and deleting the correction never touches the adjustment.
		 *
		 * Declared as the `one` side only, with no `many` inverse, for the same reason a
		 * self-reference under the removed model had none: `resolveWritableManyRelation` identifies a
		 * writable pair by reversed collections and endpoints, and an edge that exists only to be
		 * ambiguous is worse than one that is not declared.
		 */
		correction_request_corrects_adjustment: r.one.payslip_adjustments({
			from: r.correction_requests.corrects_adjustment_id,
			to: r.payslip_adjustments.id
		})
	},

	leave_requests: {
		leave_entry_request: r.many.leave_entries(),
		request_leave_entitlement: r.one.leave_entitlements({
			from: r.leave_requests.leave_entitlement_id,
			to: r.leave_entitlements.id
		}),
		leave_request_employment: r.one.employments({
			from: r.leave_requests.employment_id,
			to: r.employments.id
		}),
		leave_request_leave_catalogue: r.one.leave_catalogue({
			from: r.leave_requests.leave_catalogue_id,
			to: r.leave_catalogue.id
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
		payslip_work_day_input_work_day: r.many.payslip_work_day_inputs()
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
		payslip_adjustment_payslip: r.many.payslip_adjustments(),
		payslip_work_day_input_payslip: r.many.payslip_work_day_inputs(),
		payslip_claim_request_input_payslip: r.many.payslip_claim_request_inputs(),
		payslip_allowance_request_input_payslip: r.many.payslip_allowance_request_inputs(),
		payslip_bonus_request_input_payslip: r.many.payslip_bonus_request_inputs(),
		payslip_arrears_request_input_payslip: r.many.payslip_arrears_request_inputs(),
		payslip_correction_request_input_payslip: r.many.payslip_correction_request_inputs(),
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

	payslip_claim_request_inputs: {
		payslip_claim_request_input_payslip: cascade(
			r.one.payslips({
				from: r.payslip_claim_request_inputs.payslip_id,
				to: r.payslips.id
			})
		),
		payslip_claim_request_input_claim_request: r.one.claim_requests({
			from: r.payslip_claim_request_inputs.claim_request_id,
			to: r.claim_requests.id
		})
	},

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

	payslip_bonus_request_inputs: {
		payslip_bonus_request_input_payslip: cascade(
			r.one.payslips({
				from: r.payslip_bonus_request_inputs.payslip_id,
				to: r.payslips.id
			})
		),
		payslip_bonus_request_input_bonus_request: r.one.bonus_requests({
			from: r.payslip_bonus_request_inputs.bonus_request_id,
			to: r.bonus_requests.id
		})
	},

	payslip_arrears_request_inputs: {
		payslip_arrears_request_input_payslip: cascade(
			r.one.payslips({
				from: r.payslip_arrears_request_inputs.payslip_id,
				to: r.payslips.id
			})
		),
		payslip_arrears_request_input_arrears_request: r.one.arrears_requests({
			from: r.payslip_arrears_request_inputs.arrears_request_id,
			to: r.arrears_requests.id
		})
	},

	payslip_correction_request_inputs: {
		payslip_correction_request_input_payslip: cascade(
			r.one.payslips({
				from: r.payslip_correction_request_inputs.payslip_id,
				to: r.payslips.id
			})
		),
		payslip_correction_request_input_correction_request: r.one.correction_requests({
			from: r.payslip_correction_request_inputs.correction_request_id,
			to: r.correction_requests.id
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
		loan_component_catalogue: r.one.component_catalogue({
			from: r.loans.component_catalogue_id,
			to: r.component_catalogue.id
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
