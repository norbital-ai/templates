import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { SettlementPolicy } from '../../datatypes/settlement_policy/+definition.js';
import {
	payCalendarInstalments,
	PAY_FREQUENCIES,
	type PayFrequency,
	type StoredPayCalendar
} from '../payroll_runs/lib/period.js';
import type { Hooks } from './$types.js';

/**
 * A pay calendar that does not tile a month is refused before it is stored.
 *
 * The engine reads this on every run and refuses it there too, but a calendar whose instalments
 * overlap or leave a gap is a fact about the company, not about one run: stored, it would pay a day
 * twice or pay it never, every month, for everyone on that cadence, and the arithmetic would look
 * ordinary the whole time. Both a 31-day month and February are checked, because an instalment that
 * closes on the 30th tiles January and leaves February's last day to nobody.
 */
function assertPayCalendar(calendar: StoredPayCalendar | undefined): void {
	if (calendar == null) return;
	for (const entry of calendar) {
		const frequency: PayFrequency | undefined = PAY_FREQUENCIES.find(
			(candidate) => candidate === entry.pay_frequency
		);
		if (frequency === undefined)
			refuse(
				`pay_calendar states a calendar for "${String(entry.pay_frequency)}", which is not a pay ` +
					'frequency any employment terms can carry.'
			);
		else if (frequency === 'MONTHLY')
			refuse(
				'pay_calendar cannot state a MONTHLY calendar: pay_cutoff_day and pay_day are the ' +
					'monthly calendar, and two places to write one fact is two places for them to disagree.'
			);
		else
			for (const period of ['2026-01', '2026-02']) {
				try {
					payCalendarInstalments(
						period,
						{ pay_cutoff_day: 1, pay_day: 1, pay_calendar: calendar },
						frequency
					);
				} catch (error) {
					refuse(error instanceof Error ? error.message : String(error));
				}
			}
	}
}

/**
 * `settlement_policy` is a variant, and a variant cannot be a foreign key — so the two ids inside
 * it are checked here instead of by a constraint.
 *
 * Both checks matter for a different reason than tidiness. `defer_to_component_id` names the
 * component a deferred joining period is paid out on; if it named nothing real, payroll would defer
 * a wage and then have nowhere to put it, and the money would disappear between two runs rather
 * than fail loudly. `population_contribution_id` names the scheme whose enrolment selects the
 * population an extended-leave rule applies to; a stale id there silently empties the population,
 * and a rule that quietly applies to nobody is worse than one that is switched off.
 */
function assertReferences(
	policy: SettlementPolicy | null | undefined,
	api: Parameters<
		NonNullable<NonNullable<NonNullable<Hooks['create']>['perRecord']>['before']>['handler']
	>[0]['api']
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		if (policy == null) return;
		const { late_joiner_arrears, extended_unpaid_leave } = policy;

		const componentId = late_joiner_arrears?.defer_to_component_id;
		if (componentId != null) {
			const component = yield* api.db.query.pay_components.findFirst({
				where: { norbital_id: { eq: componentId } }
			});
			if (!component)
				refuse(
					`settlement_policy.late_joiner_arrears.defer_to_component_id ${componentId} is not a pay component.`
				);
			else if (component.definition?.source !== 'ENTRY')
				refuse(
					`Pay component ${component.code} is measured from ${String(component.definition?.source)}, ` +
						'so no entry can be written against it. A deferred joining period arrives as an arrears ' +
						'entry, which only an ENTRY component can carry.'
				);
		}

		const contributionId = extended_unpaid_leave?.population_contribution_id;
		if (contributionId != null) {
			const contribution = yield* api.db.query.statutory_contributions.findFirst({
				where: { norbital_id: { eq: contributionId } }
			});
			if (!contribution)
				refuse(
					`settlement_policy.extended_unpaid_leave.population_contribution_id ${contributionId} ` +
						'is not a statutory contribution.'
				);
		}
	});
}

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Refuses a company whose pay calendar does not tile a month, restates the monthly calendar, or whose settlement policy defers late-joiner arrears to a pay component that does not exist or cannot carry an entry, or names an unknown statutory contribution as the extended-unpaid-leave population.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						assertPayCalendar(input.pay_calendar);
						yield* assertReferences(input.settlement_policy, api);
						return input;
					})
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Re-checks the company pay calendar and settlement policy whenever either is edited, so a cadence cannot be left with a month it half covers and an arrears component or extended-leave contribution scheme cannot be pointed at an id that no longer resolves.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						if (input.pay_calendar !== undefined) assertPayCalendar(input.pay_calendar);
						if (input.settlement_policy !== undefined)
							yield* assertReferences(input.settlement_policy, api);
						return input;
					})
			}
		}
	}
} satisfies Hooks;
