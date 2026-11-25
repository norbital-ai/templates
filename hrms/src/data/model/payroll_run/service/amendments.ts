import type { CarriedWrites, WriteCtx } from '@norbital-ai/bolt';
import { DateTime, Effect, Predicate } from 'effect';
import { isJsonObject, Refusal, type JsonObject } from '../../../../lib/foundation.js';
import { attendanceOf } from './pay_cycle.js';
import { idOf, idsOf, objectValue, queryRows, type Reader } from '../../../../lib/reads.js';

/**
 * No write reaches a paid period's inputs without its amendment row in the same write. A model the run reads says
 * what its write touches, and this returns the rows that write carries: one for each person and paid period touched
 * that has no open row yet. A write held for approval carries them in the approving decision, as it does its postings.
 */

/** What a write touches: one person, by a stint of theirs or by themself, from a day to a day. */
export interface Touched {
	readonly employment?: string;
	readonly employee?: string;
	readonly from: string;
	/** The one day `from` when left out; `null` is everything from `from` on. */
	readonly to?: string | null;
	/** The run that priced the row, when one did: its period is touched whatever the row's date. */
	readonly run?: unknown;
	/** The date is a placeholder (a cash-out's): only the run that priced the row is touched. */
	readonly undated?: boolean;
	/** Amends a paid period it reaches, and is not held by an unpaid run: that run has not settled anything yet. */
	readonly soft?: boolean;
	/**
	 * Days of a stint or its terms (the person is named by `employee`): a paid period of their pay group that gave them
	 * no payslip is reached too. `groups` names the pay groups of terms the write itself brings.
	 */
	readonly unpaid?: boolean;
	readonly groups?: readonly unknown[];
	/** Priced inside the run's attendance cutoff window (or a leaver's exit day), not full salary coverage. */
	readonly attendance?: boolean;
}

/** A correction reaching more person-periods than this is made by pay group or by year. */
const REACH = 10000;
const TOO_WIDE =
	'This reaches too many paid periods for one save. Correct it by pay group or by year.';

type Rows = NonNullable<NonNullable<CarriedWrites['pay_amendment']>['create']>[number][];

const held = (run: JsonObject) =>
	`Run ${String(run.run_number)} holds this person and is not paid yet. Pay that run or delete it first, then make this change.`;

/** The paid periods these payslips name, with the window each priced. */
const windowsOf = (payslips: readonly JsonObject[], schedules: ReadonlyMap<string, JsonObject>) =>
	payslips.flatMap((slip) => {
		const run = objectValue(slip.payroll_run_id);
		const coverage = objectValue(run.salary_coverage);
		const schedule = schedules.get(String(run.pay_group_id));
		if (typeof coverage.from !== 'string' || typeof coverage.to !== 'string') return [];
		const salary = { from: coverage.from, to: coverage.to };
		// an off-cycle run prices entries, not a window of attendance: it holds its people only while it is unpaid
		const attendance =
			run.kind !== 'ON_CYCLE' || schedule === undefined ? salary : attendanceOf(schedule, salary);
		// a leaver's last run also prices attendance and entries after its cutoff up to their last day
		const last =
			isJsonObject(slip.employment_id) && isJsonObject(slip.employment_id.effective_range)
				? slip.employment_id.effective_range.to
				: null;
		const attendanceTo =
			typeof last === 'string' && last > attendance.to && last <= salary.to ? last : attendance.to;
		return [
			{
				employee: String(slip.employee_id),
				entity: String(slip.entity_id),
				run,
				from: attendance.from < salary.from ? attendance.from : salary.from,
				to: attendance.to > salary.to ? attendance.to : salary.to,
				attendanceFrom: attendance.from,
				attendanceTo
			}
		];
	});

/** A run is finalized paid only once approved: a provisional PAID write still holds its people. */
const finalized = (run: JsonObject) => run.state === 'PAID' && run.$approval == null;

const carried = (
	touched: readonly {
		readonly employee: string;
		/** The company whose day it is: its own payslips only. */
		readonly entity?: string;
		readonly from: string;
		readonly to: string | null;
		readonly run?: unknown;
		readonly undated?: boolean;
		readonly soft?: boolean;
		readonly attendance?: boolean;
	}[],
	windows: ReturnType<typeof windowsOf>,
	open: readonly JsonObject[],
	pendingRuns: ReadonlySet<string> = new Set()
) =>
	Effect.gen(function* () {
		const isFinal = (run: JsonObject) => finalized(run) && !pendingRuns.has(String(run.id));
		const touchedByEmployee = Map.groupBy(touched, (touch) => touch.employee);
		const bounds = (
			window: ReturnType<typeof windowsOf>[number],
			touch: { readonly attendance?: boolean }
		) =>
			touch.attendance === true
				? { from: window.attendanceFrom, to: window.attendanceTo }
				: { from: window.from, to: window.to };
		const reached = (window: ReturnType<typeof windowsOf>[number]) =>
			(touchedByEmployee.get(window.employee) ?? []).some((touch) => {
				const { from: wFrom, to: wTo } = bounds(window, touch);
				return (
					(touch.entity === undefined || touch.entity === window.entity) &&
					((touch.undated !== true &&
						touch.from <= wTo &&
						(touch.to === null || touch.to >= wFrom)) ||
						(touch.run != null && String(touch.run) === String(window.run.id)))
				);
			});
		// nothing of a person moves under a run that is being reviewed: what it priced, or anything before it
		const holding = windows.find(
			(window) =>
				!isFinal(window.run) &&
				(touchedByEmployee.get(window.employee) ?? []).some((touch) => {
					const { to: wTo } = bounds(window, touch);
					return (
						touch.soft !== true &&
						(touch.entity === undefined || touch.entity === window.entity) &&
						(touch.undated === true
							? touch.run != null && String(touch.run) === String(window.run.id)
							: touch.from <= wTo)
					);
				})
		);
		if (holding !== undefined)
			return yield* Effect.fail(new Refusal({ message: held(holding.run) }));
		const has = new Set(
			open.map(
				(row) => `${String(row.employee_id)}/${String(row.pay_group_id)}/${String(row.period)}`
			)
		);
		const rows: Rows = [];
		for (const window of windows) {
			if (window.run.kind !== 'ON_CYCLE' || !isFinal(window.run) || !reached(window)) continue;
			const key = `${window.employee}/${String(window.run.pay_group_id)}/${String(window.run.period)}`;
			if (has.has(key)) continue;
			has.add(key);
			rows.push({
				employee_id: idOf('employee_profile', window.employee),
				pay_group_id: idOf('pay_group', window.run.pay_group_id),
				period: String(window.run.period)
			});
		}
		if (rows.length > REACH) return yield* Effect.fail(new Refusal({ message: TOO_WIDE }));
		return rows.length === 0 ? {} : { pay_amendment: { create: rows } };
	});

const RUN = {
	fields: ['id', 'pay_group_id', 'period', 'kind', 'state', 'salary_coverage', 'run_number']
} as const;
/** A window may open a cycle before its salary period: payslips are read from two months before the earliest day. */
const since = (touched: readonly Touched[]) =>
	DateTime.formatIsoDate(
		DateTime.add(
			DateTime.makeUnsafe(touched.map((touch) => touch.from).toSorted()[0] ?? '9999-12-31'),
			{ days: -62 }
		)
	);
/** And to two months after the latest, unless a day runs on (`null`): a later cycle may attend it. */
const until = (touched: readonly Touched[]) =>
	touched.some((touch) => touch.to === null)
		? null
		: DateTime.formatIsoDate(
				DateTime.add(
					DateTime.makeUnsafe(
						touched
							.map((touch) => touch.to ?? touch.from)
							.toSorted()
							.at(-1) ?? '0001-01-01'
					),
					{ days: 62 }
				)
			);

/** The amendment rows a write on these people carries. */
export const amendmentsFor = Effect.fn('payroll.amendmentsFor')(function* (
	read: Reader,
	touched: readonly Touched[]
) {
	if (touched.length === 0) return {};
	const employments = idsOf(
		'employment',
		touched.flatMap((touch) => (touch.employment === undefined ? [] : [touch.employment]))
	);
	const named = idsOf(
		'employee_profile',
		touched.flatMap((touch) => (touch.employee === undefined ? [] : [touch.employee]))
	);
	const theirs = {
		or: [{ id: { in: named } }, { employment: { some: { id: { in: employments } } } }]
	};
	const sealing = idsOf(
		'payroll_run',
		touched.flatMap((touch) => (touch.run == null ? [] : [touch.run]))
	);
	const unpaid = touched.filter((touch) => touch.unpaid === true && touch.employee !== undefined);
	const known = yield* queryRows(read, {
		employment: {
			where: { id: { in: employments } },
			fields: ['employee_id'],
			limit: 10000
		},
		// root read carries `$approval` so provisional PAID runs are treated as holding, not finalized
		payroll_run: {
			where: {
				salary_coverage: { overlaps: { from: since(touched), to: null } }
			},
			fields: [...RUN.fields, 'entity_id'],
			limit: 10000
		},
		// a stint's days may fall in a period its pay group has paid without the person: the groups their terms name
		...(unpaid.length === 0
			? {}
			: {
					contract_terms: {
						where: { employment_id: { is: { employee_id: { in: named } } } },
						fields: ['pay_group_id'],
						limit: 10000,
						employment_id: { fields: ['employee_id'] }
					}
				}),
		// the paid periods the touched days fall in, any run not yet paid that holds the person from them on, and the runs
		// that priced the touched rows
		payslip: {
			where: {
				employee_id: { is: theirs },
				or: [
					{
						payroll_run_id: {
							is: { salary_coverage: { overlaps: { from: since(touched), to: until(touched) } } }
						}
					},
					{
						payroll_run_id: {
							is: {
								state: { eq: 'UNPAID' },
								salary_coverage: { overlaps: { from: since(touched), to: null } }
							}
						}
					},
					{ payroll_run_id: { in: sealing } }
				]
			},
			fields: ['employee_id', 'entity_id', 'employment_id', 'payroll_run_id'],
			limit: REACH,
			employment_id: { fields: ['effective_range'] },
			payroll_run_id: RUN
		},
		pay_group: { fields: ['payment_schedule'], limit: 200 },
		pay_amendment: {
			where: { payroll_run_id: { is_null: true }, employee_id: { is: theirs } },
			fields: ['employee_id', 'pay_group_id', 'period'],
			limit: 10000
		}
	});
	const employeeOf = new Map(
		(known.employment ?? []).map((row) => [String(row.id), row.employee_id])
	);
	const allRuns = known.payroll_run ?? [];
	const pendingRuns = new Set(
		allRuns.filter((run) => !finalized(run)).map((run) => String(run.id))
	);
	// a run provisionally marked PAID past `until(touched)` still holds its people while approval waits
	const provisionalPaidIds = idsOf(
		'payroll_run',
		allRuns.filter((run) => run.state === 'PAID' && run.$approval != null).map((run) => run.id)
	);
	const extraSlips =
		provisionalPaidIds.length === 0
			? []
			: ((yield* queryRows(read, {
					payslip: {
						where: {
							employee_id: { is: theirs },
							payroll_run_id: { in: provisionalPaidIds }
						},
						fields: ['employee_id', 'entity_id', 'employment_id', 'payroll_run_id'],
						limit: REACH,
						employment_id: { fields: ['effective_range'] },
						payroll_run_id: RUN
					}
				})).payslip ?? []);
	const slips = [
		...new Map(
			[...(known.payslip ?? []), ...extraSlips].map((slip) => [
				`${String(slip.employee_id)}/${String(objectValue(slip.payroll_run_id).id)}`,
				slip
			])
		).values()
	];
	const paid = new Set(
		slips.map((slip) => `${slip.employee_id}/${String(objectValue(slip.payroll_run_id).id)}`)
	);
	const groupsOf = Map.groupBy(
		[
			...(known.contract_terms ?? []).map((row) => ({
				employee: String(objectValue(row.employment_id).employee_id),
				group: String(row.pay_group_id)
			})),
			...unpaid.flatMap((touch) =>
				(touch.groups ?? []).map((group) => ({
					employee: String(touch.employee),
					group: String(group)
				}))
			)
		],
		(row) => row.employee
	);
	const unpaidFrom = unpaid.length === 0 ? '' : since(unpaid);
	const unpaidTo = unpaid.length === 0 ? null : until(unpaid);
	// the periods a group paid without the person stand as payslips that paid nothing
	const missed =
		unpaid.length === 0
			? []
			: [...groupsOf].flatMap(([employee, rows]) =>
					allRuns
						.filter((run) => {
							const cov = objectValue(run.salary_coverage);
							return (
								run.kind === 'ON_CYCLE' &&
								finalized(run) &&
								String(cov.to ?? '') >= unpaidFrom &&
								(unpaidTo === null || String(cov.from ?? '') <= unpaidTo) &&
								rows.some((row) => row.group === run.pay_group_id) &&
								!paid.has(`${employee}/${run.id}`)
							);
						})
						.map((run) => ({
							employee_id: employee,
							entity_id: run.entity_id ?? null,
							payroll_run_id: run
						}))
				);
	return yield* carried(
		touched.flatMap((touch) => {
			const employee = touch.employee ?? employeeOf.get(String(touch.employment));
			return employee === undefined
				? []
				: [
						{
							employee,
							from: touch.from,
							to: touch.to === undefined ? touch.from : touch.to,
							run: touch.run,
							...(touch.undated === true ? { undated: true } : {}),
							...(touch.soft === true ? { soft: true } : {}),
							...(touch.attendance === true ? { attendance: true } : {})
						}
					];
		}),
		windowsOf(
			[...slips, ...missed],
			new Map((known.pay_group ?? []).map((row) => [row.id, objectValue(row.payment_schedule)]))
		),
		known.pay_amendment ?? [],
		pendingRuns
	);
});

/** Everyone whose terms name these shift patterns, from the day each began to follow one: what a pattern's edit touches. */
export const followers = Effect.fn('payroll.followers')(function* (
	read: Reader,
	patterns: readonly unknown[]
) {
	if (patterns.length === 0) return [];
	const { contract_terms: terms = [] } = yield* queryRows(read, {
		contract_terms: {
			where: { shift_pattern_id: { in: idsOf('shift_pattern', patterns) } },
			fields: ['employment_id', 'effective_from'],
			limit: 10000
		}
	});
	return terms.map((row): Touched => ({
		employment: row.employment_id,
		from: row.effective_from,
		to: null,
		attendance: true
	}));
});

/** A company's days: everyone it paid for them, or the one person named. */
export interface Span {
	readonly entity: string;
	readonly from: string;
	readonly to: string | null;
	readonly employee?: string;
}

/** The amendment rows a company-wide correction carries: everyone each company paid for its days. */
export const amendmentsOf = Effect.fn('payroll.amendmentsOf')(function* (
	read: Reader,
	spans: readonly Span[]
) {
	if (spans.length === 0) return {};
	const entities = idsOf(
		'entity',
		spans.map((span) => span.entity)
	);
	const named = spans.every((span) => span.employee !== undefined)
		? idsOf(
				'employee_profile',
				spans.flatMap((span) => (span.employee === undefined ? [] : [span.employee]))
			)
		: null;
	const first = since(spans);
	const last = until(spans);
	const known = yield* queryRows(read, {
		payroll_run: {
			where: {
				entity_id: { in: entities },
				salary_coverage: { overlaps: { from: first, to: null } }
			},
			fields: ['id', 'state'],
			limit: 10000
		},
		payslip: {
			where: {
				entity_id: { in: entities },
				...(named === null ? {} : { employee_id: { in: named } }),
				...(last === null
					? {
							payroll_run_id: {
								is: { salary_coverage: { overlaps: { from: first, to: null } } }
							}
						}
					: {
							or: [
								{
									payroll_run_id: {
										is: { salary_coverage: { overlaps: { from: first, to: last } } }
									}
								},
								{
									payroll_run_id: {
										is: {
											state: { eq: 'UNPAID' },
											salary_coverage: { overlaps: { from: first, to: null } }
										}
									}
								}
							]
						})
			},
			fields: ['employee_id', 'entity_id', 'employment_id', 'payroll_run_id'],
			limit: REACH,
			employment_id: { fields: ['effective_range'] },
			payroll_run_id: RUN
		},
		pay_group: {
			where: { entity_id: { in: entities } },
			fields: ['payment_schedule'],
			limit: 10000
		},
		pay_amendment: {
			where: {
				payroll_run_id: { is_null: true },
				pay_group_id: { is: { entity_id: { in: entities } } },
				...(named === null ? {} : { employee_id: { in: named } })
			},
			fields: ['employee_id', 'pay_group_id', 'period'],
			limit: 10000
		}
	});
	const allRuns = known.payroll_run ?? [];
	const pendingRuns = new Set(
		allRuns.filter((run) => !finalized(run)).map((run) => String(run.id))
	);
	const provisionalPaidIds =
		last === null
			? []
			: idsOf(
					'payroll_run',
					allRuns
						.filter((run) => run.state === 'PAID' && run.$approval != null)
						.map((run) => run.id)
				);
	const extraSlips =
		provisionalPaidIds.length === 0
			? []
			: ((yield* queryRows(read, {
					payslip: {
						where: {
							entity_id: { in: entities },
							...(named === null ? {} : { employee_id: { in: named } }),
							payroll_run_id: { in: provisionalPaidIds }
						},
						fields: ['employee_id', 'entity_id', 'employment_id', 'payroll_run_id'],
						limit: REACH,
						employment_id: { fields: ['effective_range'] },
						payroll_run_id: RUN
					}
				})).payslip ?? []);
	const slips = [
		...new Map(
			[...(known.payslip ?? []), ...extraSlips].map((slip) => [
				`${String(slip.employee_id)}/${String(objectValue(slip.payroll_run_id).id)}`,
				slip
			])
		).values()
	];
	// a full page is one the read could not finish: the correction is too wide for one save
	if (slips.length >= REACH) return yield* Effect.fail(new Refusal({ message: TOO_WIDE }));
	const people = Map.groupBy(slips, (slip) => String(slip.entity_id));
	return yield* carried(
		spans.flatMap((span) =>
			(span.employee === undefined
				? [...new Set((people.get(span.entity) ?? []).map((slip) => slip.employee_id))]
				: [span.employee]
			).map((employee) => ({ employee, entity: span.entity, from: span.from, to: span.to }))
		),
		windowsOf(
			slips,
			new Map((known.pay_group ?? []).map((row) => [row.id, objectValue(row.payment_schedule)]))
		),
		known.pay_amendment ?? [],
		pendingRuns
	);
});

/** The amendment rows of several parts of one write: one row a person and period. */
export const amendmentsIn = (...parts: readonly CarriedWrites[]): CarriedWrites => {
	const rows = new Map(
		parts
			.flatMap((part) => part.pay_amendment?.create ?? [])
			.map((row) => [`${row.employee_id}/${row.pay_group_id}/${row.period}`, row])
	);
	return rows.size === 0 ? {} : { pay_amendment: { create: [...rows.values()] } };
};

/** A check's refusal, said in its own words, refuses the write: the message carries that text. */
export const refusing =
	<M>(ctx: WriteCtx<M>) =>
	<A, E, R>(effect: Effect.Effect<A, E | Refusal, R>) =>
		Effect.catchIf(
			effect,
			(error): error is Refusal => Predicate.isTagged(error, 'Refusal'),
			(error) => ctx.refuse('errors.payroll_refused', { values: { message: error.message } })
		);

/** Whether a paid run answers this filter. What paid periods were worked out on keeps its shape: a change is a new one. */
export const paidUnder = Effect.fn('payroll.paidUnder')(function* (
	read: Reader,
	where: JsonObject
) {
	const { payroll_run: runs = [] } = yield* queryRows(read, {
		payroll_run: {
			where: { ...where, state: { eq: 'PAID' } },
			fields: ['run_number', 'state'],
			limit: 100
		}
	});
	return runs.some((run) => finalized(run));
});

/**
 * Every model a run reads, and what a write to it does when it reaches a paid period. A model the run starts to read
 * is added here with its rule, or the gate test fails: nothing reaches a paid period's inputs unseen.
 *
 * - `amends`: its write carries the amendment rows of the paid periods it touches.
 * - `refuses`: what paid periods were worked out on keeps its shape; a change is a new one.
 * - `none`: read to know who is paid or what a balance holds, never to price a day.
 */
export const RUN_INPUTS = {
	roster_entry: 'amends',
	leave_catalog_entry: 'amends',
	claim_catalog_entry: 'amends',
	adhoc_catalog_entry: 'amends',
	loan_catalog_entry_repayment: 'amends',
	// the person in a company: the stint, what was agreed and what the law is told by date, and their family
	employment: 'amends',
	contract_terms: 'amends',
	statutory_parameters: 'amends',
	dependant: 'amends',
	holiday: 'amends',
	work_event: 'amends',
	// the company: what it changes by date amends what the change reaches; its plain fields price no day, and the law
	// it names stays once a stint or a change is linked
	entity_change: 'amends',
	entity: 'none',
	// the law: a change written, moved or deleted, or put in or out of force by its finding, amends what it reaches
	jurisdiction_change: 'amends',
	jurisdiction: 'refuses',
	pay_group: 'refuses',
	// a shift's hours and a pattern's days carry no date: an edit amends the paid periods of who followed them
	shift_definition: 'amends',
	shift_pattern: 'amends',
	// the person: their date of birth, gender and how their service counts move pay, and amend every period they were
	// paid for
	employee_profile: 'amends',
	// the running totals a payslip posts to: a run reads them, and postings move them. HR's manual row adjusts a
	// balance as it stands from its own date; it asks no paid period to be worked out again
	employee_balance: 'none',
	ledger_entry: 'none',
	// the loan itself: its instalments are what a run deducts, and they amend
	loan_catalog_entry: 'none',
	// sealed by the run that saw it open; it prices nothing
	workplace_case_catalog_entry: 'none'
} as const;
