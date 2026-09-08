import { consumedTermsThrough, withContractInput } from '../../lib/employment-contract.js';
import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { readRange } from '../payroll_runs/lib/effective.js';
import { dateKey } from '../../lib/iso-day.js';
import { stableJson } from '../../lib/jurisdiction_settings.js';
import type { Hooks } from './$types.js';

/** The model's exclusion constraint enforces non-overlap on every write, including batches. */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Preserve consumed term history; amend an unconsumed future portion by closing its range and creating a successor within the same contract.',
				handler: ({ input, existing, parent, api }) =>
					Effect.gen(function* () {
						const enclosingId =
							parent?.collection === 'employments' && parent.column === 'employment_id'
								? parent.id
								: undefined;
						const employmentId = input.employment_id ?? existing?.employment_id ?? enclosingId;
						if (!employmentId) refuse('Employment terms must reference an employment contract.');
						if (enclosingId != null && employmentId !== enclosingId)
							refuse('Nested terms must use their enclosing employment contract.');
						const result = withContractInput({ ...input, employment_id: employmentId }, existing);
						const range = readRange(input.effective_range ?? existing?.effective_range);
						if (!range || (range.end != null && dateKey(range.end) < dateKey(range.start)))
							refuse('Employment terms need an ordered inclusive effective range.');
						const through = yield* consumedTermsThrough(api, employmentId);
						if (through == null) return result;
						const prior = existing == null ? null : readRange(existing.effective_range);
						if (prior == null || dateKey(prior.start) > through) {
							if (dateKey(range.start) <= through)
								refuse(
									`Employment terms through ${through} are consumed. A successor must start later; historical gaps cannot be filled.`
								);
							return result;
						}
						const changedFacts = Object.entries(input).some(
							([key, value]) =>
								!['id', 'row_version', 'effective_range'].includes(key) &&
								stableJson(value) !== stableJson(Reflect.get(existing!, key))
						);
						if (changedFacts || dateKey(range.start) !== dateKey(prior.start))
							refuse(
								`Employment terms through ${through} are consumed. Keep their facts and create a future successor.`
							);
						const priorEnd = prior.end == null ? null : dateKey(prior.end);
						const nextEnd = range.end == null ? null : dateKey(range.end);
						if (
							nextEnd !== priorEnd &&
							(nextEnd == null || nextEnd < through || (priorEnd != null && nextEnd > priorEnd))
						)
							refuse(
								`An amendment may only close the unconsumed portion after ${through}; consumed dates must remain covered.`
							);
						return result;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Retain terms that supplied consumed contract history, even after the consumer is removed.',
				handler: ({ existing, api }) =>
					Effect.gen(function* () {
						const through = yield* consumedTermsThrough(api, existing.employment_id);
						const range = readRange(existing.effective_range);
						if (through != null && (range == null || dateKey(range.start) <= through))
							refuse(`Employment terms through ${through} are consumed and cannot be deleted.`);
					})
			}
		}
	}
} satisfies Hooks;
