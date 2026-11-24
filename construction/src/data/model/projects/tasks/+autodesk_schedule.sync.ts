import { sync } from '@norbital-ai/bolt';
import { Option, Schema } from 'effect';
import { parseScheduleDate } from '../../../../lib/dates.js';

const AccActivitySchema = Schema.Struct({
	id: Schema.optional(Schema.NullOr(Schema.String)),
	externalId: Schema.optional(Schema.NullOr(Schema.String)),
	code: Schema.optional(Schema.NullOr(Schema.String)),
	activityId: Schema.optional(Schema.NullOr(Schema.String)),
	name: Schema.optional(Schema.NullOr(Schema.String)),
	title: Schema.optional(Schema.NullOr(Schema.String)),
	wbsPath: Schema.optional(Schema.NullOr(Schema.String)),
	wbsCode: Schema.optional(Schema.NullOr(Schema.String)),
	plannedStart: Schema.optional(Schema.NullOr(Schema.String)),
	startDate: Schema.optional(Schema.NullOr(Schema.String)),
	plannedFinish: Schema.optional(Schema.NullOr(Schema.String)),
	finishDate: Schema.optional(Schema.NullOr(Schema.String)),
	percentComplete: Schema.optional(Schema.NullOr(Schema.Number)),
	isMilestone: Schema.optional(Schema.NullOr(Schema.Boolean)),
	type: Schema.optional(Schema.NullOr(Schema.String)),
	updatedAt: Schema.optional(Schema.NullOr(Schema.String))
});

const AccScheduleResponseSchema = Schema.Union([
	Schema.Array(AccActivitySchema),
	Schema.Struct({ results: Schema.Array(AccActivitySchema) })
]);

const AccUpdateResponseSchema = Schema.Struct({
	updatedAt: Schema.optional(Schema.NullOr(Schema.String))
});

const decodeSchedule = Schema.decodeUnknownOption(AccScheduleResponseSchema);
const decodeUpdate = Schema.decodeUnknownOption(AccUpdateResponseSchema);

const trimmed = (v: string | null | undefined): string | null => {
	const s = v?.trim();
	return s ? s : null;
};

/**
 * Pulls large-scale programme activities and milestones from Autodesk Construction Cloud (ACC)
 * Schedule API into workspace `tasks`, matched by each project's `autodesk_project_id`.
 */
export default sync('tasks', 'autodesk_schedule', {
	with: 'autodesk_acc',
	policies: ['construction_automation'],
	every: '30min',
	read: function* ({ cursor }, ctx) {
		const { projects } = yield* ctx.query({
			projects: {
				where: { autodesk_project_id: { is_null: false } },
				fields: ['autodesk_project_id'],
				limit: 500
			}
		});
		if (projects.rows.length === 0) {
			return { rows: [], cursor: cursor ?? null };
		}

		const rows = [];
		for (const project of projects.rows) {
			const accProjectId = project.autodesk_project_id ?? ctx.configuration.default_project_id;
			if (!accProjectId) continue;
			const response = yield* ctx.request({
				method: 'GET',
				path: `/construction/schedule/v1/projects/${encodeURIComponent(accProjectId)}/activities`,
				query: cursor ? { updatedSince: String(cursor) } : {},
				output: { kind: 'json' }
			});
			const decoded = decodeSchedule(response);
			if (Option.isNone(decoded)) continue;
			const items = 'results' in decoded.value ? decoded.value.results : decoded.value;
			for (const rec of items) {
				const extId = trimmed(rec.id) ?? trimmed(rec.externalId);
				const code = trimmed(rec.code) ?? trimmed(rec.activityId) ?? extId;
				const title = trimmed(rec.name) ?? trimmed(rec.title);
				if (!code || !title) continue;
				const start = parseScheduleDate(trimmed(rec.plannedStart) ?? trimmed(rec.startDate));
				const finish =
					parseScheduleDate(trimmed(rec.plannedFinish) ?? trimmed(rec.finishDate)) ?? start;
				const rawPct = rec.percentComplete;
				const pct =
					typeof rawPct === 'number' && Number.isFinite(rawPct)
						? String(Math.max(0, Math.min(100, Math.round(rawPct * 10) / 10)))
						: '0';
				const version = trimmed(rec.updatedAt);
				const range = start
					? { from: start, to: finish && finish >= start ? finish : start }
					: null;
				rows.push({
					$id: `${accProjectId}:${extId ?? code}`,
					...(version ? { $version: version } : {}),
					project_id: project.id,
					task_code: code,
					wbs_path: trimmed(rec.wbsPath) ?? trimmed(rec.wbsCode),
					external_id: extId ?? code,
					title,
					is_milestone: rec.isMilestone === true || trimmed(rec.type) === 'milestone',
					schedule_range: range,
					progress_pct: pct
				});
			}
		}

		return { rows, cursor: rows.length > 0 ? ctx.now : (cursor ?? null) };
	},
	write: function* ({ op, row, $id, $version }, ctx) {
		if (op !== 'update' || $id === null) return null;
		const sep = $id.indexOf(':');
		if (sep <= 0) return null;
		const accProjectId = $id.slice(0, sep);
		const activityId = $id.slice(sep + 1);
		if (!accProjectId || !activityId) return null;

		const pct = Number(row.progress_pct);
		const response = yield* ctx.request({
			method: 'PATCH',
			path: `/construction/schedule/v1/projects/${encodeURIComponent(accProjectId)}/activities/${encodeURIComponent(activityId)}`,
			headers: $version ? { 'If-Match': $version } : {},
			body: {
				...(Number.isFinite(pct) ? { percentComplete: pct } : {}),
				...(row.actual_range?.from ? { actualStart: row.actual_range.from } : {}),
				...(row.actual_range?.to ? { actualFinish: row.actual_range.to } : {})
			},
			output: { kind: 'json' }
		});
		const decoded = decodeUpdate(response);
		const nextVersion = Option.isSome(decoded) ? trimmed(decoded.value.updatedAt) : null;
		return { $id, ...(nextVersion ? { $version: nextVersion } : {}) };
	}
});
