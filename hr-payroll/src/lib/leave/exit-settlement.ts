import { everyField } from '../every-field.js';
import type { AutomationCtx, Id } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { settingsInForce } from '../jurisdiction_settings.js';
import { dateKey } from '../iso-day.js';
import { isEligible, scalarFacts } from '../../lib/payroll/run/eligibility.js';
import { defaultPayPeriod } from '../../lib/payroll/run/period.js';
import { addDays } from '../../lib/payroll/run/dates.js';
import { CATCH_UP_DAYS } from '../scheduled/entries.js';
import { coversDate, readRange } from '../../lib/payroll/run/effective.js';
import { exitFactsMissing, resolveExitFacts } from '../declared-facts.js';
import { plain, plainRows } from '../wire.js';
import { refuse } from '../refuse.js';
import { personAt, readLeaveContext, leavePool, leaveRules, type LeaveContext } from './context.js';
import { leaveExitBalanceAt } from './balance.js';
import { exitEncashments } from './exit-encashment.js';
import { leaveBalanceSummaries } from './summary.js';
import * as Predicate from 'effect/Predicate';

/** What one departure settlement did: `open` and `not_due` raise nothing and are not final. */
export type ExitSettlement = {
	readonly employment_id: string;
	readonly status: 'open' | 'not_due' | 'nothing_to_encash' | 'raised';
	readonly raised: readonly {
		readonly code: string;
		readonly days: number;
		readonly hours?: number;
		readonly reference: string;
	}[];
};

export const exitSettlementOutput = {
	kind: 'object',
	fields: {
		employment_id: { kind: 'text' },
		status: { kind: 'enum', values: ['open', 'not_due', 'nothing_to_encash', 'raised'] },
		raised: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: {
					code: { kind: 'text' },
					days: { kind: 'number' },
					hours: { kind: 'number', optional: true },
					reference: { kind: 'text' }
				}
			}
		}
	}
} as const;

type Ctx = Pick<AutomationCtx, 'read' | 'get' | 'act' | 'progress' | 'now' | 'today' | 'todayIn'>;

/** The version of the leaver's lineage in force on a day. */
function versionOn(context: LeaveContext, employmentId: string, day: string) {
	const employment = context.employments.find((row) => row.id === employmentId);
	const company = context.companies.find((row) => row.id === employment?.company_id);
	return company == null ? null : settingsInForce(context.versions, company.settings_code, day);
}

/**
 * The departure declaration the leaver owes under the law of their last day and has not recorded, as a refusal naming
 * the leaver; null when nothing owed is missing. The contract write refuses it, and a settlement that still meets it
 * (a departure recorded before the check, or a person fact that moved since) refuses by name rather than dropping it.
 */
export function departureFactsMissing(
	context: LeaveContext,
	employmentId: string,
	exitDate: string
): string | null {
	const leaver = context.employments.find((row) => row.id === employmentId);
	const missing = exitFactsMissing(
		versionOn(context, employmentId, exitDate)?.exit_facts ?? [],
		scalarFacts(leaver?.exit_facts),
		personAt(context, employmentId, exitDate)
	);
	if (missing == null) return null;
	// readAll reads the whole row; the leave context's type names only what leave rules read
	const employee: { readonly id: string; readonly name?: string } | undefined =
		context.employees.find((row) => row.id === leaver?.employee_id);
	return `Departure of ${employee?.name ?? employmentId} on ${exitDate}: ${missing}`;
}

/**
 * Settles a departure that is due: the unused encashable leave (held for the HR Manager), the separation payments
 * the version in force on the last day owes, and the exit clearance hold it declares. Each is skipped when it
 * already stands, so a retry never duplicates. A future departure is `not_due`; the contract then records its due
 * day, and the daily catch-up raises it. A settled or deferred outcome is stamped on the contract in its own,
 * non-held write, so a request HR rejected is never raised again.
 */
export async function settleExit(ctx: Ctx, employmentId: string): Promise<ExitSettlement> {
	const stored = await ctx.get('employments', employmentId as Id<'employments'>, {
		select: everyField('employments')
	});
	const row = stored == null ? null : (plain(stored) as typeof stored);
	if (row == null || row.approval_id != null)
		throw new Error(`No employment contract is named ${employmentId}.`);
	// the stint's last day of work; an open contract has not departed
	const end = readRange(row.effective_range)?.end;
	const exit_date = end == null ? null : dateKey(end);
	const today = String(ctx.today);
	const out = (status: ExitSettlement['status'], raised: ExitSettlement['raised'] = []) => ({
		employment_id: employmentId,
		status,
		raised
	});
	if (exit_date == null) return out('open');
	if (row.encashment_raised_at != null) return out('nothing_to_encash');
	await ctx.progress({ ratio: 0.2, text: `Reading ${row.employee_number} balances` });
	const context = await readLeaveContext(ctx, [employmentId], {
		start: exit_date,
		end: exit_date
	});
	const version =
		versionOn(context, employmentId, today) ?? versionOn(context, employmentId, exit_date);
	if (version == null) throw new Error('Departure processing requires a sealed settings version.');
	const zone = version.payroll?.timezone;
	if (exit_date > (zone == null ? today : String(ctx.todayIn(zone)))) {
		if (String(row.encashment_due_on) !== exit_date)
			await ctx.act('employments.update', {
				target: row.id,
				set: { encashment_due_on: PlainDate(exit_date) }
			});
		return out('not_due');
	}
	const missing = departureFactsMissing(context, employmentId, exit_date);
	if (missing != null) {
		// kept on the contract for the daily catch-up, which reports it until the facts are recorded
		if (String(row.encashment_due_on) !== exit_date)
			await ctx.act('employments.update', {
				target: row.id,
				set: { encashment_due_on: PlainDate(exit_date) }
			});
		refuse(missing);
	}
	const exitVersion = versionOn(context, employmentId, exit_date);
	const leaver = context.employments.find((e) => e.id === employmentId);
	const person = resolveExitFacts(
		exitVersion?.exit_facts ?? [],
		scalarFacts(leaver?.exit_facts),
		personAt(context, employmentId, exit_date)
	);
	const encashable = new Set<string>();
	const summaries = leaveBalanceSummaries(context, employmentId, exit_date).map((summary) => {
		const catalogue = context.catalogues.find((row) => row.id === summary.catalogue_id);
		if (catalogue == null || !catalogue.can_encash || !catalogue.encash_on_exit) return summary;
		const current = isEligible(catalogue.entitlement.encash_on_exit_when ?? '', person);
		const carryWhen = catalogue.entitlement.encash_carry_on_exit_when;
		if (carryWhen == null) {
			if (current) encashable.add(catalogue.id);
			return summary;
		}
		const carried = isEligible(carryWhen, person);
		if (!current && !carried) return summary;
		const rules = leaveRules(context, employmentId, catalogue.id);
		const balance = leaveExitBalanceAt({
			entries: leavePool(context, employmentId, rules).asPool,
			window: summary.window,
			date: exit_date,
			entitlementAt: rules.entitlementAt,
			carryFrom: rules.carryFrom,
			pool: catalogue.code
		});
		if (current && !carried && balance.carried > 0)
			refuse(
				`${catalogue.code} cannot settle current-year leave ahead of ineligible carried credit.`
			);
		encashable.add(catalogue.id);
		return {
			...summary,
			available: (current ? balance.current : 0) + (carried ? balance.carried : 0)
		};
	});
	const submissions = exitEncashments({
		employmentId,
		exitDate: exit_date,
		summaries,
		encashable,
		posted: new Set(
			context.entries.flatMap((e) => (e.employment_id === employmentId ? [e.reference] : []))
		),
		reason: `Unused leave on departure ${exit_date}; review statutory entitlement and any forfeiture before approval.`
	});
	const separation =
		exitVersion == null
			? []
			: await separationPayments(ctx, context, employmentId, exit_date, exitVersion.id, person);
	const clearance = exitVersion?.payroll?.tax_clearance ?? null;
	const awareness = scalarFacts(leaver?.exit_facts).clearance_awareness_on;
	const holdStart =
		clearance?.category === 'TAX_CLEARANCE' && Predicate.isString(awareness)
			? dateKey(awareness) || exit_date
			: exit_date;
	const hold =
		clearance == null || !isEligible(clearance.when, person)
			? null
			: (
						await ctx.read('payment_holds', {
							where: {
								employment_id: { eq: employmentId as Id<'employments'> },
								category: { eq: clearance.category },
								held_on: { eq: PlainDate(holdStart) }
							},
							limit: 1
						})
				  ).rows.length > 0
				? null
				: {
						employment_id: employmentId,
						category: clearance.category,
						directive_reference: `${clearance.reference_label} pending`,
						held_on: holdStart
					};
	const stamp = () =>
		ctx.act('employments.update', {
			target: row.id,
			set: { encashment_raised_at: ctx.now }
		});
	if (submissions.length === 0 && separation.length === 0 && hold == null) {
		await stamp();
		return out('nothing_to_encash');
	}
	await ctx.progress({
		ratio: 0.6,
		text: `Raising ${submissions.length} encashment(s), ${separation.length} separation payment(s)`
	});
	if (submissions.length > 0) await ctx.act('leave_entries.create', submissions as never);
	if (separation.length > 0) await ctx.act('adhoc_requests.create', separation as never);
	if (hold != null) await ctx.act('payment_holds.create', hold as never);
	await stamp();
	return out('raised', [
		...submissions.map((s) => ({
			code: context.catalogues.find((c) => c.id === s.catalogue_id)?.code ?? s.catalogue_id,
			days: s.encash_days ?? 0,
			...(s.encash_hours == null ? {} : { hours: s.encash_hours }),
			reference: s.reference
		})),
		...separation.map((s) => ({ code: s.reason, days: 0, reference: s.reason })),
		...(hold == null ? [] : [{ code: hold.category, days: 0, reference: hold.directive_reference }])
	]);
}

/**
 * The separation payments the version owes this leaver: each eligible `SEPARATION` class not already raised in the
 * departure's calendar year. An annual class (PH 13th month, ID THR) raised in an earlier year does not settle this one.
 *
 * Nor is one raised where its scheduled sibling — the `SCHEDULED` class of the version pricing the same bands (PH
 * THIRTEENTH_MONTH_PAY_YEAR_END, ID THR_HOLIDAY) — already stands, raised or paid, for the occurrence the departure
 * falls in: its raise window had opened by the last day (`due - raise_days_before <= exit`), the last day is within
 * the catch-up (`exit <= due + CATCH_UP_DAYS`), and the occurrence is the departure's own year or still ahead of it.
 * A held sibling is priced whole at the final pay over the year earned, so nothing is left to true up.
 */
async function separationPayments(
	ctx: Ctx,
	context: LeaveContext,
	employmentId: string,
	exitDate: string,
	versionId: string,
	person: Parameters<typeof isEligible>[1]
) {
	const employment = context.employments.find((row) => row.id === employmentId);
	const company = context.companies.find((row) => row.id === employment?.company_id);
	if (company == null) return [];
	const lineage = context.versions.flatMap((row) =>
		row.code === company.settings_code ? [row.id as Id<'jurisdiction_settings'>] : []
	);
	const [catalogue, scheduled, standing] = await Promise.all([
		ctx.read('adhoc_catalogue', {
			where: {
				settings_id: { eq: versionId as Id<'jurisdiction_settings'> },
				raised_by: { eq: 'SEPARATION' }
			},
			select: { code: true, eligibility: true, bands: true },
			all: true
		}),
		ctx.read('adhoc_catalogue', {
			where: { settings_id: { in: lineage }, raised_by: { eq: 'SCHEDULED' } },
			select: { settings_id: true, code: true, bands: true, raised_by: true, schedule: true },
			all: true
		}),
		ctx.read('adhoc_requests', {
			where: { employment_id: { eq: employmentId as Id<'employments'> } },
			select: { catalogue_id: true, event_date: true },
			all: true
		})
	]);
	type Scheduled = {
		readonly id: string;
		readonly settings_id: string;
		readonly code: string;
		readonly bands?: unknown;
		readonly raised_by?: string;
		readonly schedule?: { readonly raise_days_before?: number | null } | null;
	};
	const siblings = plainRows<Scheduled>(scheduled).filter(
		(row) => row.raised_by === 'SCHEDULED' && row.schedule != null
	);
	const year = exitDate.slice(0, 4);
	// ponytail: a sibling already paid by an earlier payslip also settles the class, so a PH leaver's basic
	// earned between that payslip and the last day gets no 1/12 true-up (PD 851 ¶6). Paying the difference
	// needs the SEPARATION band to subtract `year.earned.<sibling code>`; that is a law-data change.
	/** A sibling of the version pricing `bands` already stands for the occurrence the departure falls in. */
	const settledBySibling = (bands: unknown) => {
		const priced = JSON.stringify(bands ?? null);
		const codes = new Map(
			siblings.flatMap((row) =>
				row.settings_id === versionId && JSON.stringify(row.bands ?? null) === priced
					? [[row.code, row.schedule?.raise_days_before ?? 0] as const]
					: []
			)
		);
		const ids = new Map(
			siblings.flatMap((row) => (codes.has(row.code) ? [[row.id, row.code] as const] : []))
		);
		return standing.rows.some((s) => {
			const code = ids.get(String(s.catalogue_id));
			if (code == null) return false;
			const due = dateKey(String(s.event_date));
			return (
				addDays(due, -codes.get(code)!) <= exitDate &&
				exitDate <= addDays(due, CATCH_UP_DAYS) &&
				(due.slice(0, 4) === year || exitDate <= due)
			);
		});
	};
	// The final period: the one the last day's own salary month settles in, in the grammar the leaver is paid in.
	const terms = context.terms.find(
		(row) => row.employment_id === employmentId && coversDate(row.effective_range, exitDate)
	);
	const pay_period = defaultPayPeriod(exitDate, 1, {
		company,
		payFrequency: terms?.pay_frequency ?? company.pay_frequency
	});
	return plainRows<{ id: string; code: string; eligibility: string; bands?: unknown }>(
		catalogue
	).flatMap((row) =>
		standing.rows.some(
			(s) => s.catalogue_id === row.id && dateKey(String(s.event_date)).slice(0, 4) === year
		) ||
		settledBySibling(row.bands) ||
		!isEligible(row.eligibility, person)
			? []
			: [
					{
						employment_id: employmentId,
						catalogue_id: row.id,
						amount: 0,
						event_date: exitDate,
						pay_period,
						reason: `${row.code} on departure ${exitDate}; raised for HR review.`,
						as_adjustment_entry: false
					}
				]
	);
}
