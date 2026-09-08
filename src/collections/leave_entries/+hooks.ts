import { boundToContract } from '../../lib/employment-contract.js';
import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';
import { stableJson } from '../../lib/jurisdiction_settings.js';
import { readLeaveContext, type LeaveContext } from '../../lib/leave/context.js';
import { planLeaveActivity } from '../../lib/leave/activity.js';

type Prepared = {
	inputs: Parameters<NonNullable<NonNullable<Hooks['mutate']>['prepare']>>[0]['inputs'];
	context: LeaveContext;
};

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const employmentIds = inputs.flatMap((row) =>
					row.employment_id == null ? [] : [row.employment_id]
				);
				const ranges = inputs.flatMap((row) =>
					row.event?.kind === 'TIME_OFF' ? [row.event.range] : []
				);
				const window =
					ranges.length === 0
						? undefined
						: {
								start: ranges.map((row) => row.start.date).toSorted()[0]!,
								end: ranges
									.map((row) => row.end.date)
									.toSorted()
									.at(-1)!
							};
				return {
					inputs,
					context: yield* readLeaveContext(
						api,
						employmentIds,
						window,
						inputs.some((row) => row.event?.kind === 'REVERSAL')
					)
				};
			}),
		perRecord: {
			before: {
				description:
					'Validates a manual Leave activity and freezes its dated charges and credit allocations; each charge carries the calendar it was measured against.',
				handler: ({ input, existing, recordId, prepared }) => {
					if (existing != null) {
						if (
							Object.entries(input).some(
								([key, value]) =>
									key !== 'id' &&
									key !== 'row_version' &&
									stableJson(value) !== stableJson(Reflect.get(existing, key))
							)
						)
							refuse(
								'Approved leave entries are immutable. Submit a linked reversal and replacement.'
							);
						return boundToContract(input, existing);
					}
					if (
						input.employment_id == null ||
						input.leave_catalogue_id == null ||
						input.event == null ||
						!input.reference?.trim()
					)
						refuse('A leave entry needs an employment, leave type, event and unique reference.');
					const batch = prepared.inputs.filter((row) => row.employment_id === input.employment_id);
					const references = batch.map((row) => row.reference);
					if (new Set(references).size !== references.length)
						refuse('Each leave transaction in the batch needs its own reference.');
					const held = prepared.context.entries.find(
						(row) => row.employment_id === input.employment_id && row.reference === input.reference
					);
					if (held != null && held.id !== recordId)
						refuse('This leave reference is already posted or awaiting approval.');
					// Approval replay excludes its own held proposals. Other batches remain reservations;
					// the runtime guards both stored rows and pending reads at the atomic commit.
					const entries = prepared.context.entries.filter(
						(row) =>
							!(
								row.employment_id === input.employment_id &&
								references.includes(row.reference) &&
								row.approval_id != null
							)
					);
					let selected: ReturnType<typeof planLeaveActivity> | undefined;
					// Every before hook deterministically validates the same complete batch. Prepared data
					// is immutable across guest calls, so no correctness depends on a shared mutable Map.
					for (const row of batch) {
						if (row.id != null && entries.some((entry) => entry.id === row.id)) continue;
						if (
							row.employment_id == null ||
							row.leave_catalogue_id == null ||
							row.event == null ||
							!row.reference?.trim()
						)
							refuse('Every leave entry in the batch must be complete.');
						const current = row.reference === input.reference;
						const id = current ? recordId : (row.id ?? `batch:${row.reference}`);
						const planned = planLeaveActivity(
							prepared.context,
							{
								employment_id: row.employment_id,
								leave_catalogue_id: row.leave_catalogue_id,
								reference: row.reference,
								event: row.event
							},
							id,
							entries
						);
						if (planned.certificateRequired && row.certificate_file == null)
							refuse('A certificate is required for this time off.');
						if (current) selected = planned;
						// Batch credits become spendable only after approval. Never fund another held
						// submission from an unapproved carry-forward or exceptional credit.
						entries.push({ ...planned, id, approval_id: 'batch-reservation' });
					}
					if (selected == null)
						refuse('The leave transaction was not present in its prepared batch.');
					const { certificateRequired: _certificateRequired, ...entry } = selected;
					return {
						...boundToContract(entry, existing),
						certificate_file: input.certificate_file ?? null
					};
				}
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Approved Leave activity remains audit evidence; corrections are linked reversals.',
				handler: () => refuse('Leave entries cannot be deleted. Submit a linked reversal.')
			}
		}
	}
} satisfies Hooks<Prepared>;
