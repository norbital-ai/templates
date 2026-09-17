import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { carryAssignmentProgressToJob, JobProgressOutputSchema } from './job-progress.js';

/** An assignment's progress is the job's progress; evidence and suspicion never touch either. */
export default defineAutomation(
	{ trigger: { collection: 'job_assignments', event: 'updated' } },
	{
		output: JobProgressOutputSchema,
		policies: ['job_progress_automation'],
		description:
			'Carries assignment progress onto its job: a completed assignment completes the job, anything else keeps it assigned.',
		handler: (api, { scope }) => carryAssignmentProgressToJob(api, scope.incoming_record)
	}
);
