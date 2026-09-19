import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { refuseUnlessDraftOnBoth, versionsById } from '../../lib/settings_seal.js';
import {
	catalogueCodesByVersion,
	refuseUnknownAssessedOnMentions,
	schemeFault
} from '../../lib/catalogue_rules.js';
import { orderSchemes } from '../payroll_runs/lib/mentions.js';

const columns = {
	settings_id: true,
	code: true,
	name: true,
	authority: true,
	assessment_period: true,
	assessment_scope: true,
	elections: true,
	employee_share_annual_cap: true,
	shared_cap_group: true,
	project_relief_annually: true,
	rules: true,
	assessed_on: true,
	ordinary_on: true,
	parts: true,
	short_name: true,
	listing_order: true,
	listing_group: true
} as const;

const LIMIT = 500;

/**
 * Statutory schemes are rows of one jurisdiction settings version and are sealed with it.
 *
 * The version's period is when the scheme governs; per-scheme effective dating is gone. What the
 * transform holds is the **seal**: a scheme of a sealed version refuses create and update,
 * because a contribution rule a paid run was charged under cannot be rewritten. A change of law
 * is a new version of the settings. Delete under a seal, or of a producer another scheme still
 * names, is refused by the delete grant (`settingsCatalogueGrants`).
 *
 * While the version is a draft the transform also holds the dependency contract: every expression
 * compiles, every `produced.<code>` mention names a scheme of this version, and the mentions do
 * not close a loop.
 */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const settingsIds = [
				...inputs.map((input) => input.settings_id),
				...existing.map((row) => row?.settings_id)
			];
			const versionIds = [...new Set(settingsIds.filter((id): id is string => id != null))];
			// One wave: the versions, their money catalogues and their stored schemes together.
			const [versions, catalogues, stored] = yield* Effect.all(
				[
					versionsById(db, settingsIds),
					catalogueCodesByVersion(db, settingsIds),
					versionIds.length === 0
						? Effect.succeed([])
						: db.statutory_contributions.findMany({
								where: { settings_id: { in: versionIds }, approval_id: { isNull: true } },
								columns: {
									id: true,
									settings_id: true,
									code: true,
									rules: true,
									assessed_on: true
								},
								limit: LIMIT
							})
				],
				{ concurrency: 'unbounded' }
			);
			return inputs.map((input, index) => {
				const row = { ...existing[index], ...input };
				const what = `Scheme ${String(row.code ?? '')}`;
				refuseUnlessDraftOnBoth(versions, existing[index]?.settings_id, input.settings_id, what);
				const rules = row.rules ?? [];
				const assessedOn = String(row.assessed_on ?? '');
				const fault = schemeFault({
					rules,
					assessed_on: assessedOn,
					ordinary_on: String(row.ordinary_on ?? ''),
					elections: row.elections ?? [],
					parts: row.parts ?? []
				});
				if (fault != null) refuse(fault);
				const settingsId = row.settings_id;
				if (settingsId == null || settingsId === '') return input;
				refuseUnknownAssessedOnMentions(catalogues, settingsId, assessedOn, what);
				const entries = [
					...stored
						.filter(
							(other) =>
								other.settings_id === settingsId && other.id !== row.id && other.code !== row.code
						)
						.map((other) => ({
							row: { code: other.code, rules: other.rules, assessed_on: other.assessed_on }
						})),
					{ row: { code: String(row.code ?? ''), rules, assessed_on: assessedOn } }
				];
				try {
					orderSchemes(entries);
				} catch (error) {
					refuse(error instanceof Error ? error.message : String(error));
				}
				return input;
			});
		})
});
