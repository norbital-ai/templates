import { model } from '../../../../.norbital/models/payroll_run.ts';
import { BigDecimal } from 'effect';
import { jsonObject } from '../../../lib/payroll_engine/foundation.js';
import { attendanceOf, cycleOf, payDateOf } from '../../../lib/payroll_engine/pay_cycle.js';
import { idOf } from '../../../lib/payroll_engine/reads.js';

import { runPostings, undone } from '../../../lib/ledger/service.js';
import { amendedRun, RECOVERY } from '../../../lib/payroll_engine/amended.js';
import { loadRun } from '../../../lib/payroll_engine/run_calculation.js';
import { tap } from '../../../lib/payroll_engine/taps.js';
import { validateRegistered } from '../../../lib/payroll_engine/registrations.js';
import { salaryListing } from '../../../lib/export_format_configuration/salary_listing.js';
import { ocbcFast, metroBank } from '../../../lib/export_format_configuration/bank_files.js';
import { exportRows } from '../../../lib/export_format_configuration/export_rows.js';

export default model({
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
		settings_id: { kind: 'ref', to: 'jurisdiction_settings', on_delete: 'restrict' },
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
	syncs: {
		salary_listing: {
			with: 'file',
			parser: salaryListing.parser,
			schema: salaryListing.schema,
			context: { payroll_run_id: { kind: 'ref', to: 'payroll_run' } },
			write: function* ({ context }, ctx) {
				return salaryListing.records(yield* exportRows(ctx.query, context.payroll_run_id));
			}
		},
		ocbc_fast: {
			with: 'file',
			parser: ocbcFast.parser,
			schema: ocbcFast.schema,
			context: { payroll_run_id: { kind: 'ref', to: 'payroll_run' } },
			write: function* ({ context }, ctx) {
				return ocbcFast.records(yield* exportRows(ctx.query, context.payroll_run_id));
			}
		},
		metro_bank: {
			with: 'file',
			parser: metroBank.parser,
			schema: metroBank.schema,
			context: { payroll_run_id: { kind: 'ref', to: 'payroll_run' } },
			write: function* ({ context }, ctx) {
				return metroBank.records(yield* exportRows(ctx.query, context.payroll_run_id));
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
			pay_group_id: { fields: 'all' },
			settings_id: { fields: 'all' }
		}
	},
	create: {
		// the rows a run prices and seals are linked through their `payroll_run_id`, as are the amended periods it carried
		columns: {
			fields: [
				'entity_id',
				'pay_group_id',
				'period',
				'kind',
				'settings_id',
				'salary_coverage',
				'pay_date'
			],
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
			amendments: { fields: [] }
		},
		// a company with one pay group needs none named
		filled: { fields: ['pay_group_id', 'settings_id', 'salary_coverage', 'pay_date'] },
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
				entity_profile_version: {
					where: { entity_id: { in: entityIds }, status: { eq: 'SEALED' } },
					fields: ['entity_id', 'effective_range', 'settings_code'],
					limit: 10000
				},
				jurisdiction_settings: {
					where: { status: { eq: 'SEALED' } },
					fields: ['id', 'code', 'effective_range'],
					limit: 10000
				},
				// year-to-date only moves forward; a paid period worked out again is read off its own run
				payroll_run: {
					where: { entity_id: { in: entityIds } },
					fields: [
						'entity_id',
						'pay_group_id',
						'period',
						'kind',
						'salary_coverage',
						'run_number',
						'pay_date',
						'settings_id',
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
				// the tasks already raised for what someone who has left still owes
				obligation: {
					where: { occurrence_key: { like: 'recovery:%' } },
					fields: ['occurrence_key'],
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
				[...known.adhoc_catalog_entry.rows, ...known.claim_catalog_entry.rows].map(({ id }) =>
					String(id)
				)
			);
			// an amended period HR named that is no longer open was carried by another run
			const open = new Set(known.pay_amendment.rows.map(({ id }) => String(id)));
			const on = (range: { from: string; to: string | null }, day: string) =>
				range.from <= day && (range.to === null || day <= range.to);
			const runs = [];
			for (const [index, row] of input.entries()) {
				const version = known.entity_profile_version.rows.find(
					(entry) =>
						String(entry.entity_id) === String(row.entity_id) &&
						on(entry.effective_range, `${row.period.slice(0, 7)}-01`)
				);
				if (version === undefined)
					return yield* ctx.refuse('errors.payroll_run_no_entity_version', {
						row: index,
						values: { period: row.period }
					});
				// the run's pay group: the one named, else the company's only one
				const groups = known.pay_group.rows.filter(
					(entry) => String(entry.entity_id) === String(row.entity_id)
				);
				const group =
					row.pay_group_id == null
						? groups.length === 1
							? groups[0]
							: undefined
						: groups.find((entry) => String(entry.id) === String(row.pay_group_id));
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
				const prior = known.payroll_run.rows.filter(
					(entry) => String(entry.pay_group_id) === String(group.id)
				);
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
						String(entry.salary_coverage.from) <= cycle.to &&
						cycle.from <= String(entry.salary_coverage.to)
				);
				if (!offCycle && paid !== undefined)
					return yield* ctx.refuse('errors.payroll_run_cycle_paid', {
						row: index,
						field: 'period',
						values: {
							period: paid.period,
							from: String(paid.salary_coverage.from),
							to: String(paid.salary_coverage.to),
							group: group.name
						}
					});
				const pay_date = offCycle ? ctx.today : payDateOf(schedule, row.period);
				const settings = known.jurisdiction_settings.rows.find(
					(entry) => entry.code === version.settings_code && on(entry.effective_range, pay_date)
				);
				if (settings === undefined)
					return yield* ctx.refuse('errors.payroll_run_no_law', {
						row: index,
						values: { code: version.settings_code, date: pay_date }
					});
				// the rows HR named for an off-cycle run, linked under their layer's name
				const pays = new Set([...row.adhoc, ...row.claim].map((entry) => String(entry.id)));
				// the open amendment rows HR named for an off-cycle run: it carries their people's earlier periods
				const carries = new Set(row.amendments.map((entry) => String(entry.id)));
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
						settings_id: settings.id,
						salary_coverage: { from: cycle.from, to: cycle.to },
						pay_date
					},
					code: settings.code,
					frame: offCycle
						? { attendance: cycle, pays, carries }
						: { attendance: attendanceOf(schedule, cycle) }
				});
			}
			const rows = runs.map(({ row }) => row);
			yield* validateRegistered(
				ctx.query,
				'payroll_run',
				'create',
				rows.map((row) => jsonObject(row))
			);
			const calculated = [];
			const posting = [];
			const deferred = [];
			const owing = [];
			for (const { id, row, code, frame } of runs) {
				const data = yield* loadRun(ctx.query, jsonObject(row), frame, code);
				const unmerged = data.statutory_change?.find(
					(entry) =>
						entry.jurisdiction_code === code &&
						typeof entry.effective_from === 'string' &&
						entry.effective_from <= row.salary_coverage.to
				);
				if (unmerged !== undefined)
					return yield* ctx.refuse('errors.payroll_run_merge_law', {
						values: { code, date: String(unmerged.effective_from) }
					});
				const result = yield* amendedRun(
					ctx.query,
					{ id: String(id), row: jsonObject(row), frame, data },
					{
						runs: known.payroll_run.rows.map((entry) => jsonObject(entry)),
						groups: known.pay_group.rows.map((entry) => jsonObject(entry)),
						amendments: known.pay_amendment.rows.map((entry) => jsonObject(entry)),
						laws: known.jurisdiction_settings.rows.map((entry) => jsonObject(entry))
					}
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
					// someone it pays too little has nothing to take from: HR recovers it, or their next run does
					if (result.deferred.length > 0)
						return yield* ctx.refuse('errors.payroll_run_carry_takes_back');
					// nothing negative posts to a balance, so a deduction that outruns the run waits for the next on-cycle run
					if (result.payslips.some((slip) => Number(slip.net_pay) < 0))
						return yield* ctx.refuse('errors.payroll_run_below_zero');
					// the month's totals hold both companies: on-cycle, each stands alone
					const { from, to } = row.salary_coverage;
					const moved = yield* ctx.query({
						employee_contract: {
							where: {
								employee_id: {
									in: result.payslips.map((slip) => idOf('employee_profile', slip.employee_id))
								}
							},
							fields: ['entity_id', 'effective_range'],
							limit: 10000
						}
					});
					const both = moved.employee_contract.rows.some(
						({ entity_id, effective_range: range }) =>
							entity_id !== row.entity_id &&
							String(range.from) <= String(to) &&
							(range.to == null || String(range.to) >= String(from))
					);
					if (both) return yield* ctx.refuse('errors.payroll_run_moved_company');
				}
				const payslips = result.payslips.map((slip) => ({
					settings_id: row.settings_id,
					employee_id: idOf('employee_profile', slip.employee_id),
					employment_id: idOf('employee_contract', slip.employment_id),
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
				}));
				// what the run seals is linked at the revision it read: a row changed since is a conflict
				const ids = (layer: string) => result.attaches[layer] ?? [];
				// a month of rosters runs past Bolt's 1,000 values a list: one read, the list in chunks
				const anyOf = <T extends string>(list: readonly T[]) => ({
					or: Array.from({ length: Math.ceil(list.length / 1000) || 1 }, (_, at) => ({
						id: { in: list.slice(at * 1000, at * 1000 + 1000) }
					}))
				});
				const sealed = yield* ctx.query({
					leave_catalog_entry: {
						where: anyOf(ids('leave').map((entry) => idOf('leave_catalog_entry', entry))),
						fields: ['revision'],
						limit: 10000
					},
					leave_catalog_entry_day: {
						where: anyOf(ids('leave_day').map((entry) => idOf('leave_catalog_entry_day', entry))),
						fields: ['revision'],
						limit: 10000
					},
					claim_catalog_entry: {
						where: anyOf(ids('claim').map((entry) => idOf('claim_catalog_entry', entry))),
						fields: ['revision'],
						limit: 10000
					},
					adhoc_catalog_entry: {
						where: anyOf(ids('adhoc').map((entry) => idOf('adhoc_catalog_entry', entry))),
						fields: ['revision'],
						limit: 10000
					},
					loan_catalog_entry_repayment: {
						where: anyOf(
							ids('repayment').map((entry) => idOf('loan_catalog_entry_repayment', entry))
						),
						fields: ['revision'],
						limit: 10000
					},
					workplace_case_catalog_entry: {
						where: anyOf(ids('case').map((entry) => idOf('workplace_case_catalog_entry', entry))),
						fields: ['revision'],
						limit: 10000
					},
					roster_entry: {
						where: anyOf(ids('roster_entry').map((entry) => idOf('roster_entry', entry))),
						fields: ['revision'],
						limit: 10000
					},
					pay_amendment: {
						where: anyOf(result.taken.map((entry) => idOf('pay_amendment', entry))),
						fields: ['revision'],
						limit: 10000
					}
				});
				calculated.push({
					...row,
					payslips,
					leave: sealed.leave_catalog_entry.rows.map(({ id, revision }) => ({ id, revision })),
					leave_day: sealed.leave_catalog_entry_day.rows.map(({ id, revision }) => ({
						id,
						revision
					})),
					claim: sealed.claim_catalog_entry.rows.map(({ id, revision }) => ({ id, revision })),
					adhoc: sealed.adhoc_catalog_entry.rows.map(({ id, revision }) => ({ id, revision })),
					repayment: sealed.loan_catalog_entry_repayment.rows.map(({ id, revision }) => ({
						id,
						revision
					})),
					case: sealed.workplace_case_catalog_entry.rows.map(({ id, revision }) => ({
						id,
						revision
					})),
					roster_entry: sealed.roster_entry.rows.map(({ id, revision }) => ({ id, revision })),
					amendments: sealed.pay_amendment.rows.map(({ id, revision }) => ({ id, revision }))
				});
				posting.push({ id, pay_date: String(row.pay_date), payslips: payslips.map(jsonObject) });
				// a recovery that outran someone's pay is taken by the next run: this run's own period is amended
				// Someone who has left and still owes: no later run pays them, so the rest is HR's to recover. One task says so.
				const coveredTo = String(row.salary_coverage.to);
				for (const employee of result.deferred) {
					const slip = result.payslips.find((entry) => entry.employee_id === employee);
					// a version ends the employment only at an exit: one that runs on, or ends later, is paid by a later run
					const stays = (data.employee_contract ?? [])
						.filter((contract) => String(contract.employee_id) === employee)
						.some((contract) => {
							const to = jsonObject(contract.effective_range).to;
							return contract.exit !== true || to == null || String(to) > coveredTo;
						});
					const owed = slip?.breakdown.lines.find((line) => line.code === RECOVERY)?.amount;
					const occurrence_key = `recovery:${String(slip?.employment_id)}:${row.period}`;
					if (slip === undefined || owed === undefined || stays) continue;
					if (known.obligation.rows.some((task) => task.occurrence_key === occurrence_key))
						continue;
					owing.push({
						entity_id: row.entity_id,
						employee_id: idOf('employee_profile', employee),
						employment_id: idOf('employee_contract', slip.employment_id),
						title: `Recover ${new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(owed)} outside payroll: the last payslip (${row.period}) ended at zero and no later run pays this person`,
						occurrence_key
					});
				}
				// a run made again after it was deleted finds the row its first making left: one open row a person and period
				deferred.push(
					...result.deferred
						.filter(
							(employee) =>
								!known.pay_amendment.rows.some(
									(held) =>
										String(held.employee_id) === employee &&
										String(held.pay_group_id) === String(row.pay_group_id) &&
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
					...(yield* runPostings(ctx.query, posting)),
					...(deferred.length === 0 ? {} : { pay_amendment: { create: deferred } }),
					...(owing.length === 0 ? {} : { obligation: { create: owing } })
				}
			};
		},
		effect: function* (changes, ctx) {
			yield* tap(
				ctx,
				'create',
				'payroll_run',
				changes.map(({ after }) => ({ after }))
			);
		}
	},
	update: {
		columns: { fields: ['state'] },
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
			yield* tap(ctx, 'update', 'payroll_run', changes);
			// service bands and anniversaries move on no event of their own: every paid run looks
			const paid = changes.filter(
				({ before, after }) => before.state !== 'PAID' && after.state === 'PAID'
			);
			if (paid.length === 0) return;
			yield* ctx.schedule('ledger', {}, { key: 'ledger' });
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
			// a later run's year-to-date already counts this one, for anyone paid in both
			const { payslip: own, payroll_run: runs } = yield* ctx.query({
				payslip: { where: { payroll_run_id: { in: ids } }, fields: ['employee_id'], limit: 10000 },
				payroll_run: { fields: ['id', 'run_number'], limit: 10000 }
			});
			const first = Math.min(
				...runs.rows.filter(({ id }) => ids.includes(id)).map((row) => row.run_number)
			);
			const later = runs.rows.filter((row) => row.run_number > first && !ids.includes(row.id));
			if (later.length > 0 && own.rows.length > 0) {
				const { payslip: shared } = yield* ctx.query({
					payslip: {
						where: {
							employee_id: { in: own.rows.map((row) => row.employee_id) },
							payroll_run_id: { in: later.map((row) => row.id) }
						},
						fields: ['id'],
						limit: 1
					}
				});
				if (shared.rows.length > 0) return yield* ctx.refuse('errors.payroll_run_counted_later');
			}
			return { on_approved: yield* back };
		}
	}
});
