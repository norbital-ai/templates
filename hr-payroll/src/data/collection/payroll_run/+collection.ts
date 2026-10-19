import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { Decimal, currency } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Result, Schema } from 'effect';
import { Reads, readsFrom, runEngine } from '../../../lib/payroll_engine/foundation.js';
import { admitPayrollRun } from '../../../lib/payroll_engine/admit.js';
import { buildPayrollRun } from '../../../lib/payroll_engine/run.js';
import {
	currencyScale,
	type PayrollRunKind,
	type PinnedCollection
} from '../../../lib/payroll_engine/payslip/context.js';
import {
	bankAccountFrom,
	moneyText,
	exportEntries,
	exportSlip,
	payrollExportDocuments,
	plainRow,
	recordDocuments,
	payslipLines,
	type ExportDocument,
	type ExportPayment
} from '../../../lib/payroll_engine/export.js';
/** The payslip columns the run's own build fills; the run relation supplies `payroll_run_id`. */
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
	'gross',
	'total_deductions',
	'net',
	'employer_cost',
	'currency',
	'status'
] as const;
/** One pin the settlement ledger names: a consumed entry or roster day and the contract whose payslip settled it. */
type LedgerPin = {
	readonly employment_id: string;
	readonly collection: PinnedCollection;
	readonly id: string;
};
type Ledger = readonly LedgerPin[];
/**
 * A payroll run is requested by its entity, period, kind and — for a settlement run — the entries it pays. The
 * transform builds the run: admission names the governing version and the engine's plan becomes one owned payslip
 * per contract, with a ledger of every entry and roster day each payslip consumed. The
 * `+behaviour_taps` automation applies the ledger's pins as side effects. Deleting an unpaid run releases its
 * entries for the next run.
 */
const c = collection('payroll_run', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: ['company_id', 'period', 'kind', 'sources', 'pay_due_date'],
			filled: [
				'settings_id',
				'configuration_hash',
				'warnings',
				'pins',
				'holds',
				'pay_date',
				'pay_due_date',
				'salary_from',
				'salary_to',
				'attendance_from',
				'attendance_to'
			],
			with: { payslip: { create: { columns: payslip_columns } } }
		}
	},
	update: { input: { columns: ['pay_due_date', 'configuration_hash', 'warnings'] } },
	queries: {
		export_payroll: {
			description:
				'A bank payment CSV, one payslip CSV per employee and the files of the versions’ EXPORTS records (bank layouts, statutory returns) for the selected runs. Held slips are omitted from the bank files.',
			input: {
				ids: { kind: 'list', of: { kind: 'id', of: 'payroll_run' }, min: 1 }
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
					}
				}
			}
		}
	},
	delete: { transform: true }
});
export default c;
c.transform(function* (inputs, ctx: TransformCtx<'payroll_run'>) {
	const deleted = inputs.flatMap((input, i) => {
		const stored = ctx.existing[i];
		return '$delete' in input && stored !== undefined ? [stored.id] : [];
	});
	const paid =
		deleted.length === 0
			? []
			: (yield* ctx.db.read('payslip', {
					where: { payroll_run_id: { in: deleted }, status: { eq: 'PAID' } },
					select: { payroll_run_id: true },
					all: true
				})).rows;
	const out = [];
	for (const [i, input] of inputs.entries()) {
		if ('$delete' in input) {
			const stored = ctx.existing[i];
			if (stored === undefined)
				return yield* ctx.refuse('A payroll run must exist before it can be deleted.');
			if (paid.some((slip) => slip.payroll_run_id === stored.id))
				return yield* ctx.refuse('A run with a paid payslip cannot be deleted.');
			out.push(input);
			continue;
		}
		if (ctx.existing[i] !== undefined) {
			out.push(input);
			continue;
		}
		// one run per request: admission reads its entity, version and open entries
		const kind: PayrollRunKind = input.kind === 'OFF_CYCLE' ? 'OFF_CYCLE' : 'REGULAR';
		if (input.company_id == null)
			return yield* ctx.refuse('This needs an actual approved legal entity.');
		if (input.period == null)
			return yield* ctx.refuse('A pay period requires its actual calendar month.');
		const decodedSources = Schema.decodeUnknownResult(Schema.Array(Schema.String))(
			input.sources ?? []
		);
		if (Result.isFailure(decodedSources))
			return yield* ctx.refuse('A settlement run names its source entries as a list of ids.', {
				field: 'sources'
			});
		const sources = decodedSources.success;
		const request = {
			company_id: input.company_id,
			period: input.period,
			kind,
			sources,
			...(input.pay_due_date == null ? {} : { pay_due_date: String(input.pay_due_date) })
		};
		const version = yield* runEngine(admitPayrollRun(request), ctx.db.read, ctx.refuse);
		const outcome = yield* Effect.result(
			buildPayrollRun(request, version).pipe(Effect.provideService(Reads, readsFrom(ctx.db.read)))
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
		const ledger: LedgerPin[] = [];
		const payslips = plan.payslips.map((slip) => {
			for (const pin of slip.pins)
				ledger.push({ employment_id: slip.employment_id, collection: pin.collection, id: pin.id });
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
/** Stored columns an export reads from each pinned entry family. */
const PINNED = {
	employment_id: true,
	payslip_id: true,
	catalog_id: true,
	amount: true,
	facts: true
} as const;
c.query('export_payroll', function* ({ ids }, ctx) {
	const got = yield* ctx.read({
		runs: {
			collection: 'payroll_run',
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
			collection: 'payslip',
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
				base: true,
				statutory: true,
				adjustments: true
			},
			all: true
		},
		contracts: {
			collection: 'employment_contract',
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
			collection: 'employment_profile',
			where: { id: { in: { member: 'contracts', field: 'employee_id' } } },
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
			collection: 'entity',
			where: { id: { in: { member: 'runs', field: 'company_id' } } },
			select: {
				id: true,
				name: true,
				registration_number: true,
				region: true,
				facts: true,
				disbursement_account: true
			},
			all: true
		},
		versions: {
			collection: 'jurisdiction_settings',
			where: { id: { in: { member: 'runs', field: 'settings_id' } } },
			select: { id: true, payroll: true },
			all: true
		},
		rules: {
			collection: 'rule_set',
			where: {
				settings_id: { in: { member: 'versions', field: 'id' } },
				family: { eq: 'EXPORTS' }
			},
			select: { code: true, rules: true, settings_id: true },
			all: true
		},
		adhoc: {
			collection: 'adhoc_catalog_entry',
			where: { payslip_id: { in: { member: 'slips', field: 'id' } } },
			select: { ...PINNED, quantity: true },
			all: true
		},
		adhoc_catalog: {
			collection: 'adhoc_catalog',
			where: { id: { in: { member: 'adhoc', field: 'catalog_id' } } },
			select: { code: true },
			all: true
		},
		claims: {
			collection: 'claim_catalog_entry',
			where: { payslip_id: { in: { member: 'slips', field: 'id' } } },
			select: { ...PINNED, quantity: true },
			all: true
		},
		claim_catalog: {
			collection: 'claim_catalog',
			where: { id: { in: { member: 'claims', field: 'catalog_id' } } },
			select: { code: true },
			all: true
		},
		loans: {
			collection: 'loan_catalog_entry',
			where: { payslip_id: { in: { member: 'slips', field: 'id' } } },
			select: PINNED,
			all: true
		},
		loan_catalog: {
			collection: 'loan_catalog',
			where: { id: { in: { member: 'loans', field: 'catalog_id' } } },
			select: { code: true },
			all: true
		},
		leave: {
			collection: 'leave_catalog_entry',
			where: { payslip_id: { in: { member: 'slips', field: 'id' } } },
			select: { ...PINNED, days: true, from: true, to: true },
			all: true
		},
		leave_catalog: {
			collection: 'leave_catalog',
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
				.map((entry) => ({ ...entry, catalog: adhoc.get(entry.catalog_id) ?? null })),
			claim_catalog_entry: got.claims.rows
				.filter((entry) => entry.payslip_id === slip.id)
				.map((entry) => ({ ...entry, catalog: claims.get(entry.catalog_id) ?? null })),
			loan_catalog_entry: got.loans.rows
				.filter((entry) => entry.payslip_id === slip.id)
				.map((entry) => ({ ...entry, catalog: loans.get(entry.catalog_id) ?? null })),
			leave_catalog_entry: got.leave.rows
				.filter((entry) => entry.payslip_id === slip.id)
				.map((entry) => ({ ...entry, catalog: leave.get(entry.catalog_id) ?? null }))
		}));
	const employmentIds = [...new Set(slips.map((row) => row.employment_id))];
	const scaleOf = (units: number | null | undefined, code: string | undefined) => {
		const scale = units ?? (code == null || code === '' ? undefined : currencyScale(code));
		return scale === undefined ? {} : { scale };
	};
	const minorUnitsOf = new Map(versions.rows.map((row) => [row.id, row.payroll?.minor_units]));
	const byContract = new Map(contracts.rows.map((row) => [row.id, row]));
	const byPerson = new Map(people.rows.map((row) => [row.id, row]));
	const byEntity = new Map(entities.rows.map((row) => [row.id, row]));
	const documents: ExportDocument[] = [];
	for (const run of runs.rows) {
		const payments: ExportPayment[] = slips
			.filter((slip) => slip.payroll_run_id === run.id)
			.map((slip) => {
				const contract = byContract.get(slip.employment_id);
				const person = contract == null ? undefined : byPerson.get(contract.employee_id);
				return {
					employee_number: contract?.employee_number ?? slip.employment_id,
					name: person?.name ?? '',
					bank: bankAccountFrom(contract?.bank),
					amount: moneyText(slip.net),
					currency: String(slip.currency ?? ''),
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
		documents.push(
			...payrollExportDocuments({
				period: String(run.period),
				payments,
				...scaleOf(minorUnitsOf.get(run.settings_id), payments[0]?.currency)
			})
		);
	}
	// The selected runs' versions' statutory returns (`EXPORTS` rule-set rows), one CSV each over every employment.
	const templates = runs.rows.flatMap((run) =>
		got.rules.rows.filter((row) => row.settings_id === run.settings_id)
	);
	const byCode = new Map(templates.map((row) => [String(row.code), row]));
	const periodOf = new Map(runs.rows.map((row) => [row.id, String(row.period)]));
	documents.push(
		...recordDocuments(
			[...byCode.values()].map((row) => ({ code: String(row.code), rules: row.rules })),
			runs.rows.map((row) => ({
				id: row.id,
				period: String(row.period),
				kind: String(row.kind ?? ''),
				salary_from: String(row.salary_from ?? ''),
				salary_to: String(row.salary_to ?? ''),
				pay_date: String(row.pay_date ?? '')
			})),
			employmentIds.map((id) => {
				const mine = slips.filter((slip) => slip.employment_id === id);
				const contract = byContract.get(id);
				const person = contract == null ? undefined : byPerson.get(contract.employee_id);
				return {
					employee: plainRow(person),
					contract: plainRow(contract),
					slips: mine.map((slip) => exportSlip(slip, periodOf.get(slip.payroll_run_id) ?? '')),
					entries: exportEntries(mine)
				};
			}),
			// The runs' entity (the first run's), its payer facts included.
			plainRow(runs.rows[0] == null ? undefined : byEntity.get(runs.rows[0].company_id)),
			// The host clock's instant, never the wall clock: a re-run under a fixed clock makes the same file.
			String(ctx.now)
		)
	);
	return { documents };
});
