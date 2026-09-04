import { defineCommandHandler, refuse } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import type { Api } from './$types.js';
import { monthBounds } from '../lib/period.js';
import {
	buildRosterMaterialization,
	employmentTouchesRosterMonth,
	formatRosterMaterializationRefusal,
	referencedRosterCodeIds,
	ROSTER_MATERIALIZATION_QUERY_LIMIT
} from '../lib/scheduling/roster-materialization.js';

/**
 * Maximum authored reads on the creation path: roster, company, employments, terms, person-days,
 * roster codes, then the created roster. The count is independent of employee/day cardinality.
 */
export const OPEN_ROSTER_AUTHORED_QUERY_CEILING = 7;

const OpenRosterMonthInput = Schema.Struct({
	company_id: Schema.String.check(Schema.isUUID()),
	month: Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/))
});

function requireCompletePage(rows: readonly unknown[], label: string, month: string): void {
	if (rows.length < ROSTER_MATERIALIZATION_QUERY_LIMIT) return;
	refuse(
		`Cannot open ${month}: the ${label} read reached its ${ROSTER_MATERIALIZATION_QUERY_LIMIT.toLocaleString()}-row safety ceiling.`
	);
}

const openRosterMonth = Effect.fn('OpenRosterMonth.open')(function* (
	input: Schema.Schema.Type<typeof OpenRosterMonthInput>,
	api: Api
) {
	const existing = yield* api.db.rosters.findFirst({
		where: { company_id: { eq: input.company_id }, month: { eq: input.month } },
		columns: { id: true, company_id: true, month: true, published_at: true }
	});
	if (existing != null) {
		return {
			state: 'existing' as const,
			roster_id: existing.id,
			company_id: existing.company_id,
			month: existing.month,
			published_at: existing.published_at,
			created_count: 0,
			updated_count: 0,
			preserved_explicit_plan_count: 0,
			materialized_attendance_only_count: 0
		};
	}

	const company = yield* api.db.companies.findFirst({
		where: { id: { eq: input.company_id } },
		columns: { id: true, name: true }
	});
	if (company == null) refuse(`Cannot open ${input.month}: the selected company was not found.`);

	const employments = yield* api.db.employments.findMany({
		where: { company_id: { eq: company.id } },
		columns: {
			id: true,
			company_id: true,
			employee_number: true,
			effective_range: true
		},
		limit: ROSTER_MATERIALIZATION_QUERY_LIMIT
	});
	requireCompletePage(employments, 'employment', input.month);
	const activeEmployments = employments.filter((employment) =>
		employmentTouchesRosterMonth(employment, input.month)
	);
	const activeEmploymentIds = activeEmployments.map((employment) => employment.id);
	const { start, end } = monthBounds(input.month);

	const [terms, workDays] =
		activeEmploymentIds.length === 0
			? ([[], []] as const)
			: yield* Effect.all(
					[
						api.db.employment_terms.findMany({
							where: { employment_id: { in: activeEmploymentIds } },
							columns: {
								id: true,
								employment_id: true,
								work_pattern: true,
								effective_range: true
							},
							limit: ROSTER_MATERIALIZATION_QUERY_LIMIT
						}),
						api.db.work_days.findMany({
							where: {
								employment_id: { in: activeEmploymentIds },
								work_date: { gte: start, lte: end }
							},
							columns: {
								id: true,
								employment_id: true,
								work_date: true,
								shift_definition_id: true,
								roster_id: true
							},
							limit: ROSTER_MATERIALIZATION_QUERY_LIMIT
						})
					],
					{ concurrency: 'unbounded' }
				);
	requireCompletePage(terms, 'employment-term', input.month);
	requireCompletePage(workDays, 'person-day', input.month);

	const rosterCodeIds = referencedRosterCodeIds(terms, workDays);
	if (rosterCodeIds.length >= ROSTER_MATERIALIZATION_QUERY_LIMIT) {
		refuse(
			`Cannot open ${input.month}: its work patterns reference too many roster codes to validate in one bounded read.`
		);
	}
	const rosterCodes =
		rosterCodeIds.length === 0
			? []
			: yield* api.db.shift_definitions.findMany({
					where: { id: { in: rosterCodeIds } },
					columns: {
						id: true,
						company_id: true,
						code: true,
						variant: true,
						effective_range: true
					},
					limit: ROSTER_MATERIALIZATION_QUERY_LIMIT
				});
	requireCompletePage(rosterCodes, 'roster-code', input.month);

	const plan = buildRosterMaterialization({
		company_id: company.id,
		month: input.month,
		employments,
		terms,
		roster_codes: rosterCodes,
		work_days: workDays
	});
	if (plan.kind === 'refused') {
		refuse(formatRosterMaterializationRefusal(company.name, input.month, plan.diagnostics));
	}

	// One authored graph mutation is the commit boundary. Existing children are named by id so the
	// generic relationship engine can claim a null roster owner without rewriting actual attendance.
	yield* api.db.rosters.mutate([
		{
			company_id: company.id,
			month: input.month,
			published_at: null,
			work_day_roster: plan.work_day_roster
		}
	]);

	const created = yield* api.db.rosters.findFirst({
		where: { company_id: { eq: company.id }, month: { eq: input.month } },
		columns: { id: true, company_id: true, month: true, published_at: true }
	});
	if (created == null) {
		return yield* Effect.fail(
			new Error(`Roster ${input.month} was committed but could not be read back.`)
		);
	}
	return {
		state: 'created' as const,
		roster_id: created.id,
		company_id: created.company_id,
		month: created.month,
		published_at: created.published_at,
		created_count: plan.created_count,
		updated_count: plan.updated_count,
		preserved_explicit_plan_count: plan.preserved_explicit_plan_count,
		materialized_attendance_only_count: plan.materialized_attendance_only_count
	};
});

export default defineCommandHandler({
	description:
		'Atomically opens one company month for planning by validating and materializing its complete active employee-date roster from effective work patterns and explicit assignments.',
	schema: OpenRosterMonthInput,
	handler: openRosterMonth
});
