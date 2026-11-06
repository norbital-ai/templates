import { model } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { Schema } from 'effect';
import { PlainDate } from '@norbital-ai/std/date';
import { isJsonObject, jsonObject, stableJson } from '../../../lib/payroll_engine/foundation.js';
import {
	attendanceOf,
	cycleOf,
	payDateOf,
	type PayWindow
} from '../../../lib/payroll_engine/pay_cycle.js';
import { idOf, objectValue, queryRows } from '../../../lib/payroll_engine/reads.js';

import type { FileSyncCtx } from '@norbital-ai/bolt';
import { runPosted, runsTakenBack } from '../../../lib/ledger/service.js';
import {
	attachmentsOf,
	calculateRun,
	loadRun
} from '../../../lib/payroll_engine/run_calculation.js';
import { tap } from '../../../lib/payroll_engine/taps.js';
import { validateRegistered } from '../../../lib/payroll_engine/registrations.js';
import { salaryListing } from '../../../lib/export_format_configuration/salary_listing.js';
import { ocbcFast, metroBank } from '../../../lib/export_format_configuration/bank_files.js';
import { exportRows } from '../../../lib/export_format_configuration/export_rows.js';

export default model('payroll_run', {
	description: 'One payroll execution over a company and covered period.',
	label: 'run_number',
	fields: {
		run_number: { kind: 'seq' },
		entity_id: { kind: 'ref', to: 'entity', inverse: 'payroll_runs' },
		period: { kind: 'text' },
		kind: { kind: 'enum', values: ['ON_CYCLE', 'OFF_CYCLE'], default: 'ON_CYCLE' },
		settings_id: { kind: 'ref', to: 'jurisdiction_settings', onDelete: 'restrict' },
		salary_coverage: { kind: 'period', of: 'date' },
		pay_date: { kind: 'date' },
		state: {
			kind: 'state',
			initial: 'UNPAID',
			states: {
				UNPAID: { to: ['PAID'], edit: ['state'] },
				PAID: { to: [], edit: 'none' }
			}
		}
	},
	syncs: {
		salary_listing: {
			with: 'file',
			parser: salaryListing.parser,
			schema: salaryListing.schema,
			context: { payroll_run_id: { kind: 'id', of: 'payroll_run' } },
			write: function* (
				{ context }: { readonly context: { readonly payroll_run_id: string } },
				ctx: FileSyncCtx
			) {
				return salaryListing.records(yield* exportRows(ctx.db.query, context.payroll_run_id));
			}
		},
		ocbc_fast: {
			with: 'file',
			parser: ocbcFast.parser,
			schema: ocbcFast.schema,
			context: { payroll_run_id: { kind: 'id', of: 'payroll_run' } },
			write: function* (
				{ context }: { readonly context: { readonly payroll_run_id: string } },
				ctx: FileSyncCtx
			) {
				return ocbcFast.records(yield* exportRows(ctx.db.query, context.payroll_run_id));
			}
		},
		metro_bank: {
			with: 'file',
			parser: metroBank.parser,
			schema: metroBank.schema,
			context: { payroll_run_id: { kind: 'id', of: 'payroll_run' } },
			write: function* (
				{ context }: { readonly context: { readonly payroll_run_id: string } },
				ctx: FileSyncCtx
			) {
				return metroBank.records(yield* exportRows(ctx.db.query, context.payroll_run_id));
			}
		}
	},
	unique: [{ fields: ['entity_id', 'period'], where: { kind: { eq: 'ON_CYCLE' } } }],
	attaches: {
		leave: { model: 'leave_catalog_entry', field: 'payroll_run_id' },
		claim: { model: 'claim_catalog_entry', field: 'payroll_run_id' },
		adhoc: { model: 'adhoc_catalog_entry', field: 'payroll_run_id' },
		repayment: { model: 'loan_repayment_entry', field: 'payroll_run_id' },
		interruption: { model: 'work_interruption_catalog_entry', field: 'payroll_run_id' },
		case: { model: 'workplace_case_catalog_entry', field: 'payroll_run_id' },
		roster_entry: { model: 'roster_entry', field: 'payroll_run_id' }
	},
	read: {
		payroll_run: { fields: 'all' },
		'payroll_run.payslips': { fields: 'all' },
		'payroll_run.entity_id': { fields: 'all' },
		'payroll_run.settings_id': { fields: 'all' }
	},
	create: {
		columns: {
			'payroll_run.payslips': [
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
				'additional_wages',
				'employee_statutory',
				'employer_statutory',
				'tax_withheld'
			],
			payroll_run: ['entity_id', 'period', 'kind', 'settings_id', 'salary_coverage', 'pay_date']
		},
		filled: { payroll_run: ['settings_id', 'salary_coverage', 'pay_date'] },
		transform: function* (input, ctx) {
			const entityIds = [...new Set(input.map((row) => row.entity_id))];
			const { payroll_run: latest } = yield* ctx.db.query({
				payroll_run: {
					where: { entity_id: { in: entityIds } },
					fields: ['id', 'run_number'],
					orderBy: { run_number: 'desc' },
					limit: entityIds.length
				}
			});
			if (
				!(yield* runPosted(
					ctx.db.query,
					latest.rows.map(({ id }) => id)
				)) ||
				!(yield* runsTakenBack(ctx.db.query))
			)
				return yield* ctx.refuse('The last run is still posting. Try again in a moment.');
			const known = yield* ctx.db.query({
				entity_profile_version: {
					where: { entity_id: { in: entityIds }, status: { eq: 'SEALED' } },
					fields: [
						'entity_id',
						'effective_range',
						'settings_code',
						'payment_schedule',
						'pay_cutoff_day'
					],
					limit: 10000
				},
				jurisdiction_settings: {
					where: { status: { eq: 'SEALED' } },
					fields: ['id', 'code', 'effective_range'],
					limit: 10000
				},
				// what was entered after an earlier run closed is paid by the next one, a cycle late
				payroll_run: {
					where: { entity_id: { in: entityIds } },
					fields: ['entity_id', 'salary_coverage', 'period', 'kind'],
					limit: 10000
				}
			});
			const on = (range: { from: string; to: string | null }, day: string) =>
				range.from <= day && (range.to === null || day <= range.to);
			const framed = input.map((row) => {
				const version = known.entity_profile_version.rows.find(
					(entry) =>
						String(entry.entity_id) === String(row.entity_id) &&
						on(entry.effective_range, `${row.period.slice(0, 7)}-01`)
				);
				if (version === undefined) return `No sealed entity version covers ${row.period}.`;
				const schedule = jsonObject(version.payment_schedule);
				const cycle = cycleOf(schedule, row.period);
				if (cycle === undefined) return `${row.period} is not a pay cycle of this entity.`;
				const offCycle = row.kind === 'OFF_CYCLE';
				const prior = known.payroll_run.rows.filter(
					(entry) => String(entry.entity_id) === String(row.entity_id)
				);
				// year-to-date only moves forward: a skipped cycle cannot run behind a later one
				const later = prior.find((entry) => entry.kind === 'ON_CYCLE' && entry.period > row.period);
				if (!offCycle && later !== undefined)
					return `${later.period} has already run, so ${row.period} cannot run after it.`;
				const pay_date = PlainDate(offCycle ? ctx.today : payDateOf(schedule, row.period));
				const settings = known.jurisdiction_settings.rows.find(
					(entry) => entry.code === version.settings_code && on(entry.effective_range, pay_date)
				);
				if (settings === undefined)
					return `No sealed ${version.settings_code} law covers ${pay_date}.`;
				// a write callback sees attached ids under their layer's name
				const attached = jsonObject(row);
				const pays = new Set(
					[attached.adhoc, attached.claim].flatMap((ids) =>
						Array.isArray(ids) ? ids.map(String) : []
					)
				);
				if (offCycle && pays.size === 0) return 'Choose what this run pays.';
				const earliest = prior.reduce<PayWindow>(
					(low, { salary_coverage: { from, to } }) =>
						from < low.from ? { from, to: String(to) } : low,
					cycle
				);
				return {
					row: {
						entity_id: row.entity_id,
						period: row.period,
						kind: offCycle ? ('OFF_CYCLE' as const) : ('ON_CYCLE' as const),
						settings_id: settings.id,
						salary_coverage: { from: PlainDate(cycle.from), to: PlainDate(cycle.to) },
						pay_date
					},
					code: settings.code,
					frame: {
						attendance: offCycle ? cycle : attendanceOf(schedule, version.pay_cutoff_day, cycle),
						since: attendanceOf(schedule, version.pay_cutoff_day, earliest).from,
						...(offCycle ? { pays } : {})
					}
				};
			});
			const refused = framed.find((entry) => typeof entry === 'string');
			if (typeof refused === 'string') return yield* ctx.refuse(refused);
			const runs = framed.flatMap((entry) => (typeof entry === 'string' ? [] : [entry]));
			const rows = runs.map(({ row }) => row);
			yield* validateRegistered(
				ctx.db.query,
				'payroll_run',
				'create',
				rows.map((row) => jsonObject(row))
			);
			const calculated = [];
			for (const { row, code, frame } of runs) {
				const data = yield* loadRun(ctx.db.query, jsonObject(row), frame);
				const unmerged = data.statutory_change?.find(
					(entry) =>
						entry.jurisdiction_code === code &&
						typeof entry.effective_from === 'string' &&
						entry.effective_from <= row.salary_coverage.to
				);
				if (unmerged !== undefined)
					return yield* ctx.refuse(
						`Merge the confirmed ${code} law taking effect ${String(unmerged.effective_from)} before this run.`
					);
				const result = yield* calculateRun(data, jsonObject(row), frame);
				// an off-cycle run seals what it pays: an entry with no payslip here would never be paid
				const paid = new Set(result.payslips.map((slip) => slip.employment_id));
				if (
					frame.pays !== undefined &&
					[...(data.adhoc_catalog_entry ?? []), ...(data.claim_catalog_entry ?? [])].some(
						(entry) => !paid.has(String(entry.employment_id))
					)
				)
					return yield* ctx.refuse(
						'Someone in this run was not employed in its period. Run it on the period of their last day.'
					);
				if (frame.pays !== undefined) {
					// nothing negative posts to a balance, so a reversal that outruns the run waits for the next on-cycle run
					if (result.payslips.some((slip) => Number(slip.net_pay) < 0))
						return yield* ctx.refuse(
							'This run would take someone below zero. A reversal goes in the next on-cycle run.'
						);
					// the month's totals hold both companies: on-cycle, each stands alone
					const { from, to } = row.salary_coverage;
					const moved = yield* ctx.db.query({
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
					if (both)
						return yield* ctx.refuse(
							'Someone in this run moved between companies this month. Pay this on the on-cycle run.'
						);
				}
				calculated.push({
					...row,
					payslips: result.payslips.map((slip) => ({
						settings_id: row.settings_id,
						employee_id: idOf('employee_profile', slip.employee_id),
						employment_id: idOf('employee_contract', slip.employment_id),
						entity_id: idOf('entity', slip.entity_id),
						basic_earnings: slip.basic_earnings,
						gross_earnings: slip.gross_earnings,
						net_pay: slip.net_pay,
						total_deductions: slip.total_deductions,
						employer_cost: slip.employer_cost,
						period: slip.period,
						ordinary_wages: slip.ordinary_wages,
						additional_wages: slip.additional_wages,
						employee_statutory: slip.employee_statutory,
						employer_statutory: slip.employer_statutory,
						tax_withheld: slip.tax_withheld,
						breakdown: slip.breakdown
					})),
					attaches: attachmentsOf(data, frame)
				});
			}
			return calculated;
		}
	},
	update: {
		columns: { payroll_run: ['state'] },
		transform: function* (changes, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'payroll_run',
				'update',
				changes.map((change) => jsonObject({ ...change.before, ...change.set }))
			);
			const paying = changes.filter(({ set }) => set.state === 'PAID').map(({ before }) => before);
			if (
				paying.length > 0 &&
				!(yield* runPosted(
					ctx.db.query,
					paying.map(({ id }) => id)
				))
			)
				return yield* ctx.refuse(
					'This run is still posting. Try again in a moment, or delete it and run it again.'
				);
			return changes.map((change) => change.set);
		}
	},
	effect: {
		deleted: function* (rows, ctx) {
			yield* ctx.schedule('ledger', { post: rows.map((row) => `payroll_run:${row.id}`) });
		},
		created: function* (rows, ctx) {
			yield* ctx.schedule('ledger', { post: rows.map((row) => `payroll_run:${row.id}`) });
			yield* tap(
				ctx,
				'create',
				{ collection: 'payroll_run', ids: rows.map((row) => row.id) },
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			yield* tap(
				ctx,
				'update',
				{ collection: 'payroll_run', ids: changes.map(({ after }) => after.id) },
				changes
			);
			// service bands and anniversaries move on no event of their own: every paid run looks
			if (changes.some(({ before, after }) => before.state !== 'PAID' && after.state === 'PAID'))
				yield* ctx.schedule('ledger', {}, { key: 'ledger' });
		}
	},
	delete: {
		check: function* (rows, ctx) {
			if (rows.some((row) => row.state === 'PAID'))
				return yield* ctx.refuse('A paid run is locked.');
			// a later run's year-to-date already counts this one, for anyone paid in both
			const ids = rows.map((row) => row.id);
			const { payslip: own, payroll_run: runs } = yield* ctx.db.query({
				payslip: { where: { payroll_run_id: { in: ids } }, fields: ['employee_id'], limit: 10000 },
				payroll_run: { fields: ['id', 'run_number'], limit: 10000 }
			});
			const numbers = runs.rows.filter(({ id }) => ids.includes(id));
			const first = Math.min(...numbers.map((row) => row.run_number));
			const later = runs.rows.filter((row) => row.run_number > first && !ids.includes(row.id));
			if (later.length === 0 || own.rows.length === 0) return;
			const { payslip: shared } = yield* ctx.db.query({
				payslip: {
					where: {
						employee_id: { in: own.rows.map((row) => row.employee_id) },
						payroll_run_id: { in: later.map((row) => row.id) }
					},
					fields: ['id'],
					limit: 1
				}
			});
			if (shared.rows.length > 0)
				return yield* ctx.refuse('A later run has already counted this one. Delete it first.');
		}
	}
});
