import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';
import { runStatutoryProfileDrift } from './+statutory_profile_drift.js';

export default defineAutomation(
	{},
	{
		input: Schema.Struct({
			profile_id: Schema.String.check(Schema.isUUID()),
			parent_log_id: Schema.String.check(Schema.isUUID())
		}),
		policies: ['statutory_drift_automation'],
		description:
			'Research one statutory profile and retain its independent evidence, failure and approval proposals.',
		handler: (api, { args }) =>
			runStatutoryProfileDrift(api, { profileId: args.profile_id, parentLogId: args.parent_log_id })
	}
);
