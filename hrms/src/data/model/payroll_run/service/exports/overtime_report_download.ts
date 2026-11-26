import { Effect, Schema } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { JsonObject } from '../../../../../lib/contracts.js';
import { jsonValues, monthEndOf } from '../../../../../lib/foundation.js';
import { idOf, objectValue, type Reader } from '../../../../../lib/reads.js';
import { employerOn } from '../../../entity/service/company.js';
import { lawRead, lawsOf } from '../../../jurisdiction/service/law.js';
import { buildWorkDays } from '../../../roster_entry/service/attendance.js';
import { attendanceOf, cyclesIn, payDateOf, type PayWindow } from '../pay_cycle.js';
import { covers, lawData, withStints } from '../run_loader.js';
import {
	evaluateEmployeeOvertime,
	overtimeWorkbookOf,
	type OvertimePerson,
	type OvertimeSheet
} from './overtime_report_export.js';
import { collectPages, downloadWorkbook } from './xlsx_sheet.js';

type Query = Reader | PageContext['query'];

type ReportTarget = {
	readonly entityId: Id<'entity'>;
	readonly payGroupId: Id<'pay_group'>;
	readonly payGroupName: string;
	readonly schedule: JsonObject;
	readonly period: string;
	readonly salary: PayWindow;
	readonly attendance: PayWindow;
	readonly payDate: string;
};

const toRows = (rows: readonly unknown[]): readonly JsonObject[] =>
	Schema.decodeUnknownSync(Schema.Array(JsonObject))(jsonValues(rows));

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const loadEntityContext = Effect.fn('payroll.overtimeEntityContext')(function* (
	read: Query,
	entityId: Id<'entity'>,
	targets: readonly ReportTarget[]
) {
	let minFrom = targets[0]?.attendance.from ?? '';
	let maxTo = targets[0]?.attendance.to ?? '';
	for (const target of targets) {
		if (target.attendance.from < minFrom) minFrom = target.attendance.from;
		if (target.salary.from < minFrom) minFrom = target.salary.from;
		if (target.attendance.to > maxTo) maxTo = target.attendance.to;
		if (target.salary.to > maxTo) maxTo = target.salary.to;
	}

	const own = { entity_id: { eq: entityId } } as const;
	const ownReq = { where: own, limit: 10000 } as const;
	const first = yield* read({
		entity: { where: { id: { eq: entityId } }, limit: 1 },
		entity_change: ownReq,
		shift_definition: ownReq,
		shift_pattern: ownReq,
		holiday: ownReq,
		work_event: ownReq,
		employment: ownReq
	});

	const entityRows = [...first.entity.rows];
	const entityChangeRows = yield* collectPages(first.entity_change, (after) =>
		read({ entity_change: { ...ownReq, after } }).pipe(Effect.map((p) => p.entity_change))
	);
	const shiftRows = yield* collectPages(first.shift_definition, (after) =>
		read({ shift_definition: { ...ownReq, after } }).pipe(Effect.map((p) => p.shift_definition))
	);
	const patternRows = yield* collectPages(first.shift_pattern, (after) =>
		read({ shift_pattern: { ...ownReq, after } }).pipe(Effect.map((p) => p.shift_pattern))
	);
	const holidayRows = yield* collectPages(first.holiday, (after) =>
		read({ holiday: { ...ownReq, after } }).pipe(Effect.map((p) => p.holiday))
	);
	const workEventRows = yield* collectPages(first.work_event, (after) =>
		read({ work_event: { ...ownReq, after } }).pipe(Effect.map((p) => p.work_event))
	);
	const employmentRows = yield* collectPages(first.employment, (after) =>
		read({ employment: { ...ownReq, after } }).pipe(Effect.map((p) => p.employment))
	);

	const entity = entityRows[0];
	if (entity === undefined)
		return yield* Effect.fail(new Error('The selected company could not be read.'));
	const jurisdictionCode = text(entity.settings_code);
	const employmentIds = employmentRows.map((row) => row.id);
	const employeeIds = [...new Set(employmentRows.map((row) => row.employee_id))];

	const lawQuery = lawRead([jurisdictionCode]);
	const lawPage = yield* read(lawQuery);
	const jurisdictionRows = [...lawPage.jurisdiction.rows];
	const jurisdictionChangeRows = yield* collectPages(lawPage.jurisdiction_change, (after) =>
		read({ jurisdiction_change: { ...lawQuery.jurisdiction_change, after } }).pipe(
			Effect.map((p) => p.jurisdiction_change)
		)
	);

	let termsRows: unknown[] = [];
	let paramsRows: unknown[] = [];
	let profileRows: unknown[] = [];
	let rosterRows: unknown[] = [];
	let leaveRows: unknown[] = [];

	if (employmentIds.length > 0) {
		const byEmployment = { where: { employment_id: { in: employmentIds } }, limit: 10000 } as const;
		const profileReq = {
			where: { id: { in: employeeIds } },
			limit: 10000,
			employment: {
				fields: ['id', 'employee_id', 'effective_range', 'entity_id', 'service_started_on'],
				limit: 10000,
				entity_id: { fields: ['settings_code'] }
			}
		} as const;
		const rosterReq = {
			where: {
				employment_id: { in: employmentIds },
				work_date: { gte: minFrom, lte: maxTo }
			},
			fields: [
				'id',
				'employment_id',
				'work_date',
				'shift_definition_id',
				'actual_worked_intervals',
				'planned_overtime_intervals',
				'overtime_as_time_off'
			],
			limit: 10000
		} as const;
		const leaveReq = {
			where: {
				...own,
				leave_catalog_entry_day: { some: { incurred_on: { gte: minFrom, lte: maxTo } } }
			},
			limit: 10000,
			leave_catalog_entry_day: {
				fields: ['id', 'leave_entry_id', 'incurred_on', 'part'],
				limit: 10000
			}
		} as const;

		const second = yield* read({
			contract_terms: byEmployment,
			statutory_parameters: byEmployment,
			employee_profile: profileReq,
			roster_entry: rosterReq,
			leave_catalog_entry: leaveReq
		});

		termsRows = yield* collectPages(second.contract_terms, (after) =>
			read({ contract_terms: { ...byEmployment, after } }).pipe(Effect.map((p) => p.contract_terms))
		);
		paramsRows = yield* collectPages(second.statutory_parameters, (after) =>
			read({ statutory_parameters: { ...byEmployment, after } }).pipe(
				Effect.map((p) => p.statutory_parameters)
			)
		);
		profileRows = yield* collectPages(second.employee_profile, (after) =>
			read({ employee_profile: { ...profileReq, after } }).pipe(
				Effect.map((p) => p.employee_profile)
			)
		);
		rosterRows = yield* collectPages(second.roster_entry, (after) =>
			read({ roster_entry: { ...rosterReq, after } }).pipe(Effect.map((p) => p.roster_entry))
		);
		leaveRows = yield* collectPages(second.leave_catalog_entry, (after) =>
			read({ leave_catalog_entry: { ...leaveReq, after } }).pipe(
				Effect.map((p) => p.leave_catalog_entry)
			)
		);
	}

	const laws = lawsOf({
		jurisdiction: toRows(jurisdictionRows),
		jurisdiction_change: toRows(jurisdictionChangeRows)
	});
	const stitched = withStints({
		entity: toRows(entityRows),
		entity_change: toRows(entityChangeRows),
		employment: toRows(employmentRows),
		contract_terms: toRows(termsRows),
		statutory_parameters: toRows(paramsRows),
		employee_profile: toRows(profileRows),
		roster_entry: toRows(rosterRows),
		shift_definition: toRows(shiftRows),
		shift_pattern: toRows(patternRows),
		holiday: toRows(holidayRows),
		leave_catalog_entry: toRows(leaveRows),
		work_event: toRows(workEventRows)
	});

	return { entityName: text(entity.name), jurisdictionCode, laws, stitched };
});

const buildTargetSheet = (
	entityName: string,
	jurisdictionCode: string,
	law: ReturnType<ReturnType<typeof lawsOf>>,
	data: Readonly<Record<string, readonly JsonObject[]>>,
	target: ReportTarget
): OvertimeSheet => {
	const resolved = lawData(law);
	const settings = resolved.law_settings?.[0];
	if (settings === undefined)
		throw new Error(`No jurisdiction rules in force for ${jurisdictionCode} on ${target.payDate}.`);

	const { from, to } = target.salary;
	const { from: start, to: end } = target.attendance;
	const employer: JsonObject = {
		...employerOn((data.entity ?? [])[0] ?? {}, data.entity_change ?? [], to),
		payment_schedule: target.schedule
	};
	const startOf = (row: JsonObject) => String(objectValue(row.effective_range).from ?? '');
	const stretchOf = (row: JsonObject) => `${String(row.id)}@${startOf(row)}`;
	const stintOf = (stretch: string) => stretch.split('@')[0] ?? stretch;

	const employments = data.employment ?? [];
	const covering = employments.filter((row) => covers(row.effective_range, from, to));
	const contracts = [
		...new Map(
			[...covering]
				.toSorted((left, right) => startOf(left).localeCompare(startOf(right)))
				.map((row) => [String(row.employee_id), row])
		).values()
	].filter((row) => String(row.pay_group_id) === String(target.payGroupId));

	const currency = text(settings.currency);
	if (contracts.length === 0)
		return {
			company: entityName,
			currency,
			jurisdiction: jurisdictionCode,
			period: target.period,
			payGroup: target.payGroupName,
			attendance: target.attendance,
			people: []
		};

	const until = new Map(
		contracts.map((row) => {
			const last = objectValue(row.effective_range).to;
			const leaves = row.exit === true && typeof last === 'string' && last > end && last <= to;
			return [String(row.employee_id), leaves ? last : end];
		})
	);
	const employeeOf = new Map(employments.map((row) => [String(row.id), String(row.employee_id)]));
	const untilOf = (row: JsonObject) =>
		until.get(employeeOf.get(String(row.employment_id)) ?? '') ?? end;

	const answering = employments.filter((row) =>
		covers(
			row.effective_range,
			start < from ? start : from,
			until.get(String(row.employee_id)) ?? to
		)
	);
	const answeringBy = Map.groupBy(answering, (row) => String(row.employee_id));
	const versionOn = (employeeId: string, date: string) =>
		answeringBy.get(employeeId)?.find((contract) => covers(contract.effective_range, date, date));
	const owners = new WeakMap<JsonObject, string>();
	const ownerOf = (row: JsonObject) => {
		const held = owners.get(row);
		if (held !== undefined) return held;
		const date = String(row.work_date);
		const employee = employeeOf.get(String(row.employment_id));
		const own = employee === undefined ? [] : (answeringBy.get(employee) ?? []);
		const found =
			own.find((contract) => covers(contract.effective_range, date, date)) ??
			own
				.filter((contract) => startOf(contract) <= date)
				.toSorted((left, right) => startOf(left).localeCompare(startOf(right)))
				.at(-1);
		const owner = found === undefined ? String(row.employment_id) : stretchOf(found);
		owners.set(row, owner);
		return owner;
	};

	const payGroupEmployees = new Set(contracts.map((row) => String(row.employee_id)));
	const workRows = [
		...new Map(
			(data.roster_entry ?? [])
				.filter((row) => {
					const emp = employeeOf.get(String(row.employment_id));
					return (
						emp !== undefined &&
						payGroupEmployees.has(emp) &&
						typeof row.work_date === 'string' &&
						row.work_date >= start &&
						row.work_date <= untilOf(row)
					);
				})
				.toSorted(
					(left, right) =>
						Number(stintOf(ownerOf(left)) === String(left.employment_id)) -
						Number(stintOf(ownerOf(right)) === String(right.employment_id))
				)
				.map((row) => [
					`${employeeOf.get(String(row.employment_id))}/${String(row.work_date)}`,
					row
				])
		).values()
	];

	const { workDays, holidayNamesByEmployee } = buildWorkDays({
		workRows,
		ownerOf,
		stintOf,
		employeeOf,
		answeringByStretch: new Map(answering.map((row) => [stretchOf(row), row])),
		versionOn,
		termsOf: new Map(employments.map((row) => [stretchOf(row), objectValue(row.terms)])),
		holidays: data.holiday ?? [],
		leaves: data.leave_catalog_entry ?? [],
		shifts: new Map((data.shift_definition ?? []).map((row) => [row.id, row])),
		patterns: new Map((data.shift_pattern ?? []).map((row) => [row.id, row])),
		employer,
		zone: String(settings.timezone)
	});

	const profiles = new Map((data.employee_profile ?? []).map((row) => [String(row.id), row]));
	const employmentsOf = new Map<string, Set<string>>();
	for (const [employment, person] of employeeOf) {
		const held = employmentsOf.get(person);
		if (held === undefined) employmentsOf.set(person, new Set([employment]));
		else held.add(employment);
	}
	const workCatalog = new Map(
		(resolved.work_event_catalog ?? []).map((row) => [String(row.code), row])
	);
	const workEventsByOwner = Map.groupBy(data.work_event ?? [], (row) => String(row.employment_id));
	const globalWorkEvents = [
		...(workEventsByOwner.get('null') ?? []),
		...(workEventsByOwner.get('undefined') ?? [])
	];

	const people: OvertimePerson[] = [];
	for (const contract of contracts) {
		const employeeId = String(contract.employee_id);
		const employee = profiles.get(employeeId);
		if (employee === undefined) continue;
		const contractsOfEmployee = answeringBy.get(employeeId) ?? [];
		const days = contractsOfEmployee.flatMap((row) => workDays.get(stretchOf(row)) ?? []);
		if (days.length === 0) continue;

		const ownWorkEvents: JsonObject[] = [...globalWorkEvents];
		for (const empId of employmentsOf.get(employeeId) ?? [])
			for (const row of workEventsByOwner.get(empId) ?? []) ownWorkEvents.push(row);
		const workEvents = ownWorkEvents.flatMap((row) => {
			const catalog = workCatalog.get(String(row.catalog_code));
			if (catalog === undefined) return [];
			return [
				{
					code: String(catalog.code),
					from: String(row.from),
					to: row.to == null ? null : String(row.to),
					location: row.location ?? null
				}
			];
		});

		const { exit, ...version } = contract;
		const range = objectValue(contract.effective_range);
		const evaluated = evaluateEmployeeOvertime({
			settings,
			allowance: resolved.allowance_catalog ?? [],
			overtime: resolved.overtime_catalog ?? [],
			employee,
			employment: {
				...version,
				effective_range: { ...range, to: exit === true ? (range.to ?? null) : null }
			},
			employer,
			coverage: target.salary,
			period: target.period,
			payDate: target.payDate,
			days,
			workEvents,
			holidayNames: holidayNamesByEmployee.get(employeeId) ?? new Map()
		});
		if (evaluated.lines.length === 0 && evaluated.bankedHours === 0) continue;

		const terms = objectValue(contract.terms);
		people.push({
			code: text(contract.employee_number),
			name: text(employee.name),
			department: text(terms.department),
			position: text(terms.job_title),
			overtimeHours: evaluated.overtimeHours,
			bankedHours: evaluated.bankedHours,
			lines: evaluated.lines,
			days: evaluated.days
		});
	}

	return {
		company: entityName,
		currency,
		jurisdiction: jurisdictionCode,
		period: target.period,
		payGroup: target.payGroupName,
		attendance: target.attendance,
		people: people.toSorted((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
	};
};

const evaluateTargets = Effect.fn('payroll.overtimeEvaluateTargets')(function* (
	read: Query,
	targets: readonly ReportTarget[]
) {
	const sheets: OvertimeSheet[] = [];
	if (targets.length === 0) return sheets;
	const byEntity = Map.groupBy(targets, (target) => target.entityId);
	for (const [entityId, entityTargets] of byEntity) {
		const context = yield* loadEntityContext(read, entityId, entityTargets);
		for (const target of entityTargets) {
			const sheet = yield* Effect.try({
				try: () =>
					buildTargetSheet(
						context.entityName,
						context.jurisdictionCode,
						context.laws(context.jurisdictionCode, target.payDate),
						context.stitched,
						target
					),
				catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause)))
			});
			sheets.push(sheet);
		}
	}
	return sheets;
});

/** Builds the month's overtime sheets for every pay group of one company, following each pay group's attendance cutoff. */
export const overtimeReportForMonth = Effect.fn('payroll.overtimeReportForMonth')(function* (
	read: Query,
	entityId: Id<'entity'>,
	month: string
) {
	const groupReq = {
		where: { entity_id: { eq: entityId } },
		fields: ['name', 'payment_schedule'],
		limit: 1000
	} as const;
	const first = (yield* read({ pay_group: groupReq })).pay_group;
	const groups = yield* collectPages(first, (after) =>
		read({ pay_group: { ...groupReq, after } }).pipe(Effect.map((p) => p.pay_group))
	);
	if (groups.length === 0)
		return yield* Effect.fail(new Error('No pay group is configured for this company.'));

	const fallbackStart = `${month}-01`;
	const fallbackEnd = monthEndOf(month);
	const targets: ReportTarget[] = [];
	for (const group of groups) {
		const schedule = objectValue(group.payment_schedule);
		const cycles = cyclesIn(schedule, month);
		const resolved =
			cycles.length > 0
				? cycles.map((cycle) => ({
						period: cycle.key,
						salary: { from: cycle.from, to: cycle.to },
						attendance: attendanceOf(schedule, cycle),
						payDate: payDateOf(schedule, cycle.key)
					}))
				: [
						{
							period: month,
							salary: { from: fallbackStart, to: fallbackEnd },
							attendance: attendanceOf(schedule, { from: fallbackStart, to: fallbackEnd }),
							payDate: fallbackEnd
						}
					];
		for (const item of resolved)
			targets.push({
				entityId,
				payGroupId: group.id,
				payGroupName: text(group.name),
				schedule,
				...item
			});
	}
	targets.sort(
		(a, b) => a.period.localeCompare(b.period) || a.payGroupName.localeCompare(b.payGroupName)
	);
	return yield* evaluateTargets(read, targets);
});

/** Builds the overtime sheets for the selected payroll runs, following each run's pay group attendance cutoff. */
export const overtimeReportForRuns = Effect.fn('payroll.overtimeReportForRuns')(function* (
	read: Query,
	ids: readonly Id<'payroll_run'>[]
) {
	const runReq = {
		where: { id: { in: [...ids] } },
		fields: ['entity_id', 'pay_group_id', 'period', 'salary_coverage', 'pay_date'],
		limit: 1000,
		pay_group_id: { fields: ['name', 'payment_schedule'] }
	} as const;
	const first = (yield* read({ payroll_run: runReq })).payroll_run;
	const runs = yield* collectPages(first, (after) =>
		read({ payroll_run: { ...runReq, after } }).pipe(Effect.map((p) => p.payroll_run))
	);
	if (runs.length !== new Set(ids).size)
		return yield* Effect.fail(
			new Error(
				'Some selected payroll runs could not be read; the overtime report was not exported.'
			)
		);

	const targets: ReportTarget[] = runs
		.toSorted((a, b) => String(a.period).localeCompare(String(b.period)))
		.map((run) => {
			const schedule = objectValue(run.pay_group_id?.payment_schedule);
			const coverage = objectValue(run.salary_coverage);
			const salary: PayWindow = { from: text(coverage.from), to: text(coverage.to) };
			return {
				entityId: idOf('entity', run.entity_id),
				payGroupId: idOf('pay_group', run.pay_group_id?.id),
				payGroupName: text(run.pay_group_id?.name),
				schedule,
				period: text(run.period),
				salary,
				attendance: attendanceOf(schedule, salary),
				payDate: text(run.pay_date) || salary.to
			};
		});
	return yield* evaluateTargets(read, targets);
});

const downloadSheets = (sheets: readonly OvertimeSheet[]) =>
	Effect.tryPromise({
		try: async () => {
			const first = sheets[0];
			if (first === undefined) return;
			const last = sheets.at(-1);
			const range =
				last === undefined || last.period === first.period
					? first.period
					: `${first.period} to ${last.period}`;
			await downloadWorkbook(
				overtimeWorkbookOf(sheets),
				`Overtime report ${first.company} ${range}`.trim() + '.xlsx'
			);
		},
		catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause)))
	});

/** Exports the company's overtime hours & bandings report for a month (following pay-group attendance cutoff). */
export const exportMonthOvertimeReport = (
	ctx: Pick<PageContext, 'query'>,
	entityId: Id<'entity'>,
	month: string
) => overtimeReportForMonth(ctx.query, entityId, month).pipe(Effect.flatMap(downloadSheets));

/** Exports the overtime hours & bandings report for the selected payroll runs. */
export const exportRunOvertimeReport = (
	ctx: Pick<PageContext, 'query'>,
	ids: readonly Id<'payroll_run'>[]
) => overtimeReportForRuns(ctx.query, ids).pipe(Effect.flatMap(downloadSheets));
