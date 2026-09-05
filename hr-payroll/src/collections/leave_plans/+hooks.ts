import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { readRange } from '../payroll_runs/lib/effective.js';
import type { Hooks } from './$types.js';

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Keeps leave-plan history forward-only: DRAFT versions are editable, activation is the reviewed seal, and an ACTIVE or RETIRED version cannot be rewritten.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						if (existing == null) {
							if (input.lifecycle != null && input.lifecycle !== 'DRAFT')
								refuse('A leave plan is created as DRAFT and activated through policy approval.');
							return input;
						}
						const nextLifecycle = input.lifecycle ?? existing.lifecycle;
						if (
							input.lifecycle != null &&
							input.lifecycle !== existing.lifecycle &&
							!(
								(existing.lifecycle === 'DRAFT' && nextLifecycle === 'ACTIVE') ||
								(existing.lifecycle === 'ACTIVE' && nextLifecycle === 'RETIRED')
							)
						)
							refuse('A leave plan moves DRAFT → ACTIVE → RETIRED only.');
						if (existing.lifecycle !== 'DRAFT') {
							for (const field of [
								'company_id',
								'code',
								'name',
								'effective_range',
								'supersedes_id',
								'transition',
								'change_note'
							] as const)
								if (field in input && !same(input[field], existing[field]))
									refuse(
										`The ${existing.lifecycle} leave plan is sealed. Create a successor DRAFT to change ${field}.`
									);
						}
						if (nextLifecycle === 'RETIRED') return input;
						const predecessorId = input.supersedes_id ?? existing.supersedes_id;
						if (predecessorId == null) return input;
						const predecessor = yield* api.db.leave_plans.findFirst({
							where: { id: { eq: predecessorId }, approval_id: { isNull: true } }
						});
						if (predecessor == null || predecessor.lifecycle !== 'ACTIVE')
							refuse('A successor leave plan must follow an approved ACTIVE plan.');
						if (predecessor.company_id !== (input.company_id ?? existing.company_id))
							refuse('A successor leave plan stays within the same legal entity.');
						const range = readRange(input.effective_range ?? existing.effective_range);
						const priorRange = readRange(predecessor.effective_range);
						if (range == null || priorRange == null || range.start <= priorRange.start)
							refuse('A successor leave plan must start after its predecessor.');
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Only an unapproved DRAFT leave plan may be deleted.',
				handler: ({ existing }) => {
					if (existing.lifecycle !== 'DRAFT' || existing.approval_id != null)
						refuse('An activated leave plan is permanent history.');
				}
			}
		}
	}
} satisfies Hooks;
