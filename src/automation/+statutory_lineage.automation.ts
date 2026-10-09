import { automation } from '@norbital-ai/bolt';
import { cloneSettingsFields } from '../lib/payroll_engine/settings_version.js';
import {
	allowedUrl,
	findingFrom,
	pageFrom,
	shouldDraft,
	sourcesFrom,
	unverifiedQuotes
} from '../lib/payroll_engine/statutory_drift.js';

const TOOLS = ['browser_navigate', 'browser_snapshot', 'browser_act'] as const;

const NOTES = {
	kind: 'object',
	fields: { notes: { kind: 'text' } }
} as const;

const FINDING = {
	kind: 'object',
	fields: {
		changed: { kind: 'bool' },
		summary: { kind: 'text' },
		quotes: {
			kind: 'list',
			of: {
				kind: 'object',
				fields: { url: { kind: 'text' }, quote: { kind: 'text' } }
			},
			optional: true
		}
	}
} as const;

/**
 * One sealed in-force lineage: infer whether published law moved, fetch cited URLs in one tick, verify quotes,
 * and create an unsealed clone when it did. It never seals.
 */
const statutory_lineage = automation({
	description:
		'Research one sealed in-force jurisdiction lineage against its official sources and, when they moved, create an unsealed cloned draft. It never seals.',
	input: { code: { kind: 'text' } },
	output: {
		kind: 'object',
		fields: {
			code: { kind: 'text' },
			drafted: { kind: 'bool' },
			skipped: { kind: 'bool' }
		}
	},
	runAs: ['statutory_drift_automation'],
	retry: { attempts: 3 },
	concurrency: { max: 2 }
});
export default statutory_lineage;

statutory_lineage.run(async ({ code }, ctx) => {
	// One read: the version in force with any open draft already cloned from it (the `clones` relation).
	const { rows: versions } = await ctx.read('jurisdiction_settings', {
		where: {
			code: { eq: code },
			approval_id: { isNull: true },
			sealed_at: { isNull: false },
			voided_at: { isNull: true },
			effective_range: { contains: { today: '' } }
		},
		// what the check needs; the version's whole configuration is read only when it drafts
		select: {
			name: true,
			sources: true,
			// an open draft already cloned from it, through the relation
			clones: {
				select: { id: true },
				where: {
					sealed_at: { isNull: true },
					voided_at: { isNull: true },
					approval_id: { isNull: true }
				},
				all: true
			}
		},
		all: true
	});
	const version = versions[0];
	if (version == null) return { code, drafted: false, skipped: true };
	const held = version.clones;
	if (held.length > 0) return { code, drafted: false, skipped: true };
	const sources = sourcesFrom(version.sources);
	const urls = sources.urls.filter((url) => allowedUrl(url, sources));
	if (urls.length === 0) return { code, drafted: false, skipped: true };
	const listing = urls.join('\n');
	const discovery = await ctx.ai.sys_2.infer({
		model: 'strong',
		tools: [...TOOLS],
		system: sources.instructions ?? 'Read only the official statutory pages named in the prompt.',
		prompt: `Jurisdiction ${code} (${version.name}). Official sources:\n${listing}\nList what on those pages a payroll configuration must match.`,
		output: NOTES
	});
	const finding = findingFrom(
		await ctx.ai.sys_2.infer({
			model: 'strong',
			tools: [...TOOLS],
			system: sources.instructions ?? 'Cite only text that appears on the official pages.',
			prompt: `Jurisdiction ${code}. Discovery notes:\n${discovery.notes}\nSources:\n${listing}\nDoes the sealed configuration need a new unsealed draft? If yes, summarise the change and quote the official sentences (url + quote).`,
			output: FINDING
		})
	);
	const cited = [
		...new Set(finding.quotes.map((row) => row.url).filter((url) => allowedUrl(url, sources)))
	];
	const fetched = await Promise.all(
		(cited.length > 0 ? cited : urls).map((url) => ctx.web.read.try(url))
	);
	const pages = fetched.flatMap((item) => {
		const page = pageFrom(item);
		return page == null ? [] : [page];
	});
	const unverified = unverifiedQuotes(pages, finding.quotes, sources);
	if (!shouldDraft(finding, unverified)) return { code, drafted: false, skipped: false };
	const { rows: whole } = await ctx.read('jurisdiction_settings', {
		where: { id: { eq: version.id } },
		select: {
			id: true,
			code: true,
			name: true,
			jurisdiction_code: true,
			employee_input_schema: true,
			entity_input_schema: true,
			behaviours: true,
			payroll: true,
			change_summary: true,
			effective_range: true,
			sources: true,
			reference_tables: true,
			sealed_at: true,
			voided_at: true,
			void_reason: true
		},
		limit: 1
	});
	const payload = {
		...cloneSettingsFields({ ...whole[0]! }, ctx.today),
		change_summary: finding.summary
	};
	await ctx.act('jurisdiction_settings.create', payload);
	return { code, drafted: true, skipped: false };
});
