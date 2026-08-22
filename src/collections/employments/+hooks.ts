/**
 * Close-out: encash the remaining balance when an employment exits.
 *
 * A leaver has no next payroll cycle to correct assumptions in, so the exit must settle
 * everything it can: wages prorate, the final run extends to the exit date, and the remaining
 * leave balance becomes money. This after-hook watches the employment record and writes one
 * ENCASHMENT event per leave type configured to encash on exit, at the balance the derived
 * ledger computes on the exit date.
 *
 * The event is the movement: the balance guard then refuses any further leave against that type
 * (a balance that was paid out can never be taken), and the payroll engine reads the movement
 * into the final run's ledger exactly as it reads every other approved leave row.
 *
 * Idempotent by construction: it never writes twice for the same type, so re-editing an exited
 * employment (a bank change, a correction) cannot double-encash.
 */

import { Effect } from 'effect';
import { dateKey } from '../../lib/iso-day.js';
import { leaveBalance, resolveEntitlement, type LedgerRow } from '../payroll_runs/lib/leave.js';
import type { Hooks } from './$types.js';

const LIMIT = 20_000;

export default {
	update: {
		perRecord: {
			after: {
				description:
					'When an employment is marked as exited, writes an ENCASHMENT event for every encashable leave type whose derived balance on the exit date is positive. One writer wins after that: the paid-out balance refuses further leave.',
				handler: ({ record, api }) =>
					Effect.gen(function* () {
						const employment = record;
						if (employment.exit_date == null || employment.exit_date === '') return;
						const exitDate = dateKey(employment.exit_date);
						if (exitDate === '') return;

						const [company, encashableTypes, allRequests] = yield* Effect.all([
							api.db.query.companies.findFirst({
								where: { id: { eq: employment.company_id } },
								columns: { leave_year_start_month: true }
							}),
							api.db.query.leave_types.findMany({
								where: { company_id: { eq: employment.company_id }, encash_on_exit: { eq: true } },
								limit: LIMIT
							}),
							api.db.query.leave_requests.findMany({
								where: { employment_id: { eq: employment.id } },
								limit: LIMIT
							})
						]);
						if (company == null) return;

						const ledger: LedgerRow[] = allRequests
							.filter((row) => row.approval_id == null && row.from_date != null)
							.map((row) => ({
								id: row.id,
								leave_type_id: row.leave_type_id,
								entry_date: dateKey(row.from_date),
								kind: row.kind ?? 'TAKEN',
								days: row.kind === 'TIME_OFF' ? -Math.abs(Number(row.days)) : Number(row.days),
								source_id: null,
								approval_id: null
							}));

						const mutations: Array<{
							employment_id: string;
							leave_type_id: string;
							event: {
								kind: 'ENCASHMENT';
								effective_on: string;
								movement_days: number;
								note: string | null;
								source_id: string | null;
							};
						}> = [];
						for (const type of encashableTypes) {
							const alreadyEncashed = allRequests.some(
								(row) => row.kind === 'ENCASHMENT' && row.leave_type_id === type.id
							);
							if (alreadyEncashed) continue;
							const balance = leaveBalance(
								{
									leaveType: type,
									entitlementAtMonths: (serviceMonths: number) =>
										resolveEntitlement({
											leaveType: type,
											serviceMonths,
											employmentId: employment.id,
											asOf: exitDate
										}),
									hireDate: dateKey(employment.hire_date),
									exitDate,
									leaveYearStartMonth: Number(company.leave_year_start_month),
									ledger,
									basis: 'SETTLED'
								},
								exitDate
							);
							if (balance > 0) {
								mutations.push({
									employment_id: employment.id,
									leave_type_id: type.id,
									event: {
										kind: 'ENCASHMENT',
										effective_on: exitDate,
										movement_days: balance,
										note: 'Auto-encashed on exit',
										source_id: null
									}
								});
							}
						}
						if (mutations.length === 0) return;
						yield* api.db.leave_requests.mutate(mutations);
					})
			}
		}
	}
} satisfies Hooks;
