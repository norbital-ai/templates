import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { stableJson } from '../../lib/jurisdiction_settings.js';
import { dateKey } from '../../lib/iso-day.js';
import { resolveEmployment } from '../../lib/employment-contract.js';
import { leaveTermsThrough } from '../../lib/leave/activity.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Permanently seal the referenced contract in the same transaction as its consumer.',
				handler: ({ input, existing, api, parent }) =>
					Effect.gen(function* () {
						if (existing != null) {
							if (
								Object.entries(input).some(
									([key, value]) =>
										key !== 'id' &&
										key !== 'row_version' &&
										stableJson(value) !== stableJson(Reflect.get(existing, key))
								)
							)
								refuse('Employment contract input seals cannot be changed.');
							return input;
						}
						const employment = yield* api.db.employments.findFirst({
							where: { id: { eq: input.employment_id! } },
							with: { employment_departure: { where: { approval_id: { isNull: true } } } }
						});
						if (
							parent != null &&
							'employment_id' in parent.values &&
							parent.values.employment_id !== input.employment_id
						)
							refuse('An input seal must belong to its consumer’s employment contract.');
						const through = input.terms_through == null ? null : dateKey(input.terms_through);
						if (
							parent?.collection === 'work_days' &&
							through !== dateKey(parent.values.work_date ?? '')
						)
							refuse('A Work input must seal its actual work date.');
						if (parent?.collection === 'leave_entries') {
							if (!parent.values.event || !parent.values.charges || !employment)
								refuse('A Leave input needs its approved event, charges and contract.');
							const exit = resolveEmployment(employment).exit_date;
							const expected = leaveTermsThrough(
								parent.values.event,
								parent.values.charges,
								exit == null ? null : dateKey(exit)
							);
							if (through !== expected)
								refuse('A Leave input must seal its actual charge or debit valuation date.');
						}
						if (parent?.collection === 'payslips' && through == null)
							refuse('A payroll input must seal its consumed term dates.');
						if (through != null) {
							// Guard the terms collection too: insertion into a historical gap must race with
							// consumption just as edits to an existing term do. No row is written by a preview.
							const terms = yield* api.db.employment_terms.findMany({
								where: { employment_id: { eq: input.employment_id! } },
								columns: { id: true, effective_range: true },
								limit: 20_000
							});
							if (terms.length >= 20_000)
								refuse('Too many employment terms to capture their history safely.');
						}
						// The source many edge supplies its identifier during graph expansion. Reading the
						// contract guards a simultaneous edit against the revision this consumer will use.
						// The foreign key verifies existence at commit, including a contract created in this graph.
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Preserve contract seals even after the original consumer is removed.',
				handler: () => refuse('Employment contract input seals cannot be deleted.')
			}
		}
	}
} satisfies Hooks;
