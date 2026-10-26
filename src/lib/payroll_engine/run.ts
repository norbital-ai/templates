import { Effect, Result } from 'effect';
import { loanRuleFacts } from '../loan_values.js';
import type { Id } from '@norbital-ai/bolt';
import type { Read } from './foundation.js';
import type { ReadFailed } from '@norbital-ai/bolt/errors';
import { type SuspensionKind } from './suspension_kinds.js';
import { addMonths, monthOf } from '@norbital-ai/std/date';
import { fieldValue, payrollSetting, Reads, Refusal, stableJson } from './foundation.js';
import { eventIdOf, chainStarts } from './leave.js';
import {
	inForce,
	currencyScale,
	roundTo,
	payrollMonths,
	LONG_HISTORY_MONTHS,
	isSalaryRun,
	type PayrollRunRequest,
	type PayslipPlan,
	type PayrollPlan,
	type CatalogRow,
	type EmployeeRow,
	type EntryRow,
	type EarlierRow,
	type ShiftDefinitionRow,
	type ShiftPatternRow,
	type LeaveEventRow,
	FAMILIES,
	type EntryCollection,
	evaluate,
	versionOn,
	partsOf,
	hoursStart
} from './payslip/context.js';
import { CONTRACT, PROFILE, ENTRY, LOAN, STATUTORY, ROSTER, HOLIDAY, HISTORY } from './rows.js';
import { CYCLES, payrollWindow } from './frequency.js';
import { admitPayrollRun, payrollRulesOf, validationsOf, reservedPinsFrom } from './admit.js';
import { buildPayslip } from './payslip/lines.js';
/** All runtime dependencies for a payroll write batch, fetched once after admission. */
export const loadPayrollBuild = (read: Read, companyIds: readonly Id<'entity'>[]) =>
	read({
		// Every committed ledger reserves its source before the asynchronous backlink is attached.
		settlements: {
			from: 'payroll_run',
			where: {
				company_id: { in: companyIds }
			},
			select: { company_id: true, pins: true },
			all: true
		},
		contracts: {
			from: 'employment_contract',
			where: { company_id: { in: companyIds } },
			select: CONTRACT,
			all: true
		},
		people: {
			from: 'employment_profile',
			where: { id: { in: { member: 'contracts', field: 'employee_id' } } },
			select: PROFILE,
			all: true
		},
		history: {
			from: 'payslip',
			where: { employment_id: { in: { member: 'contracts', field: 'id' } } },
			select: HISTORY,
			all: true
		},
		adhoc: {
			from: 'adhoc_catalog_entry',
			where: { employment_id: { in: { member: 'contracts', field: 'id' } } },
			select: ENTRY.adhoc_catalog_entry,
			all: true
		},
		adhoc_codes: {
			from: 'adhoc_catalog',
			where: { id: { in: { member: 'adhoc', field: 'catalog_id' } } },
			select: { code: true },
			all: true
		},
		claim: {
			from: 'claim_catalog_entry',
			where: { employment_id: { in: { member: 'contracts', field: 'id' } } },
			select: ENTRY.claim_catalog_entry,
			all: true
		},
		claim_codes: {
			from: 'claim_catalog',
			where: { id: { in: { member: 'claim', field: 'catalog_id' } } },
			select: { code: true },
			all: true
		},
		leave: {
			from: 'leave_catalog_entry',
			where: { employment_id: { in: { member: 'contracts', field: 'id' } } },
			select: ENTRY.leave_catalog_entry,
			all: true
		},
		leave_codes: {
			from: 'leave_catalog',
			where: { id: { in: { member: 'leave', field: 'catalog_id' } } },
			select: { code: true },
			all: true
		},
		loan: {
			from: 'loan_repayment_entry',
			where: { employment_id: { in: { member: 'contracts', field: 'id' } } },
			select: ENTRY.loan_repayment_entry,
			all: true
		},
		loan_principals: {
			from: 'loan_catalog_entry',
			where: { id: { in: { member: 'loan', field: 'loan_id' } } },
			select: LOAN,
			all: true
		},
		loan_codes: {
			from: 'loan_catalog',
			where: { id: { in: { member: 'loan', field: 'catalog_id' } } },
			select: { code: true },
			all: true
		},
		holidays: {
			from: 'holiday',
			where: {
				company_id: { in: companyIds },

				published_at: { isNull: false }
			},
			select: HOLIDAY,
			all: true
		},
		definitions: {
			from: 'shift_definition',
			where: { company_id: { in: companyIds } },
			select: { company_id: true, code: true, variant: true },
			all: true
		},
		patterns: {
			from: 'shift_pattern',
			where: { company_id: { in: companyIds } },
			select: { company_id: true, pattern: true, effective_range: true },
			all: true
		},
		suspensions: {
			from: 'work_suspension',
			where: {
				company_id: { in: companyIds }
			},
			select: {
				company_id: true,
				kind: true,
				starts_on: true,
				ends_on: true,
				worksite: true,
				employment_ids: true,
				facts: true
			},
			all: true
		},
		entities: {
			from: 'entity',
			where: { id: { in: companyIds } },
			select: { settings_code: true },
			all: true
		},
		lineage_versions: {
			from: 'jurisdiction_settings',
			where: { code: { in: { member: 'entities', field: 'settings_code' } } },
			select: { id: true },
			all: true
		},
		pay_rows: {
			from: 'statutory_contribution_catalog',
			where: { settings_id: { in: { member: 'lineage_versions', field: 'id' } } },
			select: STATUTORY,
			all: true
		},
		captured_allowances: { from: 'allowance_catalog', select: { code: true }, all: true },
		roster: {
			from: 'roster_entry',
			where: { employment_id: { in: { member: 'contracts', field: 'id' } } },
			select: ROSTER,
			all: true
		}
	});
type PayrollBuildRead = Effect.Success<ReturnType<typeof loadPayrollBuild>>;
export const buildPayrollRun = (
	request: PayrollRunRequest,
	admitted?: Effect.Success<ReturnType<typeof admitPayrollRun>>,
	prefetched?: PayrollBuildRead
): Effect.Effect<PayrollPlan, Refusal | ReadFailed, Reads> =>
	Effect.gen(function* () {
		const {
			entity,
			version,
			settlement,
			salaryRun,
			sources,
			reservedPins,
			runs,
			lineage,
			governedRows,
			switched
		} = admitted ?? (yield* admitPayrollRun(request));
		const payroll = yield* Effect.fromResult(
			fieldValue(version.payroll, 'jurisdiction_settings.payroll')
		);
		const historyMonths = yield* Effect.fromResult(payrollMonths(version, 'history_months'));
		const rollingMonths = yield* Effect.fromResult(payrollMonths(version, 'rolling_hours_months'));
		const window = payrollWindow(
			settlement,
			CYCLES.includes(entity.pay_frequency ?? '') ? 1 : (entity.pay_cutoff_day ?? 1)
		);
		const currency = payroll?.currency;
		if (currency == null || currency === '')
			return yield* new Refusal({ message: `${version.code} names no payroll currency.` });
		const money = roundTo(payroll?.minor_units ?? currencyScale(currency));
		// Admission already loaded every catalogue row the build prices from.
		const { read: hostRead } = yield* Reads;
		const governed = (governedRows ?? []).find((held) => held.id === version.id);
		if (governed === undefined)
			return yield* new Refusal({
				message: 'The payroll version requires its actual governed catalogues.'
			});
		const catalogue = (
			name:
				| 'work_catalog'
				| 'allowance_catalog'
				| 'adhoc_catalog'
				| 'claim_catalog'
				| 'leave_catalog'
				| 'loan_catalog'
		): readonly CatalogRow[] => governed?.[name] ?? [];
		const ruleRows = governed?.rule_set ?? [];
		const rules = yield* Effect.fromResult(
			payrollRulesOf(ruleRows.filter((row) => row.family === 'PAYROLL'))
		);
		const validations = yield* validationsOf(
			ruleRows.filter((row) => row.family === 'VALIDATIONS'),
			'payslip'
		);
		// The pay day: the request's, else the version's required `payroll.pay_date` CEL on the period and company.
		const payDate =
			request.pay_due_date ??
			String(
				yield* evaluate(
					yield* Effect.fromResult(payrollSetting(version.code, payroll, 'pay_date')),
					{
						period: {
							key: request.period,
							from: window.salary_from,
							to: window.salary_to,
							part: settlement.part,
							parts: settlement.parts
						},
						company: {
							region: entity.region ?? '',
							pay_frequency: entity.pay_frequency ?? '',
							facts: yield* Effect.fromResult(fieldValue(entity.facts, 'entity.facts'))
						}
					},
					`${version.code} payroll.pay_date`
				)
			).slice(0, 10);
		const periodRows = governed?.statutory_contribution_catalog ?? [];
		// A scheme `governed_by: "pay_date"` is assessed on its row of the version in force on the pay day (a
		// withholding table that follows the payment, not the work period); no version that day keeps the period's.
		const payVersion = periodRows.some((row) => row.configuration?.governed_by === 'pay_date')
			? yield* Effect.result(Effect.fromResult(versionOn(lineage, entity.settings_code, payDate)))
			: undefined;
		const payVersionId =
			payVersion == null || Result.isFailure(payVersion) || payVersion.success.id === version.id
				? undefined
				: payVersion.success.id;
		// A statutory standing names one version's scheme row; every version of the lineage maps its row ids to the code.
		const schemeCodes = new Map(
			lineage.flatMap((held) =>
				held.statutory_contribution_catalog.map((row) => [row.id, row.code] as const)
			)
		);
		const workRows = catalogue('work_catalog');
		const allowanceRows = catalogue('allowance_catalog');
		const governingRows: CatalogRow[] = [
			...workRows,
			...allowanceRows,
			...FAMILIES.flatMap((family) => catalogue(family.catalog))
		];
		// Roster and holiday reads serve the attendance window and `hours`: every approved roster day, paid or not,
		// from January (or the rolling window's start) through the month's end.
		const attended = (day: string) => day >= window.attendance_from && day <= window.attendance_to;
		const monthEnd = String(monthOf(window.salary_from).to);
		// `earned.*.worked_days`/`suspended_days` reach the 24 months of `earned.history`: the same reads, a longer span.
		// A different pay-day version may read attendance its period-version row does not.
		const readsWorked =
			payVersionId !== undefined ||
			/worked_days|worked_hours|suspended_days|leave_days/.test(
				JSON.stringify([governingRows, periodRows, validations, rules])
			);
		const span = {
			gte: [
				readsWorked
					? String(
							addMonths(
								String(monthOf(window.salary_from).from),
								-Math.max(LONG_HISTORY_MONTHS, historyMonths, rollingMonths)
							)
						)
					: hoursStart(window.salary_from, Math.max(historyMonths, rollingMonths)),
				window.attendance_from
			].toSorted()[0]!,
			lte: [monthEnd, window.attendance_to].toSorted()[1]!
		};
		// Suspensions are read only when a record of the version reads `suspended`.
		const readsSuspended =
			payVersionId !== undefined ||
			JSON.stringify([governingRows, periodRows, validations, rules]).includes('suspended');
		// One read: the entity's calendar and every contract in force with its person and entries. Each
		// entry carries its class's code (`catalog`), whatever version holds that class.
		const got = prefetched ?? (yield* loadPayrollBuild(hostRead, [request.company_id]));
		const payRows = got.pay_rows.rows.filter((row) => row.settings_id === payVersionId);
		const statutoryRows = periodRows.map((row) =>
			row.configuration?.governed_by === 'pay_date'
				? (payRows.find((other) => other.code === row.code) ?? row)
				: row
		);
		const contracts = got.contracts.rows.filter((row) => row.company_id === request.company_id);
		const repayments: EntryRow[] = [];
		for (const row of got.loan.rows) {
			const parent = got.loan_principals.rows.find((loan) => loan.id === row.loan_id);
			if (
				parent == null ||
				parent.company_id !== row.company_id ||
				parent.employment_id !== row.employment_id
			)
				return yield* new Refusal({
					message: 'A repayment must belong to its employee’s actual loan.'
				});
			const principal = yield* Effect.fromResult(
				fieldValue(parent.principal_amount, 'loan_catalog_entry.principal_amount')
			);
			repayments.push({
				...row,
				facts: loanRuleFacts({
					principal_amount: principal,
					facts: yield* Effect.fromResult(fieldValue(parent.facts, 'loan_catalog_entry.facts')),
					advance_made_on: yield* Effect.fromResult(
						fieldValue(parent.advance_made_on, 'loan_catalog_entry.advance_made_on')
					)
				})
			});
		}
		const contractIds = contracts.map((contract) => contract.id);
		const byEmployee = new Map<string, EmployeeRow>(
			got.people.rows.map((person) => [person.id, person])
		);
		const coded = <R extends EntryRow>(
			rows: readonly R[],
			codes: readonly { readonly id: string; readonly code: string }[]
		) =>
			rows.map((row) => ({
				...row,
				catalog: codes.find((code) => code.id === row.catalog_id) ?? null
			}));
		const familyRows = (collection: EntryCollection) =>
			collection === 'adhoc_catalog_entry'
				? coded(got.adhoc.rows, got.adhoc_codes.rows)
				: collection === 'claim_catalog_entry'
					? coded(got.claim.rows, got.claim_codes.rows)
					: collection === 'leave_catalog_entry'
						? coded(got.leave.rows, got.leave_codes.rows)
						: coded(repayments, got.loan_codes.rows);
		type Coded = { readonly catalog: { readonly id: string; readonly code: string } | null };
		// A contract allowance names the class of the version it was captured under: one read maps every such id
		// to its code for the whole run (a read per slip would spend the transform's crossings).
		const governingAllowances = new Set(allowanceRows.map((row) => row.id));
		const capturedAllowanceIds = [
			...new Set(
				(yield* Effect.fromResult(
					Result.all(
						contracts.map((contract) => fieldValue(contract.facts, 'employment_contract.facts'))
					)
				))
					.flatMap((facts) => facts?.contract_terms ?? [])
					.flatMap((term) => term.allowances ?? [])
					.map((line) => line.catalogue_id)
					.filter((id): id is string => id != null && !governingAllowances.has(id))
			)
		];
		const captured = new Set(capturedAllowanceIds);
		const lineageAllowances = lineage
			.flatMap((held) => held.allowance_catalog)
			.filter((row) => captured.has(row.id));
		// a class captured outside the lineage (the contract's earlier entity) is read by id, once for the run
		const outside = capturedAllowanceIds.filter(
			(id) => !lineageAllowances.some((row) => row.id === id)
		);
		const capturedAllowanceCodes = new Map(lineageAllowances.map((row) => [row.id, row.code]));
		for (const row of got.captured_allowances.rows) {
			if (!outside.includes(row.id)) continue;
			capturedAllowanceCodes.set(
				row.id,
				yield* Effect.fromResult(fieldValue(row.code, 'allowance_catalog.code'))
			);
		}
		// Entries name their class by the row of the version they were captured under; the governing version prices it by code.
		const entries = new Map<string, readonly EntryRow[]>();
		const siblings = new Map<string, readonly EarlierRow[]>();
		const classes = new Map<string, CatalogRow>();
		const leaveCodes = new Map<string, string>();
		const strip = <R extends Coded>({ catalog: _catalog, ...row }: R) => row;
		const timeOff: LeaveEventRow[] = [];
		for (const family of FAMILIES) {
			const all = familyRows(family.collection);
			const leave = family.family === 'LEAVE';
			if (leave) timeOff.push(...all.filter((row) => row.activity === 'TIME_OFF').map(strip));
			entries.set(
				family.collection,
				all
					.filter(
						(row) =>
							// An off-cycle slip prices no leave but reads the period's rows, settled or not.
							!(salaryRun || !leave) ||
							(row.payslip_id == null && !reservedPins.has(`${family.collection}:${row.id}`))
					)
					.map(strip)
			);
			if (!leave)
				siblings.set(
					family.collection,
					all.map((row) => ({ ...strip(row), code: row.catalog?.code ?? '' }))
				);
			const byCode = new Map(catalogue(family.catalog).map((row) => [row.code, row]));
			for (const row of all) {
				const code = row.catalog?.code;
				if (row.catalog_id == null || code == null) continue;
				if (leave) leaveCodes.set(row.catalog_id, code);
				const priced = byCode.get(code);
				if (priced != null) classes.set(row.catalog_id, priced);
			}
		}
		const ownContracts = new Set(contractIds);
		const rosterRead = got.roster.rows.filter(
			(row) =>
				ownContracts.has(row.employment_id) &&
				row.work_date >= span.gte &&
				row.work_date <= span.lte
		);
		if (salaryRun) {
			for (const key of yield* Effect.fromResult(
				reservedPinsFrom(
					got.settlements.rows.filter((row) => row.company_id === request.company_id),
					request.run_id
				)
			))
				reservedPins.add(key);
			for (const family of FAMILIES)
				entries.set(
					family.collection,
					(entries.get(family.collection) ?? []).filter(
						(row) => !reservedPins.has(`${family.collection}:${row.id}`)
					)
				);
		}
		const roster = !salaryRun
			? []
			: rosterRead.filter(
					(row) =>
						row.payslip_id == null &&
						!reservedPins.has(`roster_entry:${row.id}`) &&
						attended(row.work_date)
				);
		const hoursRoster = rosterRead.filter((row) => row.work_date <= monthEnd);
		const holidayRead = got.holidays.rows.filter(
			(row) => row.company_id === request.company_id && row.date >= span.gte && row.date <= span.lte
		);
		const holidays = !salaryRun ? [] : holidayRead.filter((holiday) => attended(holiday.date));
		const hoursHolidays = new Map(holidayRead.map((holiday) => [holiday.date, holiday]));
		const history = got.history.rows;
		const definitions = new Map<string, ShiftDefinitionRow>(
			got.definitions.rows.map((row) => [row.id, row])
		);
		const patterns = new Map<string, ShiftPatternRow>(
			got.patterns.rows.map((row) => [row.id, row])
		);
		// An absence event's first day, across every movement of the event: a row's month of the event counts from it.
		const eventStart = new Map<string, string>();
		const chainFrom = chainStarts(
			timeOff.map((row) => ({
				id: String(row.id),
				key: `${row.employment_id}:${leaveCodes.get(String(row.catalog_id)) ?? ''}`,
				from: String(row.from ?? row.occurred_on ?? ''),
				to: String(row.to ?? row.from ?? row.occurred_on ?? '')
			}))
		);
		const suspensions = readsSuspended
			? got.suspensions.rows.filter(
					(row) =>
						row.company_id === request.company_id &&
						row.starts_on <= span.lte &&
						row.ends_on >= span.gte
				)
			: [];
		const suspension_kinds =
			suspensions.length === 0
				? []
				: yield* Effect.fromResult(
						fieldValue(governed?.suspension_kinds, 'jurisdiction_settings.suspension_kinds')
					);
		const kinds = new Map<string, SuspensionKind>(
			suspensions.length === 0
				? []
				: (suspension_kinds ?? []).map((row) => [row.code, row] as const)
		);
		for (const row of timeOff) {
			const event = eventIdOf(row.facts);
			const day = String(row.from ?? row.occurred_on ?? '');
			if (event == null || day === '') continue;
			const key = `${row.employment_id}:${event}`;
			const held = eventStart.get(key);
			if (held == null || day < held) eventStart.set(key, day);
		}
		const runKind = new Map(runs.map((run) => [run.id, run.kind ?? '']));
		const statutoryConfigurations = new Map(
			runs.map(
				(run) =>
					[
						run.id,
						lineage.find((held) => held.id === run.settings_id)?.statutory_contribution_catalog ??
							[]
					] as const
			)
		);
		// each salary run's settlement window: a paid period an exit since moved or undone is repriced over its days
		const runWindows = new Map(
			runs.flatMap((run) =>
				run.salary_from == null || run.salary_to == null || !isSalaryRun(run.kind)
					? []
					: [
							[
								run.id,
								{
									from: String(run.salary_from).slice(0, 10),
									to: String(run.salary_to).slice(0, 10)
								}
							] as const
						]
			)
		);
		const exitClasses = catalogue('adhoc_catalog').filter((row) => row.raise_on_exit === true);
		const notes: string[] = [];
		const selected = new Set(sources);
		const parts = partsOf(governingRows);
		const payslips: PayslipPlan[] = [];
		for (const contract of contracts) {
			const planned = yield* buildPayslip({
				subject: {
					contract,
					employee: byEmployee.get(contract.employee_id),
					entity
				},
				jurisdiction: {
					version,
					rules,
					statutoryRows,
					schemeCodes,
					workRows,
					allowanceRows,
					capturedAllowanceCodes,
					classes,
					parts,
					exitClasses,
					validations,
					assessesWithoutWage: statutoryRows.some(
						(row) => row.configuration?.assess_without_wage === true
					)
				},
				payroll: {
					currency,
					period: request.period,
					settlement,
					headcount: yield* Effect.fromResult(inForce(contracts, window.salary_to)),
					salaryRun,
					selected,
					window,
					notes,
					money,
					payDate,
					switched
				},
				attendance: {
					entries: FAMILIES.map((family) => ({
						...family,
						rows: (entries.get(family.collection) ?? []).filter(
							(row) => row.employment_id === contract.id
						),
						siblings: (siblings.get(family.collection) ?? []).filter(
							(row) => row.employment_id === contract.id
						)
					})),
					roster: roster.filter((row) => row.employment_id === contract.id),
					holidays,
					hoursRoster: hoursRoster.filter((row) => row.employment_id === contract.id),
					readsWorked,
					hoursHolidays,
					definitions,
					patterns,
					eventStart,
					timeOff,
					leaveCodes,
					chainFrom,
					suspensions,
					kinds,
					monthLeave: familyRows('leave_catalog_entry')
						.filter((row) => row.employment_id === contract.id)
						.map(strip)
				},
				history: {
					payslips: history.filter((slip) => slip.employment_id === contract.id),
					runKind,
					statutoryConfigurations,
					runWindows
				}
			});
			if (planned != null) payslips.push(planned);
		}
		return {
			run: {
				company_id: request.company_id,
				settings_id: version.id,
				period: request.period,
				kind: request.kind,
				sources,
				configuration_hash: stableJson({
					settings: version.id,
					statutory: statutoryRows.map((row) => [row.code, row.configuration ?? null]),
					work: workRows.map((row) => [row.code, row.quantity, row.rate, row.counts_toward ?? null])
				}),
				pay_date: payDate,
				pay_due_date: request.pay_due_date ?? payDate,
				salary_from: window.salary_from,
				salary_to: window.salary_to,
				attendance_from: window.attendance_from,
				attendance_to: window.attendance_to
			},
			payslips,
			warnings: [...notes, ...payslips.flatMap((slip) => slip.warnings)]
		};
	});
