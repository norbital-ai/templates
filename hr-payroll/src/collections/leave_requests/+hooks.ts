import { Effect } from 'effect';
import { refuse, type MutateBeforeContext } from '@norbital-ai/bolt/authoring';
import type { LeaveEvent } from '../../datatypes/leave_event/+definition.js';
import type { Hooks, WorkspaceRow } from './$types.js';
import { refuseIfCaptured } from '../../lib/scheduling/lock.js';
import { leaveAccountIdFor } from '../../lib/leave/identity.js';
import { leaveYearOf } from '../../lib/leave/reconcile.js';
import { decodeNumber } from '@norbital-ai/std/json';
import { firstLeavePreviewRefusal, previewLeave } from '../../lib/leave/preview.js';

type HookApi = MutateBeforeContext<Hooks>['api'];

function normalizedTimeOff(
	api: HookApi,
	employmentId: string,
	leaveTypeId: string,
	accountId: string,
	event: LeaveEvent,
	certificateFile: unknown,
	excludeId?: string
): Effect.Effect<LeaveEvent> {
	return Effect.gen(function* () {
		const preview = yield* previewLeave(api, {
			employment_id: employmentId,
			leave_type_id: leaveTypeId,
			leave_account_id: accountId,
			range: event.range,
			...(excludeId == null ? {} : { exclude_request_id: excludeId })
		});
		const refusal = firstLeavePreviewRefusal(preview);
		if (refusal != null) refuse(refusal);
		if (preview.certificate_required && certificateFile == null)
			refuse('A certificate is required for this request.');
		if (preview.chargeable_days == null || preview.chargeable_days <= 0)
			refuse('The selected range contains no eligible scheduled work time.');
		return { ...event, chargeable_days: preview.chargeable_days };
	});
}

function assertUnlocked(
	api: HookApi,
	existing: WorkspaceRow<'leave_requests'>,
	action: string
): Effect.Effect<void> {
	return refuseIfCaptured({
		capture: api.db.payslip_leave_request_inputs.findFirst({
			where: { leave_request_id: { eq: existing.id } },
			columns: { period: true }
		}),
		approvalId: existing.approval_id,
		action
	});
}

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const ids = inputs.flatMap((row) => (row.id == null ? [] : [row.id]));
				const stored =
					ids.length === 0
						? []
						: yield* api.db.leave_requests.findMany({
								where: { id: { in: ids } },
								limit: ids.length
							});
				const employments = new Set<string>();
				for (const input of inputs) {
					const employmentId =
						input.employment_id ?? stored.find((row) => row.id === input.id)?.employment_id;
					if (employmentId == null) continue;
					if (employments.has(employmentId))
						refuse('Apply one leave request per employment at a time.');
					employments.add(employmentId);
				}
				// The account a request draws on is named by formula from its employment, leave type and
				// leave year, so a caller — the employee's app or a bulk import — never has to know an
				// account id. What the formula needs is read once for the whole batch.
				const typeIds = [
					...new Set(
						inputs.flatMap((row) => (row.leave_type_id == null ? [] : [row.leave_type_id]))
					)
				];
				const types =
					typeIds.length === 0
						? []
						: yield* api.db.leave_types.findMany({
								where: { id: { in: typeIds } },
								limit: typeIds.length
							});
				const employmentIds = [...employments];
				const rows =
					employmentIds.length === 0
						? []
						: yield* api.db.employments.findMany({
								where: { id: { in: employmentIds } },
								columns: { id: true, company_id: true },
								limit: employmentIds.length
							});
				const companyIds = [...new Set(rows.map((row) => row.company_id))];
				const companies =
					companyIds.length === 0
						? []
						: yield* api.db.companies.findMany({
								where: { id: { in: companyIds } },
								columns: { id: true, leave_year_start_month: true },
								limit: companyIds.length
							});
				return {
					typeCodes: new Map(types.map((type) => [type.id, type.code])),
					startMonths: new Map(
						rows.map((row) => [
							row.id,
							decodeNumber(
								companies.find((company) => company.id === row.company_id)
									?.leave_year_start_month ?? 1
							)
						])
					)
				};
			}),
		perRecord: {
			before: {
				description:
					'Requires an approved generated account covering the whole range, then normalizes chargeable scheduled time and checks overlap, balance, eligibility, paid-payroll locks and certificate policy.',
				handler: ({ input, existing, recordId, prepared, api }) =>
					Effect.gen(function* () {
						if (existing != null) yield* assertUnlocked(api, existing, 'Changing a leave request');
						const employmentId = input.employment_id ?? existing?.employment_id;
						const leaveTypeId = input.leave_type_id ?? existing?.leave_type_id;
						const event = input.event ?? existing?.event;
						const derivedAccountId =
							employmentId != null && leaveTypeId != null && event != null
								? leaveAccountIdFor({
										employment_id: employmentId,
										leave_code: prepared.typeCodes.get(leaveTypeId) ?? '',
										leave_year: leaveYearOf(
											event.range.start.date,
											prepared.startMonths.get(employmentId) ?? 1
										)
									})
								: null;
						const accountId =
							input.leave_account_id ?? existing?.leave_account_id ?? derivedAccountId;
						const certificate =
							input.certificate_file !== undefined
								? input.certificate_file
								: existing?.certificate_file;
						if (employmentId == null || leaveTypeId == null || accountId == null || event == null)
							refuse(
								'A leave request needs an employment, leave type, generated account and range.'
							);
						const normalized = yield* normalizedTimeOff(
							api,
							employmentId,
							leaveTypeId,
							accountId,
							event,
							certificate,
							recordId
						);
						return { ...input, leave_account_id: accountId, event: normalized };
					})
			},
			after: {
				description:
					"An approved request charges its account: the employment's leave ledger is regenerated once the request commits.",
				handler: ({ record, api }) =>
					Effect.gen(function* () {
						if (record.approval_id != null) return;
						yield* api.automations.run('leave_ledger_refresh', {
							employment_ids: [record.employment_id]
						});
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Refuses deleting a leave request already captured by payroll.',
				handler: ({ existing, api }) => assertUnlocked(api, existing, 'Deleting a leave request')
			}
		}
	}
} satisfies Hooks<{
	readonly typeCodes: Map<string, string>;
	readonly startMonths: Map<string, number>;
}>;
