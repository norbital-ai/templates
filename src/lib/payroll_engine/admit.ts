import { Predicate } from 'effect';
import { Effect, Option, Result, Schema } from 'effect';
import { addDays, addMonths, contains, days, monthOf, PlainDate } from '@norbital-ai/std/date';
import { behavioursOf, planBehaviours } from './behaviours.js';
import {
	type Id,
	type Row,
	type WriteCtx,
	type StoredRow,
	type UpdateSet
} from '@norbital-ai/bolt';
import type { ReadFailed } from '@norbital-ai/bolt/errors';
import {
	type DynObject,
	type JsonObject,
	type Read,
	Reads,
	fieldValue,
	isJsonObject,
	moneyNumber,
	eachBatched,
	Refusal,
	runEngine,
	stableJson,
	frequencySpans,
	periodsIn,
	payrollSetting,
	PAYROLL_SLOTS,
	celValues,
	getErrorMessage
} from './foundation.js';
import { evaluateConfigured } from './expressions.js';
import { kindsOf } from './listed_kinds.js';
import {
	classFromRow,
	dayKey,
	movementFromRow,
	movementsByCode,
	readsAttendance,
	refuseLeaveWrite,
	serviceMonthsAt
} from './leave.js';
import {
	round2,
	zoneOf,
	attendancePolicy,
	num,
	dayInRange,
	inForce,
	SALARY_RUNS,
	isSalaryRun,
	type PayrollRunRequest,
	type SettingsRow,
	type ContractRow,
	type ContractTerm,
	type EmployeeRow,
	type EntryColumns,
	type LooseEntryRow,
	entryRow,
	entryContext,
	earlierContext,
	worksiteOn,
	type ShiftDefinitionRow,
	type ShiftPatternRow,
	type HolidayRow,
	FAMILIES,
	type EntryCollection,
	type EntryCatalogueId,
	type CatalogName,
	isLeaveAdmitted,
	termFor,
	moneyValue,
	evaluate,
	evaluateBoolean,
	versionOn,
	governingVersion,
	entityOf,
	type Employment,
	companyOf,
	subjectContext,
	dayPlanner,
	workDay,
	recordedWork,
	attendanceDays,
	leaveSubject,
	attendanceMembers,
	ATTENDANCE_MONTHS,
	governanceMembers,
	governedFrom,
	loadLeaveState,
	leaveStateMembers,
	employmentFrom,
	type LeaveStateRead
} from './payslip/context.js';
import {
	SETTINGS,
	ENTITY,
	CONTRACT,
	PROFILE,
	ENTRY,
	RULES,
	HOLIDAY,
	CATALOG,
	LEAVE_CLASS
} from './rows.js';
import { settlementPeriod } from './frequency.js';
import { cycleDays, plannedShift } from './shift_pattern.js';
import { requestDays } from './leave_days.js';
/** Internal admission input shared by the three native write verbs. */
export type EntryWriteInput<C extends EntryCollection> = Omit<UpdateSet<C>, 'id'> & {
	readonly id?: Id<C>;
	readonly $delete?: true;
};
/** A year's months: the headcount history duties read is the calendar's, not a payroll window. */
const MONTHS_OF_YEAR = 12;
/** A run's settlement ledger as read: each pin names its entry or roster day and the employment that settled it. */
type RunPins = { readonly id: string; readonly pins: Row<'payroll_run'>['pins'] };
export const reservedPinsFrom = (runs: readonly RunPins[], except?: string) =>
	Result.gen(function* () {
		const reserved = new Set<string>();
		for (const run of runs) {
			if (run.id === except) continue;
			for (const pin of (yield* fieldValue(run.pins, 'payroll_run.pins')) ?? [])
				reserved.add(`${pin.collection}:${pin.id}`);
		}
		return reserved;
	});
/** Each candidate a run pins, with the payslips of that run and the pin's employment it may attach to. */
const settlementLocksFrom = Effect.fnUntraced(function* (
	collection: EntryCollection,
	candidates: ReadonlySet<string>,
	runs: readonly RunPins[],
	slips: readonly {
		readonly id: string;
		readonly payroll_run_id: string;
		readonly employment_id: string;
	}[]
) {
	const locked = new Map<string, Set<string>>();
	for (const run of runs) {
		const pins = yield* Effect.fromResult(fieldValue(run.pins, 'payroll_run.pins'));
		for (const pin of pins ?? []) {
			if (pin.collection !== collection || !candidates.has(pin.id)) continue;
			const allowed = locked.get(pin.id) ?? new Set<string>();
			for (const slip of slips)
				if (slip.payroll_run_id === run.id && slip.employment_id === pin.employment_id)
					allowed.add(slip.id);
			locked.set(pin.id, allowed);
		}
	}
	return locked;
});
type EntryLockCandidate = { readonly id: string };
type LockRun = RunPins;
type LockSlip = {
	readonly id: string;
	readonly payroll_run_id: string;
	readonly employment_id: string;
};
/** Lock evidence is selected with admission, so edits and backlinks share one statement. */
const entryLockMembers = (collection: EntryCollection, candidates: readonly EntryLockCandidate[]) =>
	({
		locked_runs: {
			from: 'payroll_run',
			where:
				candidates.length === 0
					? { id: { in: [] } }
					: { or: candidates.map(({ id }) => ({ pins: { contains: [{ collection, id }] } })) },
			select: { pins: true },
			all: true
		},
		locked_slips: {
			from: 'payslip',
			where: { payroll_run_id: { in: { member: 'locked_runs', field: 'id' } } },
			select: { employment_id: true, payroll_run_id: true },
			all: true
		}
	}) as const;

export const entryLocksFrom = (
	collection: EntryCollection,
	candidates: readonly EntryLockCandidate[],
	runs: readonly LockRun[],
	slips: readonly LockSlip[]
) => settlementLocksFrom(collection, new Set(candidates.map(({ id }) => id)), runs, slips);
/** A committed run locks its entries before its asynchronous backlinks arrive. */
export const entrySettlementLocks = Effect.fnUntraced(function* (
	read: Read,
	collection: EntryCollection,
	candidates: readonly EntryLockCandidate[]
) {
	if (candidates.length === 0) return new Map<string, Set<string>>();
	const got = yield* read(entryLockMembers(collection, candidates));
	return yield* entryLocksFrom(collection, candidates, got.locked_runs.rows, got.locked_slips.rows);
});
/** One shared admission/deletion read for every payroll run in a write batch. */
export const loadPayrollAdmission = (
	read: Read,
	companyIds: readonly Id<'entity'>[],
	deleted: readonly Id<'payroll_run'>[] = [],
	capturedLeave: readonly Id<'leave_catalog_entry'>[] = []
) =>
	read({
		entity: {
			from: 'entity',
			where: { id: { in: companyIds } },
			select: ENTITY,
			all: true
		},
		runs: {
			from: 'payroll_run',
			where: { company_id: { in: companyIds } },
			select: {
				company_id: true,
				pins: true,
				kind: true,
				period: true,
				salary_from: true,
				salary_to: true,
				settings_id: true
			},
			all: true
		},
		lineage: {
			from: 'jurisdiction_settings',
			where: { code: { in: { member: 'entity', field: 'settings_code' } } },
			select: SETTINGS,
			all: true
		},
		source_adhoc: {
			from: 'adhoc_catalog_entry',
			where: { company_id: { in: companyIds }, payslip_id: { isNull: true } },
			select: { id: true, company_id: true },
			all: true
		},
		source_claim: {
			from: 'claim_catalog_entry',
			where: { company_id: { in: companyIds }, payslip_id: { isNull: true } },
			select: { id: true, company_id: true },
			all: true
		},
		source_loan: {
			from: 'loan_repayment_entry',
			where: { company_id: { in: companyIds }, payslip_id: { isNull: true } },
			select: { id: true, company_id: true },
			all: true
		},
		...governanceMembers({ member: 'lineage', field: 'id' }),
		delete_paid: {
			from: 'payslip',
			where: { payroll_run_id: { in: deleted }, status: { eq: 'PAID' } },
			select: { payroll_run_id: true },
			all: true
		},
		delete_leave: {
			from: 'leave_catalog_entry',
			where: { id: { in: capturedLeave }, activity: { eq: 'TIME_OFF' } },
			select: { employment_id: true, company_id: true, occurred_on: true, from: true, to: true },
			all: true
		},
		delete_slips: {
			from: 'payslip',
			where: { payroll_run_id: { in: { member: 'runs', field: 'id' } } },
			select: { payroll_run_id: true, employment_id: true },
			all: true
		}
	});
type PayrollAdmissionRead = Effect.Success<ReturnType<typeof loadPayrollAdmission>>;
export const admitPayrollRun = (request: PayrollRunRequest, prefetched?: PayrollAdmissionRead) =>
	Effect.gen(function* () {
		const salaryRun = SALARY_RUNS.includes(request.kind);
		const sources = request.sources ?? [];
		const offCycle = FAMILIES.filter((family) => family.family !== 'LEAVE');
		// One keyed read: the entity, its runs and — for a settlement run — which selected entries are open, and
		// every version of its lineage (the `settings_code` it names) with its scheme rows' codes; the governing
		// versions are picked in memory.
		const got =
			prefetched ??
			(yield* Effect.flatMap(Reads, ({ read }) =>
				loadPayrollAdmission(read, [request.company_id])
			));
		const selectedEntity = got.entity.rows.find((row) => row.id === request.company_id);
		if (selectedEntity === undefined)
			return yield* new Refusal({ message: 'This needs an actual approved legal entity.' });
		const entity = {
			...selectedEntity,
			pay_frequency: yield* Effect.fromResult(
				fieldValue(selectedEntity.pay_frequency, 'entity.pay_frequency')
			),
			pay_frequency_changes: yield* Effect.fromResult(
				fieldValue(selectedEntity.pay_frequency_changes, 'entity.pay_frequency_changes')
			),
			pay_cutoff_day: yield* Effect.fromResult(
				fieldValue(selectedEntity.pay_cutoff_day, 'entity.pay_cutoff_day')
			),
			region: yield* Effect.fromResult(fieldValue(selectedEntity.region, 'entity.region')),
			facts: yield* Effect.fromResult(fieldValue(selectedEntity.facts, 'entity.facts'))
		};
		const runs = got.runs.rows.filter((row) => row.company_id === request.company_id);
		const reservedPins = yield* Effect.fromResult(reservedPinsFrom(runs, request.run_id));
		// The whole write's lineage data was admitted in one keyed read.
		const governed = got;
		const lineage = got.lineage.rows
			.filter((row) => row.code === entity.settings_code)
			.map((version) => ({
				...version,
				statutory_contribution_catalog: governed.statutory.rows.filter(
					(row) => row.settings_id === version.id
				),
				allowance_catalog: governed.allowance.rows.filter((row) => row.settings_id === version.id)
			}));
		// The frequency in force on the period's days (`pay_frequency_changes`): a key the month's frequencies do not
		// offer is refused, and a period a switch cuts covers only its own frequency's days.
		const month = request.period.slice(0, 7);
		const spans = frequencySpans(entity, month);
		// The month is cut by the calendar of the version in force on its first day, then governed from the period's own.
		const opening = yield* Effect.fromResult(
			versionOn(lineage, entity.settings_code, `${month}-01`)
		);
		const openingPayroll = yield* Effect.fromResult(
			fieldValue(opening.payroll, 'jurisdiction_settings.payroll')
		);
		const calendar = {
			...(openingPayroll?.week_start == null ? {} : { week_start: openingPayroll.week_start }),
			...(openingPayroll?.semi_monthly_split == null
				? {}
				: { semi_monthly_split: openingPayroll.semi_monthly_split }),
			...(openingPayroll?.ten_day_splits == null
				? {}
				: { ten_day_splits: openingPayroll.ten_day_splits })
		};
		const offered = [
			...new Set(
				periodsIn(entity, month, calendar)
					.filter((held) => held.key === request.period)
					.map((held) => held.frequency)
			)
		];
		if (offered.length !== 1)
			return yield* new Refusal({
				message:
					offered.length === 0
						? `${request.period} is no pay period of ${entity.name ?? 'the entity'}: it pays ${spans.map((span) => `${span.frequency} ${span.from}–${span.to}`).join(', ')}.`
						: `${request.period} names a period of more than one pay frequency in force that month.`
			});
		const frequency = (
			['MONTHLY', 'SEMI_MONTHLY', 'TEN_DAY', 'WEEKLY', 'DAILY', 'INTEGER_MONTHS'] as const
		).find((value) => value === offered[0]);
		if (frequency === undefined)
			return yield* new Refusal({ message: 'The pay period requires its declared frequency.' });
		const nominal = yield* settlementPeriod(request.period, frequency, calendar);
		// ponytail: one span of the frequency per month; a switch away and back inside one month is refused above
		const own = spans.find((span) => span.frequency === frequency)!;
		const settlement = {
			...nominal,
			from: nominal.from > own.from ? nominal.from : own.from,
			to: nominal.to < own.to || frequency === 'WEEKLY' ? nominal.to : own.to
		};
		// a month paid at more than one frequency settles each line month to date (`buildPayrollRun`)
		const switched = spans.length > 1;
		const version = contains(opening.effective_range, settlement.from)
			? opening
			: yield* Effect.fromResult(versionOn(lineage, entity.settings_code, settlement.from));
		// The governing behaviours admit the run: which kinds a jurisdiction pays is a record, not a branch here.
		const behaviours = behavioursOf(
			yield* Effect.fromResult(fieldValue(version.behaviours, 'jurisdiction_settings.behaviours'))
		);
		const payroll = yield* Effect.fromResult(
			fieldValue(version.payroll, 'jurisdiction_settings.payroll')
		);
		const admitted =
			behaviours != null &&
			planBehaviours(
				behaviours,
				{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
				{ event: { data: { request: { kind: request.kind, period: request.period } } } }
			).length > 0;
		if (!admitted)
			return yield* new Refusal({
				message: `${version.code} admits no ${request.kind} payroll run under its behaviours.`
			});
		// A later period's runs read this one's year to date: an earlier period is run before them, never after.
		const later = runs
			.filter(
				(run) =>
					run.id !== request.run_id &&
					run.salary_from != null &&
					String(run.salary_from).slice(0, 10) > settlement.to
			)
			.map((run) => String(run.period))
			.toSorted();
		if (later.length > 0)
			return yield* new Refusal({
				message: `${later.join(', ')} already has a run: delete the runs after ${request.period}, latest first, and rebuild them after it, so their year to date reads it.`
			});
		// Salary runs never cover one day twice: a period over days another frequency's run already paid is refused.
		const overlapping = runs.find(
			(run) =>
				run.id !== request.run_id &&
				run.period !== request.period &&
				isSalaryRun(run.kind) &&
				run.salary_from != null &&
				run.salary_to != null &&
				String(run.salary_from).slice(0, 10) <= settlement.to &&
				String(run.salary_to).slice(0, 10) >= settlement.from
		);
		if (salaryRun && overlapping != null)
			return yield* new Refusal({
				message: `${request.period} covers days ${String(overlapping.period)} already paid.`
			});
		if (
			salaryRun &&
			runs.some(
				(run) => run.id !== request.run_id && run.period === request.period && isSalaryRun(run.kind)
			)
		)
			return yield* new Refusal({
				message: `${request.period} already has a salary run. Delete it to re-run, or create an off-cycle run for one-off payments.`
			});
		if (!salaryRun) {
			if (sources.length === 0)
				return yield* new Refusal({
					message:
						'An off-cycle or correction run pays only the ad hoc or claim entries it selects; select at least one.'
				});
			const families = yield* Effect.fromResult(
				payrollSetting(version.code, payroll, 'off_cycle_families')
			);
			const open = new Set<string>(
				offCycle
					.filter((family) => families.includes(family.family))
					.flatMap((family) =>
						(family.collection === 'adhoc_catalog_entry'
							? got.source_adhoc.rows
							: family.collection === 'claim_catalog_entry'
								? got.source_claim.rows
								: got.source_loan.rows
						)
							.filter(
								(row) =>
									row.company_id === request.company_id &&
									!reservedPins.has(`${family.collection}:${row.id}`)
							)
							.map((row) => row.id)
					)
			);
			const missing = sources.filter((id) => !open.has(id));
			if (missing.length > 0)
				return yield* new Refusal({
					message: `${missing.length} selected entr${missing.length === 1 ? 'y is' : 'ies are'} not an approved, unpaid entry of a family ${version.code} lets an off-cycle run pay.`
				});
		}
		// Only the governing version's rules price this run.
		const rules = got.rules.rows.filter((row) => row.settings_id === version.id);
		const held = governedFrom(governed, version.id, rules);
		const governedRows = held === undefined ? [] : [held];
		return {
			entity: { ...entity, pay_frequency: frequency },
			version,
			settlement,
			salaryRun,
			sources,
			reservedPins,
			runs,
			lineage,
			governedRows,
			switched
		};
	});
// ponytail: separations reach a year either side of the day (mass-layoff and notice windows); longer needs more.
const SEPARATION_DAYS = 366;
/**
 * The entity's staffing on a day (payees left out): its contracts in force (`headcount`), the same by worksite
 * (`headcount_by_worksite`, the terms in force's `facts.worksite`, blank when none), at each of the 12 month ends
 * through the day's month (`headcount_months[]`, `{ month, headcount }`), every month end of the previous calendar
 * year (`previous_year_headcount_months[]`), and its `separations` — every contract ending
 * within a year either side of the day, each `{ employment_id, exit_date, exit_ground, exit_facts, term_facts,
 * worksite, fixed_term }` (of the terms in force on the exit day). A count by cause, worksite or window is the
 * record's own filter. Permanent is the version's `payroll.permanent_when` CEL over the terms in force (`terms`);
 * `fixed_term` is its negation.
 */
export const staffingFrom = (
	all: readonly Pick<
		ContractRow,
		'id' | 'company_id' | 'effective_range' | 'engagement' | 'exit_ground' | 'exit_facts' | 'facts'
	>[],
	day: string,
	permanentWhen: string
) =>
	Result.gen(function* () {
		const permanentOn = (term: ContractTerm | undefined) =>
			Result.try({
				try: () => evaluateConfigured(permanentWhen, { terms: celValues(term ?? {}) }),
				catch: (cause) =>
					new Refusal({
						message: 'payroll.permanent_when: the stored expression failed.',
						detail: getErrorMessage(cause)
					})
			}).pipe(
				Result.flatMap((value) =>
					Schema.is(Schema.Boolean)(value)
						? Result.succeed(value)
						: Result.fail(new Refusal({ message: 'payroll.permanent_when must return a boolean.' }))
				)
			);
		const contracts: (typeof all)[number][] = [];
		for (const contract of all) {
			const engagement = yield* fieldValue(contract.engagement, 'employment_contract.engagement');
			if (engagement !== 'PAYEE') contracts.push(contract);
		}
		const from = addDays(day, -SEPARATION_DAYS);
		const to = addDays(day, SEPARATION_DAYS);
		const headcount_by_worksite: {
			[worksite: string]: number;
		} = {};
		const headcount_permanent_by_worksite: {
			[worksite: string]: number;
		} = {};
		const permanent: (typeof all)[number][] = [];
		for (const contract of contracts) {
			const range = yield* fieldValue(
				contract.effective_range,
				'employment_contract.effective_range'
			);
			const term = yield* termFor(contract, day);
			const isPermanent = yield* permanentOn(term);
			if (isPermanent) permanent.push(contract);
			if (dayInRange(day, range)) {
				const site = yield* worksiteOn(undefined, term);
				headcount_by_worksite[site] = (headcount_by_worksite[site] ?? 0) + 1;
				if (isPermanent)
					headcount_permanent_by_worksite[site] = (headcount_permanent_by_worksite[site] ?? 0) + 1;
			}
		}
		const separations = yield* Result.all(
			contracts.map((contract) =>
				Result.gen(function* () {
					const range = yield* fieldValue(
						contract.effective_range,
						'employment_contract.effective_range'
					);
					const exit = range.to;
					if (exit == null || exit < from || exit > to) return [];
					const term = yield* termFor(contract, exit);
					const exit_ground = yield* fieldValue(
						contract.exit_ground,
						'employment_contract.exit_ground'
					);
					const exit_facts = yield* fieldValue(
						contract.exit_facts,
						'employment_contract.exit_facts'
					);
					return [
						{
							employment_id: contract.id,
							exit_date: exit,
							exit_ground: exit_ground ?? '',
							exit_facts: exit_facts ?? {},
							term_facts: term?.facts ?? {},
							worksite: yield* worksiteOn(undefined, term),
							fixed_term: !(yield* permanentOn(term))
						}
					];
				})
			)
		);
		return {
			headcount: yield* inForce(contracts, day),
			// Contracts in force the version's `payroll.permanent_when` holds for.
			headcount_permanent: yield* inForce(permanent, day),
			headcount_by_worksite,
			// The same without fixed-term contracts (a site with none is absent: `has()`).
			headcount_permanent_by_worksite,
			previous_year_headcount_months: yield* Result.all(
				Array.from({ length: MONTHS_OF_YEAR }, (_, i) =>
					Result.gen(function* () {
						const month = monthOf(addMonths(day.slice(0, 4) + '-01-01', i - MONTHS_OF_YEAR));
						return {
							month: String(month.from).slice(0, 7),
							headcount: yield* inForce(contracts, String(month.to))
						};
					})
				)
			),
			headcount_months: yield* Result.all(
				Array.from({ length: MONTHS_OF_YEAR }, (_, i) =>
					Result.gen(function* () {
						const month = monthOf(addMonths(String(monthOf(day).from), i + 1 - MONTHS_OF_YEAR));
						return {
							month: String(month.from).slice(0, 7),
							headcount: yield* inForce(contracts, String(month.to))
						};
					})
				)
			),
			separations: separations
				.flat()
				// By exit day: a window count is `count_within(separations, "exit_date", from, to)`.
				.toSorted((left, right) => left.exit_date.localeCompare(right.exit_date))
		};
	});
const RECORD_RETENTION: keyof typeof PAYROLL_SLOTS = 'record_retention';
/** The PAYROLL `record_retention` slot: the `until` CEL on the subject at the exit. */
const RecordRetention = Schema.Struct({ until: Schema.String });
/** PAYROLL slots are objects in the CEL `rules` root; other families keep their own payload contracts. */
export const payrollRulesOf = (
	rows: readonly { readonly code: string; readonly rules: unknown }[]
) =>
	Result.gen(function* () {
		const rules: Record<string, JsonObject> = {};
		for (const row of rows) {
			const value = yield* fieldValue(row.rules, `rule_set.${row.code}.rules`);
			if (!isJsonObject(value))
				return yield* Result.fail(
					new Refusal({ message: `${row.code} must contain an object of payroll rules.` })
				);
			rules[row.code] = value;
		}
		return rules;
	});
/**
 * A version's `VALIDATIONS` rule-set rows: each `rules` names its `site` (`contract`: a contract's terms as written;
 * `payslip`: each slip of a build; `roster`: a roster day; `cycle`: a pattern cycle a roster write changes, `cycle`
 * { date, from, to, planned, expected }), its `kind` (`refuse` the write, `warn` in the run's warnings, `hold` the slip
 * ON_HOLD), the CEL `when` that trips it and the `message`.
 */
export const Validation = Schema.Struct({
	site: Schema.Literals(['contract', 'payslip', 'roster', 'cycle']),
	kind: Schema.Literals(['refuse', 'warn', 'hold']),
	when: Schema.String,
	message: Schema.String,
	description: Schema.optional(Schema.String),
	/** `roster`: the sheet field the finding points at (`overtime_hours`, `clock_in`, …). */
	column: Schema.optional(Schema.String)
});
export type Validation = typeof Validation.Type & {
	readonly code: string;
};
/** A version's `VALIDATIONS` rows of one site, each checked for its shape. */
export const validationsOf = (
	rows: readonly {
		code: string;
		rules?: unknown;
	}[],
	site: Validation['site']
) =>
	Effect.gen(function* () {
		const out: Validation[] = [];
		for (const row of rows) {
			if (!Schema.is(Validation)(row.rules))
				return yield* new Refusal({
					message: `rule_set ${row.code}: a validation names its site, kind, when and message.`
				});
			if (row.rules.site === site) out.push({ ...row.rules, code: row.code });
		}
		return out;
	});
/** An entity's choice of how each validation binds it (`entity.validation_severity`). */
export type Severity = Row<'entity'>['validation_severity'];
/**
 * A rule's kind for one entity: its override by code, else the entity's default; `record` or no choice keeps the
 * rule's own kind. Every site (contract, payslip, roster, a statutory `refuse_when`) resolves through this.
 */
export const severityOf = (
	severity: Severity | undefined,
	code: string,
	kind: Validation['kind']
): Validation['kind'] => {
	const chosen = severity?.rules[code] ?? severity?.default;
	return chosen == null || chosen === 'record' ? kind : chosen;
};
/** The validations that trip on one context, in code order, each with its kind for the entity's `severity`. */
export const tripped = (
	validations: readonly Validation[],
	context: DynObject,
	severity: Severity | undefined
) =>
	Effect.gen(function* () {
		const out: Validation[] = [];
		for (const check of validations.toSorted((left, right) => left.code.localeCompare(right.code)))
			if (yield* evaluateBoolean(check.when, context, `rule_set ${check.code}`))
				out.push({ ...check, kind: severityOf(severity, check.code, check.kind) });
		return out;
	});
/**
 * A contract's terms as written, against the `contract` validations of the version governing each new or changed
 * term's first day: the first that trips refuses the write. A day no sealed version governs has nothing to check.
 */
/** Contract writes prefetch every person's history and every governing rule in one statement. */
export const loadContractWriteBatch = (
	read: Read,
	identities: {
		readonly companies: readonly Id<'entity'>[];
		readonly employees: readonly Id<'employment_profile'>[];
		readonly employments: readonly Id<'employment_contract'>[];
	}
) =>
	read({
		entities: {
			from: 'entity',
			where: { id: { in: identities.companies } },
			select: ENTITY,
			all: true
		},
		employees: {
			from: 'employment_profile',
			where: { id: { in: identities.employees } },
			select: PROFILE,
			all: true
		},
		contracts: {
			from: 'employment_contract',
			where: { company_id: { in: identities.companies } },
			select: CONTRACT,
			all: true
		},
		versions: {
			from: 'jurisdiction_settings',
			where: {
				code: { in: { member: 'entities', field: 'settings_code' } },
				sealed_at: { isNull: false },
				voided_at: { isNull: true }
			},
			select: SETTINGS,
			all: true
		},
		rules: {
			from: 'rule_set',
			where: { settings_id: { in: { member: 'versions', field: 'id' } } },
			select: { ...RULES, family: true, settings_id: true },
			all: true
		},
		allowances: {
			from: 'allowance_catalog',
			where: { settings_id: { in: { member: 'versions', field: 'id' } } },
			select: { code: true, settings_id: true },
			all: true
		},
		payslips: {
			from: 'payslip',
			where: { employment_id: { in: identities.employments } },
			select: { employment_id: true, salary_from: true, salary_to: true },
			all: true
		}
	});
type ContractWriteRead = Effect.Success<ReturnType<typeof loadContractWriteBatch>>;
export const admitContractTerms = (input: {
	readonly contract: Partial<ContractRow>;
	readonly before: ContractRow['facts'] | null | undefined;
	readonly prefetched?: ContractWriteRead;
}) =>
	Effect.gen(function* () {
		const contract = input.contract;
		if (contract.company_id == null || contract.employee_id == null)
			return yield* new Refusal({ message: 'This contract needs its entity, person and terms.' });
		const company_id = contract.company_id;
		const employee_id = contract.employee_id;
		const before = yield* Effect.fromResult(fieldValue(input.before, 'employment_contract.facts'));
		const facts = yield* Effect.fromResult(fieldValue(contract.facts, 'employment_contract.facts'));
		const held = new Set((before?.contract_terms ?? []).map((term) => stableJson(term)));
		const changed = (facts?.contract_terms ?? []).filter(
			(term) => !held.has(stableJson(term)) && term.effective_range?.from != null
		);
		if (changed.length === 0) return;
		const got =
			input.prefetched ??
			(yield* Effect.flatMap(Reads, ({ read }) =>
				loadContractWriteBatch(read, {
					companies: [company_id],
					employees: [employee_id],
					employments: contract.id == null ? [] : [contract.id]
				})
			));
		const entity = got.entities.rows.find((row) => row.id === company_id);
		if (entity === undefined)
			return yield* new Refusal({ message: 'This contract needs its actual entity.' });
		const allowanceIds = [
			...new Set(
				changed
					.flatMap((term) => term.allowances ?? [])
					.flatMap((line) => (line.catalogue_id != null ? [line.catalogue_id] : []))
			)
		];
		const allowanceCodes = new Map<string, string>();
		if (allowanceIds.length > 0) {
			const lineageVersions = new Set(
				got.versions.rows.filter((row) => row.code === entity.settings_code).map((row) => row.id)
			);
			for (const row of got.allowances.rows) {
				if (!allowanceIds.includes(row.id) || !lineageVersions.has(row.settings_id)) continue;
				allowanceCodes.set(
					row.id,
					yield* Effect.fromResult(fieldValue(row.code, 'allowance_catalog.code'))
				);
			}
			if (allowanceCodes.size !== allowanceIds.length)
				return yield* new Refusal({
					message:
						'A contract allowance names no actual allowance catalogue in this entity’s jurisdiction.'
				});
		}
		if (allowanceCodes.size > 0) {
			for (const term of changed)
				for (const line of term.allowances ?? []) {
					if (line.catalogue_id == null) continue;
					if (line.code != null && line.code.trim() !== allowanceCodes.get(line.catalogue_id))
						return yield* new Refusal({
							message: 'A contract allowance code must match its catalogue item.'
						});
				}
		}
		const employee = got.employees.rows.find((row) => row.id === employee_id);
		const selfId = contract.id;
		for (const term of changed) {
			const day = String(term.effective_range!.from);
			const version = yield* Effect.fromResult(
				versionOn(got.versions.rows, entity.settings_code, day)
			).pipe(Effect.catchTag('Refusal', () => Effect.succeed(undefined)));
			if (version === undefined) continue;
			const versionRows = got.rules.rows.filter((row) => row.settings_id === version.id);
			const checks = yield* validationsOf(
				versionRows.filter((row) => row.family === 'VALIDATIONS'),
				'contract'
			);
			if (checks.length === 0) continue;
			const earlier = /employment\.terms|person\.contracts/.test(JSON.stringify(checks))
				? got.contracts.rows.filter(
						(row) =>
							row.employee_id === employee_id && row.company_id === company_id && row.id !== selfId
					)
				: undefined;
			const subject = yield* Effect.fromResult(
				subjectContext({
					contract,
					employee,
					entity,
					term,
					day,
					headcount: yield* Effect.fromResult(
						inForce(
							got.contracts.rows.filter(
								(row) => row.company_id === company_id && row.engagement !== 'PAYEE'
							),
							day
						)
					),
					version,
					allowanceCodes
				})
			);
			// `employment.terms[]`: this employment's other terms; `person.contracts[]`: the person's other contracts
			// with this employer (`id`, `start`, `end`, `exit_ground`, `contract_type` and `facts` of their last term).
			const extras: DynObject =
				earlier === undefined
					? {}
					: {
							employment: {
								...subject.employment,
								terms: (facts?.contract_terms ?? []).filter(
									(other) => stableJson(other) !== stableJson(term)
								)
							},
							person: {
								...subject.person,
								contracts: (yield* Effect.fromResult(
									Result.all(
										earlier.map((row) =>
											Result.gen(function* () {
												const rowFacts = yield* fieldValue(row.facts, 'employment_contract.facts');
												const range = yield* fieldValue(
													row.effective_range,
													'employment_contract.effective_range'
												);
												const ground = yield* fieldValue(
													row.exit_ground,
													'employment_contract.exit_ground'
												);
												const last = (rowFacts?.contract_terms ?? [])
													.toSorted((a, b) =>
														String(a.effective_range?.from).localeCompare(
															String(b.effective_range?.from)
														)
													)
													.at(-1);
												return {
													id: row.id,
													start: range?.from ?? '',
													end: range?.to ?? '',
													exit_ground: ground ?? '',
													contract_type: last?.employment_type ?? '',
													facts: last?.facts ?? {},
													// Every term, oldest first: a first-term probation is seen too.
													terms: (rowFacts?.contract_terms ?? [])
														.map((held) => ({
															from: held.effective_range?.from ?? '',
															to: held.effective_range?.to ?? '',
															contract_type: held.employment_type ?? '',
															facts: held.facts ?? {}
														}))
														.toSorted((a, b) => String(a.from).localeCompare(String(b.from)))
												};
											})
										)
									)
								)).toSorted((a, b) => a.start.localeCompare(b.start))
							}
						};
			const context: DynObject = {
				...subject,
				...extras,
				rules: yield* Effect.fromResult(
					payrollRulesOf(versionRows.filter((row) => row.family === 'PAYROLL'))
				),
				term: subject.terms,
				day
			};
			const [first] = (yield* tripped(checks, context, entity.validation_severity)).filter(
				(check) => check.kind === 'refuse'
			);
			if (first != null) return yield* new Refusal({ message: first.message });
		}
	});
/** One person-day of a roster import as it would be stored; `ref` is the caller's handle on it (a sheet row). */
export type RosterDraft = {
	readonly ref: number;
	readonly employment_id: Id<'employment_contract'>;
	readonly work_date: string;
	readonly shift_definition_id?: Id<'shift_definition'> | null;
	readonly planned_overtime_hours?: number | null;
	readonly approved_overtime_intervals?: Row<'roster_entry'>['approved_overtime_intervals'];
	readonly worked_intervals?: Row<'roster_entry'>['worked_intervals'];
	readonly banked_overtime_hours?: number | null;
	readonly overtime_consented_at?: Row<'roster_entry'>['overtime_consented_at'];
	/** The leave class covering the day, recorded or imported; blank when none. */
	readonly leave_code: string;
};
type RosterFinding = {
	readonly ref: number;
	readonly code: string;
	readonly kind: Validation['kind'];
	readonly message: string;
	readonly column: string;
};
/** The days a set of roster drafts spans: what `rosterMembers` reads around. */
const draftSpan = (drafts: readonly Pick<RosterDraft, 'work_date'>[]) => {
	const days = [...new Set(drafts.map((draft) => draft.work_date))].toSorted();
	return { from: days[0] ?? '9999-12-31', to: days.at(-1) ?? '9999-12-31' };
};
/**
 * What `rosterFindings` reads for one entity over `span`, as native keyed read members: the entity, its
 * lineage's versions over the span with their validations and rules, and its contracts, people, shifts, patterns and
 * published holidays. A caller folds them into its own keyed read (the import's check reads once).
 */
const rosterMembers = (
	company_id: Id<'entity'> | readonly Id<'entity'>[],
	span: { readonly from: string; readonly to: string }
) =>
	({
		entity: {
			from: 'entity',
			where: { id: { in: typeof company_id === 'string' ? [company_id] : company_id } },
			select: ENTITY,
			all: true
		},
		contracts: {
			from: 'employment_contract',
			where: { company_id: { in: typeof company_id === 'string' ? [company_id] : company_id } },
			select: CONTRACT,
			all: true
		},
		people: {
			from: 'employment_profile',
			where: { id: { in: { member: 'contracts', field: 'employee_id' } } },
			select: PROFILE,
			all: true
		},
		definitions: {
			from: 'shift_definition',
			where: { company_id: { in: typeof company_id === 'string' ? [company_id] : company_id } },
			select: { company_id: true, code: true, variant: true },
			all: true
		},
		patterns: {
			from: 'shift_pattern',
			where: { company_id: { in: typeof company_id === 'string' ? [company_id] : company_id } },
			select: { company_id: true, pattern: true, effective_range: true },
			all: true
		},
		holidays: {
			from: 'holiday',
			where: {
				company_id: { in: typeof company_id === 'string' ? [company_id] : company_id },
				date: { gte: PlainDate(span.from), lte: PlainDate(span.to) },
				published_at: { isNull: false }
			},
			select: HOLIDAY,
			all: true
		},
		versions: {
			from: 'jurisdiction_settings',
			where: {
				code: { in: { member: 'entity', field: 'settings_code' } },
				voided_at: { isNull: true },
				sealed_at: { isNull: false },
				effective_range: {
					overlaps: {
						from: PlainDate(span.from),
						to: PlainDate(span.to)
					}
				}
			},
			select: SETTINGS,
			all: true
		},
		rules: {
			from: 'rule_set',
			where: {
				settings_id: { in: { member: 'versions', field: 'id' } },
				family: { in: ['VALIDATIONS', 'PAYROLL'] }
			},
			select: { ...RULES, family: true, settings_id: true },
			all: true
		}
	}) as const;
const loadRoster = (
	read: Read,
	company_id: Id<'entity'>,
	span: Parameters<typeof rosterMembers>[1]
) => read(rosterMembers(company_id, span));
type RosterRead = Effect.Success<ReturnType<typeof loadRoster>>;
/**
 * A roster import's days against the `roster` validations of the version governing each day, in code order. The
 * context is the subject on the day plus `rules`, `day` (a `work.days[]` day as the import would store it, with
 * `leave_code` and `rest_hours_before` = hours from the previous day's last clock-out to this day's first clock-in,
 * null when either is unrecorded) and `week` (`worked_hours`, `overtime_hours`, `worked_days` over the seven days
 * ending on the day, `overtime_hours_by_day_type.<WORK|REST|OFF|HOLIDAY>`: by the planned type, holidays again,
 * `overtime_hours_holiday_by_day_type.<WORK|REST|OFF>`: holiday overtime alone by the type the holiday fell on, and
 * `holiday_worked_hours`: the normal hours worked on holidays; `holiday_or_rest_worked_hours`: the normal hours
 * on public holidays or planned rest days, counting an overlapping day once). Days outside the import read as unrecorded.
 */
export const rosterFindings = (company_id: Id<'entity'>, drafts: readonly RosterDraft[]) =>
	Effect.gen(function* () {
		if (drafts.length === 0) return [];
		const { read } = yield* Reads;
		const got = yield* loadRoster(read, company_id, draftSpan(drafts));
		return yield* rosterFindingsFrom(company_id, drafts, got);
	});
/** `rosterFindings` over `rosterMembers`' rows (`got`, read with `prefix`). */
export const rosterFindingsFrom = (
	company_id: Id<'entity'>,
	drafts: readonly RosterDraft[],
	got: RosterRead,
	/** Kept neighbor days still supply the week; a write need only judge the refs it can refuse. */
	checkedRefs?: ReadonlySet<number>
) =>
	Effect.gen(function* () {
		if (drafts.length === 0) return [];
		const days = [...new Set(drafts.map((draft) => draft.work_date))].toSorted();
		const entity = got.entity.rows[0];
		if (entity == null)
			return yield* new Refusal({ message: 'This needs an actual approved legal entity.' });
		const versions = got.versions.rows;
		const ruleSets = got.rules.rows;
		const checksOf = new Map<
			string,
			{
				version: SettingsRow;
				checks: readonly Validation[];
			}
		>();
		const governed = new Map<
			string,
			{
				version: SettingsRow;
				checks: readonly Validation[];
				headcount: number;
			}
		>();
		for (const date of days) {
			const found = yield* Effect.result(
				Effect.fromResult(versionOn(versions, entity.settings_code, date))
			);
			if (Result.isFailure(found)) continue;
			const version = found.success;
			let held = checksOf.get(version.id);
			if (held == null) {
				held = {
					version,
					checks: yield* validationsOf(
						ruleSets.filter(
							(row) => row.settings_id === version.id && row.family === 'VALIDATIONS'
						),
						'roster'
					)
				};
				checksOf.set(version.id, held);
			}
			if (held.checks.length > 0)
				governed.set(date, {
					...held,
					headcount: yield* Effect.fromResult(inForce(got.contracts.rows, date))
				});
		}
		if (governed.size === 0) return [];
		const rules = new Map<string, DynObject>();
		for (const { version } of checksOf.values())
			rules.set(
				version.id,
				yield* Effect.fromResult(
					payrollRulesOf(
						ruleSets.filter((row) => row.settings_id === version.id && row.family === 'PAYROLL')
					)
				)
			);
		const contracts = got.contracts.rows;
		const byEmployment = new Map<string, RosterDraft[]>();
		for (const draft of drafts) {
			const own = byEmployment.get(draft.employment_id);
			if (own === undefined) byEmployment.set(draft.employment_id, [draft]);
			else own.push(draft);
		}
		const ids = new Set(byEmployment.keys());
		const mine = contracts.filter((contract) => ids.has(contract.id));
		const employees = new Map<string, EmployeeRow>(got.people.rows.map((row) => [row.id, row]));
		const definitions = new Map<string, ShiftDefinitionRow>(
			got.definitions.rows.map((row) => [row.id, row])
		);
		const patterns = new Map<string, ShiftPatternRow>(
			got.patterns.rows.map((row) => [row.id, row])
		);
		const holidays = new Map<string, HolidayRow>(got.holidays.rows.map((row) => [row.date, row]));
		const zone = yield* Effect.fromResult(zoneOf(entity, [...checksOf.values()][0]?.version));
		const policy = yield* Effect.fromResult(attendancePolicy([...checksOf.values()][0]?.version));
		const out: RosterFinding[] = [];
		for (const contract of mine) {
			const own = byEmployment.get(contract.id) ?? [];
			if (checkedRefs !== undefined && !own.some((draft) => checkedRefs.has(draft.ref))) continue;
			const byDate = new Map(own.map((draft) => [draft.work_date, draft]));
			const rosterOn = new Map(own.map((draft) => [draft.work_date, draft]));
			const planOn = dayPlanner({
				contract,
				fallback: undefined,
				roster: rosterOn,
				definitions,
				patterns
			});
			const calculateDay = (date: string) =>
				Result.gen(function* () {
					const planned = yield* planOn(date);
					const row = rosterOn.get(date);
					// Week context needs raw attendance, not paid-window geometry; every judged row keeps the full guard.
					const day =
						checkedRefs === undefined ||
						(row != null && checkedRefs.has(row.ref)) ||
						num(row?.banked_overtime_hours) > 0
							? yield* workDay({
									date,
									planned,
									row,
									holiday: holidays.get(date),
									zone,
									policy
								})
							: {
									day_type: planned?.day_type ?? '',
									holiday_kind: holidays.get(date)?.kind ?? ''
								};
					const intervals = yield* fieldValue(
						row?.worked_intervals,
						'roster_entry.worked_intervals'
					);
					const actual = recordedWork(intervals ?? [], date, planned?.break, zone);
					return {
						...day,
						worked_hours: round2(actual.hours),
						worked: actual.hours > 0,
						intervals: actual.intervals,
						overtime_hours:
							planned == null ? 0 : round2(Math.max(0, actual.hours - planned.scheduled_hours))
					};
				});
			const calculatedDays = new Map<string, ReturnType<typeof calculateDay>>();
			const dayOf = (date: string) => {
				const held = calculatedDays.get(date);
				if (held !== undefined) return held;
				const day = calculateDay(date);
				calculatedDays.set(date, day);
				return day;
			};
			const clocks = (
				date: string
			): {
				first: number;
				last: number;
			} | null => {
				const stored = rosterOn.get(date)?.worked_intervals;
				const list = stored ?? [];
				const ends = list.flatMap((row) => (row.end == null ? [] : [Date.parse(row.end)]));
				const first = list[0] == null ? Number.NaN : Date.parse(list[0].start);
				return Number.isFinite(first) && ends.length > 0
					? { first, last: Math.max(...ends) }
					: null;
			};
			for (const draft of own.toSorted((a, b) => a.work_date.localeCompare(b.work_date))) {
				if (checkedRefs !== undefined && !checkedRefs.has(draft.ref)) continue;
				const held = governed.get(draft.work_date);
				if (held == null) continue;
				const day = yield* Effect.fromResult(dayOf(draft.work_date));
				const today = clocks(draft.work_date);
				const before = clocks(addDays(draft.work_date, -1));
				const by: {
					[type: string]: number;
				} = { WORK: 0, REST: 0, OFF: 0, HOLIDAY: 0 };
				const holidayBy: {
					[type: string]: number;
				} = { WORK: 0, REST: 0, OFF: 0 };
				const week = {
					worked_hours: 0,
					overtime_hours: 0,
					worked_days: 0,
					overtime_hours_by_day_type: by,
					overtime_hours_holiday_by_day_type: holidayBy,
					holiday_worked_hours: 0,
					holiday_or_rest_worked_hours: 0
				};
				// The week: the 7 days ending on the day, or (`payroll.roster_week: CALENDAR`) the calendar week from
				// `payroll.week_start` through the day.
				const payroll = yield* Effect.fromResult(
					fieldValue(held.version.payroll, 'jurisdiction_settings.payroll')
				);
				const calendarWeek = payroll?.roster_week === 'CALENDAR';
				const span = calendarWeek
					? ((new Date(`${draft.work_date}T00:00:00Z`).getUTCDay() -
							(payroll?.week_start ?? 0) +
							7) %
							7) +
						1
					: 7;
				for (let back = 0; back < span; back++) {
					const date = addDays(draft.work_date, -back);
					if (!byDate.has(date)) continue;
					const other = back === 0 ? day : yield* Effect.fromResult(dayOf(date));
					week.worked_hours = round2(week.worked_hours + num(other['worked_hours']));
					week.overtime_hours = round2(week.overtime_hours + num(other['overtime_hours']));
					// By the day's planned type, and again under HOLIDAY on a published holiday.
					const type = String(other['day_type'] ?? '');
					if (type === 'REST' || String(other['holiday_kind'] ?? '') !== '')
						week.holiday_or_rest_worked_hours = round2(
							week.holiday_or_rest_worked_hours +
								Math.max(0, num(other['worked_hours']) - num(other['overtime_hours']))
						);
					if (type !== '') by[type] = round2((by[type] ?? 0) + num(other['overtime_hours']));
					if (String(other['holiday_kind'] ?? '') !== '') {
						by['HOLIDAY'] = round2((by['HOLIDAY'] ?? 0) + num(other['overtime_hours']));
						// A holiday's overtime by the day type it fell on, and its normal (non-overtime) hours worked.
						if (type !== '')
							holidayBy[type] = round2((holidayBy[type] ?? 0) + num(other['overtime_hours']));
						week.holiday_worked_hours = round2(
							week.holiday_worked_hours +
								Math.max(0, num(other['worked_hours']) - num(other['overtime_hours']))
						);
					}
					if (other['worked'] === true) week.worked_days++;
				}
				const term = yield* Effect.fromResult(termFor(contract, draft.work_date));
				const context: DynObject = {
					...(yield* Effect.fromResult(
						subjectContext({
							contract,
							employee: employees.get(contract.employee_id),
							entity,
							term,
							day: draft.work_date,
							headcount: held.headcount,
							version: held.version
						})
					)),
					rules: rules.get(held.version.id) ?? {},
					day: {
						...day,
						leave_code: draft.leave_code,
						rest_hours_before:
							today == null || before == null ? null : round2((today.first - before.last) / 3600000)
					},
					week
				};
				for (const check of yield* tripped(held.checks, context, entity.validation_severity))
					out.push({
						ref: draft.ref,
						code: check.code,
						kind: check.kind,
						message: check.message,
						column: check.column ?? ''
					});
			}
		}
		return out;
	});
type DayTypeCounts = { readonly WORK: number; readonly REST: number; readonly OFF: number };
/** One whole pattern cycle around a touched day: the `cycle` root of a `cycle` validation. */
export type PatternCycle = {
	readonly date: string;
	readonly from: string;
	readonly to: string;
	readonly planned: DayTypeCounts;
	readonly expected: DayTypeCounts;
};
/**
 * The whole cycles of the pattern the terms in force name (its length from its anchor) around each touched day, each
 * with the WORK, REST and OFF days the roster plans and the pattern plans: the `cycle` root of the version's `cycle`
 * validations. A cycle the employment, the pattern or one set of terms covers only in part is not listed.
 */
export const patternCycles = (input: {
	readonly contract: Pick<ContractRow, 'facts' | 'effective_range'>;
	readonly definitions: ReadonlyMap<string, ShiftDefinitionRow>;
	readonly patterns: ReadonlyMap<string, ShiftPatternRow>;
	/** The roster's own shift on a day, null when it names none. */
	readonly rosteredOn: (date: string) => string | null;
	readonly dates: readonly string[];
}) =>
	Result.gen(function* () {
		const judged = new Set<string>();
		const cycles: PatternCycle[] = [];
		const typeOf = (id: string | null | undefined) => {
			const definition = id == null || id === '' ? undefined : input.definitions.get(id);
			return definition == null ? '' : plannedShift(definition).day_type;
		};
		for (const date of input.dates) {
			const patternId = (yield* termFor(input.contract, date))?.shift_pattern_id;
			const pattern = patternId == null ? undefined : input.patterns.get(patternId);
			const anchor = pattern?.effective_range?.from;
			const cycle = cycleDays(pattern?.pattern);
			if (pattern == null || anchor == null || cycle.length === 0 || date < anchor) continue;
			const elapsed = Math.round(
				(Date.parse(`${date}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86400000
			);
			const from = addDays(anchor, elapsed - (elapsed % cycle.length));
			if (judged.has(`${patternId}:${from}`)) continue;
			judged.add(`${patternId}:${from}`);
			const planned = { WORK: 0, REST: 0, OFF: 0 };
			const expected = { WORK: 0, REST: 0, OFF: 0 };
			let whole = true;
			for (const [i, day] of cycle.entries()) {
				const on = addDays(from, i);
				if (
					!dayInRange(on, pattern.effective_range ?? {}) ||
					!dayInRange(on, input.contract.effective_range ?? {}) ||
					(yield* termFor(input.contract, on))?.shift_pattern_id !== patternId
				) {
					whole = false;
					break;
				}
				const want = typeOf(day.roster_code_id);
				const got = typeOf(input.rosteredOn(on) ?? day.roster_code_id);
				if (want === 'WORK' || want === 'REST' || want === 'OFF') expected[want]++;
				if (got === 'WORK' || got === 'REST' || got === 'OFF') planned[got]++;
			}
			if (whole)
				cycles.push({ date, from, to: addDays(from, cycle.length - 1), planned, expected });
		}
		return cycles;
	});
/** A refusing `cycle` validation's sentence for one cycle (its counts, then the row's message), else null. */
export const cycleRefusal = (
	cycle: PatternCycle,
	checks: readonly Validation[],
	severity: Severity | undefined
) =>
	Effect.gen(function* () {
		const refused = (yield* tripped(checks, { cycle }, severity)).find(
			(check) => check.kind === 'refuse'
		);
		const { date, from, to, planned, expected } = cycle;
		return refused == null
			? null
			: `${date}: the cycle ${from} to ${to} plans ${planned.WORK} work, ${planned.REST} rest and ${planned.OFF} off days, but its pattern plans ${expected.WORK} work, ${expected.REST} rest and ${expected.OFF} off days. ${refused.message}`;
	});
/** One roster day a write changes: its row as it would be stored, null when the write deletes it. */
export type RosterTouch = {
	readonly employment_id: Id<'employment_contract'>;
	readonly work_date: string;
	readonly row: Omit<RosterDraft, 'ref' | 'employment_id' | 'work_date' | 'leave_code'> | null;
};
/**
 * Why a roster write breaks its plan, else null: a refusing `roster` validation of the law in force on a changed day
 * (read with the stored days around it, the write applied), or a refusing `cycle` validation over a changed
 * pattern cycle's planned and expected WORK, REST and OFF days (`patternCycles`). The work-day sheet and the month board write through this one judge.
 */
export const rosterPlanRefusal = (
	touched: readonly RosterTouch[],
	employmentCompanies?: readonly {
		readonly id: Id<'employment_contract'>;
		readonly company_id: Id<'entity'>;
	}[]
) =>
	Effect.gen(function* () {
		if (touched.length === 0) return null;
		const { read } = yield* Reads;
		const ids = [...new Set(touched.map((touch) => touch.employment_id))];
		const companies =
			employmentCompanies === undefined
				? (yield* read({
						contracts: {
							from: 'employment_contract',
							where: { id: { in: ids } },
							select: { company_id: true },
							all: true
						}
					})).contracts.rows
				: employmentCompanies;
		const companyByEmployment = new Map(companies.map((row) => [row.id, row.company_id]));
		const dates = touched.map((touch) => touch.work_date).toSorted();
		const span = { from: addDays(dates[0] ?? '', -31), to: addDays(dates.at(-1) ?? '', 31) };
		const batch = yield* read({
			...rosterMembers([...new Set(companies.map((row) => row.company_id))], span),
			stored: {
				from: 'roster_entry',
				where: {
					employment_id: { in: ids },
					work_date: { gte: PlainDate(span.from), lte: PlainDate(span.to) }
				},
				select: {
					employment_id: true,
					work_date: true,
					shift_definition_id: true,
					planned_overtime_hours: true,
					approved_overtime_intervals: true,
					worked_intervals: true,
					banked_overtime_hours: true,
					overtime_consented_at: true
				},
				all: true
			}
		});

		for (const company_id of new Set(companies.map((row) => row.company_id))) {
			const mine = touched.filter(
				(touch) => companyByEmployment.get(touch.employment_id) === company_id
			);
			const touchesByEmployment = new Map<string, RosterTouch[]>();
			for (const touch of mine) {
				const own = touchesByEmployment.get(touch.employment_id);
				if (own === undefined) touchesByEmployment.set(touch.employment_id, [touch]);
				else own.push(touch);
			}
			const mineIds = new Set(mine.map((touch) => touch.employment_id));
			const entityRows = batch.entity.rows.filter((row) => row.id === company_id);
			const versionRows = batch.versions.rows.filter((row) =>
				entityRows.some((entity) => entity.settings_code === row.code)
			);
			const versionIds = new Set(versionRows.map((row) => row.id));
			const ownContracts = batch.contracts.rows.filter((row) => row.company_id === company_id);
			const employeeIds = new Set(ownContracts.map((row) => row.employee_id));
			const got = {
				entity: { ...batch.entity, rows: entityRows },
				contracts: { ...batch.contracts, rows: ownContracts },
				people: {
					...batch.people,
					rows: batch.people.rows.filter((row) => employeeIds.has(row.id))
				},
				definitions: {
					...batch.definitions,
					rows: batch.definitions.rows.filter((row) => row.company_id === company_id)
				},
				patterns: {
					...batch.patterns,
					rows: batch.patterns.rows.filter((row) => row.company_id === company_id)
				},
				holidays: {
					...batch.holidays,
					rows: batch.holidays.rows.filter((row) => row.company_id === company_id)
				},
				versions: { ...batch.versions, rows: versionRows },
				rules: {
					...batch.rules,
					rows: batch.rules.rows.filter(
						(row) => row.settings_id != null && versionIds.has(row.settings_id)
					)
				},
				stored: {
					...batch.stored,
					rows: batch.stored.rows.filter((row) => mineIds.has(row.employment_id))
				}
			};
			const drafts = new Map<string, RosterDraft>();
			for (const row of got.stored.rows) {
				const work_date = String(row.work_date).slice(0, 10);
				drafts.set(`${row.employment_id}:${work_date}`, {
					ref: -1,
					employment_id: row.employment_id,
					work_date,
					shift_definition_id: row.shift_definition_id,
					planned_overtime_hours: moneyNumber(row.planned_overtime_hours),
					approved_overtime_intervals: row.approved_overtime_intervals,
					worked_intervals: row.worked_intervals,
					banked_overtime_hours: moneyNumber(row.banked_overtime_hours),
					overtime_consented_at: row.overtime_consented_at,
					leave_code: ''
				});
			}
			for (const [ref, touch] of mine.entries()) {
				const key = `${touch.employment_id}:${touch.work_date}`;
				if (touch.row == null) drafts.delete(key);
				else
					drafts.set(key, {
						...touch.row,
						ref,
						employment_id: touch.employment_id,
						work_date: touch.work_date,
						leave_code: ''
					});
			}
			const list = [...drafts.values()];
			const checkedRefs = new Set(mine.map((_, ref) => ref));
			const refused = (yield* rosterFindingsFrom(company_id, list, got, checkedRefs)).find(
				(found) => found.kind === 'refuse' && found.ref >= 0
			);
			if (refused != null) return `${mine[refused.ref]?.work_date}: ${refused.message}`;
			const definitions = new Map<string, ShiftDefinitionRow>(
				got.definitions.rows.map((row) => [row.id, row])
			);
			const patterns = new Map<string, ShiftPatternRow>(
				got.patterns.rows.map((row) => [row.id, row])
			);
			const entity = got.entity.rows[0];
			for (const contract of got.contracts.rows) {
				const own = touchesByEmployment.get(contract.id) ?? [];
				if (own.length === 0) continue;
				const cycles = yield* Effect.fromResult(
					patternCycles({
						contract,
						definitions,
						patterns,
						rosteredOn: (date) => drafts.get(`${contract.id}:${date}`)?.shift_definition_id ?? null,
						dates: own.map((touch) => touch.work_date)
					})
				);
				// Each cycle is judged by the `cycle` validations of the version governing its touched day.
				for (const cycle of cycles) {
					const governing = versionOn(got.versions.rows, entity?.settings_code, cycle.date);
					if (Result.isFailure(governing)) continue;
					const checks = yield* validationsOf(
						got.rules.rows.filter(
							(row) => row.settings_id === governing.success.id && row.family === 'VALIDATIONS'
						),
						'cycle'
					);
					const breach = yield* cycleRefusal(cycle, checks, entity?.validation_severity);
					if (breach != null) return breach;
				}
			}
		}
		return null;
	});
/**
 * Each stored roster day's derived overtime, by its id: `approved_overtime_hours` (the clock past the planned shift's
 * ordinary hours) and `overtime_hours` (less what was banked), as a task triggered by the day reads them.
 */
export const rosterOvertime = (ids: readonly Id<'roster_entry'>[]) =>
	Effect.gen(function* () {
		const out = new Map<string, { approved_overtime_hours: number; overtime_hours: number }>();
		if (ids.length === 0) return out;
		const { read } = yield* Reads;
		const stored = yield* read({
			days: {
				from: 'roster_entry',
				where: { id: { in: [...ids] } },
				select: {
					employment_id: true,
					work_date: true,
					shift_definition_id: true,
					worked_intervals: true,
					banked_overtime_hours: true,
					planned_overtime_hours: true,
					approved_overtime_intervals: true
				},
				all: true
			}
		});
		const rows = stored.days.rows.map((row) => ({
			id: row.id,
			employment_id: row.employment_id,
			work_date: String(row.work_date).slice(0, 10),
			shift_definition_id: row.shift_definition_id,
			worked_intervals: row.worked_intervals,
			banked_overtime_hours: moneyNumber(row.banked_overtime_hours),
			planned_overtime_hours: moneyNumber(row.planned_overtime_hours),
			approved_overtime_intervals: row.approved_overtime_intervals
		}));
		const companies = yield* read({
			contracts: {
				from: 'employment_contract',
				where: { id: { in: [...new Set(rows.map((row) => row.employment_id))] } },
				select: { company_id: true },
				all: true
			}
		});
		for (const company_id of new Set(companies.contracts.rows.map((row) => row.company_id))) {
			const mine = rows.filter((row) =>
				companies.contracts.rows.some(
					(contract) => contract.id === row.employment_id && contract.company_id === company_id
				)
			);
			const dates = mine.map((row) => row.work_date).toSorted();
			const got = yield* loadRoster(read, company_id, {
				from: dates[0] ?? '',
				to: dates.at(-1) ?? ''
			});
			const entity = got.entity.rows[0];
			if (entity == null) continue;
			const zone = yield* Effect.fromResult(zoneOf(entity, got.versions.rows[0]));
			const policy = yield* Effect.fromResult(attendancePolicy(got.versions.rows[0]));
			const definitions = new Map<string, ShiftDefinitionRow>(
				got.definitions.rows.map((row) => [row.id, row])
			);
			const patterns = new Map<string, ShiftPatternRow>(
				got.patterns.rows.map((row) => [row.id, row])
			);
			for (const row of mine) {
				const contract = got.contracts.rows.find((held) => held.id === row.employment_id);
				if (contract == null) continue;
				const planOn = dayPlanner({
					contract,
					fallback: undefined,
					roster: new Map([[row.work_date, row]]),
					definitions,
					patterns
				});
				const day = yield* Effect.fromResult(
					Result.gen(function* () {
						return yield* workDay({
							date: row.work_date,
							planned: yield* planOn(row.work_date),
							row,
							holiday: undefined,
							zone,
							policy
						});
					})
				);
				out.set(row.id, {
					approved_overtime_hours: day.approved_overtime_hours,
					overtime_hours: day.overtime_hours
				});
			}
		}
		return out;
	});
/** The values that replace a former employee's personal fields: identity, contact, family, biometrics and facts. The
 * payslips, runs and obligations keep their amounts for the books. */
export const anonymousProfile = () => ({
	name: 'Former employee',
	date_of_birth: null,
	gender: null,
	marital_status: null,
	children: [],
	nationality: null,
	identity_number: null,
	email: null,
	phone: null,
	address: null,
	location: null,
	face_embedding: null,
	face_photo: null,
	face_enrollment_status: 'NONE' as const,
	face_consent_at: null,
	face_enrolled_at: null,
	face_last_match_at: null,
	face_match_count: 0,
	facts: {},
	user_id: null,
	before: {}
});
/**
 * Whether a person's records may be anonymised on `today`: every employment has ended, and the version governing each
 * exit day names a PAYROLL `record_retention` rule whose `until` CEL (on the subject at the exit: `employment.exit_date`,
 * `employment.exit_ground`, `terms`, …) returns a day on or before today. Answers the latest such day.
 */
/** Retention for every profile in a write, prefetched in one keyed statement. */
export const admitAnonymiseBatch = (
	employeeIds: readonly Id<'employment_profile'>[],
	today: string
) =>
	Effect.gen(function* () {
		const { read } = yield* Reads;
		const got = yield* read({
			contracts: {
				from: 'employment_contract',
				where: { employee_id: { in: employeeIds } },
				select: CONTRACT,
				all: true
			},
			employees: {
				from: 'employment_profile',
				where: { id: { in: employeeIds } },
				select: PROFILE,
				all: true
			},
			entities: {
				from: 'entity',
				where: { id: { in: { member: 'contracts', field: 'company_id' } } },
				select: ENTITY,
				all: true
			},
			versions: {
				from: 'jurisdiction_settings',
				where: { code: { in: { member: 'entities', field: 'settings_code' } } },
				select: SETTINGS,
				all: true
			},
			rules: {
				from: 'rule_set',
				where: {
					settings_id: { in: { member: 'versions', field: 'id' } },
					family: { eq: 'PAYROLL' }
				},
				select: { ...RULES, settings_id: true },
				all: true
			}
		});
		const untilByEmployee = new Map<Id<'employment_profile'>, string>();
		for (const employeeId of employeeIds) {
			const contracts = got.contracts.rows.filter((row) => row.employee_id === employeeId);
			const employee = got.employees.rows.find((row) => row.id === employeeId);
			if (
				contracts.length === 0 ||
				contracts.some((row) => (row.effective_range?.to ?? today) >= today)
			)
				return yield* new Refusal({
					message: 'Only a former employee, every employment ended, is anonymised.'
				});
			let latest = '';
			for (const contract of contracts) {
				const exit = String(contract.effective_range?.to);
				const entity = got.entities.rows.find((row) => row.id === contract.company_id);
				if (entity === undefined)
					return yield* new Refusal({ message: 'This employment needs its actual entity.' });
				const version = yield* Effect.fromResult(
					versionOn(got.versions.rows, entity.settings_code, exit)
				);
				const rules = yield* Effect.fromResult(
					payrollRulesOf(got.rules.rows.filter((row) => row.settings_id === version.id))
				);
				const rule = Schema.decodeUnknownOption(RecordRetention)(rules[RECORD_RETENTION]);
				if (Option.isNone(rule))
					return yield* new Refusal({
						message: `${version.code} names no record retention for ${exit}.`
					});
				const until = yield* evaluate(
					rule.value.until,
					{
						...(yield* Effect.fromResult(
							subjectContext({
								contract,
								employee,
								entity,
								term: yield* Effect.fromResult(termFor(contract, exit)),
								day: exit,
								headcount: 0,
								version
							})
						)),
						rules
					},
					`rule_set ${RECORD_RETENTION} of ${version.code}`
				);
				if (!Predicate.isString(until) || until.length < 10)
					return yield* new Refusal({
						message: `${version.code} record retention must return a date.`
					});
				if (until.slice(0, 10) > latest) latest = until.slice(0, 10);
			}
			if (today < latest)
				return yield* new Refusal({
					message: `The records are kept until ${latest}; anonymise on or after that day.`
				});
			untilByEmployee.set(employeeId, latest);
		}
		return untilByEmployee;
	});
/** A kind the version governing `day` lists in its PAYROLL `<rule>` row (`rules.kinds[] = { code, name }`). */
/** The company, employment and governing definitions for every workplace row in one callback. */
export const loadWorkplaceAdmission = (
	read: Read,
	rows: readonly {
		readonly company_id?: Id<'entity'> | null;
		readonly employment_id?: Id<'employment_contract'> | null;
	}[]
) =>
	read({
		contracts: {
			from: 'employment_contract',
			where: {
				id: {
					in: [
						...new Set(
							rows.flatMap((row) => (row.employment_id == null ? [] : [row.employment_id]))
						)
					]
				}
			},
			select: { company_id: true },
			all: true
		},
		entities: {
			from: 'entity',
			where: {
				or: [
					{
						id: {
							in: [
								...new Set(rows.flatMap((row) => (row.company_id == null ? [] : [row.company_id])))
							]
						}
					},
					{ id: { in: { member: 'contracts', field: 'company_id' } } }
				]
			},
			select: { settings_code: true },
			all: true
		},
		versions: {
			from: 'jurisdiction_settings',
			where: {
				code: { in: { member: 'entities', field: 'settings_code' } },
				sealed_at: { isNull: false },
				voided_at: { isNull: true }
			},
			select: SETTINGS,
			all: true
		},
		rules: {
			from: 'rule_set',
			where: {
				settings_id: { in: { member: 'versions', field: 'id' } },
				family: { eq: 'PAYROLL' },
				code: { eq: 'case_kinds' }
			},
			select: { settings_id: true, rules: true },
			all: true
		}
	});
type WorkplaceAdmission = Effect.Success<ReturnType<typeof loadWorkplaceAdmission>>;

/** A work suspension names a cause of the version governing its first day and has an ordered range. */
export const admitSuspension = (
	input: {
		readonly company_id: Id<'entity'>;
		readonly kind: string;
		readonly starts_on: string;
		readonly ends_on: string;
	},
	prefetched?: WorkplaceAdmission
) =>
	Effect.gen(function* () {
		if (input.ends_on < input.starts_on)
			return yield* new Refusal({ message: 'A suspension ends on or after it starts.' });
		const { read } = yield* Reads;
		const got = prefetched ?? (yield* loadWorkplaceAdmission(read, [input]));
		const company = got.entities.rows.find((row) => row.id === input.company_id);
		if (company == null) return yield* new Refusal({ message: 'This needs its legal entity.' });
		const version = yield* Effect.fromResult(
			versionOn(got.versions.rows, company.settings_code, input.starts_on)
		);
		const kinds = yield* Effect.fromResult(
			fieldValue(version.suspension_kinds, 'jurisdiction_settings.suspension_kinds')
		);
		if (!(kinds ?? []).some((kind) => kind.code === input.kind))
			return yield* new Refusal({
				message: `${version.code} lists no suspension kind ${input.kind} on ${input.starts_on}.`
			});
	});
/** A workplace case takes its employment's entity and a kind of the version governing its opening day. */
export const admitCase = (
	input: {
		readonly company_id: Id<'entity'> | null;
		readonly employment_id: Id<'employment_contract'> | null;
		readonly kind: string;
		readonly opened_on: string;
		readonly closed_on: string | null;
	},
	prefetched?: WorkplaceAdmission
) =>
	Effect.gen(function* () {
		const { read } = yield* Reads;
		const got = prefetched ?? (yield* loadWorkplaceAdmission(read, [input]));
		const contract = got.contracts.rows.find((row) => row.id === input.employment_id);
		if (input.employment_id != null && contract == null)
			return yield* new Refusal({ message: 'This case needs an actual employment.' });
		const company_id = contract?.company_id ?? input.company_id;
		if (company_id == null || (input.company_id != null && input.company_id !== company_id))
			return yield* new Refusal({ message: 'A case belongs to its employment’s legal entity.' });
		if (input.closed_on != null && input.closed_on < input.opened_on)
			return yield* new Refusal({ message: 'A case closes on or after it opens.' });
		const company = got.entities.rows.find((row) => row.id === company_id);
		if (company == null) return yield* new Refusal({ message: 'This needs its legal entity.' });
		const version = yield* Effect.fromResult(
			versionOn(got.versions.rows, company.settings_code, input.opened_on)
		);
		if (
			!got.rules.rows.some(
				(row) =>
					row.settings_id === version.id &&
					kindsOf(row.rules).some((kind) => kind.code === input.kind)
			)
		)
			return yield* new Refusal({
				message: `${version.code} lists no case kind ${input.kind} on ${input.opened_on}.`
			});
		return company_id;
	});
/**
 * What `admitEntry` reads for a batch of entries of one collection: the employments (each with its person,
 * entity, headcount and earlier entries of the family; a time-off write: as a leave subject), the picked classes, and
 * the versions of their lineages over the entries' days (by the entity's code: no relation) with their PAYROLL rules and
 * their rows of the picked classes' codes (every class, for time off).
 */
type CatalogueIdentities = {
	readonly [C in EntryCollection]?: readonly Id<CatalogName<C>>[];
};
export const loadEntry = Effect.fnUntraced(function* (
	read: Read,
	collection: EntryCollection,
	inputs: readonly {
		readonly employment_id: Id<'employment_contract'>;
		readonly catalog_id: EntryCatalogueId;
		readonly occurred_on: string;
		readonly from?: string | null;
		readonly to?: string | null;
	}[],
	/** Identities already typed by the native collection's transform input. */
	catalogueIds?: CatalogueIdentities,
	lockCandidates: readonly EntryLockCandidate[] = [],
	/** Prospective parents whose schedules share a repayment write's admission read. */
	loanSchedules: readonly Pick<StoredRow<'loan_catalog_entry'>, 'id' | 'catalog_id'>[] = []
) {
	const wants = inputs.flatMap((input) =>
		[
			...new Set(
				[input.occurred_on, input.from, input.to].filter((day): day is string => day != null)
			)
		].map((asOf) => ({ employment_id: input.employment_id, asOf }))
	);
	const family = FAMILIES.find((candidate) => candidate.collection === collection);
	if (family === undefined)
		return yield* new Refusal({ message: 'The entry requires its declared family.' });
	if (collection === 'adhoc_catalog_entry' && catalogueIds?.adhoc_catalog_entry !== undefined) {
		const got = yield* read({
			...leaveStateMembers(wants),
			picked: {
				from: 'adhoc_catalog',
				where: { id: { in: catalogueIds.adhoc_catalog_entry } },
				select: CATALOG.adhoc_catalog,
				all: true
			},
			entry_classes: {
				from: 'adhoc_catalog',
				where: { settings_id: { in: { member: 'versions', field: 'id' } } },
				select: CATALOG.adhoc_catalog,
				all: true
			},
			earlier: {
				from: 'adhoc_catalog_entry',
				where: { employment_id: { in: { member: 'employment', field: 'id' } } },
				select: ENTRY.adhoc_catalog_entry,
				all: true
			},
			codes: {
				from: 'adhoc_catalog',
				where: { id: { in: { member: 'earlier', field: 'catalog_id' } } },
				select: { code: true },
				all: true
			},
			...entryLockMembers(collection, lockCandidates)
		});
		return {
			kind: 'adhoc_catalog_entry' as const,
			subject: got,

			lockRuns: got.locked_runs.rows,
			lockSlips: got.locked_slips.rows,
			data: {
				picked: got.picked,
				classes: got.entry_classes,
				earlier: got.earlier,
				codes: got.codes
			}
		};
	}
	if (collection === 'claim_catalog_entry' && catalogueIds?.claim_catalog_entry !== undefined) {
		const got = yield* read({
			...leaveStateMembers(wants),
			picked: {
				from: 'claim_catalog',
				where: { id: { in: catalogueIds.claim_catalog_entry } },
				select: CATALOG.claim_catalog,
				all: true
			},
			entry_classes: {
				from: 'claim_catalog',
				where: { settings_id: { in: { member: 'versions', field: 'id' } } },
				select: CATALOG.claim_catalog,
				all: true
			},
			earlier: {
				from: 'claim_catalog_entry',
				where: { employment_id: { in: { member: 'employment', field: 'id' } } },
				select: ENTRY.claim_catalog_entry,
				all: true
			},
			codes: {
				from: 'claim_catalog',
				where: { id: { in: { member: 'earlier', field: 'catalog_id' } } },
				select: { code: true },
				all: true
			},
			...entryLockMembers(collection, lockCandidates)
		});
		return {
			kind: 'claim_catalog_entry' as const,
			subject: got,

			lockRuns: got.locked_runs.rows,
			lockSlips: got.locked_slips.rows,
			data: {
				picked: got.picked,
				classes: got.entry_classes,
				earlier: got.earlier,
				codes: got.codes
			}
		};
	}
	if (collection === 'leave_catalog_entry' && catalogueIds?.leave_catalog_entry !== undefined) {
		const got = yield* read({
			...leaveStateMembers(wants),
			picked: {
				from: 'leave_catalog',
				where: { id: { in: catalogueIds.leave_catalog_entry } },
				select: { ...CATALOG.leave_catalog, ...LEAVE_CLASS, unit: true, unplanned_days: true },
				all: true
			},
			entry_classes: {
				from: 'leave_catalog',
				where: { settings_id: { in: { member: 'versions', field: 'id' } } },
				select: { ...CATALOG.leave_catalog, ...LEAVE_CLASS, unit: true, unplanned_days: true },
				all: true
			},
			earlier: {
				from: 'leave_catalog_entry',
				where: { employment_id: { in: { member: 'employment', field: 'id' } } },
				select: ENTRY.leave_catalog_entry,
				all: true
			},
			codes: {
				from: 'leave_catalog',
				where: { id: { in: { member: 'earlier', field: 'catalog_id' } } },
				select: { code: true },
				all: true
			},
			...entryLockMembers(collection, lockCandidates)
		});
		return {
			kind: 'leave_catalog_entry' as const,
			subject: got,

			lockRuns: got.locked_runs.rows,
			lockSlips: got.locked_slips.rows,
			data: {
				picked: got.picked,
				classes: got.entry_classes,
				earlier: got.earlier,
				codes: got.codes
			}
		};
	}
	if (collection === 'loan_repayment_entry' && catalogueIds?.loan_repayment_entry !== undefined) {
		const got = yield* read({
			...leaveStateMembers(wants),
			schedule_repayments: {
				from: 'loan_repayment_entry',
				where: { loan_id: { in: loanSchedules.map((loan) => loan.id) } },
				all: true
			},
			schedule_classes: {
				from: 'loan_catalog',
				where: { id: { in: [...new Set(loanSchedules.map((loan) => loan.catalog_id))] } },
				select: { id: true, settings_id: true },
				all: true
			},
			schedule_versions: {
				from: 'jurisdiction_settings',
				where: { id: { in: { member: 'schedule_classes', field: 'settings_id' } } },
				select: { id: true, payroll: true },
				all: true
			},
			picked: {
				from: 'loan_catalog',
				where: { id: { in: catalogueIds.loan_repayment_entry } },
				select: CATALOG.loan_catalog,
				all: true
			},
			entry_classes: {
				from: 'loan_catalog',
				where: { settings_id: { in: { member: 'versions', field: 'id' } } },
				select: CATALOG.loan_catalog,
				all: true
			},
			earlier: {
				from: 'loan_repayment_entry',
				where: { employment_id: { in: { member: 'employment', field: 'id' } } },
				select: ENTRY.loan_repayment_entry,
				all: true
			},
			codes: {
				from: 'loan_catalog',
				where: { id: { in: { member: 'earlier', field: 'catalog_id' } } },
				select: { code: true },
				all: true
			},
			...entryLockMembers(collection, lockCandidates)
		});
		return {
			kind: 'loan_repayment_entry' as const,
			subject: got,
			loanCatalogues: got.entry_classes.rows,
			schedule: {
				siblings: got.schedule_repayments.rows,
				classes: got.schedule_classes.rows,
				versions: got.schedule_versions.rows
			},
			lockRuns: got.locked_runs.rows,
			lockSlips: got.locked_slips.rows,
			data: {
				picked: got.picked,
				classes: got.entry_classes,
				earlier: got.earlier,
				codes: got.codes
			}
		};
	}
	const subject = yield* loadLeaveState(read, wants);
	const requested = {
		mode: 'declared',
		where: { id: { in: inputs.map((input) => input.catalog_id) } },
		select: ['id'],
		all: true
	} as const;
	const settings = { settings_id: { in: subject.versions.rows.map((version) => version.id) } };
	const employment = { employment_id: { in: subject.employment.rows.map((row) => row.id) } };
	// The checked read establishes each dynamic request's actual catalogue identities before the typed projection.
	const data =
		family.catalog === 'adhoc_catalog'
			? yield* Effect.gen(function* () {
					const ids = (yield* read('adhoc_catalog', requested)).rows.map((row) => row.id);
					return yield* read({
						picked: {
							from: 'adhoc_catalog',
							where: { id: { in: ids } },
							select: CATALOG.adhoc_catalog,
							all: true
						},
						classes: {
							from: 'adhoc_catalog',
							where: settings,
							select: CATALOG.adhoc_catalog,
							all: true
						},
						earlier: {
							from: 'adhoc_catalog_entry',
							where: employment,
							select: ENTRY.adhoc_catalog_entry,
							all: true
						},
						codes: {
							from: 'adhoc_catalog',
							where: { id: { in: { member: 'earlier', field: 'catalog_id' } } },
							select: { code: true },
							all: true
						}
					});
				})
			: family.catalog === 'claim_catalog'
				? yield* Effect.gen(function* () {
						const ids = (yield* read('claim_catalog', requested)).rows.map((row) => row.id);
						return yield* read({
							picked: {
								from: 'claim_catalog',
								where: { id: { in: ids } },
								select: CATALOG.claim_catalog,
								all: true
							},
							classes: {
								from: 'claim_catalog',
								where: settings,
								select: CATALOG.claim_catalog,
								all: true
							},
							earlier: {
								from: 'claim_catalog_entry',
								where: employment,
								select: ENTRY.claim_catalog_entry,
								all: true
							},
							codes: {
								from: 'claim_catalog',
								where: { id: { in: { member: 'earlier', field: 'catalog_id' } } },
								select: { code: true },
								all: true
							}
						});
					})
				: family.catalog === 'leave_catalog'
					? yield* Effect.gen(function* () {
							const ids =
								catalogueIds?.leave_catalog_entry ??
								(yield* read('leave_catalog', requested)).rows.map((row) => row.id);
							return yield* read({
								picked: {
									from: 'leave_catalog',
									where: { id: { in: ids } },
									select: CATALOG.leave_catalog,
									all: true
								},
								classes: {
									from: 'leave_catalog',
									where: settings,
									select: CATALOG.leave_catalog,
									all: true
								},
								earlier: {
									from: 'leave_catalog_entry',
									where: employment,
									select: ENTRY.leave_catalog_entry,
									all: true
								},
								codes: {
									from: 'leave_catalog',
									where: { id: { in: { member: 'earlier', field: 'catalog_id' } } },
									select: { code: true },
									all: true
								}
							});
						})
					: yield* Effect.gen(function* () {
							const ids = (yield* read('loan_catalog', requested)).rows.map((row) => row.id);
							return yield* read({
								picked: {
									from: 'loan_catalog',
									where: { id: { in: ids } },
									select: CATALOG.loan_catalog,
									all: true
								},
								classes: {
									from: 'loan_catalog',
									where: settings,
									select: CATALOG.loan_catalog,
									all: true
								},
								earlier: {
									from: 'loan_repayment_entry',
									where: employment,
									select: ENTRY.loan_repayment_entry,
									all: true
								},
								codes: {
									from: 'loan_catalog',
									where: { id: { in: { member: 'earlier', field: 'catalog_id' } } },
									select: { code: true },
									all: true
								}
							});
						});
	const lockRuns: LockRun[] = [];
	const lockSlips: LockSlip[] = [];
	return { kind: 'dynamic' as const, subject, data, lockRuns, lockSlips };
});
type EntryRead = Effect.Success<ReturnType<typeof loadEntry>>;
/** One entry as its family's catalogue reads it: the class must belong to the version in force on the entry day. */
export const admitEntry = <C extends EntryCollection>(input: {
	readonly collection: C;
	/** The stored entry being edited, which is not its own earlier sibling. */
	readonly id?: string | null;
	readonly catalog_id: EntryCatalogueId;
	readonly employment_id: Id<'employment_contract'>;
	readonly occurred_on: string;
	readonly activity?: string | null;
	readonly values?: EntryColumns | null;
	/** A batch's native reads, shared by every entry; absent, the entry reads its own. */
	readonly prefetched?: EntryRead;
}): Effect.Effect<
	{
		readonly company_id: Id<'entity'>;
		readonly catalog_id: EntryCatalogueId;
		/** The version governing the entry's day. */
		readonly version: SettingsRow;
		/** A time-off write's subject and the version's classes, read with the admission (empty for another family). */
		readonly leave: {
			readonly subject: Employment | undefined;
			readonly classes: LeaveStateRead['classes']['rows'];
		};
	},
	Refusal | ReadFailed,
	Reads
> =>
	Effect.gen(function* () {
		const family = FAMILIES.find((candidate) => candidate.collection === input.collection)!;
		// Batched reads: the employment (its person, entity, headcount and earlier entries of the family), the picked
		// class, the versions of the employment's lineage in force on the entry day, and their PAYROLL rules and row of
		// the picked class's code.
		const leaveFamily = family.family === 'LEAVE';
		// the batch's reads, else this entry's own
		const { read } = yield* Reads;
		const got = input.prefetched ?? (yield* loadEntry(read, input.collection, [input]));
		const contract = employmentFrom(got.subject, input.employment_id);
		if (contract == null)
			return yield* new Refusal({ message: 'This entry needs an actual employment.' });
		const range = contract.effective_range;
		const afterExit = range.to != null && input.occurred_on > range.to;
		if (!afterExit && !contains(range, input.occurred_on))
			return yield* new Refusal({ message: 'The entry day falls outside the employment.' });
		const entity = yield* companyOf(contract);
		const selected = yield* Effect.fromResult(
			versionOn(
				got.subject.versions.rows.filter((held) => held.code === entity.settings_code),
				entity.settings_code,
				input.occurred_on
			)
		);
		const version = {
			...selected,
			rule_set: got.subject.rules.rows.filter((row) => row.settings_id === selected.id)
		};
		const picked = got.data.picked.rows.find((row) => row.id === input.catalog_id);
		if (picked === undefined) return yield* new Refusal({ message: 'Choose the entry’s class.' });
		const row = got.data.classes.rows.find(
			(row) => row.settings_id === version.id && row.code === picked.code
		);
		if (row === undefined)
			return yield* new Refusal({
				message: `${picked.name ?? picked.code} is not a class of the ${version.code} version in force on ${input.occurred_on}.`
			});
		// Only a class payable after exit (non-compete pay, separation instalments) takes a day past the employment.
		if (afterExit && (!('payable_after_exit' in row) || row.payable_after_exit !== true))
			return yield* new Refusal({ message: 'The entry day falls outside the employment.' });
		const term = yield* Effect.fromResult(termFor(contract, input.occurred_on));
		const employee = contract.person ?? undefined;
		// a time-off write read every movement (its leave subject's); the earlier entries are the approved ones
		const earlier = got.data.earlier.rows
			.filter((row) => row.employment_id === contract.id)
			.map((row) => ({
				...row,
				code: got.data.codes.rows.find((code) => code.id === row.catalog_id)?.code ?? ''
			}));
		const values = input.values ?? {};
		if (
			family.family !== 'LEAVE' &&
			(!('amount_required' in row) || row.amount_required !== false) &&
			!(moneyValue(values.amount) > 0)
		)
			return yield* new Refusal({ message: 'Enter the amount.' });
		if (
			family.family === 'LEAVE' &&
			(input.activity ?? 'TIME_OFF') === 'TIME_OFF' &&
			!(num(values.days, 1) > 0)
		)
			return yield* new Refusal({ message: 'Enter the days taken.' });
		const context: DynObject = {
			...(yield* Effect.fromResult(
				subjectContext({
					contract,
					employee,
					entity,
					term,
					day: input.occurred_on,
					headcount: yield* Effect.fromResult(
						inForce(entity.employment_contract, input.occurred_on)
					),
					version
				})
			)),
			rules: yield* Effect.fromResult(
				payrollRulesOf(version.rule_set.filter((row) => row.family === 'PAYROLL'))
			),
			entry: entryContext(values, input.occurred_on),
			earlier: earlierContext(earlier, {
				code: row.code,
				occurred_on: input.occurred_on,
				...(input.id == null ? {} : { id: input.id })
			})
		};
		const where = `${family.catalog} ${row.code}`;
		if (!(yield* evaluateBoolean(row.eligibility, context, where)))
			return yield* new Refusal({
				message: `${row.name ?? row.code} is not available to this employment.`
			});
		if (
			!(yield* evaluateBoolean(
				'qualifies_when' in row && Predicate.isString(row.qualifies_when)
					? row.qualifies_when
					: undefined,
				context,
				where
			))
		)
			return yield* new Refusal({
				message: `This entry does not qualify as ${row.name ?? row.code}.`
			});
		return {
			company_id: contract.company_id,
			catalog_id: row.id,
			version,
			// what the time-off check reads, from the same read (none for another family)
			leave: {
				subject: leaveFamily ? contract : undefined,
				classes: leaveFamily
					? got.subject.classes.rows.filter((row) => row.settings_id === version.id)
					: []
			}
		};
	});
/** The part of a scheme one `counts_toward` target names: `CPF.ADDITIONAL` → CPF's `additional`; a bare code → `ordinary`. */
export type EntryTransformCtx<C extends EntryCollection> = Pick<WriteCtx<C>, 'refuse'> & {
	readonly db: Pick<WriteCtx<C>['db'], 'query'>;
};
/**
 * The one transform of the four entry collections: a new or edited entry must name a class of the version in force on
 * its day that its employment is eligible for, and takes its company from the employment. A settled entry's lock is
 * declared on each entry model (`payslip_id`); only the run that consumed it may write that backlink.
 */
export const transformEntries = Effect.fnUntraced(function* <
	C extends EntryCollection,
	T extends EntryWriteInput<C>
>(
	collection: C,
	inputs: readonly T[],
	before: readonly (StoredRow<C> | undefined)[],
	ctx: EntryTransformCtx<C>,
	catalogueIds?: CatalogueIdentities,
	entryValues?: readonly EntryColumns[],
	prefetchedRead?: EntryRead
) {
	const pinOnly = (input: object) =>
		Object.keys(input).every((key) => key === 'payslip_id' || key === 'id');
	// Every admitted input's rows are read for the whole batch, then each judged in memory.
	const admissible = inputs.flatMap((input, i) => {
		const stored = entryRow(before[i]);
		if (stored.payslip_id != null || '$delete' in input || pinOnly(input)) return [];
		const identity = { ...before[i], ...input };
		if (
			identity.employment_id == null ||
			identity.catalog_id == null ||
			!('occurred_on' in identity) ||
			!Schema.is(Schema.String)(identity.occurred_on)
		)
			return [];
		return [
			{
				employment_id: identity.employment_id,
				catalog_id: identity.catalog_id,
				occurred_on: identity.occurred_on,
				from: 'from' in identity ? dayKey(identity.from) : null,
				to: 'to' in identity ? dayKey(identity.to) : null
			}
		];
	});
	const candidates = before.flatMap((row) => (row === undefined ? [] : [row]));
	const prefetched =
		admissible.length === 0
			? undefined
			: (prefetchedRead ??
				(yield* loadEntry(ctx.db.query, collection, admissible, catalogueIds, candidates).pipe(
					Effect.catchTag('Refusal', (failure) => ctx.refuse(failure.message))
				)));
	const locked = yield* (
		prefetched === undefined
			? entrySettlementLocks(ctx.db.query, collection, candidates)
			: entryLocksFrom(collection, candidates, prefetched.lockRuns, prefetched.lockSlips)
	).pipe(Effect.catchTag('Refusal', (failure) => ctx.refuse(failure.message)));
	// Charge ranges and attendance-backed entitlements use the same second statement for the complete batch.
	const on = admissible
		.flatMap((input) =>
			[input.occurred_on, input.from, input.to].filter((day): day is string => day != null)
		)
		.toSorted();
	const attendance =
		prefetched?.kind !== 'leave_catalog_entry'
			? undefined
			: yield* ctx.db.query(
					attendanceMembers(
						[...new Set(admissible.map((input) => input.employment_id))],
						prefetched.subject.companies.rows.map((company) => company.id),
						{
							from: prefetched.subject.classes.rows.map(classFromRow).some(readsAttendance)
								? String(addMonths(on[0]!, -ATTENDANCE_MONTHS))
								: on[0]!,
							to: on.at(-1)!
						}
					)
				);
	const counted = yield* Effect.forEach(
		inputs,
		Effect.fnUntraced(function* (input, i) {
			if (
				prefetched?.kind !== 'leave_catalog_entry' ||
				attendance === undefined ||
				'$delete' in input ||
				pinOnly(input)
			)
				return input;
			const previous = before[i];
			const identity = { ...previous, ...input };
			const row = entryRow(identity);
			const changed =
				previous === undefined ||
				[
					'catalog_id',
					'employment_id',
					'from',
					'to',
					'half_day_start',
					'half_day_end',
					'activity',
					'days'
				].some((key) => Reflect.get(identity, key) !== Reflect.get(previous, key));
			if (
				!changed ||
				row.activity !== 'TIME_OFF' ||
				row.from == null ||
				identity.employment_id == null ||
				identity.catalog_id == null
			)
				return input;
			const contract = employmentFrom(prefetched.subject, identity.employment_id);
			const cls = prefetched.data.picked.rows.find((held) => held.id === row.catalog_id);
			if (cls === undefined) return yield* ctx.refuse('Choose the entry’s class.');
			const charge = yield* requestDays(
				{
					employment_id: identity.employment_id,
					catalog_id: cls.id,
					from: row.from,
					to: row.to,
					half_day_start: 'half_day_start' in identity && identity.half_day_start === true,
					half_day_end: 'half_day_end' in identity && identity.half_day_end === true
				},
				ctx.db.query,
				{
					employment: { rows: contract == null ? [] : [contract], next: null },
					classes: { rows: cls == null ? [] : [cls], next: null },
					roster: {
						rows: attendance.roster.rows.filter((held) => held.employment_id === row.employment_id),
						next: null
					},
					definitions: {
						rows: attendance.definitions.rows.filter(
							(held) => held.company_id === contract?.company_id
						),
						next: null
					},
					patterns: {
						rows: attendance.patterns.rows.filter(
							(held) => held.company_id === contract?.company_id
						),
						next: null
					},
					holidays: {
						rows: attendance.holidays.rows.filter(
							(held) => held.company_id === contract?.company_id
						),
						next: null
					}
				}
			);
			if (typeof charge === 'string') return yield* ctx.refuse(charge);
			if (!(charge.days > 0))
				return yield* ctx.refuse(
					'This leave charges nothing: every day of it is a rest day, an off day or a holiday.'
				);
			return { ...input, days: charge.days };
		})
	);
	// Every sibling in this write sees the same final leave set, including edits and deletions.
	const replacedLeaveIds = new Set(
		collection === 'leave_catalog_entry'
			? before.flatMap((row) => (row === undefined ? [] : [String(row.id)]))
			: []
	);
	const pendingLeave =
		collection === 'leave_catalog_entry'
			? counted.flatMap((input, index) =>
					'$delete' in input ? [] : [{ index, row: entryRow({ ...before[index], ...input }) }]
				)
			: [];
	return yield* eachBatched(
		counted,
		ctx.db.query,
		Effect.fnUntraced(function* (input, i, read) {
			const stored = entryRow(before[i]);
			const settlement = stored.id == null ? undefined : locked.get(stored.id);
			if ('$delete' in input) {
				if (settlement !== undefined)
					return yield* ctx.refuse(
						'This entry is captured by payroll. Delete that unpaid payroll run to change it.'
					);
				return input;
			}
			const updated = entryRow(input);
			if (settlement !== undefined) {
				if (
					!pinOnly(input) ||
					!Schema.is(Schema.String)(updated.payslip_id) ||
					!settlement.has(updated.payslip_id)
				)
					return yield* ctx.refuse(
						'This entry is captured by payroll. Delete that unpaid payroll run to change it.'
					);
				return input;
			}
			if (updated.payslip_id != null && updated.payslip_id !== stored.payslip_id)
				return yield* ctx.refuse(
					'Only the payroll run that consumed this entry can attach it to a payslip.'
				);
			if (pinOnly(input)) {
				return input;
			}
			const merged: LooseEntryRow = { ...stored, ...updated };
			const identity = { ...before[i], ...input };
			if (identity.employment_id == null)
				return yield* ctx.refuse('This entry needs an actual employment.');
			if (identity.catalog_id == null) return yield* ctx.refuse('Choose the entry’s class.');
			if (!('occurred_on' in identity) || !Schema.is(Schema.String)(identity.occurred_on))
				return yield* ctx.refuse('The entry needs its actual day.');
			const admitted = yield* runEngine(
				admitEntry({
					collection,
					id: stored.id ?? null,
					catalog_id: identity.catalog_id,
					employment_id: identity.employment_id,
					occurred_on: identity.occurred_on,
					activity: merged.activity ?? null,
					values: entryValues?.[i] ?? merged,
					...(prefetched === undefined ? {} : { prefetched })
				}),
				read,
				ctx.refuse
			);
			if (collection === 'leave_catalog_entry' && isLeaveAdmitted(collection, admitted)) {
				// the employment as a leave subject and the version's classes came with the admission's one read
				const contract = admitted.leave.subject;
				const catalog = admitted.leave.classes.find((held) => held.id === admitted.catalog_id);
				const coded = contract?.leave_catalog_entry ?? [];
				const asOf = dayKey(merged.from) ?? dayKey(merged.occurred_on) ?? '';
				const classes = (
					admitted.leave.classes.length > 0
						? admitted.leave.classes
						: catalog == null
							? []
							: [catalog]
				).map(classFromRow);
				const codeOf = new Map([
					...coded.flatMap((row) =>
						row.catalog?.code == null ? [] : [[String(row.catalog_id), row.catalog.code] as const]
					),
					...(prefetched?.data.picked.rows.map((row) => [String(row.id), row.code] as const) ?? []),
					...(catalog == null ? [] : [[String(catalog.id), String(catalog.code)] as const])
				]);
				const company = contract == null ? undefined : yield* companyOf(contract);
				const selected =
					prefetched === undefined || company === undefined
						? admitted.version
						: yield* Effect.fromResult(
								versionOn(
									prefetched.subject.versions.rows.filter(
										(version) => version.code === company.settings_code
									),
									company.settings_code,
									asOf
								)
							);
				const governing = {
					...selected,
					...(prefetched === undefined
						? admitted.version.rule_set === undefined
							? {}
							: { rule_set: admitted.version.rule_set }
						: {
								rule_set: prefetched.subject.rules.rows.filter(
									(rule) => rule.settings_id === selected.id
								)
							})
				};
				const subject = yield* runEngine(
					leaveSubject(
						identity.employment_id,
						asOf,
						classes.some(readsAttendance),
						governing,
						contract ?? undefined,
						attendance
					),
					read,
					ctx.refuse
				);
				// An exit's encashment is judged against the balance without the exit's own unpaid encashments: a moved
				// exit withdraws them in the same act (`retract-exit-effects`), as its balances leave them out.
				const exitPrefix = `exit:${String(merged.employment_id ?? '')}:`;
				const exitOwn = String(merged.reference ?? '').startsWith(exitPrefix);
				const movementPage = {
					rows: coded
						.filter(
							(row) =>
								!replacedLeaveIds.has(String(row.id)) &&
								!(
									exitOwn &&
									row.payslip_id == null &&
									String(row.reference ?? '').startsWith(exitPrefix)
								)
						)
						.map(({ catalog: _catalog, ...row }) => row)
				};
				const siblings = pendingLeave.flatMap(({ index, row }) => {
					if (index === i || row.employment_id !== identity.employment_id) return [];
					const cls = classes.find(
						(held) => held.id === row.catalog_id || held.code === codeOf.get(row.catalog_id ?? '')
					);
					if (cls === undefined) return [];
					return [
						movementFromRow({
							id: row.id ?? `pending:${index}`,
							catalog_id: cls.id,
							employment_id: row.employment_id ?? null,
							activity: row.activity ?? 'TIME_OFF',
							occurred_on: row.occurred_on ?? null,
							days: row.days ?? null,
							from: row.from ?? null,
							to: row.to ?? null,
							facts: row.facts ?? null
						})
					];
				});
				const message = refuseLeaveWrite({
					context: { ...subject.context, entry: entryContext(merged, asOf) },
					employmentStart: subject.employmentStart,
					...(subject.days === undefined ? {} : { attendanceDays: subject.days }),
					proposed: movementFromRow({
						catalog_id: admitted.catalog_id,
						employment_id: String(merged.employment_id ?? ''),
						activity: merged.activity ?? 'TIME_OFF',
						...(stored?.id === undefined ? {} : { id: stored.id }),
						...(merged.occurred_on === undefined ? {} : { occurred_on: merged.occurred_on }),
						days: merged.days ?? null,
						from: merged.from ?? null,
						to: merged.to ?? null,
						facts: merged.facts ?? null
					}),
					classes,
					movements: [
						...movementsByCode(movementPage.rows.map(movementFromRow), classes, codeOf),
						...siblings
					],
					serviceMonths: serviceMonthsAt(
						dayKey(contract?.effective_range),
						asOf,
						contract?.prior_service_months
					)
				});
				if (message != null) return yield* ctx.refuse(message);
			}
			return { ...input, company_id: admitted.company_id, catalog_id: admitted.catalog_id };
		})
	);
});
