import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { statutoryRegimeIssues } from '../../datatypes/statutory_regime/+definition.js';
import { refuseUnlessDraftOnBoth } from '../../lib/settings_seal.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Validate Work rules and distinct output codes; refuse changes to a sealed catalogue.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const row = { ...existing, ...input };
						yield* refuseUnlessDraftOnBoth(
							api,
							existing?.settings_id,
							input.settings_id,
							'Work catalogue'
						);
						const requiredOutputs = [row.salary, row.overtime, row.overtime_excess];
						if (requiredOutputs.some((output) => output == null))
							refuse('Work defines salary, overtime and excess overtime outputs.');
						const codes = [...requiredOutputs, row.absence].flatMap((output) =>
							output == null ? [] : [output.code]
						);
						if (new Set(codes).size !== codes.length)
							refuse('Each Work output needs a distinct pay-item code.');
						if (row.regime == null) refuse('Work requires its working-time rules.');
						const settings =
							row.settings_id == null
								? null
								: yield* api.db.jurisdiction_settings.findFirst({
										where: { id: { eq: row.settings_id } },
										columns: { currency: true }
									});
						const issues = statutoryRegimeIssues(
							row.regime,
							settings?.currency ?? row.regime.overtime_coverage?.wage_ceiling?.currency ?? ''
						);
						if (issues.length) refuse(issues.join(' '));
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Preserve Work catalogues belonging to a sealed settings version.',
				handler: ({ existing, api }) =>
					refuseUnlessDraftOnBoth(api, existing.settings_id, undefined, 'Work catalogue')
			}
		}
	}
} satisfies Hooks;
