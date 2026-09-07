import { refuse, type Api } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceSchema } from '$bolt/types.js';
import { refuseUnlessDraft } from '../../lib/settings_seal.js';
import type { Hooks } from './$types.js';

/**
 * Contribution bands belong to a jurisdiction settings version through their scheme and are
 * sealed with it.
 *
 * The two-dimensional selector overlap the database enforces (`contribution_rates_no_overlap`)
 * needs no hook: it fails first with a caller-facing refusal whatever path the write takes. What
 * the hook holds is the **seal**: a band of a scheme whose version is sealed refuses create,
 * update and delete, because a rate a paid run was charged under cannot be rewritten. A band that
 * moves between schemes is checked against both.
 */
type SealApi = Readonly<{
	readonly db: Pick<
		Api<WorkspaceSchema, unknown>['db'],
		'jurisdiction_settings' | 'statutory_contributions'
	>;
}>;

const refuseUnlessSchemeDraft = (api: SealApi, schemeId: unknown): Effect.Effect<void> =>
	Effect.gen(function* () {
		// Nested under its scheme in one write, a band reaches this before the runtime stamps the
		// parent key; the scheme's own hook has already been judged against the root.
		if (schemeId == null) return;
		const scheme = yield* api.db.statutory_contributions.findFirst({
			where: { id: { eq: String(schemeId) } },
			columns: { settings_id: true, code: true }
		});
		if (scheme == null) refuse('The statutory contribution this band names does not exist.');
		yield* refuseUnlessDraft(api, scheme.settings_id, `A band of scheme ${scheme.code}`);
	});

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses any write on a contribution band whose scheme belongs to a sealed jurisdiction settings version; bands of a draft may be prepared and edited until the seal.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const schemes = [
							...new Set(
								[existing?.statutory_contribution_id, input.statutory_contribution_id].filter(
									(id) => id != null
								)
							)
						];
						for (const schemeId of schemes) yield* refuseUnlessSchemeDraft(api, schemeId);
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a contribution band whose scheme belongs to a sealed jurisdiction settings version.',
				handler: ({ existing, api }) =>
					refuseUnlessSchemeDraft(api, existing.statutory_contribution_id)
			}
		}
	}
} satisfies Hooks;
