import { defineQueryHandler } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import { usersById } from '../lib/identity-directory.js';

/** A calendar day as the wire carries one: `YYYY-MM-DD` that names a day which actually exists. */
const calendarDay = Schema.String.check(
	Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/),
	Schema.makeFilter((value: string) => {
		const parsed = new Date(value);
		return (
			(!Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value.slice(0, 10))) ||
			'must name a day that exists'
		);
	})
);

function monthBounds(scheduledFor: string): { start: string; end: string } {
	const monthPrefix = scheduledFor.slice(0, 7);
	const [yearText, monthText] = monthPrefix.split('-');
	const year = Number(yearText);
	const month = Number(monthText);
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return {
		start: `${monthPrefix}-01`,
		end: `${monthPrefix}-${String(lastDay).padStart(2, '0')}`
	};
}

export default defineQueryHandler({
	description:
		"Builds the controller's view of one scheduled day: an assignment card per dispatched job naming the person it went to, a map point per site with the assignments on it, and every suspect assignment in that month.",
	schema: Schema.toStandardSchemaV1(Schema.Struct({ scheduled_for: calendarDay })),
	handler: ({ scheduled_for }, api) =>
		Effect.gen(function* () {
			const jobs = yield* api.db.query.jobs.findMany({
				where: { scheduled_for: { eq: scheduled_for } },
				columns: {
					norbital_id: true,
					site_id: true,
					title: true,
					status: true
				},
				orderBy: { title: 'asc' },
				limit: 1000
			});
			const month = monthBounds(scheduled_for);
			const monthJobs = yield* api.db.query.jobs.findMany({
				where: {
					scheduled_for: { gte: month.start, lte: month.end }
				},
				columns: { norbital_id: true, title: true },
				limit: 1000
			});
			const monthJobById = new Map(monthJobs.map((job) => [job.norbital_id, job.title]));
			const monthSuspectAssignments =
				monthJobById.size === 0
					? []
					: yield* api.db.query.job_assignments.findMany({
							where: {
								job_id: { in: [...monthJobById.keys()] },
								status: { eq: 'suspect' }
							},
							columns: { norbital_id: true, job_id: true },
							limit: 1000
						});
			const month_suspects = monthSuspectAssignments.flatMap((assignment) => {
				const title = monthJobById.get(assignment.job_id);
				return title ? [{ id: assignment.norbital_id, job: title }] : [];
			});

			if (jobs.length === 0) {
				return { assignment_cards: [], assignment_ids: [], map_points: [], month_suspects };
			}

			const assignments = yield* api.db.query.job_assignments.findMany({
				where: { job_id: { in: jobs.map((job) => job.norbital_id) } },
				columns: {
					norbital_id: true,
					job_id: true,
					assignee_user_id: true,
					status: true
				},
				limit: 1000
			});
			if (assignments.length === 0) {
				return { assignment_cards: [], assignment_ids: [], map_points: [], month_suspects };
			}

			const jobById = new Map(jobs.map((job) => [job.norbital_id, job]));
			const assigneeUserIds = [
				...new Set(assignments.map((assignment) => assignment.assignee_user_id))
			];
			const siteIds = [
				...new Set(
					assignments.flatMap((assignment) => {
						const job = jobById.get(assignment.job_id);
						return job ? [job.site_id] : [];
					})
				)
			];
			const [assignees, sites] = yield* Effect.all(
				[
					// The assignee is a person, so the name comes from the identity directory rather than
					// from a workspace collection restating it.
					usersById(api, assigneeUserIds),
					api.db.query.sites.findMany({
						where: { norbital_id: { in: siteIds } },
						columns: { norbital_id: true, name: true, location: true },
						limit: siteIds.length
					})
				],
				{ concurrency: 'unbounded' }
			);
			const assignmentsBySite = new Map<
				string,
				Array<{ id: string; job: string; assignee: string; status: string }>
			>();

			for (const assignment of assignments) {
				const job = jobById.get(assignment.job_id);
				if (!job) continue;
				const siteAssignments = assignmentsBySite.get(job.site_id) ?? [];
				siteAssignments.push({
					id: assignment.norbital_id,
					job: job.title,
					assignee: assignees.get(assignment.assignee_user_id)?.name ?? 'Unknown assignee',
					status: assignment.status ?? 'dispatched'
				});
				assignmentsBySite.set(job.site_id, siteAssignments);
			}

			return {
				assignment_ids: assignments.map((assignment) => assignment.norbital_id),
				month_suspects,
				assignment_cards: assignments.flatMap((assignment) => {
					const job = jobById.get(assignment.job_id);
					return job
						? [
								{
									id: assignment.norbital_id,
									job: job.title,
									assignee: assignees.get(assignment.assignee_user_id)?.name ?? 'Unknown assignee'
								}
							]
						: [];
				}),
				map_points: sites.flatMap((site) => {
					const siteAssignments = assignmentsBySite.get(site.norbital_id) ?? [];
					const geometry = site.location?.geometry;
					if (!geometry || siteAssignments.length === 0) return [];
					return [
						{
							id: site.norbital_id,
							name: site.name,
							label: site.location?.formatted_address ?? site.name,
							latitude: geometry.lat,
							longitude: geometry.lon,
							assignments: siteAssignments
						}
					];
				})
			};
		})
});
