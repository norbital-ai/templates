import { Effect, Result } from 'effect';
import { automation, type Id } from '@norbital-ai/bolt';

const SERVER_IFC_MAX_BYTES = 4 * 1024 * 1024;

export default automation({
	description:
		'Daily end-of-day BIM costing sweep: finds projects with a dirty/updated BIM file, missing cost estimate, or voided estimate, schedules server-side AI costing for models up to 4 MiB, and notifies commercial/delivery teams for oversized models requiring browser multi-angle takeoff.',
	on: [{ cron: '0 22 * * *', rest: '24h' }],
	output: {
		kind: 'object',
		fields: {
			checked_projects: { kind: 'int' },
			scheduled_count: { kind: 'int' },
			browser_required_count: { kind: 'int' },
			project_ids: { kind: 'ref', to: 'projects', many: true }
		}
	},
	policies: ['construction_automation'],
	concurrency: { max: 1 },
	run: function* (_input, ctx) {
		const loaded = yield* ctx.query({
			projects: {
				where: {
					bim_file: { is_null: false },
					status: { in: ['tendering', 'active', 'on_hold', 'defects_liability'] }
				},
				fields: ['project_number', 'project_name', 'bim_file', 'bim_version', 'bim_costing_dirty'],
				limit: 500
			},
			cost_estimates: {
				fields: ['project_id', 'status'],
				limit: 500
			}
		});

		const estimateByProject = new Map(
			loaded.cost_estimates.rows.map((est) => [est.project_id, est] as const)
		);

		const scheduledIds: Id<'projects'>[] = [];
		let browserRequiredCount = 0;

		for (const project of loaded.projects.rows) {
			if (project.bim_file == null) continue;
			const est = estimateByProject.get(project.id);
			const needsCosting = project.bim_costing_dirty || est === undefined || est.status === 'void';
			if (!needsCosting) continue;

			const meta = yield* ctx.files.meta(project.bim_file).pipe(
				Effect.map(Result.succeed),
				Effect.catchTags({
					FacilityFailure: (e) => Effect.succeed(Result.fail(e.message)),
					Unavailable: (e) => Effect.succeed(Result.fail(e.reason))
				})
			);

			const label = project.project_number
				? `${project.project_number} · ${project.project_name}`
				: project.project_name;

			if (Result.isSuccess(meta) && meta.success.bytes > SERVER_IFC_MAX_BYTES) {
				browserRequiredCount++;
				yield* ctx.notify({
					to: [
						{ team: 'commercial_qs' },
						{ team: 'project_delivery' },
						{ team: 'construction_administrators' }
					],
					title: `BIM costing pending for ${label}`,
					description: `${project.bim_file.name} exceeds the 4 MiB server stream limit — open BIM Costing in the browser to stream & classify with multi-angle 3D snapshots.`,
					link: { model: 'projects', id: project.id },
					once: `bim-eod-browser:${project.id}:${project.bim_file.id}:${ctx.today}`
				});
				continue;
			}

			yield* ctx.schedule(
				'analyze_bim_file',
				{ project_id: project.id },
				{ at: ctx.now, key: `bim-eod-sweep:${project.id}:${project.bim_file.id}` }
			);
			scheduledIds.push(project.id);
		}

		return {
			checked_projects: loaded.projects.rows.length,
			scheduled_count: scheduledIds.length,
			browser_required_count: browserRequiredCount,
			project_ids: scheduledIds
		};
	}
});
