import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { Decimal, currency } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Result, Schema } from 'effect';
import { Reads, readsFrom, runEngine } from '../../../lib/payroll_engine/foundation.js';
import {
	admitPayrollRun,
	buildPayrollRun,
	type PayrollRunKind,
	type PinnedCollection
} from '../../../lib/payroll_engine/services.js';
import {
	bankAccountFrom,
	moneyText,
	payrollExportDocuments,
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
				'Bank payment file (OCBC FAST when the payer is OCBCSG, else CSV) and one payslip CSV per employee for the selected runs. Held slips are omitted from the bank file.',
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

c.transform(async (inputs, ctx: TransformCtx<'payroll_run'>) => {
	const deleted = inputs.flatMap((input, i) => ('$delete' in input ? [ctx.existing[i]!.id] : []));
	const paid =
		deleted.length === 0
			? []
			: (
					await ctx.db.read('payslip', {
						where: { payroll_run_id: { in: deleted }, status: { eq: 'PAID' } },
						select: { payroll_run_id: true },
						all: true
					})
				).rows;
	const out = [];
	for (const [i, input] of inputs.entries()) {
		if ('$delete' in input) {
			if (paid.some((slip) => slip.payroll_run_id === ctx.existing[i]!.id))
				ctx.refuse('A run with a paid payslip cannot be deleted.');
			out.push(input);
			continue;
		}
		if (ctx.existing[i] !== undefined) {
			out.push(input);
			continue;
		}
		// one run per request: admission reads its entity, version and open entries
		const kind: PayrollRunKind = input.kind === 'OFF_CYCLE' ? 'OFF_CYCLE' : 'REGULAR';
		const sources: readonly string[] = Schema.is(Schema.Array(Schema.String))(input.sources)
			? input.sources
			: [];
		const request = {
			company_id: String(input.company_id),
			period: String(input.period),
			kind,
			sources,
			...(input.pay_due_date == null ? {} : { pay_due_date: String(input.pay_due_date) })
		};
		const version = await runEngine(admitPayrollRun(request), ctx.db.read, ctx.refuse);
		const outcome = await Effect.runPromise(
			Effect.result(
				buildPayrollRun(request).pipe(Effect.provideService(Reads, readsFrom(ctx.db.read)))
			)
		);
		if (Result.isFailure(outcome)) {
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
				service_basis: slip.service_basis,
				base: slip.base,
				proration: slip.proration,
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

c.query('export_payroll', async ({ ids }, ctx) => {
	const runs = await ctx.read('payroll_run', {
		where: { id: { in: ids } },
		select: { id: true, company_id: true, period: true },
		all: true
	});
	const slips = await ctx.read('payslip', {
		where: { payroll_run_id: { in: ids } },
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
	});
	const employmentIds = [...new Set(slips.rows.map((row) => row.employment_id))];
	const contracts =
		employmentIds.length === 0
			? { rows: [] }
			: await ctx.read('employment_contract', {
					where: { id: { in: employmentIds } },
					select: { id: true, employee_id: true, employee_number: true, bank: true },
					all: true
				});
	const employeeIds = [...new Set(contracts.rows.map((row) => row.employee_id))];
	const people =
		employeeIds.length === 0
			? { rows: [] }
			: await ctx.read('employment_profile', {
					where: { id: { in: employeeIds } },
					select: { id: true, name: true },
					all: true
				});
	const companyIds = [...new Set(runs.rows.map((row) => row.company_id))];
	const entities =
		companyIds.length === 0
			? { rows: [] }
			: await ctx.read('entity', {
					where: { id: { in: companyIds } },
					select: { id: true, disbursement_account: true },
					all: true
				});
	const byContract = new Map(contracts.rows.map((row) => [row.id, row]));
	const byPerson = new Map(people.rows.map((row) => [row.id, row]));
	const byEntity = new Map(entities.rows.map((row) => [row.id, row]));
	const documents: ExportDocument[] = [];
	for (const run of runs.rows) {
		const entity = byEntity.get(run.company_id);
		const payments: ExportPayment[] = slips.rows
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
				payer: bankAccountFrom(entity?.disbursement_account),
				period: String(run.period),
				payments
			})
		);
	}
	return { documents };
});
