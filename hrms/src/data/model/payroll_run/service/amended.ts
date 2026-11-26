import { Effect } from 'effect';
import {
	accountsOf,
	apply,
	measureOf,
	periodKey,
	periodOf,
	totalsScope,
	type Accounts,
	type Movement,
	type Wanted
} from '../../employee_profile/employee_balance/service/core.js';
import {
	carriedFor,
	type Carried
} from '../../employee_profile/employee_balance/service/service.js';
import { isJsonObject, type JsonObject } from '../../../../lib/foundation.js';
import { attendanceOf } from './pay_cycle.js';
import { emptyPayslipBreakdown } from './payslip_breakdown.js';
import { objectValue, type Reader } from '../../../../lib/reads.js';
import { lawsAt } from '../../jurisdiction/service/law.js';
import {
	calculateRun,
	type CalculatedPayslip,
	type RunData,
	type RunFrame
} from './run_calculation.js';
import { round, type BackPayLine } from './rates.js';
import {
	RECALCULATED_A_RUN,
	RECOVERY,
	backPayDeltaLines,
	earningLines,
	fromOf,
	indexSpan,
	isMoney,
	linesOf,
	loadSpan,
	movements,
	orderOf,
	ownPostings,
	postingsBetween,
	rangeOf,
	recoveryOf,
	remainderLines,
	signedOn,
	sliceOf,
	unique,
	type BalanceBucket,
	type EntryBucket,
	type Line,
	type Period
} from './history_slice.js';

export { RECALCULATED_A_RUN, RECOVERY } from './history_slice.js';

export interface Amended {
	readonly payslips: readonly CalculatedPayslip[];
	readonly attaches: Readonly<Record<string, readonly string[]>>;
	/** The amendment rows this run carried: it takes them. */
	readonly taken: readonly string[];
	/** People whose recovery outran their pay: the run leaves a row for its own period. */
	readonly deferred: readonly string[];
	/** Amended person-periods left for the next run. */
	readonly waiting: number;
}

/**
 * One run with what it carries for earlier periods: an on-cycle run for everyone it pays, an off-cycle run for the
 * people whose open rows HR named, who may be paid nothing else by it (someone who has left). `own` is the run's own read; `known` is what the
 * transform already read of the company: its on-cycle runs, its pay groups and every open amendment row.
 */
export const amendedRun = Effect.fn('payroll.amendedRun')(function* (
	read: Reader,
	own: {
		readonly id: string;
		readonly row: JsonObject;
		readonly frame: RunFrame;
		readonly data: RunData;
	},
	known: {
		readonly runs: readonly JsonObject[];
		readonly groups: readonly JsonObject[];
		readonly amendments: readonly JsonObject[];
		/** The companies of those runs: each names its law (`settings_code`). */
		readonly entities: readonly JsonObject[];
		/** The recovery tasks HR has fulfilled (`recovery:<employment>:<period>`): that money came back outside payroll. */
		readonly recovered: ReadonlySet<string>;
	}
) {
	const offCycle = own.frame.pays !== undefined;
	const settings = (own.data.law_settings ?? [])[0];
	const roundMoney = (value: number) => round(settings ?? {}, value);
	// off-cycle, a payslip below zero is refused: only an on-cycle run carries the rest
	const plain = () =>
		Effect.map(calculateRun(own.data, own.row, own.frame), (result): Amended => {
			const short = offCycle ? [] : result.payslips.filter((slip) => slip.net_pay < 0);
			const payslips = result.payslips.map((slip) =>
				!short.includes(slip)
					? slip
					: {
							...slip,
							net_pay: 0,
							breakdown: {
								...slip.breakdown,
								lines: [...slip.breakdown.lines, recoveryOf(slip, roundMoney(-slip.net_pay))]
							}
						}
			);
			return {
				payslips,
				attaches: { ...result.attaches },
				taken: [],
				deferred: short.map((slip) => slip.employee_id),
				waiting: 0
			};
		});
	const named = own.frame.carries ?? new Set<string>();
	if (offCycle && named.size === 0) return yield* plain();
	const ownPayDate = String(own.row.pay_date);
	const schedules = new Map(
		known.groups.map((row) => [String(row.id), objectValue(row.payment_schedule)])
	);
	// a paid period is worked out on the law now in force on its own pay date: the run's own law, read and folded once
	const lawCode = new Map(known.entities.map((row) => [String(row.id), row.settings_code]));
	const laws = yield* lawsAt(read, [lawCode.get(String(own.row.entity_id))]);
	const lawFor = (run: JsonObject) =>
		laws(lawCode.get(String(run.entity_id)), String(run.pay_date));
	const { runs } = known;
	const paidRuns = runs.filter(
		(run) => run.kind === 'ON_CYCLE' && run.state === 'PAID' && run.$approval == null
	);
	const periodOfRun = (run: JsonObject): Period | undefined => {
		const schedule = schedules.get(String(run.pay_group_id));
		const law = lawFor(run);
		const coverage = objectValue(run.salary_coverage);
		if (schedule === undefined || law === undefined) return undefined;
		const salary = { from: String(coverage.from), to: String(coverage.to) };
		const attendance = attendanceOf(schedule, salary);
		const payDate = String(run.pay_date);
		return {
			run,
			id: String(run.id),
			key: `${String(run.pay_group_id)}/${String(run.period)}`,
			payDate,
			order: orderOf(run),
			frame: { attendance },
			closes: attendance.to > salary.to ? attendance.to : salary.to,
			year: periodKey(
				totalsScope(law.settings, run.entity_id),
				{ kind: 'YEAR', start_month: Number(law.settings.tax_year_start_month ?? 1) },
				payDate,
				payDate
			)
		};
	};
	// one period a run, whoever asks: the people it is worked out again for are priced together
	const earliestAttendanceByGroup = new Map<string, string>();
	const orderedPeriods = paidRuns
		.toSorted((a, b) => orderOf(a).localeCompare(orderOf(b)))
		.flatMap((run) => {
			const period = periodOfRun(run);
			if (period === undefined) return [];
			const groupId = String(run.pay_group_id);
			const deferredSince = earliestAttendanceByGroup.get(groupId);
			const attFrom = period.frame.attendance.from;
			if (deferredSince === undefined || attFrom < deferredSince)
				earliestAttendanceByGroup.set(groupId, attFrom);
			return deferredSince === undefined
				? [period]
				: [{ ...period, frame: { ...period.frame, deferredSince } }];
		});
	const periodByKey = new Map(orderedPeriods.map((period) => [period.key, period] as const));
	const periodsByGroup = Map.groupBy(orderedPeriods, (period) => String(period.run.pay_group_id));
	const opensOf = (period: Period): string => {
		const salaryFrom = String(objectValue(period.run.salary_coverage).from);
		return period.frame.attendance.from < salaryFrom ? period.frame.attendance.from : salaryFrom;
	};
	const monthStart = (date: string) =>
		`${date.slice(0, 8)}01` < date ? `${date.slice(0, 8)}01` : date;
	const ownGroupId = String(own.row.pay_group_id);
	const paying = unique(
		offCycle
			? known.amendments
					.filter((row) => named.has(String(row.id)))
					.map((row) => String(row.employee_id))
			: (own.data.employment ?? []).map((row) => String(row.employee_id))
	);
	const payingSet = new Set(paying);
	// a late entry dated in a period the person may have been paid for is that period's, not this one's
	const employeeOf = new Map(
		(own.data.employment ?? []).map((row) => [String(row.id), String(row.employee_id)])
	);
	const ownFrom = own.frame.attendance.from;
	const late = (
		offCycle
			? []
			: [...(own.data.claim_catalog_entry ?? []), ...(own.data.adhoc_catalog_entry ?? [])]
	).filter(
		(row) =>
			row.payroll_run_id == null && typeof row.incurred_on === 'string' && row.incurred_on < ownFrom
	);
	// terms signed since the last pay date that began before this period: they may owe back pay
	const backPaySetting = objectValue(settings?.conversions).back_pay;
	const paysBack = backPaySetting === true || typeof backPaySetting === 'string';
	const ownGroupPeriods = periodsByGroup.get(ownGroupId) ?? [];
	const lastPayDate =
		ownGroupPeriods
			.filter((period) => period.payDate < ownPayDate)
			.map((period) => period.payDate)
			.at(-1) ?? '';
	const signedLately =
		!paysBack || offCycle || lastPayDate === ''
			? []
			: (own.data.contract_terms ?? []).flatMap((row) => {
					const signed = signedOn(row);
					const employee = employeeOf.get(String(row.employment_id));
					return employee !== undefined &&
						signed > lastPayDate &&
						signed <= ownPayDate &&
						// terms from before this period's salary days: the attendance window may already hold their first days
						fromOf(row) < String(objectValue(own.row.salary_coverage).from) &&
						// terms signed in their own first pay period were never late for anything
						signed > fromOf(row)
						? [{ employee, from: fromOf(row) }]
						: [];
				});
	const open = known.amendments.filter(
		(row) =>
			row.payroll_run_id == null &&
			payingSet.has(String(row.employee_id)) &&
			periodByKey.has(`${String(row.pay_group_id)}/${String(row.period)}`)
	);
	const openByEmployee = Map.groupBy(open, (row) => String(row.employee_id));
	const lateByEmployee = Map.groupBy(
		late.flatMap((row) => {
			const employee = employeeOf.get(String(row.employment_id));
			return employee === undefined ? [] : [{ employee, row }];
		}),
		(entry) => entry.employee
	);
	const signedLatelyByEmployee = Map.groupBy(signedLately, (row) => row.employee);
	const candidates = unique([
		...openByEmployee.keys(),
		...lateByEmployee.keys(),
		...signedLatelyByEmployee.keys()
	]);
	if (candidates.length === 0) return yield* plain();

	// precompute each candidate's own continuous-stint span and terms once so safe single-year amendments neither
	// over-count their cap cost nor load un-recalculated later tax years
	const ownStintMinFrom = new Map<string, string>();
	const ownStintsByEmployee = Map.groupBy(own.data.employment ?? [], (row) =>
		String(row.employee_id)
	);
	for (const row of own.data.employment ?? []) {
		const employee = String(row.employee_id);
		const from = rangeOf(row).from;
		const prev = ownStintMinFrom.get(employee);
		if (from !== '' && (prev === undefined || from < prev)) ownStintMinFrom.set(employee, from);
	}
	/** The last day a period prices for this person's attendance and entries: its cutoff, or their exit day in that month. */
	const attendanceEndOf = (period: Period, stints: readonly JsonObject[]): string => {
		const coverage = objectValue(period.run.salary_coverage);
		const covFrom = String(coverage.from);
		const covTo = String(coverage.to);
		const end = period.frame.attendance.to;
		if (end >= covTo) return end;
		const group = String(period.run.pay_group_id);
		const active = stints
			.filter((row) => {
				const { from, to } = rangeOf(row);
				return from <= covTo && (to === null || to >= covFrom);
			})
			.toSorted((a, b) => rangeOf(a).from.localeCompare(rangeOf(b).from))
			.at(-1);
		if (active === undefined || String(active.pay_group_id) !== group) return end;
		const last = rangeOf(active).to;
		return active.exit === true && last !== null && last > end && last <= covTo ? last : end;
	};
	const ownTermsByEmployee = Map.groupBy(
		(own.data.contract_terms ?? []).flatMap((row) => {
			const employee = employeeOf.get(String(row.employment_id));
			return employee === undefined ? [] : [{ employee, row }];
		}),
		(entry) => entry.employee
	);

	interface CandidatePlan {
		readonly employee: string;
		readonly earliest: string;
		readonly cost: number;
		readonly entryWindows: readonly { readonly from: string; readonly to: string }[];
		readonly balanceFrom: string;
		readonly paidSince: string;
	}
	const planOf = (employee: string): CandidatePlan => {
		const myOpen = openByEmployee.get(employee) ?? [];
		const myLate = lateByEmployee.get(employee) ?? [];
		const mySigned = signedLatelyByEmployee.get(employee) ?? [];
		const dates: string[] = [];
		const openPeriods: Period[] = [];
		const groupIds = new Set<string>();
		for (const row of myOpen) {
			const period = periodByKey.get(`${String(row.pay_group_id)}/${String(row.period)}`);
			if (period === undefined) continue;
			openPeriods.push(period);
			groupIds.add(String(row.pay_group_id));
			dates.push(opensOf(period));
		}
		for (const { row } of myLate) {
			dates.push(String(row.incurred_on));
			groupIds.add(ownGroupId);
		}
		for (const row of mySigned) {
			groupIds.add(ownGroupId);
			const reached = ownGroupPeriods
				.filter((period) => String(objectValue(period.run.salary_coverage).to) >= row.from)
				.map(opensOf)
				.toSorted()[0];
			dates.push(reached !== undefined && reached < row.from ? reached : row.from);
		}
		const ownMinFrom = ownStintMinFrom.get(employee);
		const ownStints = ownStintsByEmployee.get(employee) ?? [];
		const ownTerms = ownTermsByEmployee.get(employee) ?? [];
		const latePeriods = myLate.map(({ row }) =>
			ownGroupPeriods.find(
				(period) =>
					String(row.incurred_on) >= period.frame.attendance.from &&
					String(row.incurred_on) <= attendanceEndOf(period, ownStints)
			)
		);
		// recalculating a later-signed terms row's signing period also re-prices every earlier paid period its back pay
		// reaches: widen the loaded span so those earlier periods' attendance, leave and paid slips are present
		if (paysBack && ownTerms.length > 0) {
			const starts = [
				...openPeriods,
				...latePeriods.filter((period): period is Period => period !== undefined)
			];
			const termGroupIds = unique(ownTerms.map(({ row }) => String(row.pay_group_id)));
			const backPayPeriods = termGroupIds
				.flatMap((groupId) => periodsByGroup.get(groupId) ?? [])
				.toSorted((a, b) => a.order.localeCompare(b.order));
			for (const { row } of ownTerms) {
				const signed = signedOn(row);
				const from = fromOf(row);
				if (signed === '' || signed <= from) continue;
				const signing = backPayPeriods.find((period) => period.payDate >= signed);
				if (signing === undefined) continue;
				const reachesSigning = starts.some(
					(start) =>
						(start.year === signing.year && start.order <= signing.order) ||
						backPayPeriods.some(
							(period) =>
								period.year === start.year &&
								period.order >= start.order &&
								period.payDate < signed &&
								period.closes >= from
						)
				);
				if (!reachesSigning) continue;
				for (const groupId of termGroupIds) groupIds.add(groupId);
				const reached = backPayPeriods
					.filter((period) => period.order < signing.order && period.closes >= from)
					.map(opensOf)
					.toSorted()[0];
				dates.push(reached !== undefined && reached < from ? reached : from);
			}
		}
		const earliest = dates.toSorted()[0] ?? ownFrom;
		const balanceFrom = monthStart(earliest);
		const paidSince =
			orderedPeriods.find((period) => period.closes >= balanceFrom)?.payDate ?? ownPayDate;
		// when the person's unbroken stint in this pay group is already loaded and carries no backdated-signed raise,
		// their recalculated periods stay strictly within the amended tax year(s)
		const bounded =
			!offCycle &&
			mySigned.length === 0 &&
			ownMinFrom !== undefined &&
			ownMinFrom <= earliest &&
			ownTerms.every(({ row }) => String(row.pay_group_id) === ownGroupId) &&
			(!paysBack ||
				ownTerms.every(({ row }) => signedOn(row) === '' || signedOn(row) <= fromOf(row))) &&
			latePeriods.every((period) => period !== undefined);
		if (bounded) {
			const starts = [
				...openPeriods,
				...latePeriods.filter((period): period is Period => period !== undefined)
			];
			const reached = new Map<string, Period>();
			for (const start of starts) {
				const groupPeriods = periodsByGroup.get(String(start.run.pay_group_id)) ?? [];
				for (const period of groupPeriods)
					if (period.order >= start.order && period.year === start.year)
						reached.set(period.id, period);
			}
			const byYear = Map.groupBy([...reached.values()], (period) => period.year);
			const entryWindows = [...byYear.values()].map((yearPeriods) => {
				const minOpen = yearPeriods.map(opensOf).toSorted()[0] ?? earliest;
				const maxClose =
					yearPeriods
						.map((period) => period.closes)
						.toSorted()
						.at(-1) ?? ownFrom;
				return {
					from: monthStart(minOpen),
					to: maxClose
				};
			});
			return {
				employee,
				earliest,
				cost: Math.max(1, reached.size),
				entryWindows:
					entryWindows.length === 0 ? [{ from: balanceFrom, to: ownFrom }] : entryWindows,
				balanceFrom,
				paidSince
			};
		}
		const groupPeriods =
			groupIds.size === 0
				? orderedPeriods
				: [...groupIds].flatMap((groupId) => periodsByGroup.get(groupId) ?? []);
		const cost = Math.max(
			1,
			groupPeriods.filter(
				(period) => String(objectValue(period.run.salary_coverage).to) >= earliest
			).length
		);
		const maxClose =
			groupPeriods
				.map((period) => period.closes)
				.toSorted()
				.at(-1) ?? ownFrom;
		return {
			employee,
			earliest,
			cost,
			entryWindows: [{ from: balanceFrom, to: maxClose > ownFrom ? maxClose : ownFrom }],
			balanceFrom,
			paidSince
		};
	};
	const plans = candidates.map(planOf).toSorted((a, b) => a.earliest.localeCompare(b.earliest));
	// the bound: people are taken whole, the earliest amended first, by the periods their group has paid since
	const chosenPlans: CandidatePlan[] = [];
	let reach = 0;
	for (const plan of plans) {
		if (chosenPlans.length > 0 && reach + plan.cost > RECALCULATED_A_RUN) continue;
		chosenPlans.push(plan);
		reach += plan.cost;
	}
	const people = chosenPlans.map((plan) => plan.employee);
	const peopleSet = new Set(people);
	const waiting = open.filter((row) => !peopleSet.has(String(row.employee_id))).length;

	// group amended people by their date spans so one far-back amendment neither widens other people's reads nor loads
	// un-recalculated intermediate years; cap distinct OR branches so SQL stays compact
	const MAX_BUCKETS = 12;
	const rawEntry = new Map<
		string,
		{ from: string; to: string; paidSince: string; people: Set<string> }
	>();
	const rawBalance = new Map<string, { from: string; since: string; people: Set<string> }>();
	for (const plan of chosenPlans) {
		for (const win of plan.entryWindows) {
			const key = `${win.from}/${win.to}`;
			const existing = rawEntry.get(key);
			if (existing === undefined)
				rawEntry.set(key, {
					from: win.from,
					to: win.to,
					paidSince: plan.paidSince,
					people: new Set([plan.employee])
				});
			else {
				existing.people.add(plan.employee);
				if (plan.paidSince < existing.paidSince) existing.paidSince = plan.paidSince;
			}
		}
		const bKey = `${plan.balanceFrom}/${plan.paidSince}`;
		const bExisting = rawBalance.get(bKey);
		if (bExisting === undefined)
			rawBalance.set(bKey, {
				from: plan.balanceFrom,
				since: plan.paidSince,
				people: new Set([plan.employee])
			});
		else bExisting.people.add(plan.employee);
	}
	const entryGroups = [...rawEntry.values()].toSorted(
		(a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)
	);
	while (entryGroups.length > MAX_BUCKETS) {
		const last = entryGroups.pop();
		const target = entryGroups.at(-1);
		if (last === undefined || target === undefined) break;
		if (last.from < target.from) target.from = last.from;
		if (last.to > target.to) target.to = last.to;
		if (last.paidSince < target.paidSince) target.paidSince = last.paidSince;
		for (const person of last.people) target.people.add(person);
	}
	const balanceGroups = [...rawBalance.values()].toSorted(
		(a, b) => a.from.localeCompare(b.from) || a.since.localeCompare(b.since)
	);
	while (balanceGroups.length > MAX_BUCKETS) {
		const last = balanceGroups.pop();
		const target = balanceGroups.at(-1);
		if (last === undefined || target === undefined) break;
		if (last.from < target.from) target.from = last.from;
		if (last.since < target.since) target.since = last.since;
		for (const person of last.people) target.people.add(person);
	}
	const entryBuckets: EntryBucket[] = entryGroups.map((group) => ({
		people: [...group.people],
		window: { from: group.from, to: group.to },
		runs: paidRuns
			.filter((run) => String(run.pay_date) >= group.paidSince)
			.map((run) => String(run.id))
	}));
	const balanceBuckets: BalanceBucket[] = balanceGroups.map((group) => ({
		people: [...group.people],
		from: group.from,
		since: group.since
	}));

	const span = yield* loadSpan(read, people, entryBuckets, balanceBuckets, own.data);
	const spanData: RunData = { ...span, pay_group: known.groups };
	const indexed = indexSpan(spanData);

	// each payslip with its run, its law, and memoized postings/carried deltas so unwinding and remainder reads never
	// re-parse the same paid payslip across multiple periods
	type SlipEntry = {
		readonly slip: JsonObject;
		readonly run: JsonObject;
		readonly order: string;
		readonly law: ReturnType<typeof lawFor>;
		readonly ours: boolean;
		readonly ownPostings: () => readonly Wanted[];
		readonly carriedEntries: () => ReturnType<typeof carriedFor>;
		readonly lines: () => readonly JsonObject[];
		readonly ownUnwindMoves: () => readonly Movement[];
		readonly carriedUnwindMoves: () => readonly {
			readonly order: string;
			readonly moves: readonly Movement[];
		}[];
	};
	const paidByEmployee = new Map<string, SlipEntry[]>();
	const slipsByEmployee = new Map<string, SlipEntry[]>();
	const slipByEmployeeRun = new Map<string, SlipEntry>();
	const runOrder = new Map<string, string>(runs.map((run) => [String(run.id), orderOf(run)]));
	for (const slip of spanData.payslip ?? []) {
		const company = objectValue(slip.entity_id);
		const run: JsonObject = { ...objectValue(slip.payroll_run_id), entity_id: company.id ?? null };
		const order = orderOf(run);
		const law = laws(company.settings_code, String(run.pay_date));
		const ours = lawCode.has(String(company.id));
		let cachedOwn: readonly Wanted[] | undefined;
		let cachedCarried: ReturnType<typeof carriedFor> | undefined;
		let cachedLines: readonly JsonObject[] | undefined;
		let cachedOwnMoves: readonly Movement[] | undefined;
		let cachedCarriedMoves:
			readonly { readonly order: string; readonly moves: readonly Movement[] }[] | undefined;
		const ownPostingsOf = () => {
			if (cachedOwn === undefined) cachedOwn = ownPostings(law, run, slip.breakdown);
			return cachedOwn;
		};
		const carriedEntriesOf = () => {
			if (cachedCarried === undefined) cachedCarried = carriedFor(slip.breakdown);
			return cachedCarried;
		};
		const kept = (rows: readonly Wanted[]) => (ours ? rows : rows.filter(isMoney));
		const entry: SlipEntry = {
			slip,
			run,
			order,
			law,
			ours,
			ownPostings: ownPostingsOf,
			carriedEntries: carriedEntriesOf,
			lines: () => {
				if (cachedLines === undefined) cachedLines = linesOf(slip.breakdown);
				return cachedLines;
			},
			ownUnwindMoves: () => {
				if (cachedOwnMoves === undefined) cachedOwnMoves = movements(kept(ownPostingsOf()), -1);
				return cachedOwnMoves;
			},
			carriedUnwindMoves: () => {
				if (cachedCarriedMoves === undefined)
					cachedCarriedMoves = carriedEntriesOf().map((carriedEntry) => ({
						order: runOrder.get(carriedEntry.run_id) ?? '',
						moves: movements(kept(carriedEntry.postings), -1)
					}));
				return cachedCarriedMoves;
			}
		};
		const employee = String(slip.employee_id);
		runOrder.set(String(run.id), order);
		const list = paidByEmployee.get(employee);
		if (list === undefined) paidByEmployee.set(employee, [entry]);
		else list.push(entry);
		slipByEmployeeRun.set(`${employee}/${String(run.id)}`, entry);
	}
	for (const [employee, list] of paidByEmployee) {
		list.sort((a, b) => a.order.localeCompare(b.order));
		slipsByEmployee.set(
			employee,
			list.filter(({ ours }) => ours)
		);
	}
	const paidOf = (employee: string): readonly SlipEntry[] => paidByEmployee.get(employee) ?? [];
	const slipsOf = (employee: string): readonly SlipEntry[] => slipsByEmployee.get(employee) ?? [];
	const versionsOf = (employee: string) => indexed.employmentByEmployee.get(employee) ?? [];
	// the person's terms rows: each is signed on a day and applies from one
	const stintOwner = new Map(
		(spanData.employment ?? []).map((row) => [String(row.id), String(row.employee_id)])
	);
	const agreedByEmployee = new Map<string, JsonObject[]>();
	for (const row of spanData.contract_terms ?? []) {
		const employee = stintOwner.get(String(row.employment_id));
		if (employee === undefined) continue;
		const list = agreedByEmployee.get(employee);
		if (list === undefined) agreedByEmployee.set(employee, [row]);
		else list.push(row);
	}
	const agreedOf = (employee: string): readonly JsonObject[] =>
		agreedByEmployee.get(employee) ?? [];
	/**
	 * The person's paid on-cycle periods, oldest first: those that paid them, and those their stint was in with
	 * nothing agreed yet (a hire signed after its first months), which a later period owes as back pay.
	 */
	const periodsOf = new Map(
		people.map((employee) => {
			const slipped = new Set(slipsOf(employee).map(({ run }) => String(run.id)));
			const versions = versionsOf(employee);
			return [
				employee,
				orderedPeriods.filter(
					(period) =>
						slipped.has(period.id) ||
						versions.some((row) => {
							const { from, to } = rangeOf(row);
							const coverage = objectValue(period.run.salary_coverage);
							return (
								String(row.pay_group_id) === String(period.run.pay_group_id) &&
								from <= String(coverage.to) &&
								(to === null || to >= String(coverage.from))
							);
						})
				)
			] as const;
		})
	);
	const ownPeriod: Period = {
		run: { ...own.row, id: own.id },
		id: own.id,
		key: `${ownGroupId}/${String(own.row.period)}`,
		payDate: ownPayDate,
		order: `${ownPayDate}/~`,
		frame: own.frame,
		closes: String(objectValue(own.row.salary_coverage).to),
		year: ''
	};

	// which periods each person has worked out again: from each amended one through the last paid one of its tax year
	const again = new Map<string, Period[]>();
	const againIds = new Map<string, Set<string>>();
	const reach2 = (employee: string, start: Period) => {
		const held = again.get(employee) ?? [];
		const seen = againIds.get(employee) ?? new Set<string>();
		for (const period of periodsOf.get(employee) ?? [])
			if (period.order >= start.order && period.year === start.year && !seen.has(period.id)) {
				seen.add(period.id);
				held.push(period);
			}
		again.set(employee, held);
		againIds.set(employee, seen);
	};
	// someone left for the next run waits whole: their late entries wait with them
	const candidateSet = new Set(candidates);
	const waitingEmployees = new Set(candidates.filter((employee) => !peopleSet.has(employee)));
	const leftOut = new Set<string>(
		late
			.filter((row) => {
				const employee = employeeOf.get(String(row.employment_id));
				return employee !== undefined && waitingEmployees.has(employee);
			})
			.map((row) => String(row.id))
	);
	for (const row of own.data.leave_catalog_entry ?? []) {
		if (row.encashment === true) continue;
		const employee = employeeOf.get(String(row.employment_id));
		if (employee === undefined || !waitingEmployees.has(employee)) continue;
		for (const child of Array.isArray(row.leave_catalog_entry_day)
			? row.leave_catalog_entry_day
			: [])
			if (
				isJsonObject(child) &&
				child.payroll_run_id == null &&
				typeof child.incurred_on === 'string' &&
				child.incurred_on < ownFrom
			)
				leftOut.add(String(child.id));
	}
	for (const employee of people) {
		const paid = periodsOf.get(employee) ?? [];
		for (const row of openByEmployee.get(employee) ?? []) {
			const start = paid.find(
				(period) => period.key === `${String(row.pay_group_id)}/${String(row.period)}`
			);
			if (start !== undefined) reach2(employee, start);
		}
		// a late entry with no row of its own still belongs to the period that paid the person for its date
		const stints = versionsOf(employee);
		for (const { row } of lateByEmployee.get(employee) ?? []) {
			const start = paid.find(
				(period) =>
					String(row.incurred_on) >= period.frame.attendance.from &&
					String(row.incurred_on) <= attendanceEndOf(period, stints)
			);
			if (start === undefined) continue;
			leftOut.add(String(row.id));
			reach2(employee, start);
		}
		// the signing period of terms owes the back pay: a period they reach being amended amends that one too
		for (const terms of agreedOf(employee)) {
			const signed = signedOn(terms);
			if (signed === '' || !paysBack) continue;
			const signing = paid.find((period) => period.payDate >= signed);
			const reaches = (again.get(employee) ?? []).some(
				(period) => period.payDate < signed && period.closes >= fromOf(terms)
			);
			if (signing !== undefined && reaches) reach2(employee, signing);
		}
	}

	const balances = indexed.balanceByEmployee;
	const balanceOwner = new Map(
		(spanData.employee_balance ?? []).map((row) => [String(row.id), String(row.employee_id)])
	);
	const outside = new Map<
		string,
		{ readonly effective_on: string; readonly movement: Movement }[]
	>();
	for (const row of spanData.ledger_entry ?? []) {
		const employee = balanceOwner.get(String(row.balance_id));
		if (employee === undefined) continue;
		const effective_on = String(row.effective_on);
		const [movement] = movements(
			[
				{
					account: String(row.account),
					code: String(row.code),
					period: periodOf(row.period),
					measure: measureOf(row.measure),
					amount: (row.operation === 'DEDUCT' ? -1 : 1) * Number(row.amount ?? 0),
					effective_on
				}
			],
			-1
		);
		if (movement === undefined) continue;
		const bucket = outside.get(employee);
		if (bucket === undefined) outside.set(employee, [{ effective_on, movement }]);
		else bucket.push({ effective_on, movement });
	}
	/** What this run has worked out for earlier periods so far: their postings, by person. */
	const carried = new Map<
		string,
		{ readonly period: Period; readonly moves: readonly Movement[] }[]
	>();
	const baseAccountsByEmployee = new Map<string, Accounts>();
	const baseAccountsOf = (employee: string): Accounts => {
		let held = baseAccountsByEmployee.get(employee);
		if (held === undefined) {
			held = accountsOf(balances.get(employee)?.account);
			baseAccountsByEmployee.set(employee, held);
		}
		return held;
	};
	const accountsAtCache = new Map<string, Accounts>();
	/**
	 * The balance a period saw: today's, less what was paid at or after it and what records posted after it closed, with
	 * what this run has carried for earlier periods. Pay and contributions come off every payslip in these totals; leave
	 * and claims, off this company's.
	 */
	const accountsAt = (employee: string, at: Period): Accounts => {
		const carriedList = carried.get(employee) ?? [];
		const cacheKey = `${employee}/${at.order}/${at.closes}/${carriedList.length}`;
		const cached = accountsAtCache.get(cacheKey);
		if (cached !== undefined) return cached;
		const moves: Movement[] = [];
		for (const slip of paidOf(employee)) {
			if (slip.order >= at.order) moves.push(...slip.ownUnwindMoves());
			// a carried difference is the period's it is for: one for this period or later comes off
			for (const entry of slip.carriedUnwindMoves())
				if (entry.order >= at.order) moves.push(...entry.moves);
		}
		// what this run carries is not in the balance yet
		for (const entry of carriedList) if (entry.period.order < at.order) moves.push(...entry.moves);
		for (const row of outside.get(employee) ?? [])
			if (row.effective_on > at.closes) moves.push(row.movement);
		const computed = apply(baseAccountsOf(employee), moves);
		accountsAtCache.set(cacheKey, computed);
		return computed;
	};

	// pre-index closed amendment rows once so per-period slicing and back-pay lookups are O(1)
	const carriersByKey = new Map<string, Set<string>>();
	const carriedRangesByKey = new Map<string, { readonly from: string; readonly to: string }[]>();
	const amendedKeysByEmployee = new Map<string, Set<string>>();
	const periodsByEmployeeKey = new Map<string, Map<string, Period>>();
	for (const [employee, list] of periodsOf)
		periodsByEmployeeKey.set(
			employee,
			new Map(list.map((period) => [period.key, period] as const))
		);
	for (const row of spanData.pay_amendment ?? []) {
		const employee = String(row.employee_id);
		const periodKeyStr = `${String(row.pay_group_id)}/${String(row.period)}`;
		const carrierRunId = String(row.payroll_run_id);
		const cKey = `${periodKeyStr}/${employee}`;
		const cSet = carriersByKey.get(cKey);
		if (cSet === undefined) carriersByKey.set(cKey, new Set([carrierRunId]));
		else cSet.add(carrierRunId);
		const aSet = amendedKeysByEmployee.get(employee);
		if (aSet === undefined) amendedKeysByEmployee.set(employee, new Set([periodKeyStr]));
		else aSet.add(periodKeyStr);
		const earlier = periodsByEmployeeKey.get(employee)?.get(periodKeyStr);
		if (earlier !== undefined) {
			const rKey = `${carrierRunId}/${employee}`;
			const range = { from: earlier.frame.attendance.from, to: earlier.closes };
			const ranges = carriedRangesByKey.get(rKey);
			if (ranges === undefined) carriedRangesByKey.set(rKey, [range]);
			else ranges.push(range);
		}
	}
	const carriersOf = (period: Period) => (employee: string) =>
		carriersByKey.get(`${period.key}/${employee}`);
	const carriedBackOf = (period: Period) => (employee: string, date: string) => {
		const ranges = carriedRangesByKey.get(`${period.id}/${employee}`);
		return ranges !== undefined && ranges.some((range) => date >= range.from && date <= range.to);
	};
	// rows sealed by an earlier period's extended leaver tail that dropped out when the exit was cancelled or moved
	const released = new Set<string>();
	const releasedRoster = new Map<string, JsonObject>();
	const releasedClaim = new Map<string, JsonObject>();
	const releasedAdhoc = new Map<string, JsonObject>();
	const releasedRepayment = new Map<string, JsonObject>();
	const releasedLeaveDay = new Set<string>();
	const releasedLeaveParent = new Map<string, JsonObject>();
	const priced = (period: Period, who: readonly string[], frame: Partial<RunFrame>) =>
		calculateRun(
			sliceOf(
				indexed,
				lawFor(period.run),
				period,
				who,
				carriersOf(period),
				carriedBackOf(period),
				new Map(who.map((employee) => [employee, accountsAt(employee, period)])),
				released
			),
			period.run,
			{ ...period.frame, people: new Set(who), termsAsOf: period.payDate, ...frame }
		);

	/**
	 * A person's own non-statutory earning lines in an earlier period on the terms signed by a day, priced once: what one
	 * period's back pay counts on its pay date is what the next one's counts on the pay date before.
	 */
	const earnings = new Map<string, readonly JsonObject[]>();
	const earnedOn = Effect.fn('payroll.earnedOn')(function* (
		period: Period,
		asOf: string,
		who: readonly string[]
	) {
		const keyOf = (employee: string) => `${period.id}/${asOf}/${employee}`;
		for (const employee of who) {
			if (earnings.has(keyOf(employee))) continue;
			// An un-amended paid period with no terms signed between its pay date and `asOf` already holds its exact own
			// earning lines (`period === undefined && back_pay_period === undefined`) on the paid payslip.
			const amended =
				(againIds.get(employee)?.has(period.id) ?? false) ||
				(amendedKeysByEmployee.get(employee)?.has(period.key) ?? false);
			const changed = agreedOf(employee).some(
				(row) => signedOn(row) > period.payDate && signedOn(row) <= asOf
			);
			const held =
				!amended && !changed ? slipByEmployeeRun.get(`${employee}/${period.id}`) : undefined;
			if (held !== undefined) earnings.set(keyOf(employee), earningLines(held.slip.breakdown));
		}
		const missing = who.filter((employee) => !earnings.has(keyOf(employee)));
		if (missing.length > 0) {
			const { payslips } = yield* priced(period, missing, { termsAsOf: asOf });
			for (const employee of missing)
				earnings.set(
					keyOf(employee),
					earningLines(payslips.find((slip) => slip.employee_id === employee)?.breakdown)
				);
		}
		return (employee: string) => earnings.get(keyOf(employee)) ?? [];
	});
	/**
	 * The back pay a period owes, line by line: for each earlier paid period (oldest first), its own earning lines on the
	 * terms signed by this period's pay date, less its own earning lines on the terms signed by the pay date before.
	 */
	const backPay = Effect.fn('payroll.backPay')(function* (at: Period, who: readonly string[]) {
		const owed = new Map<string, BackPayLine[]>();
		const asks = new Map<string, { period: Period; since: string; who: string[] }>();
		for (const employee of who) {
			const paid = periodsOf.get(employee) ?? [];
			const earlier = paid.filter((period) => period.order < at.order);
			const since = earlier.at(-1)?.payDate ?? '';
			const signed = agreedOf(employee).filter(
				(row) => signedOn(row) > since && signedOn(row) <= at.payDate
			);
			if (!paysBack || signed.length === 0 || since === '') continue;
			const first = signed.map(fromOf).toSorted()[0] ?? at.payDate;
			for (const period of earlier.filter((entry) => entry.closes >= first)) {
				const ask = asks.get(`${period.id}/${since}`) ?? { period, since, who: [] };
				ask.who.push(employee);
				asks.set(`${period.id}/${since}`, ask);
			}
		}
		const orderedAsks = [...asks.values()].toSorted((a, b) =>
			a.period.order.localeCompare(b.period.order)
		);
		for (const { period, since, who: asked } of orderedAsks) {
			const now = yield* earnedOn(period, at.payDate, asked);
			const then = yield* earnedOn(period, since, asked);
			const periodName = String(period.run.period);
			for (const employee of asked) {
				const delta = backPayDeltaLines(now(employee), then(employee), periodName);
				if (delta.length === 0) continue;
				const held = owed.get(employee);
				if (held === undefined) owed.set(employee, [...delta]);
				else held.push(...delta);
			}
		}
		return owed;
	});

	const attachSets = new Map<string, Set<string>>();
	const attach = (more: Readonly<Record<string, readonly string[]>>) => {
		for (const [layer, ids] of Object.entries(more)) {
			let set = attachSets.get(layer);
			if (set === undefined) {
				set = new Set();
				attachSets.set(layer, set);
			}
			for (const id of ids) set.add(id);
		}
	};
	const lines = new Map<string, Line[]>();
	const records = new Map<string, Carried[]>();
	// the schemes this run's law charges in the month paid, and the pay each person is carried, by checkpoint code
	const paidMonth = new Set(
		(own.data.statutory_contribution_catalog ?? []).flatMap((row) =>
			row.assessed === 'PAID' ? [String(row.code)] : []
		)
	);
	const carriedPay = new Map<string, Record<string, number>>();
	const kinds = new Map<string, string>();
	const claimedLeaveDays = new Set<string>();
	const turns = unique([...again.values()].flat()).toSorted((a, b) =>
		a.order.localeCompare(b.order)
	);
	for (const period of turns) {
		const who = people.filter((employee) => againIds.get(employee)?.has(period.id) ?? false);
		const result = yield* priced(period, who, {
			backPay: yield* backPay(period, who),
			leftOut: claimedLeaveDays
		});
		attach(result.attaches);
		for (const id of result.attaches.leave_day ?? []) {
			claimedLeaveDays.add(id);
			leftOut.add(id);
		}
		const dueByEmployee = new Map(
			result.payslips.map((slip) => [slip.employee_id, slip.breakdown] as const)
		);
		const periodName = String(period.run.period);
		for (const employee of who) {
			const due = dueByEmployee.get(employee);
			for (const row of due?.statutory ?? []) kinds.set(row.code, row.kind);
			const theirs = slipsOf(employee);
			const paidSlip = slipByEmployeeRun.get(`${employee}/${period.id}`);
			const later = theirs.filter(({ order }) => order > period.order);
			// a recovery HR has since collected outside payroll is settled: no run takes it again
			const settled =
				paidSlip !== undefined &&
				known.recovered.has(`recovery:${String(paidSlip.slip.employment_id)}:${periodName}`);
			// what was paid for it: its payslip's own lines, and what later payslips carried for it
			const paidLines = [
				...(paidSlip === undefined
					? []
					: paidSlip.lines().filter((line) => line.period === undefined)),
				...later.flatMap((entry) => entry.lines().filter((line) => line.period === periodName))
			].filter((line) => !(settled && line.code === RECOVERY));
			const paidPostings = [
				...(paidSlip === undefined ? [] : paidSlip.ownPostings()),
				...later.flatMap((entry) =>
					entry
						.carriedEntries()
						.filter((carriedEntry) => carriedEntry.run_id === period.id)
						.flatMap((carriedEntry) => carriedEntry.postings)
				)
			];
			// a scheme assessed in the month paid keeps what it charged that period: the pay carried is this month's wages
			const remainder = remainderLines(
				due === undefined ? [] : linesOf(due),
				paidLines,
				periodName
			).filter((line) => !paidMonth.has(line.code.replace(/_EMPLOYER$/, '')));
			const postings = postingsBetween(
				due === undefined ? [] : ownPostings(lawFor(period.run), period.run, due),
				paidPostings
			).filter(
				(row) => !(row.account === 'statutory' && paidMonth.has(row.code.split('.')[0] ?? ''))
			);
			const pay = carriedPay.get(employee) ?? {};
			for (const line of remainder) {
				const checkpoint = line.subtotal;
				if (line.party !== 'EMPLOYEE' || line.source === 'statutory_contribution_catalog') continue;
				if (checkpoint === '') continue;
				pay[checkpoint] =
					(pay[checkpoint] ?? 0) + (line.direction === 'DEDUCT' ? -line.amount : line.amount);
			}
			carriedPay.set(employee, pay);
			const prevLines = lines.get(employee);
			if (prevLines === undefined) lines.set(employee, [...remainder]);
			else prevLines.push(...remainder);
			if (postings.length > 0) {
				const prevRecords = records.get(employee);
				const nextRecord = { run_id: period.id, period: periodName, postings };
				if (prevRecords === undefined) records.set(employee, [nextRecord]);
				else prevRecords.push(nextRecord);
			}
			const prevCarried = carried.get(employee);
			const nextCarried = { period, moves: movements(postings, 1) };
			if (prevCarried === undefined) carried.set(employee, [nextCarried]);
			else prevCarried.push(nextCarried);
			// if an exit was cancelled or moved, rows this period sealed past its active attendance cutoff drop out here
			// and are released so the period that now owns their date prices and re-seals them
			const until = attendanceEndOf(period, versionsOf(employee));
			if (period.closes > until) {
				const releaseRows = (
					layer: string,
					rows: readonly JsonObject[] | undefined,
					dateField: string,
					bucket: Map<string, JsonObject>
				) => {
					for (const row of rows ?? []) {
						const date = row[dateField];
						if (
							String(row.payroll_run_id) === period.id &&
							typeof date === 'string' &&
							date > until
						) {
							released.add(`${layer}/${String(row.id)}`);
							bucket.set(String(row.id), row);
						}
					}
				};
				releaseRows(
					'roster_entry',
					indexed.rosterByEmployee.get(employee),
					'work_date',
					releasedRoster
				);
				releaseRows('claim', indexed.claimByEmployee.get(employee), 'incurred_on', releasedClaim);
				releaseRows('adhoc', indexed.adhocByEmployee.get(employee), 'incurred_on', releasedAdhoc);
				releaseRows(
					'repayment',
					indexed.repaymentByEmployee.get(employee),
					'paid_on',
					releasedRepayment
				);
			}
			// release any leave slot this period previously sealed that it dropped on recalculation (e.g., cancelled exit,
			// early return from full-unpaid month, or prior-window tail deferred when a month becomes full-unpaid)
			const periodCovFrom = String(objectValue(period.run.salary_coverage).from);
			const releaseFullUnpaidPrior = result.fullUnpaid.has(employee);
			if (period.closes > until || releaseFullUnpaidPrior) {
				for (const row of indexed.leaveByEmployee.get(employee) ?? []) {
					if (row.encashment === true) continue;
					const days = Array.isArray(row.leave_catalog_entry_day)
						? row.leave_catalog_entry_day.filter(isJsonObject)
						: [];
					let hit = false;
					for (const child of days) {
						if (
							String(child.payroll_run_id) === period.id &&
							typeof child.incurred_on === 'string' &&
							!result.pricedLeaveDays.has(String(child.id)) &&
							(child.incurred_on > until ||
								(releaseFullUnpaidPrior && child.incurred_on < periodCovFrom))
						) {
							released.add(`leave_day/${String(child.id)}`);
							releasedLeaveDay.add(String(child.id));
							hit = true;
						}
					}
					if (hit) releasedLeaveParent.set(String(row.id), row);
				}
			}
		}
	}

	// merge unclaimed released rows into this run's own read so it prices and re-seals them cleanly
	const claimed = (layer: string): ReadonlySet<string> => attachSets.get(layer) ?? new Set();
	const mergeReleased = (
		existing: readonly JsonObject[] | undefined,
		extra: ReadonlyMap<string, JsonObject>,
		layer: string
	): readonly JsonObject[] => {
		if (extra.size === 0) return existing ?? [];
		const takenIds = claimed(layer);
		const byId = new Map((existing ?? []).map((row) => [String(row.id), row]));
		for (const [id, row] of extra) {
			if (takenIds.has(id)) continue;
			byId.set(id, { ...row, payroll_run_id: null });
		}
		return [...byId.values()];
	};
	const ownRepayments = mergeReleased(
		own.data.loan_catalog_entry_repayment,
		releasedRepayment,
		'repayment'
	);
	const ownLoanIds = new Set((own.data.loan_catalog_entry ?? []).map((row) => String(row.id)));
	const neededLoanIds = new Set(
		ownRepayments.map((row) => String(row.loan_id)).filter((id) => !ownLoanIds.has(id))
	);
	const extraLoans =
		neededLoanIds.size === 0
			? []
			: (spanData.loan_catalog_entry ?? []).filter((row) => neededLoanIds.has(String(row.id)));
	const takenLeaveDays = claimed('leave_day');
	const openReleasedLeaveDays = new Set(
		[...releasedLeaveDay].filter((id) => !takenLeaveDays.has(id))
	);
	const ownLeaves =
		openReleasedLeaveDays.size === 0
			? (own.data.leave_catalog_entry ?? [])
			: (() => {
					const byId = new Map(
						(own.data.leave_catalog_entry ?? []).map((row) => [String(row.id), row])
					);
					for (const [id, row] of releasedLeaveParent) if (!byId.has(id)) byId.set(id, row);
					return [...byId.values()].map((row) => {
						const days = Array.isArray(row.leave_catalog_entry_day)
							? row.leave_catalog_entry_day.filter(isJsonObject)
							: [];
						if (!days.some((child) => openReleasedLeaveDays.has(String(child.id)))) return row;
						const nextDays = days.map((child) =>
							openReleasedLeaveDays.has(String(child.id))
								? { ...child, payroll_run_id: null }
								: child
						);
						const allOpen = nextDays.every((child) => child.payroll_run_id == null);
						return {
							...row,
							...(allOpen ? { payroll_run_id: null } : {}),
							leave_catalog_entry_day: nextDays
						};
					});
				})();

	// the run's own period, on the balance the carried differences leave
	const ownData: RunData = {
		...own.data,
		roster_entry: mergeReleased(own.data.roster_entry, releasedRoster, 'roster_entry'),
		claim_catalog_entry: mergeReleased(own.data.claim_catalog_entry, releasedClaim, 'claim'),
		adhoc_catalog_entry: mergeReleased(own.data.adhoc_catalog_entry, releasedAdhoc, 'adhoc'),
		loan_catalog_entry_repayment: ownRepayments,
		loan_catalog_entry: [...(own.data.loan_catalog_entry ?? []), ...extraLoans],
		leave_catalog_entry: ownLeaves,
		employee_balance: (own.data.employee_balance ?? []).map((row) =>
			peopleSet.has(String(row.employee_id))
				? { ...row, account: accountsAt(String(row.employee_id), ownPeriod) }
				: row
		)
	};
	const result = yield* calculateRun(ownData, own.row, {
		...own.frame,
		leftOut,
		backPay: offCycle ? new Map() : yield* backPay(ownPeriod, people),
		...(paidMonth.size === 0 ? {} : { carried: carriedPay })
	});
	attach(result.attaches);
	// an off-cycle run may pay someone nothing of its own: their payslip holds what it carries, and nothing else
	const bare = !offCycle
		? []
		: people.flatMap((employee): CalculatedPayslip[] => {
				const last = versionsOf(employee)
					.filter((row) => String(row.entity_id) === String(own.row.entity_id))
					.toSorted((a, b) => rangeOf(a).from.localeCompare(rangeOf(b).from))
					.at(-1);
				return last === undefined || result.payslips.some((slip) => slip.employee_id === employee)
					? []
					: [
							{
								employee_id: employee,
								employment_id: String(last.id),
								entity_id: String(own.row.entity_id),
								basic_earnings: 0,
								gross_earnings: 0,
								net_pay: 0,
								total_deductions: 0,
								employer_cost: 0,
								period: String(own.row.period),
								ordinary_wages: 0,
								employee_statutory: 0,
								tax_withheld: 0,
								breakdown: emptyPayslipBreakdown
							}
						];
			});
	const deferred: string[] = [];
	const payslips = [...result.payslips, ...bare].map((slip): CalculatedPayslip => {
		const extra = lines.get(slip.employee_id) ?? [];
		if (
			extra.length === 0 &&
			(records.get(slip.employee_id) ?? []).length === 0 &&
			slip.net_pay >= 0
		)
			return slip;
		const mine = extra.filter((line) => line.party === 'EMPLOYEE');
		const sum = (direction: string) =>
			mine
				.filter((line) => line.direction === direction)
				.reduce((total, line) => total + line.amount, 0);
		const net = roundMoney(slip.net_pay + sum('ADD') - sum('DEDUCT'));
		const recovery: Line[] = net < 0 ? [recoveryOf(slip, roundMoney(-net))] : [];
		if (recovery.length > 0) deferred.push(slip.employee_id);
		const statutoryOf = (kind: string) =>
			mine
				.filter(
					(line) =>
						line.source === 'statutory_contribution_catalog' &&
						(slip.breakdown.statutory.find((row) => row.code === line.code)?.kind ??
							kinds.get(line.code) ??
							'CONTRIBUTION') === kind
				)
				.reduce(
					(total, line) => total + (line.direction === 'DEDUCT' ? line.amount : -line.amount),
					0
				);
		const employer = extra
			.filter((line) => line.party === 'EMPLOYER')
			.reduce(
				(total, line) => total + (line.direction === 'DEDUCT' ? -line.amount : line.amount),
				0
			);
		return {
			...slip,
			net_pay: Math.max(0, net),
			total_deductions: roundMoney(Math.max(0, slip.total_deductions + sum('DEDUCT'))),
			gross_earnings: roundMoney(
				Math.max(0, net) + Math.max(0, slip.total_deductions + sum('DEDUCT'))
			),
			employer_cost: roundMoney(Math.max(0, slip.employer_cost + employer)),
			employee_statutory: roundMoney(
				Math.max(0, slip.employee_statutory + statutoryOf('CONTRIBUTION'))
			),
			tax_withheld: roundMoney(Math.max(0, slip.tax_withheld + statutoryOf('TAX'))),
			breakdown: {
				...slip.breakdown,
				lines: [...slip.breakdown.lines, ...recovery, ...extra],
				carried: records.get(slip.employee_id) ?? []
			}
		};
	});
	const done = new Set(payslips.map((slip) => slip.employee_id));
	const againKeys = new Map(
		[...again].map(([employee, list]) => [employee, new Set(list.map((period) => period.key))])
	);
	return {
		payslips,
		attaches: Object.fromEntries([...attachSets].map(([layer, ids]) => [layer, [...ids]])),
		// a row is taken only when its person is on this run's payslips and its period was worked out: nobody else
		// carries it, and one this run could not reach waits on
		taken: open
			.filter(
				(row) =>
					peopleSet.has(String(row.employee_id)) &&
					done.has(String(row.employee_id)) &&
					(againKeys
						.get(String(row.employee_id))
						?.has(`${String(row.pay_group_id)}/${String(row.period)}`) ??
						false)
			)
			.map((row) => String(row.id)),
		deferred,
		waiting
	} satisfies Amended;
});
