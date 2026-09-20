import { decodeNumber } from '@norbital-ai/std/json';
import type { Configuration } from '../../collections/payroll_runs/lib/configuration.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import {
	addDays,
	daysBetween,
	monthBounds,
	monthKey
} from '../../collections/payroll_runs/lib/dates.js';
import { personContext } from '../../collections/payroll_runs/lib/eligibility.js';
import { resolveCompanyFacts } from '../declared-facts.js';
import { employmentDates } from '../../collections/payroll_runs/lib/settlement.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { stint } from '../employment-contract.js';
import { evaluateNumber, expressionEngine } from '../expressions/evaluate.js';
import { listedAllowances } from '../payroll/contract-allowances.js';
import {
	latestDueMonthNormalRate,
	previousWagePeriodOrdinaryRate
} from '../payroll/reference-wages.js';
import { termsAt } from '../payroll/work.js';
import {
	patternAnchor,
	patternDaysPerWeek,
	patternRosterCodeId,
	patternWorkload,
	termPatternRow
} from '../scheduling/work-pattern.js';
import { rosterCodeKind } from '../scheduling/roster-code.js';
import type { LeaveActivity } from './pending.js';

/** Price on the conversion/termination date, independently of when payroll finally pays it. */
export function leaveEncashmentRate(options: {
	readonly bundle: EmploymentBundle;
	readonly configuration: Configuration;
	readonly entry: LeaveActivity;
	/** Consumed dated wage history, recorded for the payslip capture. */
	readonly referenceWageIds?: Set<string>;
}): number {
	const { bundle, configuration, entry } = options;
	if (!entry.effective_on) throw new Error('Leave cash-out requires a conversion date.');
	const exit = employmentDates(bundle.employment).exit;
	let eventDate = exit != null && exit < entry.effective_on ? exit : entry.effective_on;
	let version = settingsInForce(
		configuration.lineageVersions,
		configuration.jurisdiction.code,
		eventDate
	);
	if (
		version?.work_rules.encashment?.preserve_year_end_rate &&
		entry.to_date != null &&
		entry.to_date < eventDate
	) {
		eventDate = entry.to_date;
		version = settingsInForce(
			configuration.lineageVersions,
			configuration.jurisdiction.code,
			eventDate
		);
	}
	const rule = version?.work_rules.encashment;
	if (rule == null)
		throw new Error(`Leave cash-out has no verified valuation rule on ${eventDate}.`);
	// A current window may consume both carried credit and this year's entitlement.
	// Carried days retain their original year-end rate, rather than the destination window's rate.
	if (rule.preserve_year_end_rate && entry.allocations.some((allocation) => allocation.days < 0)) {
		const debits = entry.allocations.filter(
			(allocation) =>
				allocation.days < 0 && (allocation.pool == null || allocation.pool === entry.leave_code)
		);
		const days = debits.reduce((sum, allocation) => sum - allocation.days, 0);
		if (Math.abs(days - decodeNumber(entry.encash_days ?? 0)) > 0.000001 || !(days > 0))
			throw new Error('Leave cash-out allocations do not match the days being valued.');
		let total = 0;
		for (const allocation of debits) {
			const credit =
				allocation.credit_entry_id == null
					? null
					: bundle.leave.entries.find((candidate) => candidate.id === allocation.credit_entry_id);
			if (allocation.credit_entry_id != null && credit == null)
				throw new Error('Carried leave cash-out requires its original credit.');
			const carried = credit?.destination_from != null;
			if (carried && credit.allocations.some((source) => source.credit_entry_id != null))
				throw new Error(
					'Carried leave with transferred credits requires reconciliation of original salary years.'
				);
			const sourceEnd = carried ? credit.to_date : allocation.window.end;
			if (sourceEnd == null)
				throw new Error('Carried leave cash-out requires its original year end.');
			total +=
				-allocation.days *
				leaveEncashmentRate({
					...options,
					entry: { ...entry, to_date: sourceEnd, allocations: [] }
				});
		}
		return total / days;
	}
	let referenceDate = eventDate;
	if (rule.reference === 'PREVIOUS_MONTH')
		referenceDate = addDays(monthBounds(monthKey(eventDate)).start, -1);
	if (rule.reference === 'PREVIOUS_DAY_OR_MONTH') {
		// Leave-year ends are stored inclusively; termination/conversion is the event boundary.
		// A December year-end therefore retains December, including when paid after carry-over.
		const boundary =
			rule.preserve_year_end_rate && entry.to_date != null && entry.to_date === eventDate
				? addDays(eventDate, 1)
				: eventDate;
		const previousDay = addDays(boundary, -1);
		const frequency = termsAt(bundle, previousDay).pay_frequency;
		referenceDate =
			frequency === 'MONTHLY' || frequency === 'SEMI_MONTHLY'
				? addDays(monthBounds(monthKey(boundary)).start, -1)
				: previousDay;
	}
	const terms = termsAt(bundle, referenceDate);
	if (!rule.pay_frequencies.some((frequency) => frequency === terms.pay_frequency))
		throw new Error(`Leave cash-out has no verified ${terms.pay_frequency} valuation rule.`);
	if (terms.base_salary.currency !== configuration.jurisdiction.payroll.currency)
		throw new Error('Leave cash-out reference salary currency differs from payroll.');
	// A rule that refers to dated wage history prices the day from the record, not the contract:
	// the qualifying allowances are already inside the recorded ordinary earnings (MY s.60I(1C)),
	// and the normal-wage record restores reductions the contract cannot state (TW).
	const reference = version?.work_rules.ordinary_rate_reference ?? null;
	if (reference != null && reference.pay_frequencies.some((code) => code === terms.pay_frequency)) {
		const currency = configuration.jurisdiction.payroll.currency;
		if (reference.reference === 'LATEST_DUE_MONTH') {
			// A leave-year end is inclusive, so the boundary is the next day; termination and
			// conversion retain their legal event boundary.
			const boundary =
				rule.preserve_year_end_rate && entry.to_date != null && entry.to_date === eventDate
					? addDays(eventDate, 1)
					: eventDate;
			const prior = latestDueMonthNormalRate({
				periods: bundle.wagePeriods ?? [],
				boundary,
				currency
			});
			options.referenceWageIds?.add(prior.row.id);
			return prior.normalDay;
		}
		const prior = previousWagePeriodOrdinaryRate({
			periods: bundle.wagePeriods ?? [],
			currentPeriodStart: monthBounds(monthKey(eventDate)).start,
			currency
		});
		options.referenceWageIds?.add(prior.row.id);
		return prior.ordinaryDay;
	}
	const patternRow = termPatternRow(terms, configuration.patternById);
	if (patternRow == null)
		throw new Error('Leave cash-out requires the reference contract’s work pattern.');
	const pattern = patternRow.pattern;
	const daysPerWeek = patternDaysPerWeek(pattern, configuration.shiftById);
	const workload = patternWorkload(pattern, configuration.shiftById);
	const hoursPerWeek = decodeNumber(
		terms.ordinary_hours_per_week ??
			(workload == null ? 0 : workload.average_weekly_paid_minutes / 60)
	);
	if (!(daysPerWeek > 0))
		throw new Error('Leave cash-out requires positive contractual working days.');
	if (terms.pay_frequency === 'HOURLY' && !(hoursPerWeek > 0))
		throw new Error('Hourly leave cash-out requires contractual normal hours.');
	const fixedAllowancesFor = (row: EmploymentBundle['terms'][number]): number =>
		listedAllowances(row).reduce((sum, allowance) => {
			const code = configuration.allowanceCodeById.get(allowance.catalogue_id);
			if (
				code == null ||
				(!rule.include_allowances.includes(code) && !rule.exclude_allowances.includes(code))
			)
				throw new Error(
					`Leave cash-out requires a wage-base classification for allowance ${code ?? allowance.catalogue_id}.`
				);
			return sum + (rule.include_allowances.includes(code) ? decodeNumber(allowance.amount) : 0);
		}, 0);
	const fixedAllowances = fixedAllowancesFor(terms);
	if (
		rule.reference === 'PREVIOUS_DAY_OR_MONTH' &&
		(terms.pay_frequency === 'MONTHLY' || terms.pay_frequency === 'SEMI_MONTHLY')
	) {
		const month = monthBounds(monthKey(referenceDate));
		for (const date of daysBetween(month.start, month.end)) {
			const prior = termsAt(bundle, date);
			if (
				(prior.pay_frequency !== 'MONTHLY' && prior.pay_frequency !== 'SEMI_MONTHLY') ||
				prior.base_salary.currency !== terms.base_salary.currency ||
				decodeNumber(prior.base_salary.value) !== decodeNumber(terms.base_salary.value) ||
				fixedAllowancesFor(prior) !== fixedAllowances
			)
				throw new Error(
					'Leave cash-out requires the reference-period wage record when normal wages changed during that month.'
				);
		}
	}
	let workingDays = 0;
	if (rule.day_amount.includes('period.working_days')) {
		const month = monthBounds(monthKey(referenceDate));
		for (const date of daysBetween(month.start, month.end)) {
			const id = patternRosterCodeId(pattern, date, patternAnchor(patternRow));
			const shift = id == null ? null : configuration.shiftById.get(id);
			if (shift == null)
				throw new Error(
					'Leave cash-out requires the reference month’s complete working-day pattern.'
				);
			if (rosterCodeKind(shift.variant) === 'WORK') workingDays++;
		}
		if (!(workingDays > 0))
			throw new Error('Leave cash-out reference month has no normal working days.');
	}
	const person = personContext({
		employee: bundle.employee,
		employment: stint(bundle.employment),
		terms,
		fixedAllowances,
		week: { ordinary_hours_per_week: hoursPerWeek, working_days_per_week: daysPerWeek },
		children: bundle.children,
		company: {
			...configuration.company,
			facts: resolveCompanyFacts(version?.facts ?? [], {
				...configuration.company,
				facts: configuration.recordedCompanyFacts
			})
		},
		period: { working_days: workingDays },
		asOf: referenceDate
	});
	const rate = evaluateNumber(
		expressionEngine,
		rule.day_amount,
		person as unknown as Record<string, unknown>
	);
	if (!Number.isFinite(rate) || rate < 0)
		throw new Error('Leave cash-out daily pay must be finite and nonnegative.');
	// Preserve the quotient. The completed award rounds once in the payroll currency.
	return rate;
}
