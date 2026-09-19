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

import { decodeNumber } from '@norbital-ai/std/json';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import { isEligible, personContext } from '../../collections/payroll_runs/lib/eligibility.js';
import { stint } from '../employment-contract.js';
import {
	contractAllowanceClass,
	contractAllowancesOn,
	listedAllowances
} from './contract-allowances.js';
import { factStatusesOn, personFacts } from './facts.js';
import { runtimeExpressionEngine } from '../expressions/evaluate.js';
import type { CatalogueComponent } from '../../collections/payroll_runs/lib/configuration.js';
import type { FamilyStep, MeasureComponentOptions } from './family.js';
import { entryContext, priceBand } from './money.js';
import { measureContractSegments, termsAt } from './work.js';

type Terms = EmploymentBundle['terms'][number];

/**
 * One step per allowance class any terms row of the period lists. The class's bands price the
 * monthly figure from the listed amount and the person on that row (`entry.amount` is the
 * contract's figure; VN's insurance-equivalent allowance prices itself from the wage); the walk
 * then prorates it. A class the person is not eligible for prices nothing.
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
			decodeNumber(configuration.jurisdiction.work_rules.wages?.by_region?.[region] ?? 0)
	});
	return configuration.catalogueComponents
		.filter((component) => listed.has(component))
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
						employment: stint(bundle.employment),
						fixedAllowances: contractAllowancesOn(bundle, configuration, options.salary.end),
						terms,
						children: bundle.children,
						company: configuration.company,
						facts: personFacts(
							configuration.contributions,
							factStatusesOn(bundle.statutoryFacts, options.salary.end)
						),
						asOf: options.salary.end
					});
				const closing = termsAt(bundle, options.contracted.end);
				if (!isEligible(component.eligibility, subjectOn(closing))) {
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
					if (row == null) return 0;
					const amount = decodeNumber(row.amount);
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
					unpaidDaysIn: prorates ? options.unpaidDaysIn : undefined
				});
			}
		}));
}
