import type { Relationships } from './$types.js';
import { cascade } from '@norbital-ai/bolt/authoring';

/**
 * The relation graph. Foreign keys are derived from here, never declared in a `+model.ts`.
 *
 * ## Ownership is declared once, by `cascade(...)`
 *
 * A `cascade(...)` on the `one` side says the child cannot meaningfully exist without that parent:
 * deleting the parent deletes it, and a nested `many` in a `mutate` may hard-delete the children it
 * leaves out. Everything not wrapped is `restrict` - the parent cannot be deleted while children
 * point at it - and that is a deliberate answer, not an omission. `work_days` is the case worth
 * reading twice: a `rosters` row owns a *plan*, but the same day also carries attendance nobody's
 * roster owns, so that edge is NOT a cascade and deleting a drafted month must release its days
 * first rather than take their attendance with it.
 *
 * ## Where an edge is not declared here
 *
 * `payslip_adjustments.source` is a `reference(...)`, and a reference owns its own target edges -
 * one real foreign key per arm, plus the exclusive-arc check that makes exactly one of them set.
 * Only the payslip ownership of that row is declared below.
 *
 * The remaining families deliberately have NO relation:
 *   - `leave_types.payroll_effect`   -> component_id on the UNPAID arm
 *   - `payslips.base/proration/statutory` -> pay_component_id, term_id, statutory_contribution_id
 * The last of those is the point of inlining: a settled payslip is a frozen statement of what was
 * paid and does not become wrong because a catalogue row was later archived. Referential integrity
 * for the first two is checked in `+hooks.ts` (validation gate A3), not by the database.
 * See docs/architecture.md (Provenance and audit).
 */
export default ((r) => ({
	jurisdictions: {
		company_jurisdiction: r.many.companies(),
		contribution_jurisdiction: r.many.statutory_contributions()
	},

	statutory_contributions: {
		contribution_jurisdiction: r.one.jurisdictions({
			from: r.statutory_contributions.jurisdiction_id,
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
		obligation_pay_component: r.many.obligations(),
		payslip_adjustment_pay_component: r.many.payslip_adjustments()
	},

	leave_types: {
		leave_type_company: r.one.companies({
			from: r.leave_types.company_id,
			to: r.companies.id
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
		employment_company: r.one.companies({
			from: r.employments.company_id,
			to: r.companies.id
		}),
		term_employment: r.many.employment_terms(),
		statutory_fact_employment: r.many.employment_statutory_facts(),
		obligation_employment: r.many.obligations(),
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

	/**
	 * Not owned by the employment, deliberately.
	 *
	 * An obligation is money that moved, or is owed. Deleting an employment must not silently take
	 * a settled loan or a paid claim with it; the `restrict` this leaves in place is what says so.
	 */
	obligations: {
		obligation_employment: r.one.employments({
			from: r.obligations.employment_id,
			to: r.employments.id
		}),
		obligation_pay_component: r.one.pay_components({
			from: r.obligations.pay_component_id,
			to: r.pay_components.id
		}),
		/**
		 * A REVERSAL points at the obligation it undoes, and the database holds that edge.
		 *
		 * It was a uuid inside a jsonb union in the first draft of this collection, which is a live
		 * reference the database cannot enforce, `bolt migrate` cannot see and the replica cannot
		 * reason about. It is a real self-referencing foreign key now.
		 *
		 * Declared as the `one` side only, with no `many` inverse. The inverse would be
		 * `obligations` -> `obligations`, and `resolveWritableManyRelation` identifies a writable
		 * pair by *reversed collections and endpoints* rather than by name — on a self-reference
		 * both sides read the same, which is precisely the ambiguity it refuses to resolve. Nothing
		 * needs to nest "the obligations that reverse this one" today, and an edge that exists only
		 * to be ambiguous is worse than one that is not declared. The foreign key is emitted from
		 * this side alone.
		 *
		 * NOT a cascade, in both directions: a reversal is the evidence that an earlier obligation
		 * was undone. Deleting the original is refused while the reversal names it, and deleting the
		 * reversal never touches the original.
		 */
		obligation_reverses: r.one.obligations({
			from: r.obligations.reverses_obligation_id,
			to: r.obligations.id
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
		})
	},

	/**
	 * Owned by nothing.
	 *
	 * `roster_entries` used to cascade from `rosters`, and that was correct while the row was only a
	 * plan. It is not correct now: the same row carries attendance, and a drafted month must not be
	 * able to delete a punch. `work_day_roster` is therefore a plain edge - deleting a roster is
	 * refused while its days still name it, and releasing them (clearing `roster_id`) is the act
	 * that un-publishes a month.
	 */
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
		})
	},

	payroll_runs: {
		payroll_run_company: r.one.companies({
			from: r.payroll_runs.company_id,
			to: r.companies.id
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
		payslip_adjustment_payslip: r.many.payslip_adjustments()
	},

	/**
	 * Owned by its payslip, which is owned by its run.
	 *
	 * That chain is what makes a recalculation a REPLACEMENT rather than a merge: a nested `many`
	 * in a `mutate` treats the array it is given as the child relationship's complete desired state
	 * and removes every row left out of it, and a parent delete only reaches children through a
	 * cascade edge. Without this an adjustment would outlive the payslip that computed it and the
	 * settlement claim it holds would never be released.
	 *
	 * `source: reference(...)` owns its three target edges; only payslip ownership is declared here.
	 */
	payslip_adjustments: {
		payslip_adjustment_payslip: cascade(
			r.one.payslips({
				from: r.payslip_adjustments.payslip_id,
				to: r.payslips.id
			})
		),
		payslip_adjustment_pay_component: r.one.pay_components({
			from: r.payslip_adjustments.pay_component_id,
			to: r.pay_components.id
		})
	}
})) satisfies Relationships;
