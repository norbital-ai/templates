import { Effect, Result } from 'effect';
import { addDays, addMonths, datePeriod, days, intersect, monthOf } from '@norbital-ai/std/date';
import { statutoryFactsFromFacts } from '../employment_facts.js';
import {
	type DynObject,
	type Json,
	type JsonObject,
	completedMonths,
	fieldValue,
	isDynObject,
	isJsonObject,
	Refusal
} from '../foundation.js';
import { eventIdOf } from '../leave.js';
import {
	round2,
	zoneOf,
	num,
	HISTORY_MONTHS,
	LONG_HISTORY_MONTHS,
	dayInRange,
	isSalaryRun,
	type PayslipLine,
	type PayslipPlan,
	type CatalogRow,
	type EntryRow,
	entryContext,
	earlierContext,
	earlierSum,
	suspensionOn,
	suspendedDay,
	worksiteOn,
	termFor,
	moneyValue,
	evaluateNumber,
	evaluateBoolean,
	subjectContext,
	schemePart,
	type MonthTally,
	emptyTally,
	earnedFrom,
	dayPlanner,
	datesFrom,
	workDay,
	hoursFrom,
	type SlipContext
} from './context.js';
import { CYCLES, payrollWindow } from '../frequency.js';
import { tripped } from '../admit.js';
import { CARRY_FAMILY, assessStatutory } from './statutory.js';
import { exitCorrections } from './exit.js';
import { classifyOvertime } from './overtime.js';
const plannedWorkDays = (
	from: string,
	to: string,
	planned: ReturnType<typeof dayPlanner>,
	include: (date: string) => boolean = () => true
) =>
	Result.gen(function* () {
		let count = 0;
		for (const date of datesFrom(from, to))
			if (include(date) && (yield* planned(date))?.day_type === 'WORK') count++;
		return count;
	});
export const buildPayslip = (options: SlipContext): Effect.Effect<PayslipPlan | null, Refusal> =>
	Effect.gen(function* () {
		const { contract, employee } = options.subject,
			{ period, window, salaryRun, money } = options.payroll;
		const allowanceCodes = new Map(options.jurisdiction.capturedAllowanceCodes);
		for (const row of options.jurisdiction.allowanceRows) allowanceCodes.set(row.id, row.code);
		const payroll = yield* Effect.fromResult(
			fieldValue(options.jurisdiction.version.payroll, 'jurisdiction_settings.payroll')
		);
		const who = employee?.name ?? contract.id;
		// Month-to-date (earned, statutory) is per calendar month; the settlement period may be a part of it.
		const calendar = monthOf(window.salary_from);
		const monthKey = window.salary_from.slice(0, 7);
		const periodParts = {
			part: options.payroll.settlement.part,
			parts: options.payroll.settlement.parts,
			month_key: monthKey,
			// the calendar month is paid at more than one frequency: a rule settles it month to date, as the engine does
			switched: options.payroll.switched,
			month_from: String(calendar.from),
			month_to: String(calendar.to),
			month_days: days(calendar)
		};
		const month = datePeriod(window.salary_from, window.salary_to);
		const employed = intersect(
			month,
			datePeriod(
				contract.effective_range?.from ?? window.salary_from,
				contract.effective_range?.to ?? null
			)
		);
		const employedFrom = String(employed?.from ?? window.salary_from);
		const employedTo = String(employed?.to ?? window.salary_to);
		// After the exit the subject reads the terms last in force (a non-compete priced on the leaving wage).
		const exitedOn = contract.effective_range?.to;
		const term = yield* Effect.fromResult(
			termFor(
				contract,
				employed != null
					? employedTo
					: exitedOn != null && exitedOn < window.salary_from
						? exitedOn
						: window.salary_to
			)
		);
		const monthDays = days(month);
		const paidDays = salaryRun && employed != null ? days(employed) : 0;
		const baseSalary = moneyValue(term?.base_salary?.value);
		// Roster facts as recorded: the days, the hours they carry and the published holidays they fall on. Which of
		// them a jurisdiction pays, and at how many hours a day, is the work catalogue's CEL.
		const byDate = new Map(options.attendance.holidays.map((holiday) => [holiday.date, holiday]));
		// The planned shift of every day and what the roster recorded on it, in the entity's time zone.
		const rosterOn = new Map<string, (typeof options.attendance.roster)[number]>(
			options.attendance.roster.map((row) => [row.work_date, row])
		);
		const planOn = dayPlanner({
			contract,
			fallback: term,
			roster: rosterOn,
			definitions: options.attendance.definitions,
			patterns: options.attendance.patterns
		});
		const zone = yield* Effect.fromResult(
			zoneOf(options.subject.entity, options.jurisdiction.version)
		);
		const employedOn = (date: string) => dayInRange(date, contract.effective_range ?? {});
		const workDays = yield* Effect.fromResult(
			Result.all(
				datesFrom(window.attendance_from, window.attendance_to)
					.filter(employedOn)
					.map((date) =>
						Result.gen(function* () {
							return yield* workDay({
								date,
								planned: yield* planOn(date),
								row: rosterOn.get(date),
								holiday: byDate.get(date),
								zone,
								suspension: suspensionOn(
									options.attendance.suspensions,
									contract.id,
									date,
									yield* worksiteOn(rosterOn.get(date), yield* termFor(contract, date))
								)
							});
						})
					)
			)
		);
		// The days of the week the window opens in that fall before it (from `payroll.week_start`), as recorded —
		// already paid by the previous period — so a weekly limit is read on the whole week.
		const opens = new Date(`${window.attendance_from}T00:00:00Z`).getUTCDay();
		const lead = (opens - (payroll?.week_start ?? 0) + 7) % 7;
		const recorded = new Map<string, (typeof options.attendance.hoursRoster)[number]>(
			options.attendance.hoursRoster.map((row) => [row.work_date, row])
		);
		const planBefore = dayPlanner({
			contract,
			fallback: term,
			roster: recorded,
			definitions: options.attendance.definitions,
			patterns: options.attendance.patterns
		});
		const weekBefore = yield* Effect.fromResult(
			Result.all(
				datesFrom(addDays(window.attendance_from, -lead), addDays(window.attendance_from, -1))
					.filter((date) => lead > 0 && employedOn(date))
					.map((date) =>
						Result.gen(function* () {
							return {
								...(yield* workDay({
									date,
									planned: yield* planBefore(date),
									row: recorded.get(date),
									holiday: options.attendance.hoursHolidays.get(date),
									zone
								})),
								in_period: false
							};
						})
					)
			)
		);
		// The month's employed days from the 1st to the period's end, as recorded — earlier parts' days too, marked
		// `in_period: false` — so a monthly cap is read on a part of the month.
		const monthDaysToDate = yield* Effect.fromResult(
			Result.all(
				datesFrom(String(calendar.from), window.salary_to)
					.filter(employedOn)
					.map((date) =>
						Result.gen(function* () {
							return {
								...(yield* workDay({
									date,
									planned: yield* planBefore(date),
									row: recorded.get(date),
									holiday: options.attendance.hoursHolidays.get(date),
									zone
								})),
								in_period: date >= window.attendance_from && date <= window.attendance_to
							};
						})
					)
			)
		);
		const dayOn = new Map(workDays.map((day) => [String(day.date), day]));
		// A rostered day on a published holiday, worked or not: `worked` / `worked_hours` tell holiday work from a
		// holiday the person was off on.
		const holidays = options.attendance.roster.flatMap((row) => {
			const holiday = byDate.get(row.work_date);
			const day = dayOn.get(row.work_date);
			return holiday == null
				? []
				: [
						{
							date: holiday.date,
							name: holiday.name ?? '',
							kind: holiday.kind,
							given_to: holiday.given_to ?? '',
							replaces: holiday.replaces ?? '',
							day_type: day?.day_type ?? '',
							worked: day?.worked === true,
							worked_hours: num(day?.worked_hours)
						}
					];
		});
		const hoursInput = {
			yearStartMonth: payroll?.tax_year_start_month ?? 1,
			historyMonths: payroll?.history_months ?? HISTORY_MONTHS,
			...(payroll?.rolling_hours_months == null
				? {}
				: { rollingMonths: payroll.rolling_hours_months }),
			rows: options.attendance.hoursRoster,
			holidays: options.attendance.hoursHolidays,
			month: { from: String(calendar.from), to: String(calendar.to) },
			through: window.salary_to,
			planOn: dayPlanner({
				contract,
				fallback: term,
				roster: new Map(options.attendance.hoursRoster.map((row) => [row.work_date, row])),
				definitions: options.attendance.definitions,
				patterns: options.attendance.patterns
			}),
			zone
		};
		const hours = yield* Effect.fromResult(hoursFrom(hoursInput));
		const previousFrom = String(addMonths(String(calendar.from), -1));
		const previousTo = addDays(String(calendar.from), -1);
		const periodExtras = {
			...periodParts,
			/** Working days of the period no-pay leave covers; set once the leave rows are priced. */
			unpaid_working_days: 0,
			paid_days: paidDays,
			pay_date: options.payroll.payDate,
			covered_days: employed == null ? 0 : days(employed),
			working_days: yield* Effect.fromResult(
				plannedWorkDays(window.salary_from, window.salary_to, planOn)
			),
			covered_working_days: yield* Effect.fromResult(
				plannedWorkDays(window.salary_from, window.salary_to, planOn, employedOn)
			),
			// The whole calendar month's planned WORK days less published holidays, from the month's roster (else the
			// pattern): the same in every part, a day rate's divisor.
			month_working_days: yield* Effect.fromResult(
				plannedWorkDays(
					String(calendar.from),
					String(calendar.to),
					planBefore,
					(date) => !options.attendance.hoursHolidays.has(date)
				)
			),
			// The month's published holidays on planned WORK days: a divisor that counts them adds this one.
			month_holiday_work_days: yield* Effect.fromResult(
				plannedWorkDays(String(calendar.from), String(calendar.to), planBefore, (date) =>
					options.attendance.hoursHolidays.has(date)
				)
			),
			// The same two for the calendar month before (the run's read reaches back a year): a divisor of last month's.
			previous_month_working_days: yield* Effect.fromResult(
				plannedWorkDays(
					previousFrom,
					previousTo,
					planBefore,
					(date) => !options.attendance.hoursHolidays.has(date)
				)
			),
			previous_month_holiday_work_days: yield* Effect.fromResult(
				plannedWorkDays(previousFrom, previousTo, planBefore, (date) =>
					options.attendance.hoursHolidays.has(date)
				)
			)
		};
		const work: DynObject = {
			overtime_hours: round2(workDays.reduce((total, day) => total + day.overtime_hours, 0)),
			incentive_hours: 0,
			payable_incentive_hours: 0,
			dates: options.attendance.roster.map((row) => row.work_date),
			holidays,
			holiday_dates: options.attendance.holidays.map((holiday) => holiday.date),
			days: workDays,
			week_before: weekBefore,
			month_days: monthDaysToDate
		};
		// Each month's recorded attendance, scheduled days of leave by class and suspended days by kind, for
		// average-wage rules over `earned.months`/`history`.
		const worked = new Map<string, MonthTally>();
		const tallyOf = (month: string): MonthTally => {
			const held = worked.get(month) ?? emptyTally();
			worked.set(month, held);
			return held;
		};
		if (options.attendance.readsWorked) {
			for (const row of options.attendance.hoursRoster) {
				const day = yield* Effect.fromResult(
					workDay({
						date: row.work_date,
						planned: yield* Effect.fromResult(planBefore(row.work_date)),
						row,
						holiday: undefined,
						zone
					})
				);
				if (day.worked !== true) continue;
				const held = tallyOf(row.work_date.slice(0, 7));
				held.worked_days += 1;
				held.worked_hours = round2(held.worked_hours + num(day.worked_hours));
			}
			const since = String(
				addMonths(
					String(calendar.from),
					-Math.max(LONG_HISTORY_MONTHS, payroll?.history_months ?? HISTORY_MONTHS)
				)
			);
			for (const suspension of options.attendance.suspensions)
				for (const date of datesFrom(suspension.starts_on, suspension.ends_on))
					if (
						dayInRange(date, contract.effective_range ?? {}) &&
						suspensionOn(
							[suspension],
							contract.id,
							date,
							yield* Effect.fromResult(
								worksiteOn(undefined, yield* Effect.fromResult(termFor(contract, date)))
							)
						) != null
					) {
						const held = tallyOf(date.slice(0, 7));
						held.suspended_days += 1;
						held.suspended_days_by_kind[suspension.kind] =
							(held.suspended_days_by_kind[suspension.kind] ?? 0) + 1;
					}
			// A leave day is a scheduled (WORK) day of the plan an approved time-off movement covers.
			for (const row of options.attendance.timeOff) {
				if (row.employment_id !== contract.id) continue;
				const code = options.attendance.leaveCodes.get(String(row.catalog_id));
				const from = String(row.from ?? row.occurred_on ?? '');
				if (code == null || from === '' || String(row.to ?? from) < since) continue;
				for (const date of datesFrom(from > since ? from : since, String(row.to ?? from)))
					if (employedOn(date) && (yield* Effect.fromResult(planOn(date)))?.day_type === 'WORK') {
						const held = tallyOf(date.slice(0, 7));
						held.leave_days[code] = (held.leave_days[code] ?? 0) + 1;
					}
			}
		}
		const earned = yield* Effect.fromResult(
			earnedFrom({
				history: options.history.payslips,
				period: monthKey,
				runKind: options.history.runKind,
				contract,
				yearStartMonth: payroll?.tax_year_start_month ?? 1,
				historyMonths: payroll?.history_months ?? HISTORY_MONTHS,
				...(options.attendance.readsWorked ? { worked } : {})
			})
		);
		const periodRoot: DynObject = {
			key: period,
			from: window.salary_from,
			to: window.salary_to,
			days: monthDays,
			...periodExtras
		};
		const context: DynObject = {
			...(yield* Effect.fromResult(
				subjectContext({
					contract,
					employee,
					entity: options.subject.entity,
					term,
					day: window.salary_to,
					headcount: options.payroll.headcount,
					version: options.jurisdiction.version,
					allowanceCodes
				})
			)),
			rules: options.jurisdiction.rules,
			period: periodRoot,
			work,
			earned,
			hours,
			leave: {}
		};
		const historyDays = yield* Effect.fromResult(
			Result.all(
				options.attendance.hoursRoster.map((row) =>
					Result.gen(function* () {
						return yield* workDay({
							date: row.work_date,
							planned: yield* planBefore(row.work_date),
							row,
							holiday: options.attendance.hoursHolidays.get(row.work_date),
							zone
						});
					})
				)
			)
		);
		const overtime = yield* classifyOvertime({
			policy: options.jurisdiction.rules['overtime_classification'],
			days: historyDays,
			contextOf: (day) =>
				Result.gen(function* () {
					return {
						...context,
						...(yield* subjectContext({
							contract,
							employee,
							entity: options.subject.entity,
							term: yield* termFor(contract, String(day['date'])),
							day: String(day['date']),
							headcount: options.payroll.headcount,
							version: options.jurisdiction.version,
							allowanceCodes
						})),
						day
					};
				})
		});
		type WorkDay = Result.Result.Success<ReturnType<typeof workDay>>;
		const applyOvertime = (list: WorkDay[]) => {
			for (const day of list) {
				const derived = overtime.get(day.date);
				day.incentive_hours = Math.min(day.approved_overtime_hours, derived?.incentive_hours ?? 0);
				day.payable_incentive_hours = Math.min(
					day.overtime_hours,
					derived?.payable_incentive_hours ?? 0
				);
			}
		};
		for (const list of [workDays, weekBefore, monthDaysToDate]) applyOvertime(list);
		work['incentive_hours'] = round2(workDays.reduce((sum, day) => sum + day.incentive_hours, 0));
		work['payable_incentive_hours'] = round2(
			workDays.reduce((sum, day) => sum + day.payable_incentive_hours, 0)
		);
		context['hours'] = yield* Effect.fromResult(
			hoursFrom({
				...hoursInput,
				incentiveByDate: new Map(
					[...overtime].map(([date, value]) => [date, value.incentive_hours])
				)
			})
		);
		// A suspended day carries its kind's effects: counted as attended, still scheduled, and what it pays.
		function* suspend(list: JsonObject[], on: DynObject, planned: ReturnType<typeof dayPlanner>) {
			for (const [i, day] of list.entries()) {
				const found = day['suspended'];
				if (!isJsonObject(found)) continue;
				// The scheduled working days from the suspension's first through this one, across pay periods (planned by
				// the terms' pattern before this window): a "first N working days" floor reads it.
				const held: DynObject = {
					...found,
					working_days_elapsed: yield* Effect.fromResult(
						plannedWorkDays(String(found['from']), String(day['date']), planned, employedOn)
					)
				};
				const kind = options.attendance.kinds.get(String(held['kind']));
				const dayContext: DynObject = { ...on, day, suspension: held };
				const effect = yield* suspendedDay(kind, dayContext);
				const pay =
					kind?.pay == null || kind.pay.trim() === ''
						? 0
						: money(
								yield* evaluateNumber(kind.pay, dayContext, `suspension_kind ${kind.code} pay`)
							);
				list[i] = { ...day, suspended: { ...held, ...effect, pay } };
			}
		}
		yield* suspend(workDays, context, planOn);
		const wages = new Map<string, Map<string, number>>();
		const base: PayslipPlan['base'][number][] = [];
		const proration: PayslipPlan['proration'][number][] = [];
		const adjustments: PayslipLine[] = [];
		const companyPayments: PayslipPlan['company_payments'][number][] = [];
		const entryWarnings: string[] = [];
		const pins: PayslipPlan['pins'][number][] = [];
		let gross = 0;
		let netAdd = 0;
		let netSubtract = 0;
		/**
		 * One priced line: PAY lines move gross, NET lines only the net; every line moves the scheme parts it counts
		 * toward, so an EMPLOYER or DISPLAY line (a benefit in kind) reaches a tax base without being paid.
		 */
		const post = (row: CatalogRow, amount: number) => {
			const signed = row.direction === 'SUBTRACT' ? -amount : amount;
			for (const target of row.counts_toward ?? []) {
				const [scheme, part] = schemePart(target);
				const held = wages.get(scheme) ?? new Map<string, number>();
				held.set(part, (held.get(part) ?? 0) + signed);
				wages.set(scheme, held);
			}
			if (row.destination === 'PAY') gross += signed;
			else if (row.destination === 'NET') {
				if (signed >= 0) netAdd += signed;
				else netSubtract -= signed;
			}
			return signed;
		};
		/**
		 * A salary slip's exit corrections, as adjustments; how many it made. A departure (an exit ground with its last
		 * day) raises each `raise_on_exit` ad hoc class whose eligibility holds, priced by its bands on an empty entry of
		 * the exit day, once per exit as it stands (`exit:<code>:<day>/<ground>`), on the first salary slip reaching it —
		 * unless HR entered the class. The exit pay a paid slip carried for an exit since moved or undone is taken back
		 * at what it paid. A paid period's prorated lines are repriced over the days it now covers (an exit moved or
		 * undone after the final slip): fully covered again, its contract amount; uncovered, nothing; else its paid
		 * amount moved by the record's divisor per day. Nothing is corrected twice: each correction names its source.
		 */
		// A salary run pays the contract for its employed days only; after the exit it pays only the period's entries
		// (a class payable after exit: non-compete pay, separation instalments).
		const salaried = salaryRun && term != null && paidDays > 0 && contract.engagement !== 'PAYEE';
		// Without salary a run pays a payee's entries, and past the exit the classes payable after it.
		const unsalaried = (row: EntryRow) =>
			options.jurisdiction.classes.get(String(row.catalog_id))?.payable_after_exit === true ||
			(contract.engagement === 'PAYEE' && employedOn(String(row.occurred_on ?? '')));
		const corrections = salaryRun
			? yield* exitCorrections(options, context, adjustments, post, salaried)
			: 0;
		if (
			salaryRun &&
			!salaried &&
			corrections === 0 &&
			!options.attendance.entries.some((family) =>
				family.rows.some((row) => {
					const day = String(row.occurred_on ?? '');
					return (
						family.family !== 'LEAVE' &&
						unsalaried(row) &&
						day >= window.salary_from &&
						day <= window.salary_to
					);
				})
			)
		)
			return null;
		/** Time off is attendance, read over the attendance window; any other movement (an exit encashment) pays
		 * in the salary window, so an encashment on the last day of employment reaches its final payslip. */
		const leaveWindow =
			(attendance: readonly [string, string], salary: readonly [string, string]) =>
			(row: EntryRow) => ((row.activity ?? 'TIME_OFF') === 'TIME_OFF' ? attendance : salary);
		/**
		 * The leave rows reaching into their window (`windowOf`), projected generically: the class's own flags beside
		 * the row's stored values, each row's share of the window, the working days no-pay leave covers and the rows the window uses.
		 * Which days become no-pay or cash is the work catalogue's record to decide, never this engine's.
		 */
		function* projectLeave(
			rows: readonly EntryRow[],
			windowOf: (row: EntryRow) => readonly [string, string],
			on: DynObject,
			planned: ReturnType<typeof dayPlanner>
		) {
			const leaveRows: Json[] = [];
			const unpaidDays = new Set<string>();
			const settled: EntryRow['id'][] = [];
			for (const row of rows) {
				const [from, to] = windowOf(row);
				const day = String(row.from ?? row.occurred_on ?? '');
				const last = String(row.to ?? day);
				// Every overlapping period prices its share; the first one using an open row captures it.
				if (last < from || day > to) continue;
				const spanned = datesFrom(day, last).filter(employedOn);
				const workingDates = new Set<string>();
				for (const date of spanned)
					if ((yield* Effect.fromResult(planned(date)))?.day_type === 'WORK')
						workingDates.add(date);
				const isWorkDay = (date: string) => workingDates.has(date);
				const inside = spanned.filter((date) => date >= from && date <= to);
				const working = spanned.filter(isWorkDay).length;
				const workingInside = inside.filter(isWorkDay).length;
				const total = num(row.days);
				const held = options.jurisdiction.classes.get(String(row.catalog_id));
				// The share by working days covered (by calendar days when the row covers none), or by calendar days
				// when the class's `share_by` says.
				const byWorking = held?.share_by !== 'CALENDAR_DAYS' && working > 0;
				const share =
					inside.length === spanned.length
						? total
						: Number(
								(byWorking
									? (total * workingInside) / working
									: spanned.length === 0
										? 0
										: (total * inside.length) / spanned.length
								).toFixed(4)
							);
				const portion = day < from ? from : day;
				const facts = isDynObject(row.facts) ? row.facts : {};
				const event = eventIdOf(row.facts);
				// Days taken before this row's share here, for the same absence: earlier movements of its event (or,
				// without one, its chain), and the row's own share of earlier periods. By class code, and this class's.
				const chain = options.attendance.chainFrom.get(row.id) ?? day;
				const before = spanned.filter((date) => date < from);
				const ownBefore =
					before.length === 0
						? 0
						: byWorking
							? (total * before.filter(isWorkDay).length) / working
							: spanned.length === 0
								? 0
								: (total * before.length) / spanned.length;
				const takenByClass: {
					[code: string]: number;
				} = {};
				for (const other of options.attendance.timeOff) {
					if (other.employment_id !== contract.id) continue;
					if (other.id === row.id) continue;
					const start = String(other.from ?? other.occurred_on ?? '');
					if (start === '' || start >= day) continue;
					const same =
						event == null
							? options.attendance.chainFrom.get(String(other.id)) === chain
							: eventIdOf(other.facts) === event;
					if (!same) continue;
					const code = options.attendance.leaveCodes.get(String(other.catalog_id)) ?? '';
					takenByClass[code] = (takenByClass[code] ?? 0) + num(other.days);
				}
				const own = held?.code ?? '';
				takenByClass[own] = (takenByClass[own] ?? 0) + ownBefore;
				for (const code of Object.keys(takenByClass))
					takenByClass[code] = Number((takenByClass[code] ?? 0).toFixed(4));
				const projected: DynObject = {
					code: held?.code ?? '',
					activity: row.activity ?? 'TIME_OFF',
					days: share,
					total_days: total,
					period_calendar_days: inside.length,
					period_working_days: workingInside,
					from: day,
					to: last,
					is_npl: held?.is_npl === true,
					// The model's default, as balances read it: encashable unless the class says not.
					can_encash: held?.can_encash !== false,
					event_id: event ?? '',
					chain_from: chain,
					taken_before: takenByClass[own] ?? 0,
					taken_before_by_class: takenByClass,
					month_index:
						completedMonths(
							(event == null
								? undefined
								: options.attendance.eventStart.get(`${contract.id}:${event}`)) ??
								options.attendance.chainFrom.get(row.id) ??
								day,
							portion
						) + 1,
					facts
				};
				const fraction = held?.pay_fraction;
				const payFraction =
					fraction == null || fraction.trim() === ''
						? 1
						: yield* evaluateNumber(
								fraction,
								{ ...on, entry: entryContext(row, day), leave: projected },
								`leave_catalog ${held?.code ?? ''} pay_fraction`
							);
				leaveRows.push({ ...projected, pay_fraction: payFraction });
				if (held?.is_npl === true || payFraction === 0)
					for (const date of inside) if (isWorkDay(date)) unpaidDays.add(date);
				settled.push(row.id);
			}
			return { rows: leaveRows, unpaid: unpaidDays.size, settled };
		}
		if (salaried || !salaryRun) {
			// The window's leave rows are projected once, generically: the class's own flags beside the row's stored
			// values. Which days become no-pay or cash is the work catalogue's record to decide, never this engine's. An
			// off-cycle slip reads the same rows (a bonus exempt during childcare leave) and settles none of them. Time off is
			// attendance: it is read over the attendance window (a cutoff of 21 attends 21st–20th), as the roster is.
			const leaveFamily = options.attendance.entries.find((family) => family.family === 'LEAVE');
			const openLeave = leaveFamily?.rows ?? [];
			const openLeaveIds = new Set(openLeave.map((row) => row.id));
			const projected = yield* projectLeave(
				[
					...openLeave,
					...options.attendance.monthLeave.filter(
						(row) => row.activity === 'TIME_OFF' && !openLeaveIds.has(row.id)
					)
				],
				leaveWindow(
					[window.attendance_from, window.attendance_to],
					[window.salary_from, window.salary_to]
				),
				context,
				planOn
			);
			context.leave = { rows: projected.rows };
			if (salaried)
				for (const id of projected.settled)
					if (openLeaveIds.has(id)) pins.push({ collection: 'leave_catalog_entry', id });
			const unpaid = salaried ? projected.unpaid : 0;
			periodExtras.unpaid_working_days = unpaid;
			periodRoot.unpaid_working_days = unpaid;
		}
		/**
		 * A month paid at more than one frequency (`pay_frequency_changes`) settles month to date: every contract line is
		 * priced as a monthly run over the 1st to this period's end (its days, attendance, leave and roster as recorded,
		 * earlier parts included) and pays that less what the month's earlier salary slips paid for it. So a part at one
		 * frequency and the rest at another pay exactly one month, whatever the records divide by.
		 */
		function* monthToDate() {
			const from = String(calendar.from);
			const to = window.salary_to;
			const frequency = yield* Effect.fromResult(
				fieldValue(options.subject.entity.pay_frequency, 'entity.pay_frequency')
			);
			const cutoffDay = yield* Effect.fromResult(
				fieldValue(options.subject.entity.pay_cutoff_day, 'entity.pay_cutoff_day')
			);
			const cutoff = CYCLES.includes(frequency ?? '') ? 1 : (cutoffDay ?? 1);
			const attendFrom = payrollWindow(
				{ from, to: String(calendar.to), part: 1, parts: 1 },
				cutoff
			).attendance_from;
			const attendTo = window.attendance_to;
			const span = intersect(
				datePeriod(from, to),
				datePeriod(contract.effective_range?.from ?? from, contract.effective_range?.to ?? null)
			);
			const covered = span == null ? 0 : days(span);
			const rows = options.attendance.hoursRoster.filter(
				(row) => row.work_date >= attendFrom && row.work_date <= attendTo
			);
			const list = yield* Effect.fromResult(
				Result.all(
					datesFrom(attendFrom, attendTo)
						.filter(employedOn)
						.map((date) =>
							Result.gen(function* () {
								return yield* workDay({
									date,
									planned: yield* planBefore(date),
									row: recorded.get(date),
									holiday: options.attendance.hoursHolidays.get(date),
									zone,
									suspension: suspensionOn(
										options.attendance.suspensions,
										contract.id,
										date,
										yield* worksiteOn(recorded.get(date), yield* termFor(contract, date))
									)
								});
							})
						)
				)
			);
			applyOvertime(list);
			const on = new Map(list.map((day) => [String(day.date), day]));
			const periodMtd: DynObject = {
				...periodRoot,
				from,
				to,
				days: days(calendar),
				part: 1,
				parts: 1,
				paid_days: covered,
				covered_days: covered,
				working_days: yield* Effect.fromResult(
					plannedWorkDays(from, String(calendar.to), planBefore)
				),
				covered_working_days: yield* Effect.fromResult(
					plannedWorkDays(from, to, planBefore, employedOn)
				)
			};
			const settling: DynObject = {
				...context,
				period: periodMtd,
				work: {
					...work,
					overtime_hours: round2(list.reduce((total, day) => total + day.overtime_hours, 0)),
					incentive_hours: round2(list.reduce((sum, day) => sum + day.incentive_hours, 0)),
					payable_incentive_hours: round2(
						list.reduce((sum, day) => sum + day.payable_incentive_hours, 0)
					),
					dates: rows.map((row) => row.work_date),
					holidays: rows.flatMap((row) => {
						const holiday = options.attendance.hoursHolidays.get(row.work_date);
						const day = on.get(row.work_date);
						return holiday == null
							? []
							: [
									{
										date: holiday.date,
										name: holiday.name ?? '',
										kind: holiday.kind,
										given_to: holiday.given_to ?? '',
										replaces: holiday.replaces ?? '',
										day_type: day?.day_type ?? '',
										worked: day?.worked === true,
										worked_hours: num(day?.worked_hours)
									}
								];
					}),
					holiday_dates: [...options.attendance.hoursHolidays.keys()].filter(
						(date) => date >= attendFrom && date <= attendTo
					),
					days: list
				}
			};
			yield* suspend(list, settling, planBefore);
			const leave = yield* projectLeave(
				options.attendance.monthLeave,
				leaveWindow([attendFrom, attendTo], [from, to]),
				settling,
				planBefore
			);
			settling['leave'] = { rows: leave.rows };
			periodMtd['unpaid_working_days'] = leave.unpaid;
			// what the month's earlier salary slips paid, by line code (signed, as stored)
			const paid = new Map<string, number>();
			for (const slip of options.history.payslips) {
				const day = String(slip.salary_from ?? '').slice(0, 10);
				if (day < from || day >= window.salary_from) continue;
				if (!isSalaryRun(options.history.runKind.get(String(slip.payroll_run_id ?? '')))) continue;
				for (const line of slip.base ?? []) {
					const code = String(line.component_code ?? '');
					paid.set(code, money((paid.get(code) ?? 0) + moneyValue(line.amount)));
				}
			}
			return {
				context: settling,
				paid,
				span: {
					from: String(span?.from ?? from),
					to: String(span?.to ?? to),
					days: covered
				}
			};
		}
		if (salaried && term != null) {
			if (baseSalary <= 0 && payroll?.base_salary_required !== false)
				return yield* Effect.fail(
					new Refusal({
						message: `${who}: the contract in force for ${period} carries no base salary.`
					})
				);
			const settling = options.payroll.switched ? yield* monthToDate() : undefined;
			const priceOn = settling?.context ?? context;
			const priced = new Set<string>();
			// A switched month's line pays the month to date less what the month's earlier slips paid for it.
			const owed = (row: CatalogRow, code: string, amount: number) => {
				priced.add(code);
				const before = settling?.paid.get(code) ?? 0;
				return money(amount - (row.direction === 'SUBTRACT' ? -before : before));
			};
			for (const row of options.jurisdiction.workRows) {
				const where = `work_catalog ${row.code}`;
				const code = row.component_code ?? row.code;
				if (!(yield* evaluateBoolean(row.eligibility, priceOn, where))) continue;
				const quantity = yield* evaluateNumber(row.quantity ?? '1.0', priceOn, where);
				const rate = yield* evaluateNumber(row.rate ?? '0.0', priceOn, where);
				const toDate = money(quantity * rate);
				const amount = owed(row, code, toDate);
				if (amount === 0) continue;
				const signed = post(row, amount);
				base.push({
					component_code: code,
					label: row.name ?? row.code,
					amount: signed,
					quantity: Number(quantity.toFixed(6)),
					rate: round2(rate)
				});
				if (row.prorated === true)
					proration.push({
						component_code: code,
						...(settling == null
							? { from: employedFrom, to: employedTo, days: paidDays }
							: {
									from: settling.span.from,
									to: settling.span.to,
									days: settling.span.days,
									window_from: String(calendar.from)
								}),
						// The divisor the record states (`denominator`), else the period's calendar days.
						denominator:
							row.denominator == null || row.denominator.trim() === ''
								? settling == null
									? monthDays
									: days(calendar)
								: yield* evaluateNumber(row.denominator, priceOn, `${where} denominator`),
						contract_amount: money(rate),
						prorated_amount: settling == null ? signed : toDate
					});
			}
			for (const row of options.attendance.roster)
				pins.push({ collection: 'roster_entry', id: row.id });
			// Contract allowances price through the governing version's allowance class of the same code.
			const allowanceById = new Map(options.jurisdiction.allowanceRows.map((row) => [row.id, row]));
			const allowanceByCode = new Map(
				options.jurisdiction.allowanceRows.map((row) => [row.code, row])
			);
			const capturedAllowances = (term.allowances ?? []).filter(
				(line) => moneyValue(line.amount?.value) !== 0
			);
			for (const line of capturedAllowances) {
				const code =
					line.code ??
					(line.catalogue_id == null
						? undefined
						: (allowanceById.get(line.catalogue_id)?.code ??
							options.jurisdiction.capturedAllowanceCodes.get(line.catalogue_id)));
				const row = code == null ? undefined : allowanceByCode.get(code);
				if (row == null)
					return yield* Effect.fail(
						new Refusal({
							message: `${who}: a contract allowance names no allowance class of ${options.jurisdiction.version.code}.`
						})
					);
				const where = `allowance_catalog ${row.code}`;
				const allowanceContext: DynObject = {
					...priceOn,
					allowance: { code: row.code, amount: moneyValue(line.amount?.value) }
				};
				if (!(yield* evaluateBoolean(row.eligibility, allowanceContext, where))) continue;
				if (row.amount == null)
					return yield* Effect.fail(
						new Refusal({ message: `${where}: the class states no amount expression.` })
					);
				const amount = owed(
					row,
					row.code,
					money(yield* evaluateNumber(row.amount, allowanceContext, where))
				);
				if (amount === 0) continue;
				base.push({
					component_code: row.code,
					label: row.name ?? row.code,
					amount: post(row, amount)
				});
			}
			// a line the month's earlier slips paid that is no longer owed is taken back
			for (const [code, before] of settling?.paid ?? []) {
				if (priced.has(code) || before === 0) continue;
				const row = [...options.jurisdiction.workRows, ...options.jurisdiction.allowanceRows].find(
					(held) => (held.component_code ?? held.code) === code
				) ?? { id: code, code, destination: 'PAY', counts_toward: [] };
				base.push({
					component_code: code,
					label: row.name ?? code,
					amount: post(row, row.direction === 'SUBTRACT' ? before : -before)
				});
			}
		}
		let settlesAfterExit = false;
		for (const family of options.attendance.entries) {
			if (family.family === 'LEAVE') continue;
			for (const row of family.rows) {
				const chosen = options.payroll.selected.has(row.id);
				if (!salaryRun && !chosen) continue;
				if (salaryRun && options.payroll.selected.size > 0 && !chosen) continue;
				const occurred = String(row.occurred_on ?? '');
				if (salaryRun && (occurred < window.salary_from || occurred > window.salary_to)) continue;
				// Without salary a salary run pays only a payee's entries and the classes payable after exit.
				if (salaryRun && !salaried && !unsalaried(row)) continue;
				const priced = options.jurisdiction.classes.get(String(row.catalog_id));
				if (priced == null)
					return yield* Effect.fail(
						new Refusal({
							message: `${who}: entry ${row.id} names a class ${options.jurisdiction.version.code} does not carry.`
						})
					);
				const earlier = earlierContext(family.siblings, {
					id: row.id,
					code: priced.code,
					occurred_on: occurred
				});
				const entryCtx: DynObject = {
					...context,
					entry: entryContext(row, occurred),
					earlier
				};
				const where = `${family.collection.replace('_entry', '')} ${priced.code}`;
				if (!(yield* evaluateBoolean(priced.eligibility, entryCtx, where)))
					return yield* Effect.fail(
						new Refusal({
							message: `${who}: ${priced.name ?? priced.code} is not available to this employment.`
						})
					);
				if (!(yield* evaluateBoolean(priced.qualifies_when, entryCtx, where)))
					return yield* Effect.fail(
						new Refusal({
							message: `${who}: entry ${row.reference ?? row.id} does not qualify as ${priced.name ?? priced.code}.`
						})
					);
				let priceAmount = moneyValue(row.amount);
				const label = `${priced.name ?? priced.code} ${row.reference ?? occurred}`;
				for (const band of priced.bands ?? []) {
					if (!(yield* evaluateBoolean(band.when, entryCtx, where))) continue;
					priceAmount = yield* evaluateNumber(band.amount, entryCtx, where);
					const limit = band.limit;
					if (limit?.amount != null && row.activity !== 'REVERSAL') {
						// The limit meters its window: this claim alone, or less what the class already took in the
						// settlement period or the calendar year. BLOCK pays up to it, ALLOW pays all; either flags the excess.
						const before = earlier.rows;
						const taken =
							limit.window === 'PERIOD'
								? earlierSum(before, window.salary_from, window.salary_to)
								: limit.window === 'CALENDAR_YEAR'
									? earlierSum(
											before,
											`${occurred.slice(0, 4)}-01-01`,
											`${occurred.slice(0, 4)}-12-31`
										)
									: 0;
						const left = Math.max(
							0,
							(yield* evaluateNumber(limit.amount, entryCtx, where)) - taken
						);
						if (priceAmount > left) {
							const excess = money(priceAmount - left);
							entryWarnings.push(
								limit.on_exceed === 'ALLOW'
									? `${who}: ${label} exceeds its limit by ${excess}; paid in full.`
									: `${who}: ${label} exceeds its limit by ${excess}; paid up to it.`
							);
							if (limit.on_exceed !== 'ALLOW') priceAmount = left;
						}
					}
					break;
				}
				const reversal = row.activity === 'REVERSAL';
				const signedAmount = money(reversal ? -priceAmount : priceAmount);
				// A class payable after exit is settled even when it pays nothing (a waived instalment): the slip keeps it
				// for the year's statutory return.
				if (priced.payable_after_exit === true) {
					pins.push({ collection: family.collection, id: row.id });
					settlesAfterExit = true;
				}
				// an entry that prices to nothing pays nothing: flagged, never silent
				if (signedAmount === 0) {
					if (priced.payable_after_exit !== true)
						entryWarnings.push(`${who}: ${label} prices to nothing; it stays unpaid.`);
					continue;
				}
				const posted = post(
					reversal
						? { ...priced, direction: priced.direction === 'SUBTRACT' ? 'ADD' : 'SUBTRACT' }
						: priced,
					Math.abs(signedAmount)
				);
				if (priced.payable_after_exit !== true)
					pins.push({ collection: family.collection, id: row.id });
				if (priced.destination === 'DISPLAY') continue;
				if (priced.destination === 'EMPLOYER') {
					companyPayments.push({
						family: family.family,
						source_id: row.id,
						component_code: priced.code,
						amount: posted,
						label: row.label ?? priced.name ?? priced.code
					});
					continue;
				}
				adjustments.push({
					family: family.family,
					source_id: row.id,
					component_code: priced.code,
					bucket: posted >= 0 && priced.destination === 'PAY' ? 'EARNING' : 'DEDUCTION',
					destination: priced.destination === 'PAY' ? 'PAY' : 'NET',
					amount: posted,
					label: row.label ?? priced.name ?? priced.code
				});
			}
		}
		gross = money(gross);
		if (
			gross === 0 &&
			adjustments.length === 0 &&
			companyPayments.length === 0 &&
			!settlesAfterExit &&
			!(salaryRun && options.jurisdiction.assessesWithoutWage)
		)
			return null;
		const subjectAt = (day: string) =>
			subjectContext({
				contract,
				employee,
				entity: options.subject.entity,
				term,
				day,
				headcount: options.payroll.headcount,
				version: options.jurisdiction.version,
				allowanceCodes
			});
		const statutorySubjects = yield* Effect.fromResult(
			Result.all({
				start: subjectAt(window.salary_from),
				end: subjectAt(window.salary_to),
				pay: subjectAt(options.payroll.payDate)
			})
		);
		const employeeFacts = yield* Effect.fromResult(
			fieldValue(employee?.facts, 'employment_profile.facts')
		);
		const { lines: statutory, warnings } = yield* assessStatutory({
			who,
			subject: statutorySubjects.start,
			subjectOn: (asOf) => (asOf === 'pay_date' ? statutorySubjects.pay : statutorySubjects.end),
			rules: options.jurisdiction.rules,
			statutoryRows: options.jurisdiction.statutoryRows,
			schemeCodes: options.jurisdiction.schemeCodes,
			standing: statutoryFactsFromFacts(employeeFacts),
			salaryRun,
			statutoryConfigurations: options.history.statutoryConfigurations ?? new Map(),
			runWindows: options.history.runWindows,
			period,
			window: { from: window.salary_from, to: window.salary_to },
			periodExtras,
			roots: { work, earned, hours, leave: context.leave ?? {} },
			lines: [...base, ...adjustments].map((line) => ({
				code: line.component_code,
				amount: line.amount
			})),
			previousMonth: String(addMonths(`${monthKey}-01`, -1)).slice(0, 7),
			available: money(gross - netSubtract + netAdd),
			money: options.payroll.money,
			yearStartMonth: payroll?.tax_year_start_month ?? 1,
			severity: options.subject.entity.validation_severity,
			wages,
			parts: options.jurisdiction.parts,
			history: options.history.payslips,
			runKind: options.history.runKind
		});
		warnings.unshift(...entryWarnings);
		const employeeStatutory = money(
			statutory.reduce((total, row) => total + row.employee_amount, 0)
		);
		const employerStatutory = money(
			statutory.reduce((total, row) => total + row.employer_amount, 0)
		);
		// A slip kept only for a scheme assessed without wage is dropped when that scheme charged nothing either.
		if (
			gross === 0 &&
			adjustments.length === 0 &&
			companyPayments.length === 0 &&
			!settlesAfterExit &&
			employeeStatutory === 0 &&
			employerStatutory === 0
		)
			return null;
		// A `carry_uncovered` scheme's employee share net cannot cover is advanced on this slip (a NET line); an advance
		// still outstanding from earlier slips is recovered from what this one's net leaves, as far as it goes.
		let advanced = 0;
		const carry = (code: string, amount: number) => {
			adjustments.push({
				family: CARRY_FAMILY,
				source_id: code,
				component_code: `${code}_CARRIED`,
				bucket: amount >= 0 ? 'EARNING' : 'DEDUCTION',
				destination: 'NET',
				amount,
				label: `${code} carried`
			});
			if (amount >= 0) {
				netAdd += amount;
				advanced += amount;
			} else netSubtract -= amount;
		};
		const carries = new Set(
			options.jurisdiction.statutoryRows
				.filter((row) => row.configuration?.carry_uncovered === true)
				.map((row) => row.code)
		);
		for (const line of statutory) {
			const short = money(employeeStatutory + netSubtract - gross - netAdd);
			if (short <= 0) break;
			if (carries.has(line.scheme_code) && line.employee_amount > 0)
				carry(line.scheme_code, money(Math.min(short, line.employee_amount)));
		}
		const outstanding = new Map<string, number>();
		for (const held of options.history.payslips)
			for (const line of held.adjustments ?? [])
				if (line.family === CARRY_FAMILY && line.component_code != null)
					outstanding.set(
						line.component_code,
						money((outstanding.get(line.component_code) ?? 0) + moneyValue(line.amount))
					);
		for (const [code, owed] of [...outstanding].toSorted()) {
			const left = money(gross + netAdd - employeeStatutory - netSubtract);
			if (owed > 0 && left > 0) carry(code.replace(/_CARRIED$/, ''), -money(Math.min(owed, left)));
		}
		const total_deductions = money(employeeStatutory + netSubtract);
		const net = money(gross - total_deductions + netAdd);
		if (net < 0 && payroll?.negative_net !== 'allow')
			return yield* Effect.fail(
				new Refusal({ message: `${who}: net pay would be negative (${net}).` })
			);
		// The payslip validations read the slip as built: `payslip` (its totals and lines by code) and `statutory`.
		const lines: {
			[code: string]: number;
		} = {};
		for (const line of [...base, ...adjustments])
			lines[line.component_code] = money((lines[line.component_code] ?? 0) + line.amount);
		let hold: string | null = null;
		for (const check of yield* tripped(
			options.jurisdiction.validations,
			{
				...context,
				payslip: {
					gross,
					net,
					total_deductions,
					statutory_employee: employeeStatutory,
					statutory_employer: employerStatutory,
					net_additions: money(netAdd),
					net_deductions: money(netSubtract),
					lines
				},
				statutory: Object.fromEntries(
					statutory.map((line) => [
						line.scheme_code,
						{ employee: line.employee_amount, employer: line.employer_amount }
					])
				)
			},
			options.subject.entity.validation_severity
		)) {
			if (check.kind === 'refuse')
				return yield* Effect.fail(new Refusal({ message: `${who}: ${check.message}` }));
			warnings.push(`${who}: ${check.message}`);
			if (check.kind === 'hold') hold ??= check.message;
		}
		return {
			employment_id: contract.id,
			salary_from: salaryRun ? employedFrom : window.salary_from,
			salary_to: salaryRun ? employedTo : window.salary_to,
			currency: options.payroll.currency,
			base,
			adjustments,
			company_payments: companyPayments,
			statutory,
			gross,
			total_deductions,
			net,
			// An advanced share is the employee's, recovered later: not a cost of employment.
			employer_cost: money(gross + netAdd - advanced + employerStatutory),
			proration,
			service_basis: salaried
				? [
						{
							from: employedFrom,
							to: employedTo,
							days: paidDays,
							denominator: proration[0]?.denominator ?? monthDays
						}
					]
				: [],
			pins,
			warnings,
			hold
		};
	});
/** The adjustment family of a statutory share advanced or recovered (`carry_uncovered`). */
