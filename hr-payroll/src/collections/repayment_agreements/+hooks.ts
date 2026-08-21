import { Effect } from 'effect';
import type { EntryOrigin } from '../../datatypes/entry_origin/+definition.js';
import type { Hooks, WorkspaceRow } from './$types.js';
import { assertRepaymentSchedule } from './lib/repayment-schedule.js';

function instalmentOrigin(value: EntryOrigin | null | undefined) {
	// The write boundary already decodes `origin` against the strict entry-origin schema, so a
	// value reaching the hook either carries a declared arm or was refused before it got here.
	// The narrowing is all that is left to do.
	return value != null && value.kind === 'LOAN_INSTALMENT' ? value : null;
}

const LIMIT = 5000;
type ReadApi = Parameters<
	NonNullable<NonNullable<NonNullable<Hooks['create']>['perRecord']>['before']>['handler']
>[0]['api'];

function checked<T>(rows: T[], what: string): T[] {
	if (rows.length >= LIMIT)
		throw new Error(
			`${what} reached the ${LIMIT}-row safety limit; the operation was not applied.`
		);
	return rows;
}

type EntryWithPayslipLines = {
	readonly norbital_id: string;
	readonly origin: WorkspaceRow<'component_entries'>['origin'];
	readonly amount: WorkspaceRow<'component_entries'>['amount'];
	readonly event_date: WorkspaceRow<'component_entries'>['event_date'];
	readonly entry_payslip_lines: readonly { readonly norbital_id: string }[] | null;
};

function agreementEntries(
	api: ReadApi,
	agreement: Pick<WorkspaceRow<'repayment_agreements'>, 'norbital_id'>
): Effect.Effect<EntryWithPayslipLines[], never, never> {
	return Effect.gen(function* () {
		const rows = yield* api.db.query.component_entries.findMany({
			where: { repayment_agreement_id: { eq: agreement.norbital_id } },
			with: { entry_payslip_lines: { columns: { norbital_id: true } } },
			limit: LIMIT
		});
		return checked(rows, 'Component entries').map((row) => {
			const linked = row.entry_payslip_lines;
			return {
				norbital_id: row.norbital_id,
				origin: row.origin,
				amount: row.amount,
				event_date: row.event_date,
				entry_payslip_lines: Array.isArray(linked) ? linked : null
			};
		});
	});
}

/** "Consumed" is not a flag: it is the existence of the nested persisted source relation. */
function linkedEntryIds(entries: readonly EntryWithPayslipLines[]): Set<string> {
	return new Set(
		entries
			.filter((entry) => entry.entry_payslip_lines != null && entry.entry_payslip_lines.length > 0)
			.map((entry) => entry.norbital_id)
	);
}

function protectPaidInstalments(
	api: ReadApi,
	existing: WorkspaceRow<'repayment_agreements'>,
	next: {
		readonly employment_id: string;
		readonly pay_component_id: string;
		readonly schedule: WorkspaceRow<'repayment_agreements'>['schedule'];
	}
): Effect.Effect<void, never, never> {
	return Effect.gen(function* () {
		const entries = yield* agreementEntries(api, existing);
		const linked = linkedEntryIds(entries);
		if (linked.size === 0) return;
		if (
			next.employment_id !== existing.employment_id ||
			next.pay_component_id !== existing.pay_component_id
		)
			throw new Error(
				'A repayment agreement with payslip-linked instalments cannot change employment or component.'
			);
		for (const entry of entries) {
			if (!linked.has(entry.norbital_id)) continue;
			const origin = instalmentOrigin(entry.origin);
			if (!origin) continue;
			const candidate = next.schedule?.[origin.sequence - 1];
			if (
				!candidate ||
				Number(candidate.amount) !== Number(entry.amount) ||
				candidate.due_date !== String(entry.event_date).slice(0, 10)
			)
				throw new Error(
					`Repayment ${origin.sequence} is linked to a payslip and cannot be changed or removed.`
				);
		}
	});
}

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Checks that the instalments add up to the principal and finish inside the agreement period, so a loan cannot be booked against a schedule that never clears it.',
				handler: ({ input }) => {
					assertRepaymentSchedule({
						principal: input.principal,
						effectiveRange: input.effective_range,
						schedule: input.schedule
					});
					return input;
				}
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Re-checks that the amended schedule still clears the principal inside the agreement period, and refuses to change the amount, due date, employment or component of any instalment already paid out on a payslip.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						const principal = input.principal ?? existing.principal;
						const effectiveRange = input.effective_range ?? existing.effective_range;
						const schedule = input.schedule ?? existing.schedule;
						assertRepaymentSchedule({ principal, effectiveRange, schedule });
						yield* protectPaidInstalments(api, existing, {
							employment_id: input.employment_id ?? existing.employment_id,
							pay_component_id: input.pay_component_id ?? existing.pay_component_id,
							schedule
						});
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses to delete a repayment agreement at all, because it is the auditable record of what an employee owes; an unwanted balance is cleared by shortening the unpaid schedule.',
				handler: () => {
					throw new Error(
						'Repayment agreements are auditable records and cannot be deleted. Correct the unpaid schedule instead.'
					);
				}
			}
		}
	}
} satisfies Hooks;
