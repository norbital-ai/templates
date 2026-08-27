import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { getErrorMessage } from '@norbital-ai/std/error';
import type { SettlementPolicy } from '../../datatypes/settlement_policy/+definition.js';
import {
	payCalendarInstalments,
	PAY_FREQUENCIES,
	type PayFrequency,
	type StoredPayCalendar
} from '../payroll_runs/lib/period.js';
import type { Hooks } from './$types.js';

function payCalendarTiles(
	calendar: StoredPayCalendar,
	frequency: PayFrequency
): Effect.Effect<void, never, never> {
	return Effect.forEach(
		['2026-01', '2026-02'],
		(period) =>
			Effect.try({
				try: () =>
					payCalendarInstalments(
						period,
						{ pay_cutoff_day: 1, pay_day: 1, pay_calendar: calendar },
						frequency
					),
				catch: (error) => error
			}).pipe(Effect.catch((error) => Effect.sync(() => refuse(getErrorMessage(error))))),
		{ discard: true }
	);
}

/**
 * A pay calendar that does not tile a month is refused before it is stored.
 *
 * The engine reads this on every run and refuses it there too, but a calendar whose instalments
 * overlap or leave a gap is a fact about the company, not about one run: stored, it would pay a day
 * twice or pay it never, every month, for everyone on that cadence, and the arithmetic would look
 * ordinary the whole time. Both a 31-day month and February are checked, because an instalment that
 * closes on the 30th tiles January and leaves February's last day to nobody.
 */
function assertPayCalendar(
	calendar: StoredPayCalendar | undefined
): Effect.Effect<void, never, never> {
	if (calendar == null) return Effect.void;
	const frequencyByValue = new Map<string, PayFrequency>(
		PAY_FREQUENCIES.map((frequency) => [frequency, frequency])
	);
	return Effect.forEach(
		calendar,
		(entry): Effect.Effect<void, never, never> => {
			const frequency = frequencyByValue.get(entry.pay_frequency);
			if (frequency === undefined)
				return refuse(
					`pay_calendar states a calendar for "${String(entry.pay_frequency)}", which is not a pay ` +
						'frequency any employment terms can carry.'
				);
			if (frequency === 'MONTHLY')
				return refuse(
					'pay_calendar cannot state a MONTHLY calendar: pay_cutoff_day and pay_day are the ' +
						'monthly calendar, and two places to write one fact is two places for them to disagree.'
				);
			return payCalendarTiles(calendar, frequency);
		},
		{ discard: true }
	);
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
		NonNullable<NonNullable<NonNullable<Hooks['mutate']>['perRecord']>['before']>['handler']
	>[0]['api']
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		if (policy == null) return;
		const { late_joiner_arrears, extended_unpaid_leave } = policy;

		const componentId = late_joiner_arrears?.defer_to_component_id;
		if (componentId != null) {
			const component = yield* api.db.pay_components.findFirst({
				where: { id: { eq: componentId } }
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
			const contribution = yield* api.db.statutory_contributions.findFirst({
				where: { id: { eq: contributionId } }
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
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses a company whose pay calendar does not tile a month or restates the monthly calendar, and whose settlement policy defers late-joiner arrears to a pay component that does not exist or cannot carry an entry, or names an unknown statutory contribution as the extended-unpaid-leave population. Both are re-checked whenever either column is edited, so a cadence cannot be left with a month it half covers.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						// Guarding on `!== undefined` rather than on whether this is a create: a create that
						// states no calendar has nothing to check, and an update that does not touch the
						// column must not be refused for a value it never sent.
						if (input.pay_calendar !== undefined) yield* assertPayCalendar(input.pay_calendar);
						if (input.settlement_policy !== undefined)
							yield* assertReferences(input.settlement_policy, api);
						return input;
					})
			}
		}
	}
} satisfies Hooks;
