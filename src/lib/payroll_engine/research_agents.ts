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

/**
 * Each agent's brief, as the prompt states it: what a correct section achieves for payroll and what the attributes of
 * its rows do when payroll runs.
 */
export const AGENT_BRIEFS: Readonly<Record<ResearchAgent, string>> = {
	catalog:
		"You own the pay and leave catalogues and the suspension kinds: every payslip line but statutory contributions. Goal: every payment, leave and recovery the law grants or permits is a class that prices it lawfully and reaches the right statutory bases. work_catalog: a salary slip posts quantity × rate (CEL over the payslip context) when eligibility holds; component_code names the line; prorated with denominator states an incomplete period's divisor. Write the law's multiples, premiums and divisors here: overtime, rest-day and holiday work, the daily rate, no-pay deductions (leave.rows, period.unpaid_working_days), leave pay, encashment. allowance_catalog: amount is CEL over allowance.amount, gated by eligibility. adhoc_catalog, claim_catalog, loan_catalog: an entry must meet eligibility and qualifies_when; the first band whose when holds prices it (amount) and its limit caps it (on_exceed BLOCK, CAP or ALLOW; a claim's window ENTRY, PERIOD or CALENDAR_YEAR): statutory caps go there. raise_on_exit makes the final slip raise it (severance, notice in lieu); payable_after_exit pays it after the exit. Each class: destination (PAY gross, NET net only, EMPLOYER, DISPLAY) and direction place its money; counts_toward lists the schemes and parts (CODE or CODE.PART) the law includes it in; an omitted scheme silently exempts it. leave_catalog: eligibility gates requests; unit and unplanned_days say what a day charges; entitlement.days (CEL over service_months, bands, taken) with window, carry_forward, carry_depth and overdraw meters the balance; is_npl or pay_fraction make it unpaid or part paid; can_encash, encash_on_exit and encash_at_window_end decide payouts; consumes_code draws another class's pool. suspension_kind: counts_as_attended, scheduled and pay (CEL over day, suspension) decide a suspended day.",
	contribution:
		"You own statutory_contribution_catalog: every social-insurance, provident, employment-insurance, levy and income-tax withholding scheme. Goal: each month charges exactly the employee and employer amounts the law requires, on the wage the law includes. A scheme's wage is the lines whose counts_toward names its code (a bare code is its ordinary part, CODE.PART another); a missing inclusion is the catalog agent's: note it under unresolved. In configuration: person derives the person facts a scheme reads (age basis, residency) as CEL; assessable gives each part's month-to-date assessable amount over wage, month, year, period and terms: ceilings, floors and exempt thresholds go there; assessment may replace their total. rules are tried in order: the first whose when holds charges employee and employer (or contribution, returning both) over base.assessed and the parts; write rates, bands, fixed amounts, minimums, maximums and rounding (round(value, step, mode)) there. The engine charges the month's liability and subtracts what earlier slips of the month charged: write month liabilities, never per-slip ones. Coverage, exemptions and opt-ins read the employee's declared standing (scheme.standing, scheme.elections); refuse_when and warn_when guard a slip. as_of picks the day the person is read (period_start, period_end, pay_date); governed_by pay_date assesses on the version in force on the pay day; order decides whose employee share net_available covers first; assess_without_wage charges without a wage; annual_reconciliation settles an annual ceiling; carry_uncovered advances a share net cannot cover. Another scheme's charge reads charged.month.CODE. limitation states coverage in words. A liability the row lacks is missing, never zero.",
	rules:
		"You own rule_set families VALIDATIONS and PAYROLL: the limits the law sets on pay and working time. Goal: every legal limit either stops, holds or flags the record that breaks it, and every named slot the engine reads is stated. VALIDATIONS rows: rules is { site, kind, when, message, description }. site is where it trips: payslip (each built slip, reading payslip.gross, net, total_deductions, statutory_employee, statutory_employer, net_additions, net_deductions, lines.CODE and statutory.CODE beside the subject, period, work and hours roots), contract (terms as written), roster (one roster day; column names the sheet field) or cycle (a pattern cycle). kind is refuse, warn or hold (the slip ON_HOLD); an entity may rebind it by code. when is CEL that holds on a breach: minimum wage, hours and overtime caps, rest days, deduction ceilings, young-worker limits, pay held pending clearance. PAYROLL rows: rules is an object read in CEL as rules.CODE. The engine requires record_retention ({ until }: CEL on the subject at the exit), exit_grounds and holiday_kinds (kinds: [{ code, name }]) and salary_report; case_kinds and overtime_classification (how approved hours split by source limit) are optional. Any other slot (a deduction ceiling, a wage floor table) is data that validations and catalogue expressions read by its code. Keep each limit's numbers in one slot and read it from there. State wage periods and payment-method rules here only as validations; the settings agent owns the period mechanics.",
	behaviour:
		"You own behaviour_rule: the version's event rules, keyed by code. Goal: every effect the law attaches to an event happens as a write, once. A rule answers an engine event (catalog with events, e.g. WORK PAYROLL_CREATE) or a row event (target_collection with events: created, updated, deleted; calendar daily and after_exit for the daily tick; entity calendar). when is CEL over the event; fields names extra trigger-row fields to read; reads declares rows to load ({ collection, where whose string leaves are CEL, select }); effect is CEL returning writes ({ collection, operation create, update or delete, data }) to obligation, regulatory_task, holiday, payslip, roster_entry or the entry models, or null for none. Rules run in order and see earlier rules' writes. The generic rules (pin settled entries, hold payslips, raise-obligations, raise-tasks, encash leave on exit and at window end, retract exit effects, write public holidays) are mechanics: keep them unchanged. raise-obligations and raise-tasks already turn every OBLIGATIONS and TASKS row into a record, so a dated duty is a rule_set row for the obligations agent, not a behaviour. Add a behaviour only for a consequence a catalogue cannot express: a substitute day when a holiday falls on a rest day, an entry a lawful event must create, a write an exit or a payroll run must cause. Key each write on its event (a reference or occurrence_key) so a rerun is a no-op.",
	obligations:
		"You own rule_set families TASKS, OBLIGATIONS and EXPORTS: the employer's dated duties and statutory files. Goal: every duty the law imposes appears as an open record with its correct due date, and every prescribed file can be produced. OBLIGATIONS rows are money remittances: each created payroll run raises one obligation per row. rules: { description, schemes, due, amount, months, applies_when }. amount_due is the named schemes' employee plus employer charges of the run, unless amount (CEL over total, run, period, company) states it; due is CEL over period, company, run, holidays and rules giving due_on (add_days, next_working_day with the published holidays); months limits it to some periods; applies_when gates it. TASKS rows are non-money duties (registrations, returns, notices of hire, cessation, departure and retrenchment, registers, payslip delivery): rules: { description, trigger: { collection, events }, when, applies_when, due, months }. The trigger is the record event that raises it (payroll_run created, employment_contract created or updated, calendar daily or after_exit, workplace_case daily); when and applies_when are CEL over row, contract, employee, company, hired_on, exit_on, today and headcount; due gives its due_on. EXPORTS rows render statutory returns and files: rules: { file, format CSV or FIXED, columns, header, records, trailer, summary, when, applies_when }, each field a CEL value over runs, company, employee, contract, slips and totals, with width, align and pad for fixed layouts. Record the deadline rule, not a computed date; state penalties in description.",
	settings:
		"You own the version's settings: payroll, employee_input_schema, entity_input_schema and their references. Goal: the run's frame (money, periods, pay day, wage basis, exit and net handling) is the law's, and every statutory fact a payroll needs has a field to hold it. payroll: currency and minor_units set the money every amount rounds to; timezone the local day; tax_year_start_month starts the year that year-to-date bases and charged.year read; pay_date is CEL over period and company giving the latest lawful pay day; week_start, semi_monthly_split and ten_day_splits cut wage periods; monthly_wage is CEL over terms defining terms.monthly_wage, the wage rates and divisors build on; base_salary_required, permanent_when (CEL over terms: who counts in permanent headcount), off_cycle_families (entry families an off-cycle run may pay), negative_net (refuse or allow), exit_raise_when (CEL: which salary slip raises exit pay), exit_overpayment (note or deduct) and attendance (step_hours, rounding, overtime_window, untimed_credit_day_types) are stated on every version. employee_input_schema is a JSON schema of employee facts read as employee.facts; its employment_statutory_facts standing kinds and elections are what each scheme reads as scheme.standing and scheme.elections; contract_terms items reach CEL as terms. entity_input_schema holds the employer facts (registration numbers, sector, risk class inputs) read as company.facts. Add a field when the law makes a fact decisive for coverage, rates or a duty, with the values the law names."
};
