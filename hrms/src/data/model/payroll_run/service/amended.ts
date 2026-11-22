import { BigDecimal, Effect } from 'effect';
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
import { type JsonObject } from '../../../../lib/foundation.js';
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
import {
	RECALCULATED_A_RUN,
	RECOVERY,
	earned,
	fromOf,
	isMoney,
	keyOf,
	linesOf,
	loadSpan,
	movements,
	net,
	orderOf,
	ownPostings,
	postingsBetween,
	rangeOf,
	recoveryOf,
	remainderLines,
	signedOn,
	sliceOf,
	unique,
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
								lines: [...slip.breakdown.lines, recoveryOf(slip, -slip.net_pay)]
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
	const paidRuns = runs.filter((run) => run.kind === 'ON_CYCLE' && run.state === 'PAID');
	const runAt = new Map(
		paidRuns.map((run) => [`${String(run.pay_group_id)}/${String(run.period)}`, run])
	);
	const paying = unique(
		offCycle
			? known.amendments
					.filter((row) => named.has(String(row.id)))
					.map((row) => String(row.employee_id))
			: (own.data.employment ?? []).map((row) => String(row.employee_id))
	);
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
	const settings = (own.data.law_settings ?? [])[0];
	const paysBack = typeof objectValue(settings?.conversions).back_pay === 'string';
	const lastPayDate =
		paidRuns
			.filter(
				(run) =>
					String(run.pay_group_id) === String(own.row.pay_group_id) &&
					String(run.pay_date) < ownPayDate
			)
			.map((run) => String(run.pay_date))
			.toSorted()
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
			paying.includes(String(row.employee_id)) &&
			runAt.has(`${String(row.pay_group_id)}/${String(row.period)}`)
	);
	const candidates = unique([
		...open.map((row) => String(row.employee_id)),
		...late.flatMap((row) => employeeOf.get(String(row.employment_id)) ?? []),
		...signedLately.map((row) => row.employee)
	]);
	if (candidates.length === 0) return yield* plain();

	// the bound: people are taken whole, the earliest amended first, by the periods their group has paid since
	const earliestOf = (employee: string): string =>
		[
			// a period's attendance may open before its salary days: the span starts where the earliest one attends
			...open
				.filter((row) => String(row.employee_id) === employee)
				.map((row) => {
					const coverage = objectValue(
						runAt.get(`${String(row.pay_group_id)}/${String(row.period)}`)?.salary_coverage
					);
					const salary = { from: String(coverage.from), to: String(coverage.to) };
					const schedule = schedules.get(String(row.pay_group_id));
					const attended = schedule === undefined ? salary : attendanceOf(schedule, salary);
					return attended.from < salary.from ? attended.from : salary.from;
				}),
			...late
				.filter((row) => employeeOf.get(String(row.employment_id)) === employee)
				.map((row) => String(row.incurred_on)),
			...signedLately
				.filter((row) => row.employee === employee)
				.map((row) => {
					const reached = paidRuns
						.filter(
							(run) =>
								String(run.pay_group_id) === String(own.row.pay_group_id) &&
								String(objectValue(run.salary_coverage).to) >= row.from
						)
						.map((run) => {
							const coverage = objectValue(run.salary_coverage);
							const salary = { from: String(coverage.from), to: String(coverage.to) };
							const schedule = schedules.get(String(run.pay_group_id));
							const attended = schedule === undefined ? salary : attendanceOf(schedule, salary);
							return attended.from < salary.from ? attended.from : salary.from;
						})
						.toSorted()[0];
					return reached !== undefined && reached < row.from ? reached : row.from;
				})
		].toSorted()[0] ?? ownFrom;
	const ordered = candidates.toSorted((a, b) => earliestOf(a).localeCompare(earliestOf(b)));
	const people: string[] = [];
	let reach = 0;
	for (const employee of ordered) {
		const since = earliestOf(employee);
		const cost = paidRuns.filter(
			(run) => String(objectValue(run.salary_coverage).to) >= since
		).length;
		if (people.length > 0 && reach + cost > RECALCULATED_A_RUN) continue;
		people.push(employee);
		reach += cost;
	}
	const waiting = open.filter((row) => !people.includes(String(row.employee_id))).length;
	const from = people.map(earliestOf).toSorted()[0] ?? ownFrom;
	const window = {
		from: `${from.slice(0, 8)}01` < from ? `${from.slice(0, 8)}01` : from,
		to: ownFrom
	};
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
	const periods = new Map(
		paidRuns
			.toSorted((a, b) => orderOf(a).localeCompare(orderOf(b)))
			.flatMap((run) => {
				const period = periodOfRun(run);
				return period === undefined ? [] : [[String(run.id), period] as const];
			})
	);
	// every period worked out again closes in the span: what was paid is read from the first such, and before it the
	// balance holds it
	const paidSince =
		[...periods.values()].find((period) => period.closes >= window.from)?.payDate ?? ownPayDate;
	const span = yield* loadSpan(
		read,
		String(own.row.entity_id),
		people,
		window,
		paidSince,
		paidRuns.filter((run) => String(run.pay_date) >= paidSince).map((run) => String(run.id)),
		own.data
	);
	const spanData: RunData = { ...span, pay_group: known.groups };

	// each payslip with its run and its law; `ours` is one of the run's companies, whose payslips say what was paid
	const slips = (spanData.payslip ?? []).map((slip) => {
		const company = objectValue(slip.entity_id);
		const run: JsonObject = { ...objectValue(slip.payroll_run_id), entity_id: company.id ?? null };
		return {
			slip,
			run,
			order: orderOf(run),
			law: laws(company.settings_code, String(run.pay_date)),
			ours: lawCode.has(String(company.id))
		};
	});
	const paidOf = (employee: string) =>
		slips
			.filter(({ slip }) => String(slip.employee_id) === employee)
			.toSorted((a, b) => a.order.localeCompare(b.order));
	const slipsOf = (employee: string) => paidOf(employee).filter(({ ours }) => ours);
	// the order of every run a payslip may have carried for, whichever company
	const runOrder = new Map([
		...slips.map(({ run, order }) => [String(run.id), order] as const),
		...runs.map((run) => [String(run.id), orderOf(run)] as const)
	]);
	const versionsOf = (employee: string) =>
		(spanData.employment ?? []).filter((row) => String(row.employee_id) === employee);
	// the person's terms rows: each is signed on a day and applies from one
	const stintOwner = new Map(
		(spanData.employment ?? []).map((row) => [String(row.id), String(row.employee_id)])
	);
	const agreedOf = (employee: string) =>
		(spanData.contract_terms ?? []).filter(
			(row) => stintOwner.get(String(row.employment_id)) === employee
		);
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
				[...periods.values()].filter(
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
		key: `${String(own.row.pay_group_id)}/${String(own.row.period)}`,
		payDate: ownPayDate,
		order: `${ownPayDate}/~`,
		frame: own.frame,
		closes: String(objectValue(own.row.salary_coverage).to),
		year: ''
	};

	// which periods each person has worked out again: from each amended one through the last paid one of its tax year
	const again = new Map<string, Period[]>();
	const reach2 = (employee: string, start: Period) => {
		const held = again.get(employee) ?? [];
		for (const period of periodsOf.get(employee) ?? [])
			if (period.order >= start.order && period.year === start.year && !held.includes(period))
				held.push(period);
		again.set(employee, held);
	};
	// someone left for the next run waits whole: their late entries wait with them
	const leftOut = new Set<string>(
		late
			.filter((row) => {
				const employee = employeeOf.get(String(row.employment_id));
				return (
					employee !== undefined && candidates.includes(employee) && !people.includes(employee)
				);
			})
			.map((row) => String(row.id))
	);
	for (const employee of people) {
		const paid = periodsOf.get(employee) ?? [];
		for (const row of open.filter((entry) => String(entry.employee_id) === employee)) {
			const start = paid.find(
				(period) => period.key === `${String(row.pay_group_id)}/${String(row.period)}`
			);
			if (start !== undefined) reach2(employee, start);
		}
		// a late entry with no row of its own still belongs to the period that paid the person for its date
		for (const row of late.filter(
			(entry) => employeeOf.get(String(entry.employment_id)) === employee
		)) {
			const start = paid.find(
				(period) =>
					String(row.incurred_on) >= period.frame.attendance.from &&
					String(row.incurred_on) <= period.closes
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

	const balances = new Map(
		(spanData.employee_balance ?? []).map((row) => [String(row.employee_id), row])
	);
	const balanceOwner = new Map(
		(spanData.employee_balance ?? []).map((row) => [String(row.id), String(row.employee_id)])
	);
	const outside = Map.groupBy(spanData.ledger_entry ?? [], (row) =>
		String(balanceOwner.get(String(row.balance_id)))
	);
	/** What this run has worked out for earlier periods so far: their postings, by person. */
	const carried = new Map<string, { period: Period; postings: readonly Wanted[] }[]>();
	/**
	 * The balance a period saw: today's, less what was paid at or after it and what records posted after it closed, with
	 * what this run has carried for earlier periods. Pay and contributions come off every payslip in these totals; leave
	 * and claims, off this company's.
	 */
	const accountsAt = (employee: string, at: Period): Accounts => {
		const moves: Movement[] = [];
		for (const { slip, run, order, law, ours } of paidOf(employee)) {
			const kept = (rows: readonly Wanted[]) => rows.filter((row) => ours || isMoney(row));
			if (order >= at.order)
				moves.push(...movements(kept(ownPostings(law, run, slip.breakdown)), -1));
			// a carried difference is the period's it is for: one for this period or later comes off
			for (const entry of carriedFor(slip.breakdown))
				if ((runOrder.get(entry.run_id) ?? '') >= at.order)
					moves.push(...movements(kept(entry.postings), -1));
		}
		// what this run carries is not in the balance yet
		for (const entry of carried.get(employee) ?? [])
			if (entry.period.order < at.order) moves.push(...movements(entry.postings, 1));
		for (const row of outside.get(employee) ?? [])
			if (String(row.effective_on) > at.closes)
				moves.push(
					...movements(
						[
							{
								account: String(row.account),
								code: String(row.code),
								period: periodOf(row.period),
								measure: measureOf(row.measure),
								amount: (row.operation === 'DEDUCT' ? -1 : 1) * Number(row.amount ?? 0),
								effective_on: String(row.effective_on)
							}
						],
						-1
					)
				);
		return apply(accountsOf(balances.get(employee)?.account), moves);
	};
	const carriersOf = (period: Period) => (employee: string) =>
		new Set(
			(spanData.pay_amendment ?? [])
				.filter(
					(row) =>
						String(row.employee_id) === employee &&
						`${String(row.pay_group_id)}/${String(row.period)}` === period.key
				)
				.map((row) => String(row.payroll_run_id))
		);
	const priced = (period: Period, who: readonly string[], frame: Partial<RunFrame>) =>
		calculateRun(
			sliceOf(
				spanData,
				lawFor(period.run),
				period,
				new Set(who),
				carriersOf(period),
				(employee, date) =>
					(spanData.pay_amendment ?? []).some(
						(row) =>
							String(row.employee_id) === employee &&
							String(row.payroll_run_id) === period.id &&
							(periodsOf.get(employee) ?? []).some(
								(earlier) =>
									earlier.key === `${String(row.pay_group_id)}/${String(row.period)}` &&
									date >= earlier.frame.attendance.from &&
									date <= earlier.closes
							)
					),
				new Map(who.map((employee) => [employee, accountsAt(employee, period)]))
			),
			period.run,
			{ ...period.frame, people: new Set(who), termsAsOf: period.payDate, ...frame }
		);

	/**
	 * A person's earnings in an earlier period on the terms signed by a day, priced once: what one period's back pay counts
	 * on its pay date is what the next one's counts on the pay date before.
	 */
	const backPayCode =
		typeof objectValue(settings?.conversions).back_pay === 'string'
			? String(objectValue(settings?.conversions).back_pay)
			: '';
	const earnings = new Map<string, number>();
	const earnedOn = Effect.fn('payroll.earnedOn')(function* (
		period: Period,
		asOf: string,
		who: readonly string[]
	) {
		const keyOf = (employee: string) => `${period.id}/${asOf}/${employee}`;
		for (const employee of who) {
			if (earnings.has(keyOf(employee))) continue;
			// An un-amended paid period with no terms signed between its pay date and `asOf` (and no back pay of its own)
			// already holds its exact earnings on the paid payslip.
			const amended =
				(again.get(employee) ?? []).some((p) => p.id === period.id) ||
				(spanData.pay_amendment ?? []).some(
					(row) =>
						String(row.employee_id) === employee &&
						`${String(row.pay_group_id)}/${String(row.period)}` === period.key
				);
			const changed = agreedOf(employee).some(
				(row) => signedOn(row) > period.payDate && signedOn(row) <= asOf
			);
			const held =
				!amended && !changed
					? paidOf(employee).find((entry) => entry.run.id === period.id)
					: undefined;
			if (
				held !== undefined &&
				(backPayCode === '' ||
					!linesOf(held.slip.breakdown).some((line) => line.code === backPayCode))
			)
				earnings.set(keyOf(employee), earned(held.slip.breakdown));
		}
		const missing = who.filter((employee) => !earnings.has(keyOf(employee)));
		if (missing.length > 0) {
			const { payslips } = yield* priced(period, missing, { termsAsOf: asOf });
			for (const employee of missing)
				earnings.set(
					keyOf(employee),
					earned(payslips.find((slip) => slip.employee_id === employee)?.breakdown)
				);
		}
		return (employee: string) => earnings.get(keyOf(employee)) ?? 0;
	});
	/**
	 * The back pay a period owes: for each earlier paid period, its earnings on the terms signed by this period's pay
	 * date, less its earnings on the terms signed by the pay date before.
	 */
	const backPay = Effect.fn('payroll.backPay')(function* (at: Period, who: readonly string[]) {
		const owed = new Map<string, number>();
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
		for (const { period, since, who: asked } of asks.values()) {
			const now = yield* earnedOn(period, at.payDate, asked);
			const then = yield* earnedOn(period, since, asked);
			for (const employee of asked)
				owed.set(employee, (owed.get(employee) ?? 0) + now(employee) - then(employee));
		}
		return new Map(
			[...owed].map(([employee, amount]) => [
				employee,
				BigDecimal.toNumberUnsafe(
					BigDecimal.round(BigDecimal.fromNumberUnsafe(amount), { scale: 6 })
				)
			])
		);
	});

	const attaches: Record<string, string[]> = {};
	const attach = (more: Readonly<Record<string, readonly string[]>>) => {
		for (const [layer, ids] of Object.entries(more))
			attaches[layer] = unique([...(attaches[layer] ?? []), ...ids]);
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
	const turns = unique([...again.values()].flat()).toSorted((a, b) =>
		a.order.localeCompare(b.order)
	);
	for (const period of turns) {
		const who = people.filter((employee) => (again.get(employee) ?? []).includes(period));
		const result = yield* priced(period, who, { backPay: yield* backPay(period, who) });
		attach(result.attaches);
		for (const employee of who) {
			const due = result.payslips.find((slip) => slip.employee_id === employee)?.breakdown;
			for (const row of due?.statutory ?? []) kinds.set(row.code, row.kind);
			const theirs = slipsOf(employee);
			const paidSlip = theirs.find(({ run }) => String(run.id) === period.id);
			const later = theirs.filter(({ order }) => order > period.order);
			// a recovery HR has since collected outside payroll is settled: no run takes it again
			const settled =
				paidSlip !== undefined &&
				known.recovered.has(
					`recovery:${String(paidSlip.slip.employment_id)}:${String(period.run.period)}`
				);
			// what was paid for it: its payslip's own lines, and what later payslips carried for it
			const paidLines = [
				...linesOf(paidSlip?.slip.breakdown).filter((line) => line.period === undefined),
				...later.flatMap(({ slip }) =>
					linesOf(slip.breakdown).filter((line) => line.period === period.key.split('/')[1])
				)
			].filter((line) => !(settled && line.code === RECOVERY));
			const paidPostings = [
				...(paidSlip === undefined
					? []
					: ownPostings(lawFor(period.run), period.run, paidSlip.slip.breakdown)),
				...later.flatMap(({ slip }) =>
					carriedFor(slip.breakdown)
						.filter((entry) => entry.run_id === period.id)
						.flatMap((entry) => entry.postings)
				)
			];
			// a scheme assessed in the month paid keeps what it charged that period: the pay carried is this month's wages
			const remainder = remainderLines(
				due === undefined ? [] : linesOf(due),
				paidLines,
				String(period.run.period)
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
			lines.set(employee, [...(lines.get(employee) ?? []), ...remainder]);
			if (postings.length > 0)
				records.set(employee, [
					...(records.get(employee) ?? []),
					{ run_id: period.id, period: String(period.run.period), postings }
				]);
			carried.set(employee, [...(carried.get(employee) ?? []), { period, postings }]);
		}
	}

	// the run's own period, on the balance the carried differences leave
	const amended = new Set(people);
	const ownData: RunData = {
		...own.data,
		employee_balance: (own.data.employee_balance ?? []).map((row) =>
			amended.has(String(row.employee_id))
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
		const net = BigDecimal.toNumberUnsafe(
			BigDecimal.round(BigDecimal.fromNumberUnsafe(slip.net_pay + sum('ADD') - sum('DEDUCT')), {
				scale: 12,
				mode: 'half-ceil'
			})
		);
		const recovery: Line[] = net < 0 ? [recoveryOf(slip, -net)] : [];
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
			total_deductions: BigDecimal.toNumberUnsafe(
				BigDecimal.round(
					BigDecimal.fromNumberUnsafe(Math.max(0, slip.total_deductions + sum('DEDUCT'))),
					{ scale: 12, mode: 'half-ceil' }
				)
			),
			gross_earnings: BigDecimal.toNumberUnsafe(
				BigDecimal.round(
					BigDecimal.fromNumberUnsafe(
						Math.max(0, net) + Math.max(0, slip.total_deductions + sum('DEDUCT'))
					),
					{ scale: 12, mode: 'half-ceil' }
				)
			),
			employer_cost: BigDecimal.toNumberUnsafe(
				BigDecimal.round(BigDecimal.fromNumberUnsafe(Math.max(0, slip.employer_cost + employer)), {
					scale: 12,
					mode: 'half-ceil'
				})
			),
			employee_statutory: BigDecimal.toNumberUnsafe(
				BigDecimal.round(
					BigDecimal.fromNumberUnsafe(
						Math.max(0, slip.employee_statutory + statutoryOf('CONTRIBUTION'))
					),
					{ scale: 12, mode: 'half-ceil' }
				)
			),
			tax_withheld: BigDecimal.toNumberUnsafe(
				BigDecimal.round(
					BigDecimal.fromNumberUnsafe(Math.max(0, slip.tax_withheld + statutoryOf('TAX'))),
					{ scale: 12, mode: 'half-ceil' }
				)
			),
			breakdown: {
				...slip.breakdown,
				lines: [...slip.breakdown.lines, ...recovery, ...extra],
				carried: records.get(slip.employee_id) ?? []
			}
		};
	});
	const done = new Set(payslips.map((slip) => slip.employee_id));
	return {
		payslips,
		attaches,
		// a row is taken only when its person is on this run's payslips and its period was worked out: nobody else
		// carries it, and one this run could not reach waits on
		taken: open
			.filter(
				(row) =>
					people.includes(String(row.employee_id)) &&
					done.has(String(row.employee_id)) &&
					(again.get(String(row.employee_id)) ?? []).some(
						(period) => period.key === `${String(row.pay_group_id)}/${String(row.period)}`
					)
			)
			.map((row) => String(row.id)),
		deferred,
		waiting
	} satisfies Amended;
});
