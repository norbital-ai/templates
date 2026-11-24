import { sync } from '@norbital-ai/bolt';
import { Option, Schema } from 'effect';

const AccSheetSchema = Schema.Struct({
	urn: Schema.optional(Schema.NullOr(Schema.String)),
	id: Schema.optional(Schema.NullOr(Schema.String)),
	number: Schema.optional(Schema.NullOr(Schema.String)),
	title: Schema.optional(Schema.NullOr(Schema.String)),
	name: Schema.optional(Schema.NullOr(Schema.String)),
	kind: Schema.optional(Schema.NullOr(Schema.String)),
	versionSetName: Schema.optional(Schema.NullOr(Schema.String)),
	revision: Schema.optional(Schema.NullOr(Schema.String)),
	updatedAt: Schema.optional(Schema.NullOr(Schema.String))
});

const AccSheetsResponseSchema = Schema.Union([
	Schema.Array(AccSheetSchema),
	Schema.Struct({ results: Schema.Array(AccSheetSchema) })
]);

const AccUpdateResponseSchema = Schema.Struct({
	updatedAt: Schema.optional(Schema.NullOr(Schema.String))
});

const decodeSheets = Schema.decodeUnknownOption(AccSheetsResponseSchema);
const decodeUpdate = Schema.decodeUnknownOption(AccUpdateResponseSchema);

const trimmed = (v: string | null | undefined): string | null => {
	const s = v?.trim();
	return s ? s : null;
};

/**
 * Syncs Autodesk Construction Cloud (ACC) project sheets and BIM model metadata into `project_files`.
 */
export default sync('project_files', 'autodesk_files', {
	with: 'autodesk_acc',
	policies: ['construction_automation'],
	every: '1h',
	read: function* ({ cursor }, ctx) {
		const { projects } = yield* ctx.query({
			projects: {
				where: { autodesk_project_id: { is_null: false } },
				fields: ['autodesk_project_id'],
				limit: 500
			}
		});
		if (projects.rows.length === 0) return { rows: [], cursor: cursor ?? null };

		const rows = [];
		for (const project of projects.rows) {
			const accProjectId = project.autodesk_project_id ?? ctx.configuration.default_project_id;
			if (!accProjectId) continue;
			const response = yield* ctx.request({
				method: 'GET',
				path: `/construction/sheets/v1/projects/${encodeURIComponent(accProjectId)}/sheets`,
				query: cursor ? { updatedSince: String(cursor) } : {},
				output: { kind: 'json' }
			});
			const decoded = decodeSheets(response);
			if (Option.isNone(decoded)) continue;
			const items = 'results' in decoded.value ? decoded.value.results : decoded.value;
			for (const rec of items) {
				const urn = trimmed(rec.urn) ?? trimmed(rec.id);
				const number = trimmed(rec.number) ?? urn;
				const title = trimmed(rec.title) ?? trimmed(rec.name) ?? number;
				if (!number || !title) continue;
				const isModel =
					title.toLowerCase().endsWith('.rvt') ||
					title.toLowerCase().endsWith('.ifc') ||
					trimmed(rec.kind) === 'model';
				const version = trimmed(rec.updatedAt);
				const currentVersion = trimmed(rec.versionSetName) ?? trimmed(rec.revision) ?? 'ACC-1';
				rows.push({
					$id: `${accProjectId}:${urn ?? number}`,
					...(version ? { $version: version } : {}),
					project_id: project.id,
					document_number: number,
					title,
					kind: isModel ? ('autodesk_model' as const) : ('drawing' as const),
					current_version: currentVersion,
					autodesk_urn: urn
				});
			}
		}

		return { rows, cursor: rows.length > 0 ? ctx.now : (cursor ?? null) };
	},
	write: function* ({ op, row, $id }, ctx) {
		if (op !== 'update' || $id === null || !row.autodesk_urn) return null;
		const sep = $id.indexOf(':');
		if (sep <= 0) return null;
		const accProjectId = $id.slice(0, sep);
		const sheetId = $id.slice(sep + 1);
		if (!accProjectId || !sheetId) return null;

		const response = yield* ctx.request({
			method: 'PATCH',
			path: `/construction/sheets/v1/projects/${encodeURIComponent(accProjectId)}/sheets/${encodeURIComponent(sheetId)}`,
			body: { title: row.title },
			output: { kind: 'json' }
		});
		const decoded = decodeUpdate(response);
		const nextVersion = Option.isSome(decoded) ? trimmed(decoded.value.updatedAt) : null;
		return { $id, ...(nextVersion ? { $version: nextVersion } : {}) };
	}
});
