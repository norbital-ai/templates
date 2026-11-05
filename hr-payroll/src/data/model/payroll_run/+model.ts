import { model } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { Schema } from 'effect';
import { isJsonObject, jsonObject, stableJson } from '../../../lib/payroll_engine/foundation.js';
import { idOf } from '../../../lib/payroll_engine/reads.js';

import type { FileSyncCtx } from '@norbital-ai/bolt';
import { calculateRun } from '../../../lib/payroll_engine/run_calculation.js';
import { tap } from '../../../lib/payroll_engine/taps.js';
import { validateRegistered } from '../../../lib/payroll_engine/registrations.js';
import { salaryListing } from '../../../lib/export_format_configuration/salary_listing.js';
import { ocbcFast, metroBank } from '../../../lib/export_format_configuration/bank_files.js';
import { exportRows } from '../../../lib/export_format_configuration/export_rows.js';

const immutable = [
	'entity_id',
	'settings_id',
	'period',
	'kind',
	'salary_coverage',
	'attendance_coverage',
	'payment_timezone',
	'source_reference',
	'replacement_of_id',
	'replacement_reason',
	'occurrence_key'
] as const;

export default model('payroll_run', {
	description: 'One payroll execution over a company and covered period.',
	label: 'run_number',
	fields: {
		run_number: { kind: 'seq' },
		entity_id: { kind: 'ref', to: 'entity', inverse: 'payroll_runs' },
		settings_id: { kind: 'ref', to: 'jurisdiction_settings', onDelete: 'restrict' },
		period: { kind: 'text' },
		kind: { kind: 'enum', values: ['REGULAR', 'OFF_CYCLE', 'FINAL', 'CORRECTION'] },
		salary_coverage: { kind: 'period', of: 'date' },
		attendance_coverage: { kind: 'period', of: 'date' },
		pay_date: { kind: 'date' },
		pay_due_date: { kind: 'date' },
		payment_timezone: { kind: 'text', format: 'zone' },
		source_reference: { kind: 'text', optional: true },
		replacement_of_id: { kind: 'ref', to: 'payroll_run', optional: true, onDelete: 'restrict' },
		replacement_reason: { kind: 'text', optional: true },
		source_manifest: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {}
		},
		findings: { kind: 'json', default: [] },
		occurrence_key: { kind: 'text' },
		state: {
			kind: 'state',
			initial: 'FINALISED',
			states: {
				FINALISED: { to: ['PAID', 'SUPERSEDED'], edit: ['state'] },
				PAID: { to: [], edit: 'none' },
				SUPERSEDED: { to: [], edit: 'none' }
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
	unique: [{ fields: ['occurrence_key'] }],
	attaches: {
		leave: { model: 'leave_catalog_entry', field: 'payroll_run_id' },
		claim: { model: 'claim_catalog_entry', field: 'payroll_run_id' },
		adhoc: { model: 'adhoc_catalog_entry', field: 'payroll_run_id' },
		loan: { model: 'loan_catalog_entry', field: 'payroll_run_id' },
		repayment: { model: 'loan_repayment_entry', field: 'payroll_run_id' },
		interruption: { model: 'work_interruption_catalog_entry', field: 'payroll_run_id' },
		case: { model: 'workplace_case_catalog_entry', field: 'payroll_run_id' },
		roster_entry: { model: 'roster_entry', field: 'payroll_run_id' }
	},
	read: {
		payroll_run: { fields: 'all' },
		'payroll_run.payslips': { fields: 'all' },
		'payroll_run.ledger_entries': { fields: 'all' },
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
			payroll_run: [
				'entity_id',
				'settings_id',
				'period',
				'kind',
				'salary_coverage',
				'attendance_coverage',
				'pay_date',
				'pay_due_date',
				'payment_timezone',
				'source_reference',
				'replacement_of_id',
				'replacement_reason',
				'occurrence_key',
				'state'
			]
		},
		transform: function* (rows, ctx) {
			yield* validateRegistered(
				ctx.db.query,
				'payroll_run',
				'create',
				rows.map((row) => jsonObject(row))
			);
			for (const row of rows) {
				if (
					row.salary_coverage.to === null ||
					row.attendance_coverage.to === null ||
					row.salary_coverage.from > row.salary_coverage.to ||
					row.attendance_coverage.from > row.attendance_coverage.to
				)
					return yield* ctx.refuse('Payroll needs complete salary and attendance periods.');
				if (row.replacement_of_id != null && !row.replacement_reason?.trim())
					return yield* ctx.refuse('Record why this run replaces an earlier draft.');
			}
			const coverOf = (row: (typeof rows)[number]) => {
				const { from, to } = row.attendance_coverage;
				return to === null ? null : { from, to };
			};
			const covers = rows.flatMap((row) => {
				const cover = coverOf(row);
				return cover === null ? [] : [cover];
			});
			const from = covers.map((cover) => cover.from).sort()[0];
			const to = covers
				.map((cover) => cover.to)
				.sort()
				.at(-1);
			const entityIds = [...new Set(rows.map((row) => row.entity_id))];
			const settingsIds = [...new Set(rows.map((row) => row.settings_id))];
			// what was entered after an earlier run closed is paid by the next one, a cycle late
			const closed =
				entityIds.length === 0
					? []
					: (yield* ctx.db.query({
							payroll_run: {
								where: { entity_id: { in: entityIds } },
								fields: ['attendance_coverage'],
								limit: 10000
							}
						})).payroll_run.rows.map((row) => row.attendance_coverage.from);
			const since =
				from === undefined
					? undefined
					: closed.reduce((low, date) => (date < low ? date : low), from);
			const sources =
				entityIds.length === 0 || since === undefined || to === undefined
					? null
					: yield* ctx.db.query({
							jurisdiction_settings: {
								where: { id: { in: settingsIds } },
								fields: ['id', 'status', 'code', 'effective_range'],
								limit: 10000
							},
							statutory_change: {
								where: {
									applied_version_id: { isNull: true },
									finding_id: { is: { status: { eq: 'CONFIRMED' } } }
								},
								fields: ['jurisdiction_code', 'effective_from'],
								limit: 10000
							},
							leave_catalog_entry: {
								where: { entity_id: { in: entityIds }, payroll_run_id: { isNull: true } },
								fields: ['id', 'entity_id', 'days'],
								limit: 10000
							},
							claim_catalog_entry: {
								where: {
									entity_id: { in: entityIds },
									incurred_on: { gte: since, lte: to },
									payroll_run_id: { isNull: true }
								},
								fields: ['id', 'entity_id', 'incurred_on'],
								limit: 10000
							},
							adhoc_catalog_entry: {
								where: {
									entity_id: { in: entityIds },
									incurred_on: { gte: since, lte: to },
									payroll_run_id: { isNull: true }
								},
								fields: ['id', 'entity_id', 'incurred_on'],
								limit: 10000
							},
							loan_catalog_entry: {
								where: { entity_id: { in: entityIds }, payroll_run_id: { isNull: true } },
								fields: ['id'],
								limit: 10000
							},
							loan_repayment_entry: {
								where: {
									entity_id: { in: entityIds },
									paid_on: { gte: from, lte: to },
									payroll_run_id: { isNull: true }
								},
								fields: ['id', 'entity_id', 'loan_id', 'paid_on'],
								limit: 10000
							},
							work_interruption_catalog_entry: {
								where: { entity_id: { in: entityIds }, payroll_run_id: { isNull: true } },
								fields: ['id', 'entity_id', 'period'],
								limit: 10000
							},
							workplace_case_catalog_entry: {
								where: { entity_id: { in: entityIds }, payroll_run_id: { isNull: true } },
								fields: ['id', 'entity_id', 'opened_on', 'closed_on'],
								limit: 10000
							},
							employee_contract: {
								where: { entity_id: { in: entityIds }, status: { eq: 'SEALED' } },
								fields: ['id', 'entity_id'],
								limit: 10000
							},
							roster_entry: {
								where: {
									employment_id: { is: { entity_id: { in: entityIds } } },
									work_date: { gte: since, lte: to },
									payroll_run_id: { isNull: true }
								},
								fields: ['id', 'employment_id', 'work_date'],
								limit: 10000
							}
						});
			const sealedSettings = new Set(
				(sources?.jurisdiction_settings?.rows ?? [])
					.filter((entry) => entry.status === 'SEALED')
					.map((entry) => String(entry.id))
			);
			if (rows.some((row) => !sealedSettings.has(String(row.settings_id))))
				return yield* ctx.refuse('Choose a sealed jurisdiction.');
			for (const row of rows) {
				const settings = sources?.jurisdiction_settings.rows.find(
					(entry) => String(entry.id) === String(row.settings_id)
				);
				if (settings === undefined) continue;
				// law applies by the wages' period or their payment, by jurisdiction: either end of the run may name its version
				const earned = row.salary_coverage.to ?? row.pay_date;
				const { from: start, to: end } = settings.effective_range;
				const covered = (day: string) => start <= day && (end === null || day <= end);
				if (!covered(earned) && !covered(row.pay_date))
					return yield* ctx.refuse(`That jurisdiction version does not cover ${row.pay_date}.`);
				const unmerged = sources?.statutory_change.rows.find(
					(entry) =>
						entry.jurisdiction_code === settings.code &&
						entry.effective_from != null &&
						entry.effective_from <= earned
				);
				if (unmerged !== undefined)
					return yield* ctx.refuse(
						`Merge the confirmed ${settings.code} law taking effect ${unmerged.effective_from} before this run.`
					);
			}
			const contracts = new Map(
				(sources?.employee_contract.rows ?? []).map((entry) => [
					String(entry.id),
					String(entry.entity_id)
				])
			);
			const unsealedLoans = new Set(
				(sources?.loan_catalog_entry.rows ?? []).map((entry) => String(entry.id))
			);
			const attachOf = (row: (typeof rows)[number]) => {
				const cover = coverOf(row);
				if (cover === null)
					return {
						leave: [],
						claim: [],
						adhoc: [],
						loan: [],
						repayment: [],
						interruption: [],
						case: [],
						roster_entry: []
					};
				const within = (date: unknown) =>
					typeof date === 'string' && date >= cover.from && date <= cover.to;
				const due = (date: unknown) => typeof date === 'string' && date <= cover.to;
				const entity = String(row.entity_id);
				const leave = (sources?.leave_catalog_entry.rows ?? [])
					.filter(
						(entry) =>
							String(entry.entity_id) === entity &&
							Array.isArray(entry.days) &&
							entry.days.some((day) => isJsonObject(day) && within(day.date))
					)
					.map((entry) => idOf('leave_catalog_entry', entry.id));
				const claim = (sources?.claim_catalog_entry.rows ?? [])
					.filter((entry) => String(entry.entity_id) === entity && due(entry.incurred_on))
					.map((entry) => idOf('claim_catalog_entry', entry.id));
				const adhoc = (sources?.adhoc_catalog_entry.rows ?? [])
					.filter((entry) => String(entry.entity_id) === entity && due(entry.incurred_on))
					.map((entry) => idOf('adhoc_catalog_entry', entry.id));
				const repayment = (sources?.loan_repayment_entry.rows ?? [])
					.filter((entry) => String(entry.entity_id) === entity && due(entry.paid_on))
					.map((entry) => idOf('loan_repayment_entry', entry.id));
				const loan = [
					...new Set(
						(sources?.loan_repayment_entry.rows ?? [])
							.filter(
								(entry) =>
									String(entry.entity_id) === entity &&
									due(entry.paid_on) &&
									unsealedLoans.has(String(entry.loan_id))
							)
							.map((entry) => idOf('loan_catalog_entry', entry.loan_id))
					)
				];
				const interruption = (sources?.work_interruption_catalog_entry.rows ?? [])
					.filter((entry) => {
						if (String(entry.entity_id) !== entity || !isJsonObject(entry.period)) return false;
						return (
							String(entry.period['from']) <= cover.to &&
							(entry.period['to'] == null || String(entry.period['to']) >= cover.from)
						);
					})
					.map((entry) => idOf('work_interruption_catalog_entry', entry.id));
				const workplaceCase = (sources?.workplace_case_catalog_entry.rows ?? [])
					.filter(
						(entry) =>
							String(entry.entity_id) === entity &&
							String(entry.opened_on) <= cover.to &&
							(entry.closed_on == null || String(entry.closed_on) >= cover.from)
					)
					.map((entry) => idOf('workplace_case_catalog_entry', entry.id));
				const roster_entry = [
					...new Set(
						(sources?.roster_entry.rows ?? [])
							.filter(
								(entry) =>
									contracts.get(String(entry.employment_id)) === entity && due(entry.work_date)
							)
							.map((entry) => idOf('roster_entry', entry.id))
					)
				];
				return {
					leave,
					claim,
					adhoc,
					loan,
					repayment,
					interruption,
					case: workplaceCase,
					roster_entry
				};
			};
			const calculated = [];
			for (const row of rows) {
				const result = yield* calculateRun(ctx.db.query, jsonObject(row));
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
						breakdown: slip.breakdown,
						state: 'FINALISED' as const
					})),
					attaches: attachOf(row),
					ledger_entries: result.ledger.map((movement) => ({
						balance_id: idOf('employee_balance', movement.balance_id),
						operation: movement.operation,
						account: movement.account,
						code: movement.code,
						amount: movement.amount,
						...(movement.unit === undefined ? {} : { unit: movement.unit }),
						effective_on: movement.effective_on
					}))
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
			return changes.map((change) => change.set);
		}
	},
	effect: {
		created: function* (rows, ctx) {
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
		}
	},
	delete: {
		check: function* (rows, ctx) {
			if (rows.some((row) => row.state === 'PAID'))
				return yield* ctx.refuse('Paid payroll evidence cannot be deleted.');
			const got = yield* ctx.db.query({
				payslip: { where: { payroll_run_id: { in: rows.map((row) => row.id) } } }
			});
			if (got.payslip.rows.some((row) => row.state === 'FINALISED' || row.state === 'PAID'))
				return yield* ctx.refuse('This run contains finalised payroll.');
		}
	}
});
