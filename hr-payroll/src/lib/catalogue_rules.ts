/**
 * What every catalogue row must satisfy before it is stored: its settings version is still a
 * draft and its own predicate compiles. The bands' expressions and the entitlement amounts are
 * compiled by their own datatype schemas, so they are already refused by the time this runs.
 * Refused at the write, rather than at the run where the person who typed it is long gone.
 */

import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { compileEligibility } from '../collections/payroll_runs/lib/eligibility.js';
import { refuseUnlessDraftOnBoth } from './settings_seal.js';

type CatalogueRowLike = {
	readonly settings_id?: unknown;
	readonly code?: unknown;
	readonly eligibility?: string | null;
};

function catalogueRowProblem(row: CatalogueRowLike): string | null {
	return compileEligibility(row.eligibility);
}

/** The mutate hook of a money catalogue: the input back, or a refusal naming the row. */
export const admitCatalogueRow = <TInput extends CatalogueRowLike>(
	api: Parameters<typeof refuseUnlessDraftOnBoth>[0],
	input: TInput,
	existing: CatalogueRowLike | undefined,
	noun: string
): Effect.Effect<TInput> =>
	Effect.gen(function* () {
		const row = { ...existing, ...input };
		yield* refuseUnlessDraftOnBoth(
			api,
			existing?.settings_id,
			input.settings_id,
			`${noun} ${String(row.code ?? '')}`
		);
		const problem = catalogueRowProblem(row);
		if (problem != null) refuse(problem);
		return input;
	});
