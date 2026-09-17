import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { compileEligibility } from '../payroll_runs/lib/eligibility.js';
import { refuseUnlessDraftOnBoth, versionsById } from '../../lib/settings_seal.js';

const columns = {
	settings_id: true,
	code: true,
	name: true,
	authority: true,
	eligibility: true,
	evidence: true,
	is_npl: true,
	can_encash: true,
	evidence_after_days: true,
	entitlement: true
} as const;

/**
 * Sealed catalogue revisions remain the historical rules used by entitlement queries: a row of a
 * sealed version refuses create and update here, and delete through the grant. The eligibility
 * expression and every entitlement band predicate compile against the person context.
 */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.map(
			versionsById(db, [
				...inputs.map((input) => input.settings_id),
				...existing.map((row) => row?.settings_id)
			]),
			(versions) =>
				inputs.map((input, index) => {
					const stored = existing[index];
					const row = { ...stored, ...input };
					refuseUnlessDraftOnBoth(
						versions,
						stored?.settings_id,
						input.settings_id,
						`Leave ${String(row.code ?? '')}`
					);
					const problem = compileEligibility(row.eligibility);
					if (problem != null) refuse(problem);
					for (const band of row.entitlement?.bands ?? []) {
						const bandProblem = compileEligibility(band.eligibility);
						if (bandProblem != null) refuse(`Entitlement band: ${bandProblem}`);
					}
					return input;
				})
		)
});
