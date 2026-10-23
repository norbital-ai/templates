/**
 * Statutory research runs six agents per jurisdiction, side by side. Each owns a disjoint part of the snapshot (it may
 * edit nothing else), reads only the source entries tagged with its name, and is told its job here; the jurisdiction's
 * `sources.agents` adds supplementary instructions. Their results merge back into one jurisdiction snapshot.
 */
export const RESEARCH_AGENT_NAMES = [
	'catalog',
	'contribution',
	'rules',
	'behaviour',
	'obligations',
	'settings'
] as const;
export type ResearchAgent = (typeof RESEARCH_AGENT_NAMES)[number];

/** `rule_set` is split by family: the rules agent owns the law's limits, the obligations agent its deadlines. */
export const RULE_FAMILIES: Readonly<Record<'rules' | 'obligations', readonly string[]>> = {
	rules: ['VALIDATIONS', 'PAYROLL'],
	obligations: ['TASKS', 'OBLIGATIONS', 'EXPORTS']
};

/** The snapshot sections each agent owns. */
export const AGENT_SECTIONS: Readonly<Record<ResearchAgent, readonly string[]>> = {
	catalog: [
		'leave_catalog',
		'claim_catalog',
		'adhoc_catalog',
		'allowance_catalog',
		'loan_catalog',
		'work_catalog',
		'suspension_kind'
	],
	contribution: ['statutory_contribution_catalog'],
	rules: ['rule_set'],
	behaviour: ['behaviour_rule'],
	obligations: ['rule_set'],
	settings: ['settings']
};

/** Each agent's job, as the prompt states it. */
export const AGENT_JOBS: Readonly<Record<ResearchAgent, string>> = {
	catalog:
		'the pay and leave catalogues: statutory leave classes and their entitlements, claims, ad hoc payments (bonuses, commissions, termination and lay-off benefits, payments in lieu), allowances, loans and recoveries, the work items pay is built from (basic, overtime, rest-day and holiday work and pay, leave pay, piece pay) and the suspension kinds',
	contribution:
		'the statutory contribution and withholding schemes: every social-insurance, provident, employment-insurance, training-levy and income-tax withholding scheme the law imposes on employer or employee, with its coverage, base, rates and bands, ceilings, shares and rounding',
	rules:
		'the rule set families VALIDATIONS and PAYROLL: minimum wage, hours of work, overtime limits and classification, rest days, wage periods and payment methods, deduction ceilings, child and young-worker limits, record retention and the other limits the law sets',
	behaviour:
		"the version's behaviour rules (behaviour_rule, keyed by code): the event rules the law requires, e.g. what a rest day falling on a holiday, an exit or a payroll run must cause",
	obligations:
		'the rule set families TASKS, OBLIGATIONS and EXPORTS: the employer duties with deadlines: registrations, monthly remittances, returns and forms, notices of hire, cessation and departure, retrenchment and other notifications, registers and payslips, statutory exports',
	settings:
		"the version's own settings: payroll settings (currency, tax year, pay date, wage periods, monthly-wage basis, negative net, exit handling) and the employee and entity input schemas (the statutory facts and employer numbers the law requires a payroll to hold)"
};
