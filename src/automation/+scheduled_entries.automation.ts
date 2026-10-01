import { automation, type Id } from '@norbital-ai/bolt';
import { dateKey } from '../lib/iso-day.js';
import { governed, settingsInForce } from '../lib/jurisdiction_settings.js';
import { dutyTypesOf, instanceKey, type ObligationInput } from '../lib/obligations/materialise.js';
import { isEligible } from '../lib/payroll/run/eligibility.js';
import { coversDate } from '../lib/payroll/run/effective.js';
import { addDays } from '../lib/payroll/run/dates.js';
import { readAll } from '../lib/reads.js';
import { decodeNumber } from '../lib/wire.js';
import { getErrorMessage } from '../lib/refuse.js';
import type { HolidayRow } from '../lib/holiday-calendar.js';
import { personAt, readLeaveContext, type LeaveContext } from '../lib/leave/context.js';
import { leaveWindowOf } from '../lib/leave/entitlement.js';
import { leaveBalanceSummaries } from '../lib/leave/summary.js';
import type { LeaveSubmission } from '../lib/leave/activity.js';
import {
	dueDays,
	holidaysOf,
	nearestDue,
	personCondition,
	planOccurrences,
	scheduledDuty,
	scheduledInstance,
	scheduledRef,
	type CatalogueSchedule
} from '../lib/scheduled/entries.js';

/**
 * The daily sweep of mandatory payments nobody has to ask for (`raised_by: SCHEDULED` ad hoc classes and leave rows
 * with a year-end `schedule`). For every lineage it raises each occurrence a person is owed as a held pay request,
 * `raise_days_before` its legal due day, and records the occurrence in the obligation ledger with that due day, so an
 * unpaid one reads LATE. The ledger instance is the raise's mark: an occurrence already there is never raised again,
 * and an entry of the class already on file (by hand, or consumed by a payslip) is recorded, never re-raised. It
 * never edits an entry. An open occurrence whose entry a paid payslip settled is fulfilled on the pay day.
 */
const scheduled_entries = automation({
	description:
		'Daily: raises the mandatory payments the catalogues schedule (13th month, religious holiday allowance, leave-year-end conversions) as held pay requests before their legal due day, records each occurrence in the obligation ledger with that due day, and fulfils it once a paid payslip settles it. An occurrence already recorded, or an entry already on file, is never raised again; no entry is edited.',
	on: { cron: '45 1 * * *' },
	output: {
		kind: 'object',
		fields: {
			raised: { kind: 'int' },
			recorded: { kind: 'int' },
			fulfilled: { kind: 'int' },
			failures: { kind: 'list', of: { kind: 'text' } }
		}
	},
	runAs: ['scheduled_entries_automation'],
	concurrency: { max: 1 }
});
export default scheduled_entries;

type Scheduled = {
	readonly id: string;
	readonly settings_id: string;
	readonly code: string;
	readonly schedule?: CatalogueSchedule | null;
};
type Leave = Scheduled & { readonly entitlement: Parameters<typeof leaveWindowOf>[1] };
type Version = {
	readonly id: string;
	readonly code: string;
	readonly sealed_at?: unknown;
	readonly voided_at?: unknown;
	readonly approval_id?: unknown;
	readonly effective_range: unknown;
	readonly duty_types?: unknown;
	readonly payroll?: { readonly currency?: string } | null;
};

const settled = { approval_id: { isNull: true } };

scheduled_entries.run(async (_input, ctx) => {
	const today = dateKey(String(ctx.today));
	const years = [0, -1, 1].map((step) => decodeNumber(today.slice(0, 4)) + step);
	const versions = (
		await readAll<Version>(
			ctx,
			'jurisdiction_settings',
			{ sealed_at: { isNull: false }, voided_at: { isNull: true }, ...settled },
			undefined,
			{
				id: true,
				code: true,
				sealed_at: true,
				voided_at: true,
				approval_id: true,
				effective_range: true,
				duty_types: true,
				payroll: true
			}
		)
	).filter((version) => governed(version.effective_range) != null);
	const versionIds = versions.map((version) => version.id);
	const [adhocRows, leaveRows] = await Promise.all([
		readAll<Scheduled>(ctx, 'adhoc_catalogue', {
			settings_id: { in: versionIds },
			raised_by: { eq: 'SCHEDULED' }
		}),
		readAll<Leave>(ctx, 'leave_catalogue', { settings_id: { in: versionIds }, ...settled })
	]);
	const adhoc = adhocRows.filter((row) => row.schedule != null);
	const leave = leaveRows.filter((row) => row.schedule != null);
	const codeOf = new Map(versions.map((version) => [version.id, version.code]));
	const lineages = new Set([...adhoc, ...leave].map((row) => codeOf.get(row.settings_id)));
	const companies = (
		await readAll<{ readonly id: string; readonly settings_code: string }>(
			ctx,
			'companies',
			settled
		)
	).filter((company) => lineages.has(company.settings_code));
	if (companies.length === 0) return { raised: 0, recorded: 0, fulfilled: 0, failures: [] };
	const companyIds = companies.map((company) => company.id) as Id<'companies'>[];
	const employments = (
		await readAll<{ readonly id: string; readonly effective_range: unknown }>(ctx, 'employments', {
			company_id: { in: companyIds },
			...settled
		})
	).filter((row) => {
		const days = governed(row.effective_range);
		return (
			days != null && days.from <= `${years[2]}-12-31` && (days.to ?? '9999') >= `${years[1]}-01-01`
		);
	});
	const ids = employments.map((row) => row.id) as Id<'employments'>[];
	const [context, holidayRows, requests, ledger] = await Promise.all([
		readLeaveContext(ctx, ids),
		readAll<HolidayRow & { readonly religion?: string | null }>(ctx, 'jurisdiction_holidays', {
			company_id: { in: companyIds },
			published_at: { isNull: false },
			...settled
		}),
		readAll<{
			readonly employment_id: string;
			readonly catalogue_id: string;
			readonly event_date: string;
			readonly payslip_id?: string | null;
		}>(ctx, 'adhoc_requests', { employment_id: { in: ids } }),
		readAll<ObligationInput & { readonly id: string; readonly state: string }>(
			ctx,
			'obligation_instances',
			{ company_id: { in: companyIds }, subject_kind: { eq: 'EMPLOYMENT' } }
		)
	]);
	const existing = new Set(ledger.map(instanceKey));
	// Every revision of a scheduled class across its lineage, so a request under any of them counts.
	const adhocIds = new Map(
		(
			await readAll<{ readonly id: string; readonly code: string }>(ctx, 'adhoc_catalogue', {
				settings_id: { in: versionIds },
				code: { in: [...new Set(adhoc.map((row) => row.code))] }
			})
		).map((row) => [row.id, row.code])
	);

	const failures: string[] = [];
	/** A request to raise, with the ledger instance that marks it once it is written. */
	type Raise<I> = { readonly input: I; readonly instance: ObligationInput | null };
	const raiseAdhoc: Raise<Record<string, unknown>>[] = [];
	const raiseLeave: Raise<LeaveSubmission>[] = [];
	const leaveDue: {
		readonly employmentId: string;
		readonly row: Leave;
		readonly window: { readonly start: string; readonly end: string };
		readonly due: string;
		readonly instance: ObligationInput | null;
	}[] = [];
	const obligations: ObligationInput[] = [];
	const record = (row: ObligationInput | null) => {
		if (row == null) return;
		existing.add(instanceKey(row));
		obligations.push(row);
	};

	for (const employment of context.employments) {
		const company = companies.find((row) => row.id === employment.company_id);
		if (company == null || employment.effective_range == null) continue;
		const lineage = versions.filter((version) => version.code === company.settings_code);
		const start = dateKey(employment.effective_range.start);
		const exit =
			employment.effective_range.end == null ? null : dateKey(employment.effective_range.end);
		const inService = (day: string) => start <= day && (exit == null || day <= exit);
		const clamp = (day: string) => (day < start ? start : exit != null && day > exit ? exit : day);
		const personOn = (day: string) => personAt(context, employment.id, clamp(day));
		const applies = personCondition(personOn);
		const worksiteOn = (day: string) =>
			context.terms.find(
				(row) => row.employment_id === employment.id && coversDate(row.effective_range, day)
			)?.worksite;
		const now = personOn(today);
		const rootsByYear = new Map<number, object>();
		const roots = (year: number) =>
			rootsByYear.get(year) ??
			rootsByYear
				.set(year, {
					...now,
					year: BigInt(year),
					holidays: holidaysOf(holidayRows, company.id, year, worksiteOn, applies)
				})
				.get(year)!;
		const versionOn = (day: string) => settingsInForce(lineage, company.settings_code, day);
		const current = versionOn(clamp(today));

		/** One class of this lineage: its occurrences today, each handed to `act` with its ledger instance. */
		const sweep = <R extends Scheduled>(
			rows: readonly R[],
			dues: (row: R) => readonly string[],
			entryDates: (code: string) => readonly string[],
			/** The day the person must be in service, and in the population, to be owed an occurrence. */
			servedOn: (row: R, due: string) => string,
			act: (row: R, due: string, raising: boolean, instance: ObligationInput | null) => void
		) => {
			for (const row of rows.filter((one) => one.settings_id === current?.id)) {
				const schedule = row.schedule!;
				try {
					const days = dues(row);
					const plan = planOccurrences({
						today,
						dues: days,
						raiseDaysBefore: schedule.raise_days_before ?? 0,
						recorded: (due) =>
							existing.has(
								instanceKey({
									duty_code: schedule.duty,
									subject_kind: 'EMPLOYMENT',
									subject_id: employment.id,
									trigger_ref: scheduledRef(row.code, due)
								})
							),
						entryDates: entryDates(row.code),
						owed: (due) => {
							const day = servedOn(row, due);
							return inService(day) && isEligible(schedule.population, personOn(day));
						}
					});
					for (const { due, raise: raising } of plan) {
						const version = versionOn(due);
						const own = rows.find(
							(one) => one.settings_id === version?.id && one.code === row.code
						);
						const duty = scheduledDuty(dutyTypesOf(version), schedule.duty);
						if (version == null || own == null || duty == null) {
							failures.push(
								`${employment.id} ${row.code} ${due}: the version in force declares no ${row.code} class with duty ${schedule.duty} (subject EMPLOYMENT, trigger SCHEDULED).`
							);
							continue;
						}
						act(
							own,
							due,
							raising,
							scheduledInstance({
								duty,
								settingsId: version.id,
								companyId: company.id,
								employmentId: employment.id,
								code: row.code,
								due,
								today,
								currency: version.payroll?.currency,
								existing
							})
						);
					}
				} catch (error) {
					failures.push(`${employment.id} ${row.code}: ${getErrorMessage(error)}`);
				}
			}
		};

		sweep(
			adhoc,
			(row) => years.flatMap((year) => dueDays(row.schedule!.due, roots(year))).sort(),
			(code) =>
				requests
					.filter(
						(one) => one.employment_id === employment.id && adhocIds.get(one.catalogue_id) === code
					)
					.map((one) => dateKey(one.event_date)),
			(_row, due) => due,
			(row, due, raising, instance) => {
				if (!raising) return record(instance);
				raiseAdhoc.push({
					input: {
						employment_id: employment.id,
						catalogue_id: row.id,
						amount: 0,
						event_date: due,
						reason: `${row.code} due ${due}; raised by its schedule for HR review.`,
						as_adjustment_entry: false
					},
					instance
				});
			}
		);
		// A leave row's occurrences are its leave years ending in the candidate years; each is paid its unused balance.
		const windowsOf = (row: Leave) =>
			years.flatMap((year) => {
				const last = leaveWindowOf(`${year}-12-31`, row.entitlement, start);
				const before = leaveWindowOf(addDays(last.start, -1), row.entitlement, start);
				return [before, last].filter((window) => window.end.startsWith(String(year)));
			});
		const windowByDue = new Map<string, { start: string; end: string }>();
		sweep(
			leave,
			(row) =>
				windowsOf(row)
					.flatMap((window) =>
						dueDays(row.schedule!.due, {
							...roots(decodeNumber(window.end.slice(0, 4))),
							leave_year: window
						}).map((due) => {
							windowByDue.set(`${row.code}:${due}`, window);
							return due;
						})
					)
					.sort(),
			(code) =>
				context.entries.flatMap((one) =>
					one.employment_id === employment.id &&
					one.reference?.startsWith(`scheduled:${employment.id}:${code}:`)
						? [one.reference.slice(-10)]
						: []
				),
			// the balance belongs to whoever served the year to its last day; a leaver's is settled on exit
			(row, due) => windowByDue.get(`${row.code}:${due}`)!.end,
			(row, due, raising, instance) => {
				// a conversion is owed only where the year left a balance, which is read below
				if (raising)
					leaveDue.push({
						employmentId: employment.id,
						row,
						window: windowByDue.get(`${row.code}:${due}`)!,
						due,
						instance
					});
				else record(instance);
			}
		);
	}

	// A leave year's unused balance is read against its own last day, one context per distinct last day.
	for (const [end, group] of Map.groupBy(leaveDue, (item) => item.window.end)) {
		const balances: LeaveContext = await readLeaveContext(
			ctx,
			[...new Set(group.map((item) => item.employmentId))],
			{ start: end, end }
		);
		for (const item of group) {
			const summary = leaveBalanceSummaries(balances, item.employmentId, end).find(
				(one) => one.code === item.row.code
			);
			const available = summary?.available ?? 0;
			if (available <= 0) continue;
			raiseLeave.push({
				instance: item.instance,
				input: {
					employment_id: item.employmentId,
					catalogue_id: item.row.id,
					reference: `scheduled:${item.employmentId}:${item.row.code}:${item.due}`,
					from_date: item.window.start,
					to_date: item.window.end,
					...(summary?.unit === 'HOUR'
						? { encash_hours: available }
						: { days: available, encash_days: available }),
					effective_on: end,
					due_on: item.due,
					reason: `Unused ${item.row.code} of the leave year ending ${end}, payable by ${item.due}; raised by its schedule for HR review.`
				}
			});
		}
	}

	// An open occurrence is fulfilled on the day a paid payslip settled its entry.
	const scheduledCodes = new Set([...adhoc, ...leave].map((row) => row.schedule!.duty));
	const open = ledger.filter((row) => row.state === 'OPEN' && scheduledCodes.has(row.duty_code));
	const settledBy = new Map<string, string>();
	for (const row of open) {
		const [code, due] = [row.trigger_ref.slice(0, -11), row.trigger_ref.slice(-10)];
		const dues = open
			.filter((one) => one.subject_id === row.subject_id && one.trigger_ref.startsWith(`${code}:`))
			.map((one) => one.trigger_ref.slice(-10));
		const slip =
			requests.find(
				(one) =>
					one.employment_id === row.subject_id &&
					adhocIds.get(one.catalogue_id) === code &&
					one.payslip_id != null &&
					nearestDue(dues, dateKey(one.event_date)) === due
			)?.payslip_id ??
			context.entries.find((one) => one.reference === `scheduled:${row.subject_id}:${code}:${due}`)
				?.payslip_id;
		if (slip != null) settledBy.set(row.id, slip);
	}
	const paid = new Map(
		(
			await readAll<{ readonly id: string; readonly paid_at?: string | null }>(ctx, 'payslips', {
				id: { in: [...new Set(settledBy.values())] }
			})
		).flatMap((slip) => (slip.paid_at == null ? [] : [[slip.id, dateKey(slip.paid_at)] as const]))
	);
	const fulfil = [...settledBy].flatMap(([id, slip]) => {
		const day = paid.get(slip);
		return day == null ? [] : [{ target: id, set: { state: 'FULFILLED', fulfilled_on: day } }];
	});

	/** One write per family; where it is refused, each alone, so a refusal holds back only its own occurrence. */
	const create = async <I>(
		action: 'adhoc_requests.create' | 'leave_entries.create',
		items: readonly Raise<I>[]
	) => {
		if (items.length === 0) return 0;
		try {
			await ctx.act(action, items.map((item) => item.input) as never);
			for (const item of items) record(item.instance);
			return items.length;
		} catch {
			let written = 0;
			for (const item of items)
				try {
					await ctx.act(action, [item.input] as never);
					record(item.instance);
					written += 1;
				} catch (error) {
					failures.push(`${action} ${JSON.stringify(item.input)}: ${getErrorMessage(error)}`);
				}
			return written;
		}
	};
	const raised =
		(await create('adhoc_requests.create', raiseAdhoc)) +
		(await create('leave_entries.create', raiseLeave));
	if (obligations.length > 0) await ctx.act('obligation_instances.create', obligations as never);
	for (const update of fulfil) await ctx.act('obligation_instances.update', update as never);
	await ctx.progress({
		ratio: 1,
		text: `Raised: ${raised}. Recorded: ${obligations.length}. Fulfilled: ${fulfil.length}. Failures: ${failures.length}.`
	});
	return {
		raised,
		recorded: obligations.length,
		fulfilled: fulfil.length,
		failures
	};
});
