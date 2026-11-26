import { DateTime, Effect } from 'effect';
import {
	Refusal,
	isJsonObject,
	jsonObject,
	type JsonObject
} from '../../../../../lib/foundation.js';
import { idsOf, objectValue, queryRows, type Reader } from '../../../../../lib/reads.js';
import { accountsOf, eventsOf, totalsScope } from './core.js';
import { validateRegistered, type Operation } from '../../../jurisdiction/service/registrations.js';
import { employmentOn, startsOf, type Parts, type Starts } from '../../service/person.js';
import { lawsAt, lawsWith, type Law } from '../../../jurisdiction/service/law.js';
import { type LeavePerson, type LeaveRow } from './entitlement.js';
import {
	FIELDS,
	LEAVE,
	carry,
	inverted,
	stintsOf,
	stintsRead,
	uniqueIds,
	type Plan
} from './ledger_store.js';
import {
	adhocWanted,
	carriedFor,
	claimLeft,
	claimWanted,
	leaveWanted,
	payslipWanted
} from './posting_plans.js';

export type Family = 'leave' | 'claim';
export const rowOfCatalog = (row: JsonObject): LeaveRow => ({
	code: String(row.code),
	lookup: objectValue(row.lookup)
});
/**
 * The facts a leave row can read about a person, from their employment (`employmentOn`) and their employer as they stand
 * on the day. Its rule reads the starts worked out from the stints as the employment's `service_started_on` and
 * `employment_started_on`.
 */
export const personOf = (
	contract: JsonObject,
	starts: Starts,
	employer?: JsonObject,
	workEvents: readonly JsonObject[] = []
): LeavePerson => {
	const payroll = objectValue(contract.payroll);
	const extension = objectValue(contract.statutory_parameters);
	const facts = Object.fromEntries(
		Object.entries(extension).filter(([key]) => key !== 'statutory')
	);
	const employerExtension = objectValue(employer?.statutory_parameters ?? {});
	return {
		started: starts.service_started_on,
		partTime: contract.engagement === 'PART_TIME',
		gender: typeof payroll.gender === 'string' ? payroll.gender : null,
		maritalStatus: typeof payroll.marital_status === 'string' ? payroll.marital_status : null,
		terms: objectValue(contract.terms),
		facts,
		stateOwned: employerExtension.state_owned === true,
		workEvents,
		employment: { ...contract, ...starts },
		...(employer === undefined ? {} : { employer })
	};
};

export type Entries = 'leave_catalog_entry' | 'claim_catalog_entry' | 'adhoc_catalog_entry';
/**
 * What a batch of entries reads, in two requests: every stint of their people, then those stints' dated rows and
 * dependants, the people's balances, what the batch's entries posted and the laws their companies answer to. A leave
 * batch also reads its stints' open entries and what they posted, the people's leave on the batch's days, and what
 * plans those days. Every check and the posting read it.
 */
export type Known = {
	/** Every stint of the people, by its id. */
	readonly parts: ReadonlyMap<string, Parts>;
	/** The lineage (`settings_code`) of each entity the people's stints name, for their service start. */
	readonly lineage: ReadonlyMap<string, string>;
	/** The people whose service counts every stint (`cumulative_service`). */
	readonly cumulative: ReadonlySet<string>;
	/** The law of a jurisdiction code as it stands on a day. */
	readonly laws: (code: unknown, day: string) => Law | undefined;
	readonly balance: ReadonlyMap<string, JsonObject>;
	readonly entries: readonly JsonObject[];
	readonly posted: readonly JsonObject[];
	readonly captures: ReadonlyMap<string, readonly JsonObject[]>;
	/** What plans the people's days, read for leave alone: holidays, pay groups, shifts, patterns and roster rows. */
	readonly plan: Readonly<Record<string, readonly JsonObject[]>>;
};
export const known = Effect.fn('ledger.known')(function* (
	read: Reader,
	model: Entries,
	entries: readonly JsonObject[]
) {
	const named = idsOf('employment', uniqueIds(entries, 'employment_id'));
	// leave falls only on days the person works: their companies' holidays, shifts and patterns, and their roster rows
	// ponytail: roster rows a month either side of the days asked; a holiday replacing a day further off reads its plan
	const dates = entries
		.flatMap((entry) => (Array.isArray(entry.days) ? entry.days : []))
		.filter(isJsonObject)
		.map((day) => String(day.date ?? day.incurred_on))
		.toSorted();
	const [first, last] = [dates[0], dates.at(-1)];
	const month = (day: string, months: number) =>
		DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(day), { months }));
	const planned = model === LEAVE && first !== undefined && last !== undefined;
	// every stint of the entries' people, with its company's law code; for leave, the open entries of the batch's
	// stints, whose postings say which of them wait for approval
	const { employment: stints, leave_catalog_entry: open } = yield* queryRows(read, {
		employment: {
			where: { employee_id: { is: { employment: { some: { id: { in: named } } } } } },
			fields: ['employee_id', 'entity_id'],
			limit: 10000,
			entity_id: { fields: ['settings_code'] }
		},
		leave_catalog_entry: {
			where: { employment_id: { in: planned ? named : [] }, payroll_run_id: { is_null: true } },
			limit: 10000
		}
	});
	const people = idsOf('employee_profile', uniqueIds(stints, 'employee_id'));
	const companies = idsOf(
		'entity',
		planned
			? stints.map((row) => (isJsonObject(row.entity_id) ? row.entity_id.id : row.entity_id))
			: []
	);
	const sources = [...entries, ...open].map((row) => `${model}:${String(row.id)}`);
	// the people's leave on the batch's days, from its first to its last: what a half-day may collide with
	const sameDays = { incurred_on: { gte: first ?? '1970-01-01', lte: last ?? '1970-01-01' } };
	const codes = stints.flatMap((row) =>
		isJsonObject(row.entity_id) ? [row.entity_id.settings_code] : []
	);
	const { got: own, laws } = yield* lawsWith(read, codes, (law) =>
		queryRows(read, {
			...stintsRead(people),
			...law,
			employee_balance: {
				where: { employee_id: { in: people } },
				fields: ['employee_id', 'account', 'revision'],
				limit: 10000
			},
			// what those entries posted, by their own sources: never the person's history. `in` takes 1,000 values
			ledger_entry: {
				where: {
					or: Array.from({ length: Math.max(1, Math.ceil(sources.length / 1000)) }, (_, at) => ({
						source: { in: sources.slice(at * 1000, (at + 1) * 1000) }
					}))
				},
				fields: FIELDS,
				limit: 10000
			},
			leave_catalog_entry: {
				where: {
					employment_id: { is: { employee_id: { in: planned ? people : [] } } },
					leave_catalog_entry_day: { some: sameDays }
				},
				limit: 10000
			},
			// every slot of the batch's own and the open entries; the people's other slots only on the batch's days
			leave_catalog_entry_day: {
				where: {
					or: [
						{
							leave_entry_id: {
								in: idsOf('leave_catalog_entry', planned ? uniqueIds(entries, 'id') : [])
							}
						},
						{
							leave_entry_id: {
								is: {
									employment_id: { in: planned ? named : [] },
									payroll_run_id: { is_null: true }
								}
							}
						},
						{
							...sameDays,
							leave_entry_id: {
								is: { employment_id: { is: { employee_id: { in: planned ? people : [] } } } }
							}
						}
					]
				},
				fields: ['leave_entry_id', 'incurred_on', 'part', 'payroll_run_id'],
				limit: 10000
			},
			roster_entry: {
				where: {
					employment_id: { is: { employee_id: { in: planned ? people : [] } } },
					work_date: {
						gte: month(first ?? '1970-01-01', -1),
						lte: month(last ?? '1970-01-01', 1)
					}
				},
				fields: ['employment_id', 'work_date', 'shift_definition_id'],
				limit: 10000
			},
			holiday: {
				where: { entity_id: { in: companies } },
				fields: ['date', 'published_at', 'employee_id', 'replaces', 'given_to'],
				limit: 10000
			},
			pay_group: {
				where: { entity_id: { in: companies } },
				fields: ['payment_schedule'],
				limit: 1000
			},
			shift_pattern: {
				where: { entity_id: { in: companies } },
				fields: ['pattern', 'effective_range'],
				limit: 1000
			},
			shift_definition: {
				where: { entity_id: { in: companies } },
				fields: ['variant'],
				limit: 1000
			}
		})
	);
	// the stored leave a check judges against: the open entries and those on the batch's days, each once
	const stored = [
		...new Map([...open, ...own.leave_catalog_entry].map((row) => [row.id, row])).values()
	];
	return knownOf(own, stored, own.leave_catalog_entry_day, laws);
});
/**
 * `Known` from rows already read: the people's stints with their dated rows (`stintsRead`'s roots), their balances,
 * ledger rows and plan rows in `found`, their stored `entries` and those entries' slots. A page builds it from its own
 * queries, so the checks below judge there exactly as they do before the write.
 */
export const knownOf = (
	found: Readonly<Record<string, readonly JsonObject[] | undefined>>,
	entries: readonly JsonObject[],
	captures: readonly JsonObject[],
	laws: Known['laws']
): Known => {
	const { parts, lineage, cumulative } = stintsOf(found);
	return {
		parts: new Map(parts.map((held) => [String(held.stint.id), held])),
		lineage,
		cumulative,
		laws,
		balance: new Map((found.employee_balance ?? []).map((row) => [String(row.employee_id), row])),
		entries,
		posted: found.ledger_entry ?? [],
		captures: Map.groupBy(captures, (row) => String(row.leave_entry_id)),
		plan: {
			holiday: found.holiday ?? [],
			pay_group: found.pay_group ?? [],
			shift_pattern: found.shift_pattern ?? [],
			shift_definition: found.shift_definition ?? [],
			roster_entry: found.roster_entry ?? []
		}
	};
};
/**
 * A batch of entries' read (`Known`, two crossings), and with an `operation` its registered rules' validation beside
 * it: both start together, so each crossing carries both, and the slower of the two sets the count.
 */
export const entryRead = (
	read: Reader,
	model: Entries,
	entries: readonly JsonObject[],
	operation?: Operation
) =>
	Effect.all(
		[
			known(read, model, entries),
			operation === undefined ? Effect.void : validateRegistered(read, model, operation, entries)
		],
		{ concurrency: 'unbounded' }
	).pipe(Effect.map(([read]) => read));

/**
 * The law an entry answers to: its company's, in force on the entry's own day. That day is a claim's or an ad hoc
 * entry's `incurred_on` and a leave entry's first slot; an entry with no slot posts nothing under any law.
 */
export const lawOf = (known: Known, entry: JsonObject): Law | undefined => {
	const stint = known.parts.get(String(entry.employment_id))?.stint;
	return stint === undefined
		? undefined
		: known.laws(known.lineage.get(String(stint.entity_id)), dayOf(known, entry));
};
export const dayOf = (known: Known, entry: JsonObject): string =>
	typeof entry.incurred_on === 'string'
		? entry.incurred_on
		: ((Array.isArray(entry.days) ? entry.days : (known.captures.get(String(entry.id)) ?? []))
				.filter(isJsonObject)
				.map((slot) => String(slot.date ?? slot.incurred_on))
				.toSorted()[0] ?? '');

/** What each entry should post, from what its batch read. A record that is gone is not here: its delete inverts it. */
export const entryPlans = (
	known: Known,
	family: Family | 'adhoc',
	model: string,
	entries: readonly JsonObject[]
): readonly Plan[] => {
	if (entries.length === 0) return [];
	const postedBy = Map.groupBy(known.posted, (row) => String(row.source));
	const drew = (source: string) =>
		(postedBy.get(source) ?? [])
			.filter((item) => item.measure === 'used')
			.reduce(
				(total, item) => total + (item.operation === 'DEDUCT' ? -1 : 1) * Number(item.amount ?? 0),
				0
			);
	const inBatch = new Map<string, number>();
	return entries.flatMap((entry) => {
		const own = known.parts.get(String(entry.employment_id));
		const law = lawOf(known, entry);
		const familyRows = law?.rows[`${family}_catalog` as const] ?? [];
		const catalog = familyRows.find((item) => item.code === entry.catalog_code);
		const balance = known.balance.get(String(own?.stint.employee_id));
		if (own === undefined || law === undefined || catalog === undefined || balance === undefined)
			return [];
		const settings = law.settings;
		// the employment as it stands on the entry's own day
		const contract = employmentOn(own, dayOf(known, entry));
		const subject = {
			scope: law.code,
			started: startsOf(
				own.stint,
				[...known.parts.values()].map((held) => held.stint),
				known.lineage,
				known.cumulative.has(String(own.stint.employee_id))
			).service_started_on,
			events: eventsOf(contract),
			taxYearStart: Number(settings.tax_year_start_month ?? 1)
		};
		const row = rowOfCatalog(catalog);
		const rowOf = (code: string) => {
			const found = familyRows.find((item) => item.code === code);
			return found === undefined ? undefined : rowOfCatalog(found);
		};
		// the child slots are the truth: a stored entry carries them in `captures`, a batch's own entry on `days`
		const withSlots = (row: JsonObject) =>
			family === 'leave'
				? jsonObject({
						...row,
						// an entry of this batch states its slots (a slot taken off it is gone); a stored one's are its children
						days: [
							...new Map(
								(Array.isArray(row.days) ? row.days : (known.captures.get(String(row.id)) ?? []))
									.filter(isJsonObject)
									.map((child) => {
										const day = {
											date: String(child.date ?? child.incurred_on),
											part: child.part
										};
										return [`${day.date}/${String(day.part)}`, day] as const;
									})
							).values()
						]
					})
				: row;
		const source = `${model}:${String(entry.id)}`;
		const left = (period: string) => {
			// what this claim already drew stays available to it
			const key = `${String(balance.id)}/${row.code}/${period}`;
			return (
				claimLeft(accountsOf(balance.account), row, period) + drew(source) - (inBatch.get(key) ?? 0)
			);
		};
		const wanted =
			family === 'leave'
				? leaveWanted(
						withSlots(entry),
						row,
						rowOf,
						subject,
						Number(objectValue(contract.terms).normal_hours_per_day ?? 0)
					)
				: family === 'claim'
					? claimWanted(entry, row, subject, left)
					: adhocWanted(entry, row, {
							...subject,
							scope: totalsScope(settings, entry.entity_id)
						});
		if (family === 'claim')
			for (const item of wanted) {
				const key = `${String(balance.id)}/${row.code}/${item.period}`;
				inBatch.set(key, (inBatch.get(key) ?? 0) + item.amount - drew(source));
			}
		return [{ source: `${model}:${String(entry.id)}`, balance_id: String(balance.id), wanted }];
	});
};

const UNOPENED =
	"This person's balance is not open yet. It opens when the ledger sync after their hire finishes; try again then.";

const FAMILY = {
	leave_catalog_entry: 'leave',
	claim_catalog_entry: 'claim',
	adhoc_catalog_entry: 'adhoc'
} as const;

/** What these entries post, as their own write carries it, from what their batch read. */
export const entryPostings = Effect.fn('ledger.entryPostings')(function* (
	known: Known,
	model: Entries,
	entries: readonly JsonObject[]
) {
	// no balance row, no posting: the entry would stand, or be approved, with nothing on the ledger
	const closed = entries.find((entry) => {
		const stint = known.parts.get(String(entry.employment_id))?.stint;
		return stint !== undefined && !known.balance.has(String(stint.employee_id));
	});
	if (closed !== undefined) return yield* Effect.fail(new Refusal({ message: UNOPENED }));
	return carry(entryPlans(known, FAMILY[model], model, entries), known.posted, [
		...known.balance.values()
	]);
});
/** What these entries, deleted, posted: inverted, as their delete carries it. */
export const entriesUndone = (known: Known, model: Entries, entries: readonly JsonObject[]) => {
	const sources = new Set(entries.map((entry) => `${model}:${String(entry.id)}`));
	return inverted(
		known.posted.filter((row) => sources.has(String(row.source))),
		[...known.balance.values()]
	);
};

/**
 * What runs post from their payslips: those a create makes (`payslips`), else the stored ones. A caller that has read
 * the laws passes them (`laws`); otherwise they are one more read.
 */
export const runPostings = Effect.fn('ledger.runPostings')(function* (
	read: Reader,
	runs: readonly {
		readonly id: string;
		readonly pay_date: string;
		readonly payslips?: readonly JsonObject[];
	}[],
	laws?: Known['laws']
) {
	const made = runs.every((run) => run.payslips !== undefined);
	const slips = made
		? runs.flatMap((run) =>
				(run.payslips ?? []).map((slip) => jsonObject({ ...slip, payroll_run_id: run.id }))
			)
		: ((yield* queryRows(read, {
				payslip: {
					where: {
						payroll_run_id: {
							in: idsOf(
								'payroll_run',
								runs.map((run) => run.id)
							)
						}
					},
					fields: ['payroll_run_id', 'employee_id', 'employment_id', 'entity_id', 'breakdown'],
					limit: 10000
				}
			})).payslip ?? []);
	const companies = idsOf('entity', uniqueIds(slips, 'entity_id'));
	const found = yield* queryRows(read, {
		entity: { where: { id: { in: companies } }, fields: ['id', 'settings_code'], limit: 50 },
		employment: {
			where: { id: { in: idsOf('employment', uniqueIds(slips, 'employment_id')) } },
			fields: ['id'],
			limit: 10000
		},
		employee_balance: {
			where: { employee_id: { in: idsOf('employee_profile', uniqueIds(slips, 'employee_id')) } },
			fields: ['employee_id', 'account', 'revision'],
			limit: 10000
		},
		// a run just made has posted nothing: it asks for no source
		ledger_entry: {
			where: { source: { in: made ? [] : runs.map((run) => `payroll_run:${run.id}`) } },
			fields: FIELDS,
			limit: 10000
		}
	});
	const {
		entity: entities,
		employment: stints,
		employee_balance: balances,
		ledger_entry: posted
	} = found;
	const payDate = new Map(runs.map((run) => [run.id, run.pay_date]));
	const stint = new Set(stints.map((row) => String(row.id)));
	const balance = new Map(balances.map((row) => [String(row.employee_id), row.id]));
	// a payslip answers to the law of its company on its run's pay date
	const lawIn =
		laws ??
		(yield* lawsAt(
			read,
			entities.map((row) => row.settings_code)
		));
	const lineage = new Map(entities.map((row) => [String(row.id), row.settings_code]));
	const lawFor = (slip: JsonObject) =>
		lawIn(lineage.get(String(slip.entity_id)), String(payDate.get(String(slip.payroll_run_id))));
	const codesOf = (rows: readonly JsonObject[]) => rows.map((row) => String(row.code));
	// the ledger write boundary: a payslip may only post a code its law declares
	for (const slip of slips) {
		const law = lawFor(slip);
		const codes = new Set(
			codesOf([...(law?.rows.subtotal ?? []), ...(law?.rows.statutory_contribution_catalog ?? [])])
		);
		const leaveCodes = new Set(codesOf(law?.rows.leave_catalog ?? []));
		for (const key of ['checkpoints', 'statutory', 'time_off']) {
			const rows = objectValue(slip.breakdown)[key];
			for (const row of Array.isArray(rows) ? rows : [])
				if (isJsonObject(row) && !(key === 'time_off' ? leaveCodes : codes).has(String(row.code)))
					return yield* Effect.fail(
						new Refusal({
							message: `${String(row.code)}: not a code of the law on this pay date.`
						})
					);
		}
	}
	// a payslip with no balance row would be paid with nothing on the ledger
	if (slips.some((slip) => !balance.has(String(slip.employee_id))))
		return yield* Effect.fail(new Refusal({ message: UNOPENED }));
	const plans = slips.flatMap((slip) => {
		const balance_id = String(balance.get(String(slip.employee_id)));
		const run = String(slip.payroll_run_id);
		const law = lawFor(slip);
		if (law === undefined || !stint.has(String(slip.employment_id))) return [];
		const own = law.settings;
		// the catalog rows own the posting window: a monthly checkpoint or scheme posts to the month as well as the year
		const monthly = (rows: readonly JsonObject[]) =>
			codesOf(rows.filter((row) => row.balance_window === 'MONTH'));
		const byMonth = [
			...monthly(law.rows.subtotal),
			...monthly(law.rows.statutory_contribution_catalog).flatMap((code) => [
				`${code}.employee`,
				`${code}.employer`
			])
		];
		return [
			{
				source: `payroll_run:${run}`,
				balance_id,
				wanted: [
					...payslipWanted(objectValue(slip.breakdown), String(payDate.get(run)), {
						scope: totalsScope(own, slip.entity_id),
						// a payslip posts to calendar windows, which no service start moves
						started: String(payDate.get(run)),
						events: [],
						taxYearStart: Number(own.tax_year_start_month ?? 1),
						byMonth
					}),
					// what it carries for earlier periods posts to those periods, as its breakdown records
					...carriedFor(slip.breakdown).flatMap((entry) => entry.postings)
				]
			}
		];
	});
	return carry(plans, posted, balances);
});
