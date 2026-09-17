import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { carryAssignmentProgressToJob, JobProgressOutputSchema } from './job-progress.js';

/** The first dispatch moves a job from unassigned to assigned. */
export default defineAutomation(
	{ trigger: { collection: 'job_assignments', event: 'created' } },
	{
		output: JobProgressOutputSchema,
		policies: ['job_progress_automation'],
		description:
			'Moves a job from unassigned to assigned as soon as its first assignee is dispatched.',
		handler: (api, { scope }) => carryAssignmentProgressToJob(api, scope.incoming_record)
	}
);
