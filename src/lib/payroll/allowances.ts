/**
 * Allowances: the static classes, assigned on the contract and priced every period beside the
 * wage.
 *
 * An allowance is not an event. `employment_terms.allowances` lists the classes a contract
 * carries and the monthly figure of each; to change or stop one is a terms change from a date,
 * exactly as salary. The run prices each listed class through the same terms walk the wage takes
 * (`measureContractSegments`): one segment per terms row, prorated on the person's basis, less
 * the unpaid days where the jurisdiction says an allowance loses them. Nothing is materialised —
 * the payslip's base line and its proration segments are the whole record.
 */

import { decodeNumber } from '../wire.js';
import { placeWage } from '../datatypes/wages.js';
import type { EmploymentBundle } from '../../lib/payroll/run/gather.js';
import { isEligible, personContext } from '../../lib/payroll/run/eligibility.js';
import { stint } from '../employment-contract.js';
import {
	contractAllowanceClass,
	contractAllowancesOn,
	listedAllowances
} from './contract-allowances.js';
import { factStatusesOn, personFacts } from './facts.js';
import { runtimeExpressionEngine } from '../expressions/evaluate.js';
import type { CatalogueComponent } from '../../lib/payroll/run/configuration.js';
import type { FamilyStep, MeasureComponentOptions } from './family.js';
import { entryContext, priceBand } from './money.js';
import { measureContractSegments, termsAt } from './work.js';

type Terms = EmploymentBundle['terms'][number];

/**
 * One step per allowance class any terms row of the period lists. The class's bands price the
 * monthly figure from the listed amount and the person on that row (`entry.amount` is the
 * contract's figure; VN's insurance-equivalent allowance prices itself from the wage); the walk
 * then prorates it. A class the person is not eligible for prices nothing. A class marked
 * `owed` (VN's insurance-equivalent allowance, LC art.168(3)) is priced for every employment its
 * eligibility admits, listed or not: the statute owes it without an HR row.
 */
export function prepareAllowanceSteps(
	options: Omit<MeasureComponentOptions, 'component' | 'entry'>
): readonly FamilyStep[] {
	const { bundle, configuration } = options;
	const listed = new Set<CatalogueComponent>();
	const withdrawn = new Set<string>();
	for (const terms of bundle.termsHistory)
		for (const row of listedAllowances(terms)) {
			const component = contractAllowanceClass(configuration, row.catalogue_id);
			if (component != null) listed.add(component);
			else if (!withdrawn.has(row.catalogue_id)) {
				// A class the period's version no longer offers: the contract still names it, and
				// nothing prices it — said aloud, since the payslip cannot show a missing line.
				withdrawn.add(row.catalogue_id);
				options.note({
					code: 'ALLOWANCE_SKIPPED',
					severity: 'WARNING',
					message:
						`${bundle.employment.employee_number}: the contract lists allowance class ` +
						`${row.catalogue_id}, which the jurisdiction version in force for ` +
						`${options.period} does not offer — nothing is paid for it.`,
					collection: 'employment_terms',
					recordId: String(terms.id)
				});
			}
		}
	const prorates = configuration.jurisdiction.payroll.allowance_npl_prorates === true;
	const engine = runtimeExpressionEngine({
		minimumWage: (region) =>
			placeWage(configuration.jurisdiction.work_rules.wages?.by_region ?? {}, region) ?? 0
	});
	return configuration.catalogueComponents
		.filter((component) => listed.has(component) || component.owed === true)
		.map((component) => ({
			item: component,
			calculate: () => {
				/**
				 * The person on the period's last day, over one terms row, with the registration
				 * facts of the day: a class's eligibility may read `facts.<CODE>.registered` (VN's
				 * insurance-equivalent allowance is owed to those outside the schemes).
				 */
				const subjectOn = (terms: Terms) =>
					personContext({
						employee: bundle.employee,
						employment: stint(bundle.employment, configuration.jurisdiction.exit_facts ?? []),
						fixedAllowances: contractAllowancesOn(bundle, configuration, options.salary.end),
						terms,
						children: bundle.children,
						company: configuration.company,
						// The salary window's leave, so a class's band can read what leave takes from it.
						period: options.leavePeriod?.() ?? null,
						facts: personFacts(
							configuration.contributions,
							factStatusesOn(
								bundle.statutoryFacts,
								options.salary.end,
								bundle.employment.id,
								configuration.contributions
							)
						),
						asOf: options.salary.end
					});
				const closing = termsAt(bundle, options.contracted.end);
				if (!isEligible(component.eligibility, subjectOn(closing))) {
					// An owed class no contract lists is simply not owed to this person.
					if (!listed.has(component)) return null;
					// A class on the contract the person is not eligible for leaves no line to explain
					// itself: the decision is reported so the operator sees it.
					options.note({
						code: 'ALLOWANCE_SKIPPED',
						severity: 'WARNING',
						message:
							`${bundle.employment.employee_number}: allowance ${component.code} is on the ` +
							`contract for ${options.period} and paid nothing — this employment does not ` +
							'satisfy the class’s eligibility rule.',
						collection: 'employment_terms',
						recordId: String(closing.id)
					});
					return null;
				}
				const monthlyOf = (terms: Terms): number => {
					const row = listedAllowances(terms).find(
						(entry) => contractAllowanceClass(configuration, entry.catalogue_id) === component
					);
					// An owed class prices itself from the person when no contract row lists it.
					if (row == null && component.owed !== true) return 0;
					const amount = row?.amount ?? 0;
					if (component.bands.length === 0) return amount;
					const subject = subjectOn(terms);
					const context = entryContext({
						entry: { amount, event_date: options.salary.start },
						subject,
						period: options.period,
						periodStart: options.salary.start,
						periodEnd: options.salary.end,
						instalments: options.instalments,
						daysEmployed: 0,
						daysInMonth: 0,
						ordinaryDay: options.rates.ordinaryDay,
						ordinaryHour: options.rates.ordinaryHour,
						limits: {},
						captures: { paidToDate: 0, remaining: 0 },
						year: options.year
					});
					return priceBand(component.bands, context, engine) ?? amount;
				};
				return measureContractSegments({
					component,
					bundle,
					configuration,
					salary: options.salary,
					employed: options.employed,
					contracted: options.contracted,
					workingDaysIn: options.workingDaysIn,
					contractOf: monthlyOf,
					contractPeriod: 'MONTH',
					// The class may overrule the version: a statute that keeps a travelling allowance
					// (SG EA s.2, MY s.2) out of the deduction's wage states false on the class.
					unpaidDaysIn: (component.npl_prorates ?? prorates) ? options.unpaidDaysIn : undefined
				});
			}
		}));
}
