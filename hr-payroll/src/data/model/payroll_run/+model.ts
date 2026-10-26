import {
	model,
	type Id,
	type CreateRow,
	type UpdateSet,
	type StoredRow,
	type WriteCtx
} from '@norbital-ai/bolt';
import { Decimal, currency } from '@norbital-ai/std/decimal';
import { inputSchema } from '@norbital-ai/std/kind';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Result, Schema } from 'effect';
import {
	PAYROLL_SLOTS,
	Reads,
	readsFrom,
	runEngine
} from '../../../lib/payroll_engine/foundation.js';
import { admitPayrollRun, loadPayrollAdmission } from '../../../lib/payroll_engine/admit.js';
import { buildPayrollRun, loadPayrollBuild } from '../../../lib/payroll_engine/run.js';
import {
	currencyScale,
	type PayrollRunRequest,
	type PinnedCollection
} from '../../../lib/payroll_engine/payslip/context.js';
import {
	bankAccountFrom,
	moneyText,
	exportEntries,
	exportSlip,
	payable,
	plainRow,
	recordDocuments,
	payslipLines,
	type ExportDocument,
	type ExportPayment
} from '../../../lib/payroll_engine/export.js';
import { salaryReport, type SalaryReport } from '../../../lib/payroll_engine/salary_report.js';
import { bankExportDocuments } from '../../../lib/payroll_engine/bank_export.js';

const SALARY_REPORT: keyof typeof PAYROLL_SLOTS = 'salary_report';

const payslip_columns = [
	'employment_id',
	'salary_from',
	'salary_to',
	'terms_through',
	'service_basis',
	'base',
	'proration',
	'statutory',
	'adjustments',
	'company_payments',
	'gross',
	'total_deductions',
	'net',
	'employer_cost',
	'currency',
	'status'
] as const;

type LedgerPin = {
	readonly employment_id: string;
	readonly collection: PinnedCollection;
	readonly id: string;
};

type Ledger = readonly LedgerPin[];

const leaveId = inputSchema({ kind: 'id', of: 'leave_catalog_entry' });

const isLeaveId = (value: unknown): value is Id<'leave_catalog_entry'> => Schema.is(leaveId)(value);

const PINNED = {
	employment_id: true,
	payslip_id: true,
	catalog_id: true,
	amount: true,
	facts: true
} as const;

type WriteInput = Omit<UpdateSet<'payroll_run'>, 'id'> &
	Partial<Omit<CreateRow<'payroll_run'>, 'id'>> & {
		readonly id?: Id<'payroll_run'>;
		readonly $delete?: true;
	};

const transformRows = Effect.fnUntraced(function* (
	inputs: readonly WriteInput[],
	existing: readonly (StoredRow<'payroll_run'> | undefined)[],
	ctx: WriteCtx<'payroll_run'>
) {
	const requestedEntities = new Set<string>();
	for (const [i, input] of inputs.entries()) {
		if ('$delete' in input || existing[i] !== undefined || input.company_id == null) continue;
		if (requestedEntities.has(input.company_id))
			return yield* ctx.refuse(
				'Calculate one payroll run per entity at a time. Submit the next run after the first finishes.'
			);
		requestedEntities.add(input.company_id);
	}
	const deleted = inputs.flatMap((input, i) => {
		const stored = existing[i];
		return '$delete' in input && stored !== undefined ? [stored.id] : [];
	});
	const capturedLeave: Id<'leave_catalog_entry'>[] = [];
	for (const stored of existing) {
		if (stored === undefined || !deleted.includes(stored.id)) continue;
		for (const pin of stored.pins ?? []) {
			if (pin.collection !== 'leave_catalog_entry') continue;
			if (!isLeaveId(pin.id))
				return yield* ctx.refuse('Review this payroll run’s captured leave before deleting it.');
			capturedLeave.push(pin.id);
		}
	}
	const deletedCompanies = existing.flatMap((stored) =>
		stored !== undefined && deleted.includes(stored.id) ? [stored.company_id] : []
	);
	const requests = new Map<number, PayrollRunRequest>();
	for (const [i, input] of inputs.entries()) {
		if ('$delete' in input || existing[i] !== undefined) continue;
		const decodedKind = Schema.decodeUnknownResult(Schema.Literals(['REGULAR', 'OFF_CYCLE']))(
			input.kind ?? 'REGULAR'
		);
		if (Result.isFailure(decodedKind))
			return yield* ctx.refuse('A payroll run is REGULAR or OFF_CYCLE.', {
				field: 'kind'
			});
		const kind = decodedKind.success;
		if (input.company_id == null)
			return yield* ctx.refuse('This needs an actual approved legal entity.');
		if (input.period == null)
			return yield* ctx.refuse('A pay period requires its actual calendar month.');
		const sources = input.sources ?? [];
		const request = {
			company_id: input.company_id,
			period: input.period,
			kind,
			sources,
			...(input.pay_due_date == null ? {} : { pay_due_date: String(input.pay_due_date) })
		};
		requests.set(i, request);
	}
	const companies = [
		...new Set([...requests.values()].map((request) => request.company_id).concat(deletedCompanies))
	];
	if (companies.length === 0) return inputs;
	const admission = yield* loadPayrollAdmission(ctx.db.query, companies, deleted, capturedLeave);
	const dependencies =
		deleted.length === 0
			? undefined
			: {
					paid: admission.delete_paid,
					leave: admission.delete_leave,
					runs: { rows: admission.runs.rows.filter((run) => run.kind === 'REGULAR') },
					slips: admission.delete_slips
				};
	const buildData =
		requests.size === 0
			? undefined
			: yield* loadPayrollBuild(
					ctx.db.query,
					[...requests.values()].map((request) => request.company_id)
				);

	// A frozen range can price later periods while its single backlink remains on the first capturing payslip.
	if (dependencies !== undefined)
		for (const leave of dependencies.leave.rows) {
			const from = leave.from ?? leave.occurred_on;
			const to = leave.to ?? from;
			const dependent = dependencies.runs.rows.find(
				(run) =>
					!deleted.includes(run.id) &&
					run.company_id === leave.company_id &&
					run.salary_from != null &&
					run.salary_to != null &&
					run.salary_from <= to &&
					run.salary_to >= from &&
					dependencies.slips.rows.some(
						(slip) => slip.payroll_run_id === run.id && slip.employment_id === leave.employment_id
					)
			);
			if (dependent !== undefined)
				return yield* ctx.refuse(
					`This run captured leave also used by payroll ${dependent.period}. Delete that payroll run first.`
				);
		}
	const out: WriteInput[] = [];
	const consumed = new Set<string>();
	for (const [i, input] of inputs.entries()) {
		if ('$delete' in input) {
			const stored = existing[i];
			if (stored === undefined)
				return yield* ctx.refuse('A payroll run must exist before it can be deleted.');
			if (dependencies?.paid.rows.some((slip) => slip.payroll_run_id === stored.id))
				return yield* ctx.refuse('A run with a paid payslip cannot be deleted.');
			out.push(input);
			continue;
		}
		if (existing[i] !== undefined) {
			out.push(input);
			continue;
		}
		// Every run uses the same two prefetched batch reads.
		const request = requests.get(i)!;
		const version = yield* runEngine(admitPayrollRun(request, admission), ctx.db.query, ctx.refuse);
		const outcome = yield* Effect.result(
			buildPayrollRun(request, version, buildData).pipe(
				Effect.provideService(Reads, readsFrom(ctx.db.query))
			)
		);
		if (Result.isFailure(outcome)) {
			if (outcome.failure._tag !== 'Refusal') return yield* Effect.fail(outcome.failure);
			out.push({
				...input,
				settings_id: version.version.id,
				warnings: outcome.failure.message
			});
			continue;
		}
		const plan = outcome.success;
		for (const slip of plan.payslips)
			for (const pin of slip.pins) {
				const key = `${pin.collection}:${pin.id}`;
				if (consumed.has(key))
					return yield* ctx.refuse('A payroll entry can be consumed only once in the same batch.');
				consumed.add(key);
			}
		const ledger: LedgerPin[] = [];
		const payslips = plan.payslips.map((slip) => {
			for (const pin of slip.pins)
				ledger.push({
					employment_id: slip.employment_id,
					collection: pin.collection,
					id: pin.id
				});
			return {
				employment_id: slip.employment_id,
				salary_from: PlainDate(slip.salary_from),
				salary_to: PlainDate(slip.salary_to),
				terms_through: PlainDate(slip.salary_to),
				service_basis: slip.service_basis.map((basis) => ({
					...basis,
					from: PlainDate(basis.from),
					to: PlainDate(basis.to)
				})),
				base: slip.base,
				proration: slip.proration.map(({ window_from, ...proration }) => ({
					...proration,
					from: PlainDate(proration.from),
					to: PlainDate(proration.to),
					...(window_from === undefined ? {} : { window_from: PlainDate(window_from) })
				})),
				statutory: slip.statutory,
				adjustments: slip.adjustments,
				company_payments: slip.company_payments,
				gross: Decimal.fromNumber(slip.gross, 2),
				total_deductions: Decimal.fromNumber(slip.total_deductions, 2),
				net: Decimal.fromNumber(slip.net, 2),
				employer_cost: Decimal.fromNumber(slip.employer_cost, 2),
				currency: currency(slip.currency.toUpperCase()),
				status: 'DRAFT' as const
			};
		});
		out.push({
			...input,
			settings_id: version.version.id,
			configuration_hash: plan.run.configuration_hash,
			pay_date: PlainDate(plan.run.pay_date),
			pay_due_date: PlainDate(plan.run.pay_due_date),
			salary_from: PlainDate(plan.run.salary_from),
			salary_to: PlainDate(plan.run.salary_to),
			attendance_from: PlainDate(plan.run.attendance_from),
			attendance_to: PlainDate(plan.run.attendance_to),
			warnings: plan.warnings.join('\n'),
			pins: ledger,
			holds: plan.payslips.flatMap((slip) =>
				slip.hold == null ? [] : [{ employment_id: slip.employment_id, message: slip.hold }]
			),
			payslip: { create: payslips }
		});
	}
	return out;
});

export default model('payroll_run', {
	description:
		'A frozen payroll calculation for an entity and period: a month (YYYY-MM), or a half (YYYY-MM-1/YYYY-MM-2). The run names the jurisdiction settings version that governed it; payment lives on its payslips and the run carries no state of its own.',
	icon: 'lucide:play-circle',
	label: 'period',
	fields: {
		period: {
			kind: 'text'
		},
		kind: {
			kind: 'enum',
			values: ['REGULAR', 'OFF_CYCLE'],
			default: 'REGULAR'
		},
		sequence: {
			kind: 'int',
			min: 1,
			default: 1
		},
		sources: {
			kind: 'json',
			shape: { kind: 'list', of: { kind: 'text' } },
			optional: true
		},
		configuration_hash: {
			kind: 'text',
			optional: true
		},
		pay_date: {
			kind: 'date',
			optional: true
		},
		pay_due_date: {
			kind: 'date',
			optional: true
		},
		salary_from: {
			kind: 'date',
			optional: true
		},
		salary_to: {
			kind: 'date',
			optional: true
		},
		attendance_from: {
			kind: 'date',
			optional: true
		},
		attendance_to: {
			kind: 'date',
			optional: true
		},
		warnings: {
			kind: 'text',
			default: ''
		},
		pins: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						employment_id: { kind: 'text' },
						collection: { kind: 'text' },
						id: { kind: 'text' }
					}
				}
			},
			optional: true
		},
		holds: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						employment_id: { kind: 'text' },
						message: { kind: 'text' }
					}
				}
			},
			optional: true
		},
		company_id: { kind: 'ref', to: 'entity', inverse: 'payroll_run' },
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'payroll_run'
		}
	},
	read: 'all',
	create: {
		columns: ['company_id', 'period', 'kind', 'sources', 'pay_due_date'],
		with: {
			payslip: {
				create: {
					columns: payslip_columns
				}
			}
		},
		transform: function* (rows, ctx) {
			const transformed = yield* transformRows(
				rows,
				rows.map(() => undefined),
				ctx
			);
			return rows.map((row, index) => {
				const { id: _id, $delete: _delete, ...set } = transformed[index] ?? {};
				return { ...row, ...set };
			});
		}
	},
	update: {
		columns: ['pay_due_date', 'configuration_hash', 'warnings'],
		transform: function* (changes, ctx) {
			const transformed = yield* transformRows(
				changes.map(({ set }) => set),
				changes.map(({ before }) => before),
				ctx
			);
			return changes.map(({ set: original }, index) => {
				const { id: _id, $delete: _delete, ...set } = transformed[index] ?? {};
				return { ...original, ...set };
			});
		}
	},
	queries: {
		export_payroll: {
			description:
				'Bank payment files or a salary report for the selected runs. Each entity, run and currency stays separate. Held employees remain in the salary report and are omitted from bank files.',
			input: {
				ids: { kind: 'list', of: { kind: 'id', of: 'payroll_run' }, min: 1 },
				kind: {
					kind: 'enum',
					values: ['BANK', 'SALARY', 'COMPLIANCE'],
					default: 'BANK'
				},
				generated_at: { kind: 'instant' }
			},
			output: {
				kind: 'object',
				fields: {
					documents: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: { name: { kind: 'text' }, content: { kind: 'text' } }
						}
					},
					salary_reports: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								company: { kind: 'text' },
								period: { kind: 'text' },
								currency: { kind: 'text' },
								run_kind: { kind: 'text' },
								pay_date: { kind: 'text' },
								run_reference: { kind: 'text' },
								minor_units: { kind: 'int' },
								warnings: { kind: 'list', of: { kind: 'text' } },
								columns: {
									kind: 'list',
									of: {
										kind: 'object',
										fields: {
											group: { kind: 'text' },
											family: { kind: 'text' },
											code: { kind: 'text' },
											label: { kind: 'text' },
											external: { kind: 'bool' }
										}
									}
								},
								rows: {
									kind: 'list',
									of: {
										kind: 'object',
										fields: {
											employee_number: { kind: 'text' },
											name: { kind: 'text' },
											status: { kind: 'text' },
											amounts: {
												kind: 'list',
												of: { kind: 'number', optional: true }
											}
										}
									}
								}
							}
						}
					}
				}
			},
			run: function* ({ ids, kind, generated_at }, ctx) {
				const got = yield* ctx.query({
					runs: {
						from: 'payroll_run',
						where: { id: { in: ids } },
						select: {
							id: true,
							company_id: true,
							period: true,
							kind: true,
							settings_id: true,
							salary_from: true,
							salary_to: true,
							pay_date: true
						},
						all: true
					},
					slips: {
						from: 'payslip',
						where: { payroll_run_id: { in: { member: 'runs', field: 'id' } } },
						select: {
							id: true,
							payroll_run_id: true,
							employment_id: true,
							net: true,
							gross: true,
							total_deductions: true,
							currency: true,
							status: true,
							bank_charges: true,
							base: true,
							statutory: true,
							adjustments: true,
							company_payments: true
						},
						all: true
					},
					contracts: {
						from: 'employment_contract',
						where: { id: { in: { member: 'slips', field: 'employment_id' } } },
						select: {
							id: true,
							employee_id: true,
							employee_number: true,
							bank: true,
							effective_range: true,
							exit_ground: true,
							facts: true
						},
						all: true
					},
					people: {
						from: 'employment_profile',
						where: {
							id: { in: { member: 'contracts', field: 'employee_id' } }
						},
						select: {
							id: true,
							name: true,
							identity_number: true,
							date_of_birth: true,
							nationality: true,
							facts: true
						},
						all: true
					},
					entities: {
						from: 'entity',
						where: { id: { in: { member: 'runs', field: 'company_id' } } },
						select: {
							id: true,
							name: true,
							registration_number: true,
							region: true,
							facts: true,
							payment_bank_id: true,
							disbursement_account: true
						},
						all: true
					},
					banks: {
						from: 'bank',
						where: {
							id: { in: { member: 'entities', field: 'payment_bank_id' } }
						},
						select: {
							code: true,
							name: true,
							bank_codes: true,
							currencies: true,
							enabled: true,
							template: true
						},
						all: true
					},
					versions: {
						from: 'jurisdiction_settings',
						where: { id: { in: { member: 'runs', field: 'settings_id' } } },
						select: { id: true, code: true, payroll: true },
						all: true
					},
					work_meta: {
						from: 'work_catalog',
						where: { settings_id: { in: { member: 'versions', field: 'id' } } },
						select: {
							settings_id: true,
							code: true,
							component_code: true,
							direction: true,
							destination: true,
							name: true
						},
						all: true
					},
					allowance_meta: {
						from: 'allowance_catalog',
						where: { settings_id: { in: { member: 'versions', field: 'id' } } },
						select: {
							settings_id: true,
							code: true,
							direction: true,
							destination: true,
							name: true
						},
						all: true
					},
					adhoc_meta: {
						from: 'adhoc_catalog',
						where: { settings_id: { in: { member: 'versions', field: 'id' } } },
						select: {
							settings_id: true,
							code: true,
							direction: true,
							destination: true,
							name: true
						},
						all: true
					},
					claim_meta: {
						from: 'claim_catalog',
						where: { settings_id: { in: { member: 'versions', field: 'id' } } },
						select: {
							settings_id: true,
							code: true,
							destination: true,
							name: true
						},
						all: true
					},
					scheme_meta: {
						from: 'statutory_contribution_catalog',
						where: { settings_id: { in: { member: 'versions', field: 'id' } } },
						select: {
							settings_id: true,
							code: true,
							label: true,
							display_order: true
						},
						all: true
					},
					rules: {
						from: 'rule_set',
						where: {
							settings_id: { in: { member: 'versions', field: 'id' } },
							family: { eq: 'EXPORTS' }
						},
						select: { code: true, rules: true, settings_id: true },
						all: true
					},
					salary_report_rules: {
						from: 'rule_set',
						where: {
							settings_id: { in: { member: 'versions', field: 'id' } },
							family: { eq: 'PAYROLL' },
							code: { eq: SALARY_REPORT }
						},
						select: { rules: true, settings_id: true },
						all: true
					},
					adhoc: {
						from: 'adhoc_catalog_entry',
						where: { payslip_id: { in: { member: 'slips', field: 'id' } } },
						select: { ...PINNED, quantity: true },
						all: true
					},
					adhoc_catalog: {
						from: 'adhoc_catalog',
						where: { id: { in: { member: 'adhoc', field: 'catalog_id' } } },
						select: { code: true },
						all: true
					},
					claims: {
						from: 'claim_catalog_entry',
						where: { payslip_id: { in: { member: 'slips', field: 'id' } } },
						select: { ...PINNED, quantity: true },
						all: true
					},
					claim_catalog: {
						from: 'claim_catalog',
						where: { id: { in: { member: 'claims', field: 'catalog_id' } } },
						select: { code: true },
						all: true
					},
					loans: {
						from: 'loan_repayment_entry',
						where: { payslip_id: { in: { member: 'slips', field: 'id' } } },
						select: {
							employment_id: true,
							payslip_id: true,
							catalog_id: true,
							amount: true
						},
						all: true
					},
					loan_catalog: {
						from: 'loan_catalog',
						where: { id: { in: { member: 'loans', field: 'catalog_id' } } },
						select: { code: true },
						all: true
					},
					leave: {
						from: 'leave_catalog_entry',
						where: { payslip_id: { in: { member: 'slips', field: 'id' } } },
						select: { ...PINNED, days: true, from: true, to: true },
						all: true
					},
					leave_catalog: {
						from: 'leave_catalog',
						where: { id: { in: { member: 'leave', field: 'catalog_id' } } },
						select: { code: true },
						all: true
					}
				});
				const { runs, contracts, people, entities, versions } = got;
				const adhoc = new Map(got.adhoc_catalog.rows.map((row) => [row.id, row]));
				const claims = new Map(got.claim_catalog.rows.map((row) => [row.id, row]));
				const loans = new Map(got.loan_catalog.rows.map((row) => [row.id, row]));
				const leave = new Map(got.leave_catalog.rows.map((row) => [row.id, row]));
				const slips = runs.rows
					.flatMap((run) => got.slips.rows.filter((slip) => slip.payroll_run_id === run.id))
					.map((slip) => ({
						...slip,
						adhoc_catalog_entry: got.adhoc.rows
							.filter((entry) => entry.payslip_id === slip.id)
							.map((entry) => ({
								...entry,
								catalog: adhoc.get(entry.catalog_id) ?? null
							})),
						claim_catalog_entry: got.claims.rows
							.filter((entry) => entry.payslip_id === slip.id)
							.map((entry) => ({
								...entry,
								catalog: claims.get(entry.catalog_id) ?? null
							})),
						loan_repayment_entry: got.loans.rows
							.filter((entry) => entry.payslip_id === slip.id)
							.map((entry) => ({
								...entry,
								catalog: loans.get(entry.catalog_id) ?? null
							})),
						leave_catalog_entry: got.leave.rows
							.filter((entry) => entry.payslip_id === slip.id)
							.map((entry) => ({
								...entry,
								catalog: leave.get(entry.catalog_id) ?? null
							}))
					}));
				const minorUnitsOf = new Map(
					versions.rows.map((row) => [row.id, row.payroll?.minor_units])
				);
				const byContract = new Map(contracts.rows.map((row) => [row.id, row]));
				const byPerson = new Map(people.rows.map((row) => [row.id, row]));
				const byEntity = new Map(entities.rows.map((row) => [row.id, row]));
				const byBank = new Map(got.banks.rows.map((row) => [row.id, row]));
				const documents: ExportDocument[] = [];
				const salary_reports: SalaryReport[] = [];
				const runRows = (selected: typeof runs.rows) =>
					selected.map((row) => ({
						id: row.id,
						period: String(row.period),
						kind: String(row.kind ?? ''),
						salary_from: String(row.salary_from ?? ''),
						salary_to: String(row.salary_to ?? ''),
						pay_date: String(row.pay_date ?? '')
					}));
				const exportRows = (selected: typeof slips) =>
					[...new Set(selected.map((row) => row.employment_id))].map((id) => {
						const contract = byContract.get(id);
						const person = contract == null ? undefined : byPerson.get(contract.employee_id);
						const mine = selected.filter((slip) => slip.employment_id === id);
						return {
							employee: plainRow(person),
							contract: plainRow(contract),
							slips: mine.map((slip) =>
								exportSlip(
									slip,
									String(runs.rows.find((run) => run.id === slip.payroll_run_id)?.period ?? '')
								)
							),
							entries: exportEntries(mine)
						};
					});
				for (const run of runs.rows) {
					const runSlips = slips.filter((slip) => slip.payroll_run_id === run.id);
					const company = byEntity.get(run.company_id);
					for (const currency of [
						...new Set(runSlips.map((slip) => String(slip.currency ?? '')))
					]) {
						const selected = runSlips.filter((slip) => slip.currency === currency);
						const scale = minorUnitsOf.get(run.settings_id) ?? currencyScale(currency);
						if (kind === 'SALARY') {
							salary_reports.push(
								salaryReport({
									company: company?.name ?? '',
									period: String(run.period),
									currency,
									run_kind: run.kind ?? 'REGULAR',
									pay_date: String(run.pay_date ?? ''),
									run_reference: run.id,
									minor_units: scale,
									configuration: got.salary_report_rules.rows.find(
										(row) => row.settings_id === run.settings_id
									)?.rules,
									catalogs: [
										...got.work_meta.rows
											.filter((row) => row.settings_id === run.settings_id)
											.map((row) => ({
												family: 'WORK',
												code: row.component_code ?? row.code,
												direction: row.direction,
												destination: row.destination,
												name: row.name
											})),
										...got.allowance_meta.rows
											.filter((row) => row.settings_id === run.settings_id)
											.map((row) => ({
												family: 'ALLOWANCE',
												code: row.code,
												direction: row.direction,
												destination: row.destination,
												name: row.name
											})),
										...got.adhoc_meta.rows
											.filter((row) => row.settings_id === run.settings_id)
											.map((row) => ({
												family: 'ADHOC',
												code: row.code,
												direction: row.direction,
												destination: row.destination,
												name: row.name
											})),
										...got.claim_meta.rows
											.filter((row) => row.settings_id === run.settings_id)
											.map((row) => ({
												family: 'CLAIM',
												code: row.code,
												destination: row.destination,
												name: row.name
											}))
									],
									schemes: got.scheme_meta.rows.filter(
										(row) => row.settings_id === run.settings_id
									),
									employees: selected.map((slip) => {
										const contract = byContract.get(slip.employment_id);
										const person =
											contract == null ? undefined : byPerson.get(contract.employee_id);
										return {
											employee_number: contract?.employee_number ?? slip.employment_id,
											name: person?.name ?? '',
											status: String(slip.status),
											bank_charges: slip.bank_charges,
											base: slip.base,
											adjustments: slip.adjustments,
											company_payments: slip.company_payments,
											statutory: slip.statutory,
											gross: slip.gross,
											total_deductions: slip.total_deductions,
											net: slip.net,
											consumed_entries: [
												...slip.adhoc_catalog_entry.map((entry) => ({
													family: 'ADHOC',
													source_id: entry.id,
													code: entry.catalog?.code ?? ''
												})),
												...slip.claim_catalog_entry.map((entry) => ({
													family: 'CLAIM',
													source_id: entry.id,
													code: entry.catalog?.code ?? ''
												}))
											]
										};
									})
								})
							);
							continue;
						}
						if (kind === 'COMPLIANCE') continue;
						const payments: ExportPayment[] = selected.map((slip) => {
							const contract = byContract.get(slip.employment_id);
							const person = contract == null ? undefined : byPerson.get(contract.employee_id);
							return {
								employee_number: contract?.employee_number ?? slip.employment_id,
								name: person?.name ?? '',
								bank: bankAccountFrom(contract?.bank),
								amount: moneyText(slip.net),
								currency,
								status: String(slip.status ?? 'DRAFT'),
								period: String(run.period),
								gross: moneyText(slip.gross),
								total_deductions: moneyText(slip.total_deductions),
								lines: [
									...payslipLines(slip.base),
									...payslipLines(slip.statutory),
									...payslipLines(slip.adjustments)
								]
							};
						});
						if (!payments.some((row) => payable(row.status, row.amount))) continue;
						const layouts = got.rules.rows.filter(
							(row) =>
								row.settings_id === run.settings_id && row.code.toLowerCase().startsWith('bank_')
						);
						const paymentBank =
							company?.payment_bank_id == null ? undefined : byBank.get(company.payment_bank_id);
						if (company?.payment_bank_id != null && paymentBank === undefined)
							return yield* ctx.refuse(
								'The selected payment bank is unavailable. Review this entity’s bank in Settings before exporting.'
							);
						const bank = bankExportDocuments({
							...(paymentBank === undefined ? {} : { bank: paymentBank }),
							templates: layouts,
							runs: runRows([run]),
							rows: exportRows(selected.filter((slip) => payable(String(slip.status), slip.net))),
							company: plainRow(company),
							currency,
							generated_at: String(generated_at)
						});
						if (bank.issue !== null) return yield* ctx.refuse(bank.issue);
						const bankFiles = bank.documents;
						if (bankFiles.length === 0)
							return yield* ctx.refuse(
								`No bank payment layout is configured for ${company?.name ?? 'this entity'} (${currency}). Select the paying bank and configure its bank-file layout before exporting.`
							);
						for (const file of bankFiles) {
							if (
								documents.some(
									(document) => document.name.toLowerCase() === file.name.toLowerCase()
								)
							)
								return yield* ctx.refuse(
									'The selected payroll runs produce the same bank-file name. Export these runs separately to preserve the bank-required file name and every payment.'
								);
							documents.push(file);
						}
					}
				}
				if (kind === 'COMPLIANCE') {
					for (const entity of entities.rows) {
						const selectedRuns = runs.rows.filter((run) => run.company_id === entity.id);
						const runIds = new Set(selectedRuns.map((run) => run.id));
						const mine = slips.filter((slip) => runIds.has(slip.payroll_run_id));
						for (const currency of [...new Set(mine.map((slip) => String(slip.currency ?? '')))]) {
							const selected = mine.filter((slip) => slip.currency === currency);
							const templates = selectedRuns.flatMap((run) =>
								got.rules.rows.filter(
									(row) =>
										row.settings_id === run.settings_id &&
										!row.code.toLowerCase().startsWith('bank_')
								)
							);
							const byCode = new Map(templates.map((row) => [row.code, row]));
							documents.push(
								...recordDocuments(
									[...byCode.values()],
									runRows(selectedRuns),
									exportRows(selected),
									plainRow(entity),
									String(generated_at)
								)
							);
						}
					}
				}
				return { documents, salary_reports };
			}
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* transformRows(
				rows.map(({ id }) => ({ id, $delete: true })),
				rows,
				ctx
			);
		}
	}
});
