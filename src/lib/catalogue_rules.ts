/**
 * What every catalogue row must satisfy before it is stored: its settings version is still a
 * draft, its own predicate compiles, and every statutory opt-in names a scheme of that version.
 * The bands' expressions and the entitlement amounts are compiled by their own datatype schemas,
 * so they are already refused by the time this runs. Refused at the write, rather than at the run
 * where the person who typed it is long gone.
 */

import { Effect } from 'effect';
import { refuse, type Api } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import { compileEligibility } from '../collections/payroll_runs/lib/eligibility.js';
import { refuseUnlessDraftOnBoth } from './settings_seal.js';
import type { StatutoryOptIn } from '../datatypes/work_rules/+definition.js';

type CatalogueRowLike = {
	readonly settings_id?: unknown;
	readonly code?: unknown;
	readonly eligibility?: string | null;
	readonly bands?: readonly { readonly statutory_opt_ins?: readonly StatutoryOptIn[] }[];
};

/** The read surface the opt-in FK check needs; a wide api satisfies it structurally. */
type OptInReadApi = Readonly<{
	readonly db: Pick<
		Api<WorkspaceSchema, unknown>['db'],
		'jurisdiction_settings' | 'statutory_contributions'
	>;
}>;

function catalogueRowProblem(row: CatalogueRowLike): string | null {
	return compileEligibility(row.eligibility);
}

/**
 * The `contribution_id`s one row states, wherever it carries them: a catalogue's bands, a work
 * band, or the engine lines.
 */
export function optInsOfBands(
	bands: readonly { readonly statutory_opt_ins?: readonly StatutoryOptIn[] }[] | null | undefined
): readonly StatutoryOptIn[] {
	return (bands ?? []).flatMap((band) => band.statutory_opt_ins ?? []);
}

/**
 * Every opt-in must name a scheme of the row's own settings version (RFC 0002 §6): the id is a
 * foreign key, and a version that does not carry the scheme can never charge the line. The write
 * refuses, so a stale id cannot reach a payroll where ACCUMULATE would silently ignore it.
 */
export function refuseUnknownOptIns(
	api: OptInReadApi,
	settingsId: unknown,
	optIns: readonly StatutoryOptIn[],
	what: string
): Effect.Effect<void> {
	if (settingsId == null || settingsId === '' || optIns.length === 0) return Effect.void;
	const ids = [...new Set(optIns.map((row) => row.contribution_id))];
	return Effect.map(
		api.db.statutory_contributions.findMany({
			where: {
				settings_id: { eq: String(settingsId) },
				id: { in: ids },
				approval_id: { isNull: true }
			},
			columns: { id: true },
			limit: 500
		}),
		(rows) => {
			const known = new Set(rows.map((row) => row.id));
			for (const id of ids)
				if (!known.has(id))
					refuse(
						`${what} opts into a statutory scheme that is not part of its settings version. ` +
							'Add the scheme to that version first, or remove the opt-in.'
					);
		}
	);
}

/** The mutate hook of a money catalogue: the input back, or a refusal naming the row. */
export const admitCatalogueRow = <TInput extends CatalogueRowLike>(
	api: OptInReadApi,
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
		yield* refuseUnknownOptIns(
			api,
			row.settings_id,
			optInsOfBands(row.bands),
			`${noun} ${String(row.code ?? '')}`
		);
		return input;
	});
