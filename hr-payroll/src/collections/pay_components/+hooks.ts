import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { compileEligibility } from '../payroll_runs/lib/eligibility.js';
import { refuseUnlessDraftOnBoth } from '../../lib/settings_seal.js';
import type { Hooks } from './$types.js';

/** The two catalogue rows the overtime regime prices; nothing else may be derived overtime. */
export const DERIVED_OVERTIME_CODES = ['OVERTIME', 'OVERTIME_EXCESS'] as const;

/**
 * Pay components are the catalogue of one jurisdiction settings version. The row is the whole
 * mechanism: its eligibility expression decides who receives it, its definition decides how the
 * number is produced, and its contribution treatments decide what every statutory scheme does
 * with the money. The row is sealed with its version: once sealed, no create, edit or delete.
 *
 * A malformed expression is refused here the same way a bad formula is. A treatment keyed by a
 * scheme code the version does not levy is refused too: the map would otherwise carry a decision
 * nothing ever reads while the scheme that is levied stays undecided.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses any write once the jurisdiction settings version is sealed; compiles the eligibility expression and every claim-cap layer, requires derived overtime to sit on the OVERTIME and OVERTIME_EXCESS rows only, and refuses a contribution treatment keyed by a scheme code the version does not levy.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const row = { ...existing, ...input };
						const code = String(row.code ?? '');
						yield* refuseUnlessDraftOnBoth(
							api,
							existing?.settings_id,
							input.settings_id,
							`Pay component ${code}`
						);
						const problem = compileEligibility(row.eligibility);
						if (problem != null) refuse(problem);
						if (row.definition?.source === 'ENTRY' && row.definition.cap != null)
							for (const layer of row.definition.cap.matrix.layers) {
								const layerProblem = compileEligibility(layer.eligibility);
								if (layerProblem != null) refuse(`Claim cap layer: ${layerProblem}`);
							}
						const derived = (DERIVED_OVERTIME_CODES as readonly string[]).includes(code);
						if (row.definition?.source === 'DERIVED_OVERTIME' && !derived)
							refuse(
								`${code} cannot be derived overtime: only ${DERIVED_OVERTIME_CODES.join(' and ')} are ` +
									'priced by the overtime regime.'
							);
						if (derived && row.definition != null && row.definition.source !== 'DERIVED_OVERTIME')
							refuse(
								`${code} is priced by the overtime regime, so its definition is DERIVED_OVERTIME.`
							);
						const treatments = row.contribution_treatments ?? {};
						const codes = Object.keys(treatments);
						// Nested under its version in one write, the row has no parent key yet; see below.
						if (codes.length === 0 || row.settings_id == null) return input;
						const schemes = yield* api.db.statutory_contributions.findMany({
							where: {
								settings_id: { eq: String(row.settings_id) },
								approval_id: { isNull: true }
							},
							columns: { code: true },
							limit: 500
						});
						// A version created in one write carries its schemes beside its catalogue, and a
						// nested row cannot read its siblings: with no scheme stored yet the map is taken
						// as it is, and PICK refuses by name at the first run if a levied scheme is undecided.
						if (schemes.length === 0) return input;
						const levied = new Set(schemes.map((scheme) => scheme.code));
						for (const schemeCode of codes)
							if (!levied.has(schemeCode))
								refuse(
									`${code} states a ${schemeCode} treatment, but this settings version levies no ` +
										`scheme coded ${schemeCode}.`
								);
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a pay component once its jurisdiction settings version is sealed.',
				handler: ({ existing, api }) =>
					refuseUnlessDraftOnBoth(
						api,
						existing.settings_id,
						undefined,
						`Pay component ${existing.code}`
					)
			}
		}
	}
} satisfies Hooks;
