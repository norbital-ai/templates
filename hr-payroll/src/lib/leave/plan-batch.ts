import { refuse } from '@norbital-ai/bolt/authoring';
import type { WorkspaceRow } from '$bolt/types.js';
import { boundToContract } from '../employment-contract.js';
import type { LeaveContext } from './context.js';
import { planLeaveActivity, type LeaveSubmission } from './activity.js';
import { LEAVE_DAY_COLUMNS } from './activity-fields.js';
import { canonicalDays } from '../iso-day.js';

/**
 * One batch of leave submissions, planned in order against one context.
 *
 * Every input is planned against the same complete batch: an earlier row's planned debits are
 * reservations the next row sees, and a batch credit becomes spendable only after approval, so
 * it never funds another held submission. The `leave_entries` transform calls this with the
 * context it read; a test calls it with one it built.
 *
 * Each payload carries its own id: a carry-forward's credit allocation names the entry that
 * grants it, so the id has to exist before the row does. The engine keeps a transform-minted id.
 */
export function planLeaveBatch(
	context: LeaveContext,
	inputs: ReadonlyArray<
		Partial<LeaveSubmission> & {
			readonly certificate_file?: WorkspaceRow<'leave_entries'>['certificate_file'] | undefined;
		}
	>
) {
	const entries = [...context.entries];
	return inputs.map((input, index) => {
		if (input.employment_id == null || input.catalogue_id == null || !input.reference?.trim())
			refuse('A leave entry needs an employment, leave type and unique reference.');
		const batch = inputs.filter((row) => row.employment_id === input.employment_id);
		const references = batch.map((row) => row.reference);
		if (new Set(references).size !== references.length)
			refuse('Each leave transaction in the batch needs its own reference.');
		if (
			context.entries.some(
				(row) => row.employment_id === input.employment_id && row.reference === input.reference
			)
		)
			refuse('This leave reference is already posted or awaiting approval.');
		const id = `batch:${index}`;
		const planned = planLeaveActivity(
			context,
			{
				...input,
				employment_id: input.employment_id,
				catalogue_id: input.catalogue_id,
				reference: input.reference
			},
			id,
			entries
		);
		if (planned.certificateRequired && input.certificate_file == null)
			refuse('A certificate is required for this time off.');
		entries.push({ ...planned, id, approval_id: 'batch-reservation' });
		const { certificateRequired: _certificateRequired, ...entry } = planned;
		return {
			...boundToContract(canonicalDays(entry, LEAVE_DAY_COLUMNS)),
			certificate_file: input.certificate_file ?? null
		};
	});
}
