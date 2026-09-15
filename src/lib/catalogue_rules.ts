/**
 * What every catalogue row must satisfy before it is stored: its settings version is still a
 * draft and its own predicate compiles. The bands' expressions and the entitlement amounts are
 * compiled by their own datatype schemas, so they are already refused by the time this runs.
 *
 * What every scheme's base must satisfy: each entry names a catalogue row of the scheme's own
 * settings version (RFC 0003 §1.4). Refused at the write, rather than at the run where the person
 * who typed it is long gone.
 */

import { Effect } from 'effect';
import { refuse, type Api } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import { compileEligibility } from '../collections/payroll_runs/lib/eligibility.js';
import { refuseUnlessDraftOnBoth } from './settings_seal.js';
import {
	BASE_ENTRY_FAMILIES,
	type BaseEntryFamily,
	type ContributionBase
} from '../datatypes/contribution_base/+definition.js';

type CatalogueRowLike = {
	readonly settings_id?: unknown;
	readonly code?: unknown;
	readonly eligibility?: string | null;
};

/** The read surface the write gates need; a wide api satisfies it structurally. */
type CatalogueWriteApi = Readonly<{
	readonly db: Pick<
		Api<WorkspaceSchema, unknown>['db'],
		| 'jurisdiction_settings'
		| 'statutory_contributions'
		| 'leave_catalogue'
		| 'allowance_catalogue'
		| 'claim_catalogue'
		| 'payment_catalogue'
		| 'loan_catalogue'
	>;
}>;

/** The codes of one family's rows in one version, among those asked for. */
function knownCodes(
	api: CatalogueWriteApi,
	family: BaseEntryFamily,
	settingsId: string,
	codes: readonly string[]
): Effect.Effect<ReadonlySet<string>> {
	const query = {
		where: {
			settings_id: { eq: settingsId },
			code: { in: [...codes] },
			approval_id: { isNull: true }
		},
		columns: { code: true },
		limit: 500
	} as const;
	// Every family's rows live in `<family>_catalogue`: one naming rule, no table per case. The
	// five tables differ in every column but `code`, which is the one this query reads, so one
	// table's signature stands for all of them.
	const table = `${family.toLowerCase()}_catalogue` as `${Lowercase<BaseEntryFamily>}_catalogue`;
	const rows = (api.db[table] as CatalogueWriteApi['db']['leave_catalogue']).findMany(query);
	return Effect.map(rows, (found) => new Set(found.map((row) => row.code)));
}

/**
 * Every entry of a scheme's base names a row of the scheme's own settings version. The write
 * refuses, so a code the version does not carry cannot reach a payroll where ACCUMULATE would
 * silently admit nothing under it.
 */
export function refuseUnknownBaseEntries(
	api: CatalogueWriteApi,
	settingsId: unknown,
	base: ContributionBase,
	what: string
): Effect.Effect<void> {
	if (settingsId == null || settingsId === '' || base.entries.length === 0) return Effect.void;
	return Effect.gen(function* () {
		for (const family of BASE_ENTRY_FAMILIES) {
			const codes = [
				...new Set(base.entries.filter((entry) => entry.family === family).map((row) => row.code))
			];
			if (codes.length === 0) continue;
			const known = yield* knownCodes(api, family, String(settingsId), codes);
			for (const code of codes)
				if (!known.has(code))
					refuse(
						`${what} charges ${family} ${code}, which is not a row of its settings version. ` +
							'Add the row to that version first, or take it out of the base.'
					);
		}
	});
}

/** The mutate hook of a money catalogue: the input back, or a refusal naming the row. */
export const admitCatalogueRow = <TInput extends CatalogueRowLike>(
	api: CatalogueWriteApi,
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
		const problem = compileEligibility(row.eligibility);
		if (problem != null) refuse(problem);
		return input;
	});
