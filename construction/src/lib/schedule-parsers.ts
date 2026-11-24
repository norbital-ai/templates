import { parseScheduleDate } from './dates.js';

/**
 * Pure TypeScript large-scale construction schedule parsers for Primavera P6 (`.xer`) and
 * Microsoft Project (`.xml`) exports, producing normalized WBS work packages for `tasks`.
 */

export type ParsedScheduleTask = {
	readonly $at: number;
	readonly task_code: string;
	readonly wbs_path: string;
	readonly title: string;
	readonly is_milestone: boolean;
	readonly start_date: string;
	readonly end_date: string;
	readonly progress_pct: string;
	readonly trade_specialty: string;
	readonly external_id: string;
};

function toIsoDate(raw: string | undefined): string {
	return parseScheduleDate(raw) ?? '';
}

function clampPctString(raw: string | undefined): string {
	const n = Number(raw ?? '0');
	if (!Number.isFinite(n)) return '0';
	return String(Math.max(0, Math.min(100, Math.round(n * 10) / 10)));
}

/**
 * Parses Primavera P6 `.xer` tab-delimited text into WBS tasks and milestones.
 * Reads `%T PROJWBS` for WBS hierarchy paths and `%T TASK` for activity dates, milestones, and % complete.
 */
export function parsePrimaveraXer(text: string): ParsedScheduleTask[] {
	const lines = text.split(/\r?\n/);
	let currentTable = '';
	let fields: string[] = [];
	const wbsMap = new Map<string, { code: string; name: string; parent: string }>();
	const out: ParsedScheduleTask[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (line.startsWith('%T\t')) {
			currentTable = line.slice(3).trim();
			fields = [];
			continue;
		}
		if (line.startsWith('%F\t')) {
			fields = line
				.slice(3)
				.split('\t')
				.map((f) => f.trim());
			continue;
		}
		if (!line.startsWith('%R\t') || fields.length === 0) continue;
		const cols = line.slice(3).split('\t');
		const row: Record<string, string> = {};
		for (let c = 0; c < fields.length; c++) {
			const k = fields[c];
			if (k) row[k] = (cols[c] ?? '').trim();
		}

		if (currentTable === 'PROJWBS') {
			const id = row['wbs_id'];
			if (id) {
				wbsMap.set(id, {
					code: row['wbs_short_name'] ?? id,
					name: row['wbs_name'] ?? '',
					parent: row['parent_wbs_id'] ?? ''
				});
			}
		} else if (currentTable === 'TASK') {
			const taskCode = row['task_code'] || row['task_id'];
			const title = row['task_name'];
			if (!taskCode || !title) continue;

			// Build WBS breadcrumb path
			const crumbs: string[] = [];
			let cursor = row['wbs_id'] ?? '';
			let guard = 0;
			while (cursor && guard < 12) {
				const node = wbsMap.get(cursor);
				if (!node) break;
				crumbs.unshift(node.code);
				cursor = node.parent;
				guard++;
			}

			const taskType = row['task_type'] ?? '';
			const isMilestone = taskType === 'TT_Mile' || taskType === 'TT_FinMile';
			const startDate = toIsoDate(
				row['target_start_date'] || row['early_start_date'] || row['act_start_date']
			);
			const endDate =
				toIsoDate(row['target_end_date'] || row['early_end_date'] || row['act_end_date']) ||
				startDate;
			const pct = clampPctString(row['phys_complete_pct'] || row['complete_pct']);

			out.push({
				$at: i + 1,
				task_code: taskCode,
				wbs_path: crumbs.join('.'),
				title,
				is_milestone: isMilestone,
				start_date: startDate,
				end_date: endDate,
				progress_pct: pct,
				trade_specialty: 'general',
				external_id: `xer:${row['task_id'] || taskCode}`
			});
		}
	}

	return out;
}

function xmlTag(block: string, tag: string): string {
	const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
	const m = block.match(re);
	return m?.[1]
		? m[1]
				.replace(/&amp;/g, '&')
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')
				.replace(/&quot;/g, '"')
				.trim()
		: '';
}

/**
 * Parses Microsoft Project / Autodesk Schedule `.xml` exports (`<Task>...</Task>` elements)
 * into normalized WBS tasks and milestones.
 */
export function parseMsProjectXml(text: string): ParsedScheduleTask[] {
	const out: ParsedScheduleTask[] = [];
	const taskRe = /<Task\b[^>]*>([\s\S]*?)<\/Task>/gi;
	let match: RegExpExecArray | null = taskRe.exec(text);
	let index = 0;
	while (match !== null) {
		index++;
		const block = match[1] ?? '';
		const uid = xmlTag(block, 'UID');
		const outline = xmlTag(block, 'OutlineNumber') || xmlTag(block, 'WBS');
		const name = xmlTag(block, 'Name');
		const isSummary = xmlTag(block, 'Summary') === '1';
		if (!name || isSummary) {
			match = taskRe.exec(text);
			continue;
		}
		const isMilestone = xmlTag(block, 'Milestone') === '1';
		const startDate = toIsoDate(xmlTag(block, 'Start'));
		const endDate = toIsoDate(xmlTag(block, 'Finish')) || startDate;
		const pct = clampPctString(xmlTag(block, 'PercentComplete'));
		const code = outline ? `WBS-${outline}` : `MSP-${uid || index}`;

		out.push({
			$at: index,
			task_code: code,
			wbs_path: outline,
			title: name,
			is_milestone: isMilestone,
			start_date: startDate,
			end_date: endDate,
			progress_pct: pct,
			trade_specialty: 'general',
			external_id: `msp:${uid || code}`
		});
		match = taskRe.exec(text);
	}
	return out;
}
