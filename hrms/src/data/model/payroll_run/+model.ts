import { model } from '@norbital-ai/bolt';
import { BigDecimal, Effect } from 'effect';
import { jsonObject } from '../../../lib/foundation.js';
import { attendanceOf, cycleOf, cycleStarted, payDateOf } from './service/pay_cycle.js';
import { idOf } from '../../../lib/reads.js';

import {
	runPostings,
	syncLatePosted,
	undone
} from '../employee_profile/employee_balance/service/service.js';
import { amendedRun, RECOVERY } from './service/amended.js';
import { loadRun } from './service/run_calculation.js';
import { lawsAt } from '../jurisdiction/service/law.js';
import { tap } from '../jurisdiction/service/taps.js';
import { validateRegistered } from '../jurisdiction/service/registrations.js';

export default model('payroll_run', {
	description: 'One payroll execution over a company and covered period.',
	record_label: "'Run ' + string(record.run_number) + ' · ' + record.period",
	fields: {
		run_number: { kind: 'seq' },
		entity_id: { kind: 'ref', to: 'entity', inverse: 'payroll_runs' },
		pay_group_id: {
			kind: 'ref',
			to: 'pay_group',
			inverse: 'payroll_runs',
			// the one pay group of the company this run pays, on its schedule
			on_delete: 'restrict'
		},
		period: { kind: 'text' },
		kind: { kind: 'enum', values: ['ON_CYCLE', 'OFF_CYCLE'], default: 'ON_CYCLE' },
		salary_coverage: { kind: 'period', of: 'date' },
		pay_date: { kind: 'date' },
		state: {
			kind: 'state',
			initial: 'UNPAID',
			states: {
				UNPAID: { to: ['PAID'] },
				PAID: { to: [] }
			}
		}
	},
	constraints: {
		one_cycle_run: { unique: ['pay_group_id', 'period'], where: { kind: { eq: 'ON_CYCLE' } } },
		// a paid run is locked: correct the record where it was recorded, the next run carries the difference
		paid_run: { locked: { state: { eq: 'PAID' } } }
	},
	outputs: {
		default: {
			fields: 'all',
			payslips: { fields: 'all' },
			entity_id: { fields: 'all' },
			pay_group_id: { fields: 'all' }
		}
	},
	create: {
		// the rows a run prices and seals are linked through their `payroll_run_id`, as are the amended periods it carried
		fields: ['entity_id', 'pay_group_id', 'period', 'kind', 'salary_coverage', 'pay_date'],
		payslips: {
			fields: [
				'employee_id',
				'employment_id',
				'entity_id',
				'basic_earnings',
				'gross_earnings',
				'net_pay',
				'total_deductions',
				'employer_cost',
				'period',
				'ordinary_wages',
				'employee_statutory',
				'tax_withheld'
			]
		},
		leave: { fields: [] },
		leave_day: { fields: [] },
		claim: { fields: [] },
		adhoc: { fields: [] },
		repayment: { fields: [] },
		case: { fields: [] },
		roster_entry: { fields: [] },
		amendments: { fields: [] },
		// a company with one pay group needs none named
		filled: { fields: ['pay_group_id', 'salary_coverage', 'pay_date'] },
		transform: function* (changes, ctx) {
			// the approving decision asks again only for what the run posts: its payslips stand
			if (ctx.approving)
				return {
					sets: changes.map(({ set }) => set),
					on_approved: yield* runPostings(
						ctx.query,
						changes.map(({ after: run }) => ({ id: run.id, pay_date: String(run.pay_date) }))
					)
				};
			const input = changes.map(({ after }) => after);
			const entityIds = [...new Set(input.map((row) => row.entity_id))];
			const known = yield* ctx.query({
				pay_group: {
					where: { entity_id: { in: entityIds } },
					fields: ['entity_id', 'name', 'payment_schedule'],
					limit: 10000
				},
				// a company's law is the jurisdiction it names, as it stands on the run's pay date
				entity: { where: { id: { in: entityIds } }, fields: ['settings_code'], limit: 10000 },
				// year-to-date only moves forward; a paid period worked out again is read off its own run. Every on-cycle run of
				// the company: an amended period, a late entry or late-signed terms reach back to any of them, and back pay to the
				// one before. A payslip names its own run when the span reads it.
				payroll_run: {
					where: { entity_id: { in: entityIds }, kind: { eq: 'ON_CYCLE' } },
					fields: [
						'entity_id',
						'pay_group_id',
						'period',
						'kind',
						'salary_coverage',
						'run_number',
						'pay_date',
						'state'
					],
					limit: 10000
				},
				// every paid period still to be worked out again: a run takes those of the people it pays
				pay_amendment: {
					where: { payroll_run_id: { is_null: true } },
					fields: ['employee_id', 'pay_group_id', 'period', 'payroll_run_id'],
					limit: 10000
				},
				// the tasks already raised for what someone who has left still owes these companies
				obligation: {
					where: { entity_id: { in: entityIds }, occurrence_key: { like: 'recovery:%' } },
					fields: ['occurrence_key', 'state'],
					limit: 10000
				},
				// what HR named that another run already paid or carried
				adhoc_catalog_entry: {
					where: {
						id: { in: input.flatMap((row) => row.adhoc.map((entry) => entry.id)) },
						payroll_run_id: { is_null: false }
					},
					fields: ['id'],
					limit: 10000
				},
				claim_catalog_entry: {
					where: {
						id: { in: input.flatMap((row) => row.claim.map((entry) => entry.id)) },
						payroll_run_id: { is_null: false }
					},
					fields: ['id'],
					limit: 10000
				}
			});
			const attached = new Set(
				[...known.adhoc_catalog_entry.rows, ...known.claim_catalog_entry.rows].map(({ id }) => id)
			);
			// an amended period HR named that is no longer open was carried by another run
			const open = new Set(known.pay_amendment.rows.map(({ id }) => id));
			const runs = [];
			for (const [index, row] of input.entries()) {
				// the run's pay group: the one named, else the company's only one
				const groups = known.pay_group.rows.filter((entry) => entry.entity_id === row.entity_id);
				const group =
					row.pay_group_id == null
						? groups.length === 1
							? groups[0]
							: undefined
						: groups.find((entry) => entry.id === String(row.pay_group_id));
				if (group === undefined)
					return row.pay_group_id == null
						? yield* ctx.refuse('errors.payroll_run_choose_group', {
								row: index,
								field: 'pay_group_id'
							})
						: yield* ctx.refuse('errors.payroll_run_group_other_company', {
								row: index,
								field: 'pay_group_id'
							});
				const schedule = jsonObject(group.payment_schedule);
				const cycle = cycleOf(schedule, row.period);
				if (cycle === undefined)
					return yield* ctx.refuse('errors.payroll_run_not_a_cycle', {
						row: index,
						field: 'period',
						values: { period: row.period, group: group.name }
					});
				const offCycle = row.kind === 'OFF_CYCLE';
				if (!offCycle && !cycleStarted(cycle, ctx.today))
					return yield* ctx.refuse('errors.payroll_run_cycle_not_started', {
						row: index,
						field: 'period',
						values: { period: row.period, from: cycle.from }
					});
				const prior = known.payroll_run.rows.filter((entry) => entry.pay_group_id === group.id);
				// year-to-date only moves forward: a skipped cycle cannot run behind a later one
				const later = prior.find((entry) => entry.kind === 'ON_CYCLE' && entry.period > row.period);
				if (!offCycle && later !== undefined)
					return yield* ctx.refuse('errors.payroll_run_later_ran', {
						row: index,
						field: 'period',
						values: { later: later.period, period: row.period }
					});
				// a group's schedule may change after it ran: no day of salary is paid by two of its cycles
				const paid = prior.find(
					(entry) =>
						entry.kind === 'ON_CYCLE' &&
						entry.period !== row.period &&
						entry.salary_coverage.from <= cycle.to &&
						cycle.from <= String(entry.salary_coverage.to)
				);
				if (!offCycle && paid !== undefined)
					return yield* ctx.refuse('errors.payroll_run_cycle_paid', {
						row: index,
						field: 'period',
						values: {
							period: paid.period,
							from: paid.salary_coverage.from,
							to: String(paid.salary_coverage.to),
							group: group.name
						}
					});
				const pay_date = offCycle ? ctx.today : payDateOf(schedule, row.period);
				// the rows HR named for an off-cycle run, linked under their layer's name
				const pays = new Set([...row.adhoc, ...row.claim].map((entry) => entry.id));
				// the open amendment rows HR named for an off-cycle run: it carries their people's earlier periods
				const carries = new Set(row.amendments.map((entry) => entry.id));
				if (offCycle && pays.size === 0 && carries.size === 0)
					return yield* ctx.refuse('errors.payroll_run_choose_pays', { row: index });
				// a row another run sealed is not paid twice
				if ([...pays].some((id) => attached.has(id)) || [...carries].some((id) => !open.has(id)))
					return yield* ctx.refuse('errors.payroll_run_already_attached', { row: index });
				runs.push({
					id: row.id,
					row: {
						entity_id: row.entity_id,
						pay_group_id: group.id,
						period: row.period,
						kind: offCycle ? ('OFF_CYCLE' as const) : ('ON_CYCLE' as const),
						salary_coverage: { from: cycle.from, to: cycle.to },
						pay_date
					},
					code: String(
						known.entity.rows.find((entry) => entry.id === row.entity_id)?.settings_code
					),
					frame: offCycle
						? { attendance: cycle, pays, carries }
						: { attendance: attendanceOf(schedule, cycle) }
				});
			}
			// fixed once the loop is done: the reads below close over it
			const planned = [...runs];
			const rows = planned.map(({ row }) => row);
			// each run's one read and what it carries, one run after another, beside the registered rules' reads
			const admit = Effect.gen(function* () {
				const working = [];
				for (const [index, { id, row, code, frame }] of planned.entries()) {
					const data = yield* loadRun(ctx.query, jsonObject(row), frame, code);
					if (data.law_settings?.[0] === undefined)
						return yield* ctx.refuse('errors.payroll_run_no_law', {
							row: index,
							values: { code, date: row.pay_date }
						});
					const result = yield* amendedRun(
						ctx.query,
						{ id: id, row: jsonObject(row), frame, data },
						{
							runs: known.payroll_run.rows.map((entry) => jsonObject(entry)),
							groups: known.pay_group.rows.map((entry) => jsonObject(entry)),
							amendments: known.pay_amendment.rows.map((entry) => jsonObject(entry)),
							entities: known.entity.rows.map((entry) => jsonObject(entry)),
							recovered: new Set(
								known.obligation.rows
									.filter((task) => task.state === 'FULFILLED')
									.map((task) => task.occurrence_key)
							)
						}
					);
					// a stint ends the employment only at an exit, with its last stretch: one that runs on, or ends later, is
					// paid by a later run. Someone no later run pays owes what could not be taken: HR recovers it.
					const coveredTo = row.salary_coverage.to;
					const leaving = result.deferred.filter(
						(employee) =>
							![
								...new Map(
									(data.employment ?? [])
										.filter((contract) => String(contract.employee_id) === employee)
										.map((contract) => [String(contract.id), contract])
								).values()
							].some((contract) => {
								const to = jsonObject(contract.effective_range).to;
								return contract.exit !== true || to == null || String(to) > coveredTo;
							})
					);
					// an off-cycle run seals what it pays: an entry with no payslip here would never be paid
					const paid = new Set(result.payslips.map((slip) => slip.employment_id));
					if (
						frame.pays !== undefined &&
						[...(data.adhoc_catalog_entry ?? []), ...(data.claim_catalog_entry ?? [])].some(
							(entry) => !paid.has(String(entry.employment_id))
						)
					)
						return yield* ctx.refuse('errors.payroll_run_not_in_group');
					if (frame.pays !== undefined) {
						// someone still employed it pays too little is left for their next on-cycle run. Someone who has left has
						// no such run: the payslip ends at zero and one task names what they owe.
						if (result.deferred.some((employee) => !leaving.includes(employee)))
							return yield* ctx.refuse('errors.payroll_run_carry_takes_back');
						// nothing negative posts to a balance, so a deduction that outruns the run waits for the next on-cycle run
						if (result.payslips.some((slip) => slip.net_pay < 0))
							return yield* ctx.refuse('errors.payroll_run_below_zero');
					}
					working.push({ id, row, frame, data, result, leaving });
				}
				return working;
			});
			// a rule's refusal still comes first, as when the rules read before the runs
			const [, admitted] = yield* Effect.all(
				[
					validateRegistered(
						ctx.query,
						'payroll_run',
						'create',
						rows.map((row) => jsonObject(row))
					),
					Effect.exit(admit)
				],
				{ concurrency: 'unbounded' }
			);
			const worked = yield* admitted;
			const calculated = [];
			const deferred = [];
			const owing = [];
			// each run's payslips as they are written and posted
			const made = worked.map((entry) => ({
				...entry,
				payslips: entry.result.payslips.map((slip) => ({
					employee_id: idOf('employee_profile', slip.employee_id),
					employment_id: idOf('employment', slip.employment_id),
					entity_id: idOf('entity', slip.entity_id),
					basic_earnings: new Intl.NumberFormat('en', {
						useGrouping: false,
						maximumFractionDigits: 20
					}).format(slip.basic_earnings),
					gross_earnings: new Intl.NumberFormat('en', {
						useGrouping: false,
						maximumFractionDigits: 20
					}).format(slip.gross_earnings),
					net_pay: new Intl.NumberFormat('en', {
						useGrouping: false,
						maximumFractionDigits: 20
					}).format(slip.net_pay),
					total_deductions: new Intl.NumberFormat('en', {
						useGrouping: false,
						maximumFractionDigits: 20
					}).format(slip.total_deductions),
					employer_cost: new Intl.NumberFormat('en', {
						useGrouping: false,
						maximumFractionDigits: 20
					}).format(slip.employer_cost),
					period: slip.period,
					ordinary_wages: new Intl.NumberFormat('en', {
						useGrouping: false,
						maximumFractionDigits: 20
					}).format(slip.ordinary_wages),
					employee_statutory: BigDecimal.format(
						BigDecimal.fromNumberUnsafe(slip.employee_statutory)
					),
					tax_withheld: new Intl.NumberFormat('en', {
						useGrouping: false,
						maximumFractionDigits: 20
					}).format(slip.tax_withheld),
					breakdown: slip.breakdown
				}))
			}));
			const attaches = (layer: string) =>
				worked.flatMap(({ result }) => result.attaches[layer] ?? []);
			// a month of rosters runs past Bolt's 1,000 values a list: one read, the list in chunks
			const anyOf = <T extends string>(list: readonly T[]) => ({
				or: Array.from({ length: Math.ceil(list.length / 1000) || 1 }, (_, at) => ({
					id: { in: list.slice(at * 1000, at * 1000 + 1000) }
				}))
			});
			// what the runs post goes on the laws they were priced on, which this invocation has read
			const laws = yield* lawsAt(
				ctx.query,
				planned.map(({ code }) => code)
			);
			// one read for every run, beside those postings: where the people an off-cycle run pays work, and the rows each
			// run seals, linked at the revision read (a row changed since is a conflict)
			const [sealed, posted] = yield* Effect.all(
				[
					ctx.query({
						employment: {
							where: {
								employee_id: {
									in: worked.flatMap(({ frame, result }) =>
										frame.pays === undefined
											? []
											: result.payslips.map((slip) => idOf('employee_profile', slip.employee_id))
									)
								}
							},
							fields: ['employee_id', 'entity_id', 'effective_range'],
							limit: 10000
						},
						leave_catalog_entry: {
							where: anyOf(attaches('leave').map((entry) => idOf('leave_catalog_entry', entry))),
							fields: ['revision'],
							limit: 10000
						},
						leave_catalog_entry_day: {
							where: anyOf(
								attaches('leave_day').map((entry) => idOf('leave_catalog_entry_day', entry))
							),
							fields: ['revision'],
							limit: 10000
						},
						claim_catalog_entry: {
							where: anyOf(attaches('claim').map((entry) => idOf('claim_catalog_entry', entry))),
							fields: ['revision'],
							limit: 10000
						},
						adhoc_catalog_entry: {
							where: anyOf(attaches('adhoc').map((entry) => idOf('adhoc_catalog_entry', entry))),
							fields: ['revision'],
							limit: 10000
						},
						loan_catalog_entry_repayment: {
							where: anyOf(
								attaches('repayment').map((entry) => idOf('loan_catalog_entry_repayment', entry))
							),
							fields: ['revision'],
							limit: 10000
						},
						workplace_case_catalog_entry: {
							where: anyOf(
								attaches('case').map((entry) => idOf('workplace_case_catalog_entry', entry))
							),
							fields: ['revision'],
							limit: 10000
						},
						roster_entry: {
							where: anyOf(attaches('roster_entry').map((entry) => idOf('roster_entry', entry))),
							fields: ['revision'],
							limit: 10000
						},
						pay_amendment: {
							where: anyOf(
								worked
									.flatMap(({ result }) => result.taken)
									.map((entry) => idOf('pay_amendment', entry))
							),
							fields: ['revision'],
							limit: 10000
						}
					}),
					// the runs' own refusals below still come first
					Effect.exit(
						runPostings(
							ctx.query,
							made.map(({ id, row, payslips }) => ({
								id,
								pay_date: row.pay_date,
								payslips: payslips.map(jsonObject)
							})),
							laws
						)
					)
				],
				{ concurrency: 'unbounded' }
			);
			/** A run's own rows of one layer, each at the revision read. */
			const linked = <R extends { readonly id: string; readonly revision: number }>(
				rows: readonly R[],
				wanted: readonly string[]
			) => {
				const own = new Set(wanted);
				return rows.filter((row) => own.has(row.id)).map(({ id, revision }) => ({ id, revision }));
			};
			for (const { id, row, frame, result, leaving, payslips } of made) {
				if (frame.pays !== undefined) {
					// the month's totals hold both companies: on-cycle, each stands alone. A payslip that only carries earlier
					// periods adds nothing to this month: someone who moved company is paid what the old one owes them
					const { from, to } = row.salary_coverage;
					const paid = new Set(
						result.payslips
							.filter((slip) => slip.breakdown.lines.some((line) => line.period === undefined))
							.map((slip) => slip.employee_id)
					);
					const both = sealed.employment.rows.some(
						({ employee_id, entity_id, effective_range: range }) =>
							paid.has(employee_id) &&
							entity_id !== row.entity_id &&
							range.from <= to &&
							(range.to == null || range.to >= from)
					);
					if (both) return yield* ctx.refuse('errors.payroll_run_moved_company');
				}
				const ids = (layer: string) => result.attaches[layer] ?? [];
				calculated.push({
					...row,
					payslips,
					leave: linked(sealed.leave_catalog_entry.rows, ids('leave')),
					leave_day: linked(sealed.leave_catalog_entry_day.rows, ids('leave_day')),
					claim: linked(sealed.claim_catalog_entry.rows, ids('claim')),
					adhoc: linked(sealed.adhoc_catalog_entry.rows, ids('adhoc')),
					repayment: linked(sealed.loan_catalog_entry_repayment.rows, ids('repayment')),
					case: linked(sealed.workplace_case_catalog_entry.rows, ids('case')),
					roster_entry: linked(sealed.roster_entry.rows, ids('roster_entry')),
					amendments: linked(sealed.pay_amendment.rows, result.taken)
				});
				// Someone who has left and still owes: no later run pays them, so the rest is HR's to recover. One task says so;
				// fulfilling it settles the recovery. An off-cycle run may carry for the same person more than once.
				for (const employee of leaving) {
					const slip = result.payslips.find((entry) => entry.employee_id === employee);
					const owed = slip?.breakdown.lines.find((line) => line.code === RECOVERY)?.amount;
					if (slip === undefined || owed === undefined) continue;
					const occurrence_key = `recovery:${slip.employment_id}:${row.period}${frame.pays === undefined ? '' : `:${id}`}`;
					if (known.obligation.rows.some((task) => task.occurrence_key === occurrence_key))
						continue;
					owing.push({
						entity_id: row.entity_id,
						employee_id: idOf('employee_profile', employee),
						employment_id: idOf('employment', slip.employment_id),
						title: `Recover ${new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(owed)} outside payroll: the last payslip (${row.period}) ended at zero and no later run pays this person`,
						occurrence_key
					});
				}
				// a recovery that outran the pay of someone still employed is taken by the next run: this run's own period is
				// amended.
				// a run made again after it was deleted finds the row its first making left: one open row a person and period
				deferred.push(
					...result.deferred
						.filter(
							(employee) =>
								!leaving.includes(employee) &&
								!known.pay_amendment.rows.some(
									(held) =>
										held.employee_id === employee &&
										held.pay_group_id === row.pay_group_id &&
										held.period === row.period
								)
						)
						.map((employee) => ({
							employee_id: idOf('employee_profile', employee),
							pay_group_id: row.pay_group_id,
							period: row.period
						}))
				);
			}
			return {
				sets: calculated,
				on_approved: {
					...(yield* posted),
					...(deferred.length === 0 ? {} : { pay_amendment: { create: deferred } }),
					...(owing.length === 0 ? {} : { obligation: { create: owing } })
				}
			};
		},
		effect: function* (changes, ctx) {
			yield* Effect.all(
				[
					tap(
						ctx,
						'create',
						'payroll_run',
						changes.map(({ after }) => ({ after }))
					),
					// leave a run posts into a year before this one can change what carried since
					syncLatePosted(
						ctx,
						changes.map(({ after }) => `payroll_run:${after.id}`)
					)
				],
				{ concurrency: 'unbounded' }
			);
		}
	},
	update: {
		fields: ['state'],
		transform: function* (changes, ctx) {
			yield* validateRegistered(
				ctx.query,
				'payroll_run',
				'update',
				changes.map((change) => jsonObject(change.after))
			);
			return changes.map((change) => change.set);
		},
		effect: function* (changes, ctx) {
			const paid = changes.flatMap(({ before, after }) =>
				before.state !== 'PAID' && after.state === 'PAID' ? [after.id] : []
			);
			// service bands and anniversaries move on no event of their own: a paid run looks again at whom it paid
			const [, { payslip }] = yield* Effect.all(
				[
					tap(ctx, 'update', 'payroll_run', changes),
					ctx.query({
						payslip: {
							where: { payroll_run_id: { in: paid } },
							fields: ['employee_id'],
							limit: 10000
						}
					})
				],
				{ concurrency: 'unbounded' }
			);
			if (payslip.rows.length === 0) return;
			yield* ctx.schedule('ledger', {
				employees: [...new Set(payslip.rows.map((row) => row.employee_id))]
			});
		}
	},
	// a paid run is locked (`paid_run`)
	delete: {
		transform: function* (changes, ctx) {
			const ids = changes.map(({ before }) => before.id);
			// what the run posted comes back off the balance with it
			const back = undone(
				ctx.query,
				ids.map((id) => `payroll_run:${id}`)
			);
			if (ctx.approving) return { on_approved: yield* back };
			// a later run's year-to-date already counts this one, for anyone paid in both, in any company of the same totals:
			// the deleted runs' numbers and people, then one of their payslips in a run made after them
			const counted = Effect.gen(function* () {
				const { payslip: own, payroll_run: deleted } = yield* ctx.query({
					payslip: {
						where: { payroll_run_id: { in: ids } },
						fields: ['employee_id'],
						limit: 10000
					},
					payroll_run: { where: { id: { in: ids } }, fields: ['run_number'], limit: 10000 }
				});
				if (own.rows.length === 0 || deleted.rows.length === 0) return false;
				const first = Math.min(...deleted.rows.map((row) => row.run_number));
				const { payslip: shared } = yield* ctx.query({
					payslip: {
						where: {
							employee_id: { in: [...new Set(own.rows.map((row) => row.employee_id))] },
							payroll_run_id: { is: { run_number: { gt: first } } }
						},
						fields: ['payroll_run_id'],
						// a deleted run made after the first is not a later one: past all their own payslips, one is
						limit: own.rows.length + 1
					}
				});
				return shared.rows.some((row) => !ids.includes(row.payroll_run_id));
			});
			const [refused, undoing] = yield* Effect.all([counted, Effect.exit(back)], {
				concurrency: 'unbounded'
			});
			if (refused) return yield* ctx.refuse('errors.payroll_run_counted_later');
			return { on_approved: yield* undoing };
		},
		effect: function* (changes, ctx) {
			yield* syncLatePosted(
				ctx,
				changes.map(({ before }) => `payroll_run:${before.id}`)
			);
		}
	}
});
