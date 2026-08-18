import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { SettlementPolicy } from '../../custom-types/settlement_policy/+definition.js';
import type { Hooks } from './$types.js';

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
	api: Parameters<NonNullable<NonNullable<Hooks['create']>['before']>['handler']>[0]['api']
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
		before: {
			description:
				'Refuses a company whose settlement policy defers late-joiner arrears to a pay component that does not exist or cannot carry an entry, or names an unknown statutory contribution as the extended-unpaid-leave population.',
			handler: ({ input, api }) =>
				Effect.gen(function* () {
					yield* assertReferences(input.settlement_policy, api);
					return input;
				})
		}
	},
	update: {
		before: {
			description:
				'Re-checks the company settlement policy whenever it is edited, so an arrears component or extended-leave contribution scheme cannot be pointed at an id that no longer resolves.',
			handler: ({ input, api }) =>
				Effect.gen(function* () {
					if (input.settlement_policy !== undefined)
						yield* assertReferences(input.settlement_policy, api);
					return input;
				})
		}
	}
} satisfies Hooks;
