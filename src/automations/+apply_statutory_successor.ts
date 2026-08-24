import { defineAutomation, type AutomationApi } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import { statutoryFactStatusValueSchema } from '../datatypes/statutory_fact_status/+definition.js';

export const ApplyStatutorySuccessorInputSchema = Schema.Struct({
	predecessor_fact_id: Schema.String,
	employment_id: Schema.String,
	successor_contribution_id: Schema.String,
	status: statutoryFactStatusValueSchema,
	effective_start: Schema.String,
	label: Schema.String
});

const ApplyStatutorySuccessorOutputSchema = Schema.Struct({
	status: Schema.Literals(['submitted', 'already_present']),
	label: Schema.String
});

type ApplyStatutorySuccessorInput = Schema.Schema.Type<typeof ApplyStatutorySuccessorInputSchema>;

/**
 * Submits one deterministic transition. The create hook stages the predecessor close, so Bolt sees
 * one graph containing the exact create and update records before it evaluates both policy grants.
 * A normal run therefore ends as `awaiting_approval`; approval settlement commits both rows or none.
 */
export const applyStatutorySuccessor = (api: AutomationApi, input: ApplyStatutorySuccessorInput) =>
	Effect.gen(function* () {
		const existing = yield* api.db.query.employment_statutory_facts.findFirst({
			where: {
				employment_id: { eq: input.employment_id },
				statutory_contribution_id: { eq: input.successor_contribution_id }
			}
		});
		if (existing != null) return { status: 'already_present' as const, label: input.label };

		yield* api.db.employment_statutory_facts.create({
			employment_id: input.employment_id,
			statutory_contribution_id: input.successor_contribution_id,
			supersedes_fact_id: input.predecessor_fact_id,
			status: input.status,
			effective_range: { start: input.effective_start, end: null }
		});
		return { status: 'submitted' as const, label: input.label };
	});

export default defineAutomation(
	{},
	{
		input: ApplyStatutorySuccessorInputSchema,
		output: ApplyStatutorySuccessorOutputSchema,
		policies: ['statutory_successor_automation'],
		description:
			'Validates and submits one effective-dated employment statutory successor for HR Manager approval.',
		handler: (api, context) => applyStatutorySuccessor(api, context.args)
	}
);
