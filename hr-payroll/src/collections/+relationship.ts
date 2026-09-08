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
 *   - `leave_catalogue.payroll_effect`   -> declares its own deduction; no pointer to follow
 *   - `payslips.base/proration/statutory` -> component codes, scheme codes, band and term keys
 * The last of those is the point of inlining: a settled payslip is a frozen statement of what was
 * paid and does not become wrong because a catalogue row was later archived. See
 * docs/architecture.md (Provenance and audit).
 */
export default ((r) => ({
	jurisdiction_holiday_calendars: {
		holiday_input_calendar: r.many.holiday_calendar_inputs()
	},
	holiday_calendar_inputs: {
		holiday_input_calendar: r.one.jurisdiction_holiday_calendars({
			from: r.holiday_calendar_inputs.calendar_id,
			to: r.jurisdiction_holiday_calendars.id
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

	employees: {
		employment_employee: r.many.employments()
	},

	employment_contract_inputs: {
		contract_input_employment: r.one.employments({
			from: r.employment_contract_inputs.employment_id,
			to: r.employments.id
		})
	},
	employments: {
		contract_input_employment: r.many.employment_contract_inputs(),
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
		employment_contract_input: r.many.employment_contract_inputs({
			from: r.employment_terms.id,
			to: r.employment_contract_inputs.employment_terms_id
		}),
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
		employment_contract_input: r.many.employment_contract_inputs({
			from: r.employment_statutory_facts.id,
			to: r.employment_contract_inputs.employment_statutory_facts_id
		}),
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
		employment_contract_input: r.many.employment_contract_inputs({
			from: r.claim_requests.id,
			to: r.employment_contract_inputs.claim_requests_id
		}),
		claim_request_employment: r.one.employments({
			from: r.claim_requests.employment_id,
			to: r.employments.id
		}),
		claim_request_claim_catalogue: r.one.claim_catalogue({
			from: r.claim_requests.claim_catalogue_id,
			to: r.claim_catalogue.id
		}),
		/**
		 * The capture that settled this request, when a run has. Declared so the page can carry its
		 * lock state on the row it lists rather than open a second live query for it (B12).
		 */
		payslip_claim_request_input_claim_request: r.many.payslip_claim_request_inputs()
	},

	allowance_requests: {
		employment_contract_input: r.many.employment_contract_inputs({
			from: r.allowance_requests.id,
			to: r.employment_contract_inputs.allowance_requests_id
		}),
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
		employment_contract_input: r.many.employment_contract_inputs({
			from: r.payment_requests.id,
			to: r.employment_contract_inputs.payment_requests_id
		}),
		payment_request_employment: r.one.employments({
			from: r.payment_requests.employment_id,
			to: r.employments.id
		}),
		payment_request_payment_catalogue: r.one.payment_catalogue({
			from: r.payment_requests.payment_catalogue_id,
			to: r.payment_catalogue.id
		}),
		/**
		 * The capture that settled this request, when a run has. Declared so the page can carry its
		 * lock state on the row it lists rather than open a second live query for it (B12).
		 */
		payslip_payment_request_input_payment_request: r.many.payslip_payment_request_inputs()
	},

	leave_entries: {
		employment_contract_input: r.many.employment_contract_inputs({
			from: r.leave_entries.id,
			to: r.employment_contract_inputs.leave_entries_id
		}),
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
		payslip_leave_input_leave_entry: r.many.payslip_leave_inputs(),
		leave_holiday_input: r.many.holiday_calendar_inputs({
			from: r.leave_entries.id,
			to: r.holiday_calendar_inputs.leave_entry_id
		})
	},

	work_days: {
		employment_contract_input: r.many.employment_contract_inputs({
			from: r.work_days.id,
			to: r.employment_contract_inputs.work_days_id
		}),
		// No inverse FK: a holiday seal retains its historical consumer ID after deletion.
		work_day_holiday_input: r.many.holiday_calendar_inputs({
			from: r.work_days.id,
			to: r.holiday_calendar_inputs.work_day_id
		}),
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
		payroll_holiday_input_run: r.many.holiday_calendar_inputs({
			from: r.payroll_runs.id,
			to: r.holiday_calendar_inputs.payroll_run_id
		}),
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
		employment_contract_input: r.many.employment_contract_inputs({
			from: r.payslips.id,
			to: r.employment_contract_inputs.payslips_id
		}),
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
		payslip_payment_request_input_payslip: r.many.payslip_payment_request_inputs(),
		payslip_leave_input_payslip: r.many.payslip_leave_inputs(),
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

	payslip_payment_request_inputs: {
		payslip_payment_request_input_payslip: cascade(
			r.one.payslips({
				from: r.payslip_payment_request_inputs.payslip_id,
				to: r.payslips.id
			})
		),
		payslip_payment_request_input_payment_request: r.one.payment_requests({
			from: r.payslip_payment_request_inputs.payment_request_id,
			to: r.payment_requests.id
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
		employment_contract_input: r.many.employment_contract_inputs({
			from: r.loans.id,
			to: r.employment_contract_inputs.loans_id
		}),
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
		employment_contract_input: r.many.employment_contract_inputs({
			from: r.loan_repayments.id,
			to: r.employment_contract_inputs.loan_repayments_id
		}),
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
