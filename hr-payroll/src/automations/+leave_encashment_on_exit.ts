import { defineAutomation, refuse, type AutomationApi } from '@norbital-ai/bolt/authoring';
import { Clock, Effect, Schema } from 'effect';
import { stint } from '../lib/employment-contract.js';
import { personAt, readLeaveContext, type LeaveContext } from '../lib/leave/context.js';
import { settingsInForce } from '../lib/jurisdiction_settings.js';
import { isEligible } from '../collections/payroll_runs/lib/eligibility.js';
import { defaultPayPeriod } from '../collections/payroll_runs/lib/period.js';
import { coversDate } from '../collections/payroll_runs/lib/effective.js';
import { exitEncashments } from '../lib/leave/exit-encashment.js';
import { leaveBalanceSummaries } from '../lib/leave/summary.js';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../lib/iso-day.js';
import { resolveExitFacts } from '../lib/declared-facts.js';

export const OutputSchema = Schema.Struct({
	employment_id: Schema.String,
	status: Schema.Literals(['open', 'not_due', 'nothing_to_encash', 'raised']),
	/** The entries this run raised, awaiting the HR Manager's decision. */
	raised: Schema.Array(
		Schema.Struct({ code: Schema.String, days: Schema.Number, reference: Schema.String })
	)
});

/**
 * Defers future departures; due departures raise held requests from the final-day balance.
 * The contract/leave reference prevents duplicates. HR reviews entitlement and any lawful
 * forfeiture; valuation and payment timing remain separate payroll requirements.
 */
export const runLeaveEncashmentOnExit = (api: AutomationApi, employmentId: string, now?: Date) =>
	Effect.gen(function* () {
		const employment = yield* api.db.employments.findFirst({
			where: { id: { eq: employmentId }, approval_id: { isNull: true } },
			columns: { id: true, employee_number: true, effective_range: true, exit_reason: true }
		});
		if (employment == null) refuse(`No employment contract is named ${employmentId}.`);
		const { exit_date } = stint(employment);
		if (exit_date == null || exit_date.startsWith('9999-'))
			return { employment_id: employmentId, status: 'open' as const, raised: [] };
		yield* api.progress({ progress: 0.2, text: `Reading ${employment.employee_number} balances` });
		const context = yield* readLeaveContext(api, [employmentId]);
		const company = context.companies.find(
			(row) => row.id === context.employments.find((row) => row.id === employmentId)?.company_id
		);
		const instant = now ?? new Date(yield* Clock.currentTimeMillis);
		const version =
			company == null
				? null
				: (settingsInForce(
						context.versions,
						company.settings_code,
						calendarDateInTimeZone(instant, PAYROLL_TIME_ZONE)
					) ?? settingsInForce(context.versions, company.settings_code, exit_date));
		if (version == null) refuse('Departure processing requires a sealed settings version.');
		const today = calendarDateInTimeZone(instant, version.payroll.timezone);
		if (exit_date > today)
			return { employment_id: employmentId, status: 'not_due' as const, raised: [] };
		const submissions = exitEncashments({
			employmentId,
			exitDate: exit_date,
			summaries: leaveBalanceSummaries(context, employmentId, exit_date),
			encashable: new Set(
				context.catalogues.flatMap((row) => (row.can_encash && row.encash_on_exit ? [row.id] : []))
			),
			posted: new Set(
				context.entries.flatMap((row) =>
					row.employment_id === employmentId ? [row.reference] : []
				)
			),
			reason: `Unused leave on departure ${exit_date}; review statutory entitlement and any forfeiture before approval.`
		});
		// The payments the law owes on separation: every `SEPARATION` ad hoc class of the version
		// in force on the last day whose eligibility holds over the leaver then, raised as one
		// request for that day (its band prices the amount from the person), unless a request of
		// that class already stands.
		const separation = yield* separationPayments(api, context, employmentId, exit_date);
		if (submissions.length === 0 && separation.length === 0)
			return { employment_id: employmentId, status: 'nothing_to_encash' as const, raised: [] };
		yield* api.progress({
			progress: 0.6,
			text: `Raising ${submissions.length} encashment(s), ${separation.length} separation payment(s)`
		});
		const rows =
			submissions.length === 0 ? [] : yield* api.collection.leave_entries.createMany(submissions);
		if (separation.length > 0) yield* api.collection.adhoc_requests.createMany(separation);
		return {
			employment_id: employmentId,
			status: 'raised' as const,
			raised: [
				...rows.map((row) => ({
					code: row.leave_code,
					days: row.encash_days ?? 0,
					reference: row.reference
				})),
				...separation.map((row) => ({ code: row.reason, days: 0, reference: row.reason }))
			]
		};
	});

/** The separation payments the version owes this leaver, as ad hoc requests to create. */
const separationPayments = (
	api: AutomationApi,
	context: LeaveContext,
	employmentId: string,
	exitDate: string
) =>
	Effect.gen(function* () {
		const employment = context.employments.find((row) => row.id === employmentId);
		const company = context.companies.find((row) => row.id === employment?.company_id);
		if (employment == null || company == null) return [];
		const version = settingsInForce(context.versions, company.settings_code, exitDate);
		if (version == null) return [];
		const [catalogue, standing] = yield* Effect.all([
			api.db.adhoc_catalogue.findMany({
				where: { settings_id: { eq: version.id }, raised_by: { eq: 'SEPARATION' } },
				columns: { id: true, code: true, eligibility: true },
				limit: 200
			}),
			api.db.adhoc_requests.findMany({
				where: { employment_id: { eq: employmentId } },
				columns: { catalogue_id: true, event_date: true },
				limit: 2000
			})
		]);
		if (catalogue.length === 0) return [];
		// The final period: the one the last day's own salary month settles in (a cutoff of the
		// 1st is the month itself), in the grammar the leaver is paid in — not the cutoff's
		// answer, which would carry a month-end leaver's separation pay into the next month.
		const terms = context.terms.find(
			(row) => row.employment_id === employmentId && coversDate(row.effective_range, exitDate)
		);
		const payPeriod = defaultPayPeriod(exitDate, 1, {
			company,
			payFrequency: terms?.pay_frequency ?? company.pay_frequency
		});
		const person = resolveExitFacts(
			version.exit_facts ?? [],
			employment.exit_facts ?? {},
			personAt(context, employmentId, exitDate)
		);
		return catalogue.flatMap((row) => {
			if (standing.some((existing) => existing.catalogue_id === row.id)) return [];
			if (!isEligible(row.eligibility, person)) return [];
			return [
				{
					employment_id: employmentId,
					catalogue_id: row.id,
					amount: 0,
					event_date: exitDate,
					pay_period: payPeriod,
					reason: `${row.code} on departure ${exitDate}; raised for HR review.`,
					evidence_file: null,
					as_adjustment_entry: false
				}
			];
		});
	});

export default defineAutomation(
	{ trigger: { collection: 'employments', event: 'updated' } },
	{
		input: Schema.Struct({
			/** The contract to settle, when started by hand; the changed contract otherwise. */
			employment_id: Schema.optional(Schema.String)
		}),
		output: OutputSchema,
		policies: ['leave_encashment_on_exit_automation'],
		description:
			'On or after departure, submits unused leave encashment and eligible separation payments for HR approval. Future departures are deferred to the daily check. Dismissals require review; the departure reason alone does not establish forfeiture. Existing requests are skipped on retry.',
		handler: (api, { args, scope }) =>
			runLeaveEncashmentOnExit(api, args.employment_id ?? scope.incoming_record.id)
	}
);
