import { sync, type Finding } from '@norbital-ai/bolt';
import { parseIsoDate } from '../../../../lib/dates.js';
import { parseMsProjectXml, parsePrimaveraXer } from '../../../../lib/schedule-parsers.js';
import { TRADE_SPECIALTIES, type TradeSpecialty } from '../../../../lib/trades.js';

const TRADE_SET = new Set<string>(TRADE_SPECIALTIES);
const asTrade = (raw: string | null | undefined): TradeSpecialty => {
	const v = raw?.trim().toLowerCase() ?? '';
	return TRADE_SET.has(v) ? (TRADE_SPECIALTIES.find((t) => t === v) ?? 'general') : 'general';
};

/**
 * Large-scale construction schedule file sync supporting XLSX, CSV, Primavera P6 (`.xer`),
 * and Microsoft Project (`.xml`) programme imports and exports.
 */
export default sync('tasks', 'schedule_file', {
	with: 'file',
	parser: [
		'xlsx',
		'csv',
		{
			type: 'text/plain',
			extensions: ['.xer'],
			parse: function* (file, ctx) {
				const bytes = yield* ctx.files.get(file, { max: '4MiB' });
				const text = new TextDecoder('utf-8').decode(bytes);
				return parsePrimaveraXer(text);
			}
		},
		{
			type: 'application/xml',
			extensions: ['.xml'],
			parse: function* (file, ctx) {
				const bytes = yield* ctx.files.get(file, { max: '4MiB' });
				const text = new TextDecoder('utf-8').decode(bytes);
				return parseMsProjectXml(text);
			}
		}
	],
	schema: {
		task_code: { kind: 'text' },
		wbs_path: { kind: 'text', optional: true },
		title: { kind: 'text' },
		is_milestone: { kind: 'bool', optional: true },
		start_date: { kind: 'text', optional: true },
		end_date: { kind: 'text', optional: true },
		progress_pct: { kind: 'text', optional: true },
		trade_specialty: { kind: 'text', optional: true },
		external_id: { kind: 'text', optional: true }
	},
	context: {
		project_id: { kind: 'ref', to: 'projects' }
	},
	read: function* ({ records, context }, _ctx) {
		const findings: Finding[] = [];
		const rows = [];
		for (const r of records) {
			const code = r.task_code.trim();
			const title = r.title.trim();
			if (!code || !title) {
				findings.push({
					at: r.$at,
					field: !code ? 'task_code' : 'title',
					message: 'Task code and title are required.',
					severity: 'warn'
				});
				continue;
			}
			const from = parseIsoDate(r.start_date);
			const to = parseIsoDate(r.end_date) ?? from;
			const range = from ? { from, to: to && to >= from ? to : from } : null;
			rows.push({
				project_id: context.project_id,
				task_code: code,
				wbs_path: r.wbs_path?.trim() || null,
				external_id: r.external_id?.trim() || null,
				title,
				is_milestone: r.is_milestone === true,
				trade_specialty: asTrade(r.trade_specialty),
				schedule_range: range,
				baseline_range: range,
				progress_pct: r.progress_pct?.trim() || '0'
			});
		}
		return { rows, findings };
	},
	write: function* ({ context }, ctx) {
		const { tasks } = yield* ctx.query({
			tasks: {
				where: { project_id: { eq: context.project_id } },
				fields: [
					'task_code',
					'wbs_path',
					'title',
					'is_milestone',
					'schedule_range',
					'progress_pct',
					'trade_specialty',
					'external_id'
				],
				order_by: { task_code: 'asc' },
				limit: 10000
			}
		});
		return tasks.rows.map((t) => ({
			task_code: t.task_code,
			wbs_path: t.wbs_path ?? '',
			title: t.title,
			is_milestone: t.is_milestone,
			start_date: t.schedule_range?.from ?? '',
			end_date: t.schedule_range?.to ?? '',
			progress_pct: t.progress_pct,
			trade_specialty: t.trade_specialty,
			external_id: t.external_id ?? ''
		}));
	}
});
