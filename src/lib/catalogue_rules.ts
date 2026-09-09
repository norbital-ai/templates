/**
 * What every money catalogue row must satisfy before it is stored: its settings version is still a
 * draft, its own predicate compiles, so does the predicate of every entitlement band, and every
 * special treatment names a rule. Refused here, at the write, rather than at the run where the
 * person who typed it is long gone. The four catalogue hooks are this function and a noun.
 */

import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { compileEligibility } from '../collections/payroll_runs/lib/eligibility.js';
import type { EntitlementCap } from '../datatypes/entitlement_cap/+definition.js';
import type { ContributionTreatments } from '../datatypes/contribution_treatments/+definition.js';
import { refuseUnlessDraftOnBoth } from './settings_seal.js';

type CatalogueRowLike = {
	readonly settings_id?: unknown;
	readonly code?: unknown;
	readonly eligibility?: string | null;
	readonly cap?: EntitlementCap | null;
	readonly contribution_treatments?: ContributionTreatments | null;
};

function catalogueRowProblem(row: CatalogueRowLike): string | null {
	const own = compileEligibility(row.eligibility);
	if (own != null) return own;
	for (const [index, band] of (row.cap?.bands ?? []).entries()) {
		const problem = compileEligibility(band.eligibility);
		if (problem != null) return `Entitlement band ${index + 1}: ${problem}`;
	}
	for (const [code, cell] of Object.entries(row.contribution_treatments ?? {}))
		if (cell.kind === 'SPECIAL' && cell.rule.trim() === '')
			return `${code} is charged by a special rule, but the treatment names none.`;
	return null;
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
