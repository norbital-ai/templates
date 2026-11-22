import { DateTime, Duration, Effect, Schema } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { JsonObject } from '../../../../../lib/contracts.js';
import { isJsonObject, jsonValues } from '../../../../../lib/foundation.js';
import { idOf, objectValue, type Reader } from '../../../../../lib/reads.js';
import { employerOn } from '../../../entity/service/company.js';
import { lawRead, lawsOf } from '../../../jurisdiction/service/law.js';
import {
	awardedMinutes,
	holidaysForDay,
	overlapSpans,
	plannedWork as plannedWorkOf,
	scheduled,
	spanMinutes
} from '../../../roster_entry/service/attendance.js';
import { intervalSpans } from '../../../roster_entry/service/time_evidence.js';
import { attendanceOf, cyclesIn, payDateOf, type PayWindow } from '../pay_cycle.js';
import { covers, lawData, withStints } from '../run_loader.js';
import {
	evaluateEmployeeOvertime,
	overtimeWorkbookOf,
	type OvertimePerson,
	type OvertimeSheet
} from './overtime_report_export.js';

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

const closedSpans = (value: unknown) =>
	intervalSpans(
		Array.isArray(value) ? value.filter((row) => isJsonObject(row) && row.end != null) : []
	);

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
	const entityReq = { where: { id: { eq: entityId } }, limit: 1 } as const;
	const entityChangeReq = { where: own, limit: 10000 } as const;
	const shiftReq = { where: own, limit: 10000 } as const;
	const patternReq = { where: own, limit: 10000 } as const;
	const holidayReq = { where: own, limit: 10000 } as const;
	const workEventReq = { where: own, limit: 10000 } as const;
	const employmentReq = { where: own, limit: 10000 } as const;

	const first = yield* read({
		entity: entityReq,
		entity_change: entityChangeReq,
		shift_definition: shiftReq,
		shift_pattern: patternReq,
		holiday: holidayReq,
		work_event: workEventReq,
		employment: employmentReq
	});

	const entityRows = [...first.entity.rows];
	const entityChangeRows = [...first.entity_change.rows];
	let entityChangeNext = first.entity_change.next;
	while (entityChangeNext !== null) {
		const page = yield* read({
			entity_change: { ...entityChangeReq, after: entityChangeNext }
		});
		entityChangeRows.push(...page.entity_change.rows);
		entityChangeNext = page.entity_change.next;
	}

	const shiftRows = [...first.shift_definition.rows];
	let shiftNext = first.shift_definition.next;
	while (shiftNext !== null) {
		const page = yield* read({ shift_definition: { ...shiftReq, after: shiftNext } });
		shiftRows.push(...page.shift_definition.rows);
		shiftNext = page.shift_definition.next;
	}

	const patternRows = [...first.shift_pattern.rows];
	let patternNext = first.shift_pattern.next;
	while (patternNext !== null) {
		const page = yield* read({ shift_pattern: { ...patternReq, after: patternNext } });
		patternRows.push(...page.shift_pattern.rows);
		patternNext = page.shift_pattern.next;
	}

	const holidayRows = [...first.holiday.rows];
	let holidayNext = first.holiday.next;
	while (holidayNext !== null) {
		const page = yield* read({ holiday: { ...holidayReq, after: holidayNext } });
		holidayRows.push(...page.holiday.rows);
		holidayNext = page.holiday.next;
	}

	const workEventRows = [...first.work_event.rows];
	let workEventNext = first.work_event.next;
	while (workEventNext !== null) {
		const page = yield* read({ work_event: { ...workEventReq, after: workEventNext } });
		workEventRows.push(...page.work_event.rows);
		workEventNext = page.work_event.next;
	}

	const employmentRows = [...first.employment.rows];
	let employmentNext = first.employment.next;
	while (employmentNext !== null) {
		const page = yield* read({ employment: { ...employmentReq, after: employmentNext } });
		employmentRows.push(...page.employment.rows);
		employmentNext = page.employment.next;
	}

	const entity = entityRows[0];
	if (entity === undefined)
		return yield* Effect.fail(new Error('The selected company could not be read.'));
	const jurisdictionCode = text(entity.settings_code);
	const employmentIds = employmentRows.map((row) => row.id);
	const employeeIds = [...new Set(employmentRows.map((row) => row.employee_id))];

	const lawQuery = lawRead([jurisdictionCode]);
	const lawPage = yield* read(lawQuery);
	const jurisdictionRows = [...lawPage.jurisdiction.rows];
	const jurisdictionChangeRows = [...lawPage.jurisdiction_change.rows];
	let changeNext = lawPage.jurisdiction_change.next;
	while (changeNext !== null) {
		const page = yield* read({
			jurisdiction_change: { ...lawQuery.jurisdiction_change, after: changeNext }
		});
		jurisdictionChangeRows.push(...page.jurisdiction_change.rows);
		changeNext = page.jurisdiction_change.next;
	}

	const termsRows: unknown[] = [];
	const paramsRows: unknown[] = [];
	const profileRows: unknown[] = [];
	const rosterRows: unknown[] = [];
	const leaveRows: unknown[] = [];

	if (employmentIds.length > 0) {
		const termsReq = { where: { employment_id: { in: employmentIds } }, limit: 10000 } as const;
		const paramsReq = { where: { employment_id: { in: employmentIds } }, limit: 10000 } as const;
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
			contract_terms: termsReq,
			statutory_parameters: paramsReq,
			employee_profile: profileReq,
			roster_entry: rosterReq,
			leave_catalog_entry: leaveReq
		});

		termsRows.push(...second.contract_terms.rows);
		let termsNext = second.contract_terms.next;
		while (termsNext !== null) {
			const page = yield* read({ contract_terms: { ...termsReq, after: termsNext } });
			termsRows.push(...page.contract_terms.rows);
			termsNext = page.contract_terms.next;
		}

		paramsRows.push(...second.statutory_parameters.rows);
		let paramsNext = second.statutory_parameters.next;
		while (paramsNext !== null) {
			const page = yield* read({ statutory_parameters: { ...paramsReq, after: paramsNext } });
			paramsRows.push(...page.statutory_parameters.rows);
			paramsNext = page.statutory_parameters.next;
		}

		profileRows.push(...second.employee_profile.rows);
		let profileNext = second.employee_profile.next;
		while (profileNext !== null) {
			const page = yield* read({ employee_profile: { ...profileReq, after: profileNext } });
			profileRows.push(...page.employee_profile.rows);
			profileNext = page.employee_profile.next;
		}

		rosterRows.push(...second.roster_entry.rows);
		let rosterNext = second.roster_entry.next;
		while (rosterNext !== null) {
			const page = yield* read({ roster_entry: { ...rosterReq, after: rosterNext } });
			rosterRows.push(...page.roster_entry.rows);
			rosterNext = page.roster_entry.next;
		}

		leaveRows.push(...second.leave_catalog_entry.rows);
		let leaveNext = second.leave_catalog_entry.next;
		while (leaveNext !== null) {
			const page = yield* read({ leave_catalog_entry: { ...leaveReq, after: leaveNext } });
			leaveRows.push(...page.leave_catalog_entry.rows);
			leaveNext = page.leave_catalog_entry.next;
		}
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

	return {
		entityName: text(entity.name),
		jurisdictionCode,
		laws,
		stitched
	};
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
	if (contracts.length === 0) {
		return {
			company: entityName,
			currency,
			jurisdiction: jurisdictionCode,
			period: target.period,
			payGroup: target.payGroupName,
			attendance: target.attendance,
			people: []
		};
	}

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

	const answering = employments.filter((row) => {
		const person = String(row.employee_id);
		return covers(row.effective_range, start < from ? start : from, until.get(person) ?? to);
	});
	const ownerOf = (row: JsonObject) => {
		const date = String(row.work_date);
		const employee = employeeOf.get(String(row.employment_id));
		const own = answering.filter((contract) => contract.employee_id === employee);
		const found =
			own.find((contract) => covers(contract.effective_range, date, date)) ??
			own
				.filter((contract) => startOf(contract) <= date)
				.toSorted((left, right) => startOf(left).localeCompare(startOf(right)))
				.at(-1);
		return found === undefined ? String(row.employment_id) : stretchOf(found);
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

	const shifts = new Map((data.shift_definition ?? []).map((row) => [row.id, row]));
	const patterns = new Map((data.shift_pattern ?? []).map((row) => [row.id, row]));
	const plan = { employer, shifts, patterns };
	const plannedWork = (terms: JsonObject, date: string) => plannedWorkOf(terms, date, plan);
	const zone = String(settings.timezone);
	const planOf = (row: JsonObject) => {
		const shift = shifts.get(row.shift_definition_id);
		return scheduled(row, { zone, ...(shift === undefined ? {} : { shift }) });
	};
	const scheduledHours = ({ spans, untimed }: ReturnType<typeof planOf>) =>
		spans.reduce(
			(total, span) => total + Duration.toHours(Duration.millis(span.end - span.start)),
			untimed
		);

	const rosterDayTypes = new Map<string, Record<string, string>>();
	for (const row of workRows) {
		const owner = ownerOf(row);
		const days = rosterDayTypes.get(owner) ?? {};
		days[String(row.work_date)] = planOf(row).day_type;
		rosterDayTypes.set(owner, days);
	}
	const replaced = [
		...new Set(
			(data.holiday ?? []).flatMap((row) =>
				typeof row.replaces === 'string' ? [row.replaces] : []
			)
		)
	];
	for (const [owner, days] of rosterDayTypes) {
		const own = answering.find((row) => stretchOf(row) === owner);
		if (own === undefined) continue;
		for (const date of replaced) {
			if (days[date] !== undefined) continue;
			const row =
				answering.find(
					(contract) =>
						contract.employee_id === own.employee_id && covers(contract.effective_range, date, date)
				) ?? own;
			const work = plannedWork(objectValue(row.terms), date);
			if (work !== undefined) days[date] = work ? 'WORK' : 'OFF';
		}
	}

	const leaveDays = new Set<string>();
	for (const entry of data.leave_catalog_entry ?? []) {
		if (entry.encashment === true) continue;
		for (const child of Array.isArray(entry.leave_catalog_entry_day)
			? entry.leave_catalog_entry_day
			: [])
			if (isJsonObject(child) && typeof child.incurred_on === 'string')
				leaveDays.add(`${employeeOf.get(String(entry.employment_id))}:${child.incurred_on}`);
	}

	const termsOf = new Map(employments.map((row) => [stretchOf(row), objectValue(row.terms)]));
	const workDays = new Map<string, JsonObject[]>();
	const holidayNamesByEmployee = new Map<string, Map<string, string>>();

	for (const row of workRows) {
		const owner = ownerOf(row);
		const employeeId = employeeOf.get(stintOf(owner)) ?? '';
		const days = workDays.get(owner) ?? [];
		const date = String(row.work_date);
		const holidays = holidaysForDay(date, {
			holidays: data.holiday ?? [],
			roster_day_types: rosterDayTypes.get(owner) ?? {},
			roster_days: [],
			employee: employeeId
		});
		const holiday = holidays.find((item) => item.kind !== 'MAKEUP_WORKDAY') ?? holidays[0];
		if (holiday !== undefined && typeof holiday.name === 'string' && holiday.name.trim() !== '') {
			const names = holidayNamesByEmployee.get(employeeId) ?? new Map<string, string>();
			names.set(date, holiday.name.trim());
			holidayNamesByEmployee.set(employeeId, names);
		}
		const dayPlan = planOf(row);
		const clock = closedSpans(row.actual_worked_intervals);
		const planned = closedSpans(row.planned_overtime_intervals);
		const awarded = awardedMinutes(planned, clock) / 60;
		const timeOff = row.overtime_as_time_off === true ? awarded : 0;
		const overtime = awarded - timeOff;
		const worked = clock.length === 0 ? 0 : scheduledHours(dayPlan) + overtime;
		const paidSpans = timeOff > 0 ? [] : planned;
		const absent =
			dayPlan.day_type === 'WORK' &&
			clock.length === 0 &&
			holiday === undefined &&
			!leaveDays.has(`${employeeId}:${date}`);
		days.push({
			date,
			terms: termsOf.get(owner) ?? null,
			day_type: absent ? 'ABS' : dayPlan.day_type,
			scheduled_hours: absent ? 0 : scheduledHours(dayPlan),
			holiday_kind: typeof holiday?.kind === 'string' ? holiday.kind : '',
			worked: worked + timeOff > 0,
			worked_hours: worked,
			overtime_hours: overtime,
			clocked_shift_hours: Math.floor(spanMinutes(overlapSpans(clock, dayPlan.spans)) / 30) / 2,
			time_off_hours: timeOff,
			intervals: overlapSpans(clock, [...dayPlan.spans, ...paidSpans]).map(
				({ start: s, end: e }) => ({
					start: s,
					end: e
				})
			),
			overtime_intervals: overlapSpans(paidSpans, clock).map(({ start: s, end: e }) => ({
				start: s,
				end: e
			}))
		});
		workDays.set(owner, days);
	}

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

	const people: OvertimePerson[] = [];
	for (const contract of contracts) {
		const employeeId = String(contract.employee_id);
		const employee = profiles.get(employeeId);
		if (employee === undefined) continue;
		const contractsOfEmployee = answering.filter((row) => row.employee_id === employeeId);
		const days = contractsOfEmployee.flatMap((row) => workDays.get(stretchOf(row)) ?? []);
		if (days.length === 0) continue;

		const eventKeys = new Set([...(employmentsOf.get(employeeId) ?? []), 'null', 'undefined']);
		const workEvents = (data.work_event ?? [])
			.filter((row) => eventKeys.has(String(row.employment_id)))
			.flatMap((row) => {
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
	let page = (yield* read({ pay_group: groupReq })).pay_group;
	const groups = [...page.rows];
	while (page.next !== null) {
		page = (yield* read({ pay_group: { ...groupReq, after: page.next } })).pay_group;
		groups.push(...page.rows);
	}
	if (groups.length === 0)
		return yield* Effect.fail(new Error('No pay group is configured for this company.'));

	const fallbackStart = `${month}-01`;
	const fallbackEnd = DateTime.formatIsoDate(
		DateTime.endOf(DateTime.makeUnsafe(fallbackStart), 'month')
	);
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
		for (const item of resolved) {
			targets.push({
				entityId,
				payGroupId: group.id,
				payGroupName: text(group.name),
				schedule,
				period: item.period,
				salary: item.salary,
				attendance: item.attendance,
				payDate: item.payDate
			});
		}
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
	let page = (yield* read({ payroll_run: runReq })).payroll_run;
	const runs = [...page.rows];
	while (page.next !== null) {
		page = (yield* read({ payroll_run: { ...runReq, after: page.next } })).payroll_run;
		runs.push(...page.rows);
	}
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
			const from = text(coverage.from);
			const to = text(coverage.to);
			const salary: PayWindow = { from, to };
			return {
				entityId: idOf('entity', run.entity_id),
				payGroupId: idOf('pay_group', run.pay_group_id?.id),
				payGroupName: text(run.pay_group_id?.name),
				schedule,
				period: text(run.period),
				salary,
				attendance: attendanceOf(schedule, salary),
				payDate: text(run.pay_date) || to
			};
		});
	return yield* evaluateTargets(read, targets);
});

const downloadSheets = (sheets: readonly OvertimeSheet[]) =>
	Effect.tryPromise({
		try: async () => {
			if (sheets.length === 0) return;
			const bytes = await overtimeWorkbookOf(sheets).xlsx.writeBuffer();
			const url = URL.createObjectURL(
				new Blob([new Uint8Array(bytes)], {
					type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
				})
			);
			const first = sheets[0];
			const last = sheets.at(-1);
			const range =
				first === undefined
					? ''
					: last === undefined || last.period === first.period
						? first.period
						: `${first.period} to ${last.period}`;
			const link = Object.assign(document.createElement('a'), {
				href: url,
				download: `Overtime report ${first?.company ?? ''} ${range}`.trim() + '.xlsx'
			});
			link.click();
			URL.revokeObjectURL(url);
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
