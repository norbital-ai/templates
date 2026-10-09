import { collection, type Row, type TransformCtx } from '@norbital-ai/bolt';
import { Decimal, currency } from '@norbital-ai/std/decimal';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect, Result, Schema } from 'effect';
import {
	callerReadAsHost,
	Reads,
	readJoined,
	readsFrom,
	runEngine
} from '../../../lib/payroll_engine/foundation.js';
import {
	admitPayrollRun,
	buildPayrollRun,
	currencyScale,
	type PayrollRunKind,
	type PinnedCollection
} from '../../../lib/payroll_engine/services.js';
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
	type ExportPayment,
	type PinningSlip
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
				buildPayrollRun(request, version).pipe(Effect.provideService(Reads, readsFrom(ctx.db.read)))
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

/** An entry a slip pinned, as a return reads it (`slips[].leave[]`, `entries[]`): its class code through `catalog`. */
const PINNED = {
	employment_id: true,
	catalog: { one: 'catalog_id', select: { code: true } },
	amount: true,
	facts: true
} as const;
const PINNED_ARMS = {
	adhoc_catalog_entry: { many: { ...PINNED, quantity: true } },
	claim_catalog_entry: { many: { ...PINNED, quantity: true } },
	loan_catalog_entry: { many: PINNED },
	leave_catalog_entry: { many: { ...PINNED, days: true, from: true, to: true } }
} as const;

/** What an export reads, as one joined read of the selected runs. */
const RUN_EXPORT = {
	id: true,
	company_id: true,
	period: true,
	kind: true,
	settings_id: true,
	salary_from: true,
	salary_to: true,
	pay_date: true,
	payslip: {
		many: {
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
			adjustments: true,
			// The entries each slip pinned (their class codes through `catalog`): a return's `slips[].leave[]` and
			// `entries[]`, in this same read.
			...PINNED_ARMS,
			employment: {
				one: 'employment_id',
				select: {
					id: true,
					employee_id: true,
					employee_number: true,
					bank: true,
					effective_range: true,
					exit_ground: true,
					facts: true,
					person: {
						one: 'employee_id',
						select: {
							id: true,
							name: true,
							identity_number: true,
							date_of_birth: true,
							nationality: true,
							facts: true
						}
					}
				}
			}
		}
	},
	company: {
		one: 'company_id',
		select: {
			id: true,
			name: true,
			registration_number: true,
			region: true,
			facts: true,
			disbursement_account: true
		}
	},
	settings: {
		one: 'settings_id',
		select: {
			id: true,
			payroll: true,
			rule_set: { many: { code: true, rules: true }, where: { family: { eq: 'EXPORTS' } } }
		}
	}
} as const;
type Run = Pick<
	Row<'payroll_run'>,
	'id' | 'company_id' | 'period' | 'kind' | 'settings_id' | 'salary_from' | 'salary_to' | 'pay_date'
> & {
	readonly payslip: readonly (Pick<
		Row<'payslip'>,
		| 'id'
		| 'payroll_run_id'
		| 'employment_id'
		| 'net'
		| 'gross'
		| 'total_deductions'
		| 'currency'
		| 'status'
		| 'base'
		| 'statutory'
		| 'adjustments'
	> &
		PinningSlip & {
			readonly employment:
				| (Pick<
						Row<'employment_contract'>,
						| 'id'
						| 'employee_id'
						| 'employee_number'
						| 'bank'
						| 'effective_range'
						| 'exit_ground'
						| 'facts'
				  > & {
						readonly person: Pick<
							Row<'employment_profile'>,
							'id' | 'name' | 'identity_number' | 'date_of_birth' | 'nationality' | 'facts'
						> | null;
				  })
				| null;
		})[];
	readonly company: Pick<
		Row<'entity'>,
		'id' | 'name' | 'registration_number' | 'region' | 'facts' | 'disbursement_account'
	> | null;
	readonly settings:
		| (Pick<Row<'jurisdiction_settings'>, 'id' | 'payroll'> & {
				readonly rule_set: readonly Pick<Row<'rule_set'>, 'code' | 'rules'>[];
		  })
		| null;
};

c.query('export_payroll', async ({ ids }, ctx) => {
	// One read: the runs with their slips, each slip's contract and person, the entity and the version's exports.
	const joined = await runEngine(
		readJoined<Run>('payroll_run', { id: { in: ids } }, RUN_EXPORT),
		callerReadAsHost(ctx.read),
		ctx.refuse
	);
	const runs = { rows: joined };
	const slips = {
		rows: joined.flatMap((run) => run.payslip.map(({ employment: _employment, ...slip }) => slip))
	};
	const held = [
		...new Map(
			joined.flatMap((run) =>
				run.payslip.flatMap((slip) =>
					slip.employment == null ? [] : [[slip.employment.id, slip.employment] as const]
				)
			)
		).values()
	];
	const contracts = { rows: held.map(({ person: _person, ...contract }) => contract) };
	const employmentIds = [...new Set(slips.rows.map((row) => row.employment_id))];
	const people = {
		rows: held.flatMap((contract) => (contract.person == null ? [] : [contract.person]))
	};
	const entities = { rows: joined.flatMap((run) => (run.company == null ? [] : [run.company])) };
	const versions = { rows: joined.flatMap((run) => (run.settings == null ? [] : [run.settings])) };
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
				period: String(run.period),
				payments,
				...scaleOf(minorUnitsOf.get(run.settings_id), payments[0]?.currency)
			})
		);
	}
	// The selected runs' versions' statutory returns (`EXPORTS` rule-set rows), one CSV each over every employment.
	const templates = versions.rows.flatMap((version) => version.rule_set);
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
				const mine = slips.rows.filter((slip) => slip.employment_id === id);
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
