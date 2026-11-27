import { model } from '@norbital-ai/bolt';
import { validateReportTemplateBody } from '../../../services/reports/template-validation.js';

export default model('report_templates', {
	icon: 'lucide:file-spreadsheet',
	record_label: "record.title + ' (v' + record.version + ')'",
	description:
		'Versioned HTML print layouts and declarations for project Sustainability (BCA Green Mark / EN 15978 / GRI) and Compliance (BCA CORENET X / ISO 19650 / CONQUAS / ISO 9001/14001/45001) PDF reports.',
	fields: {
		kind: { kind: 'enum', values: ['sustainability_report', 'compliance_report'] },
		locale: { kind: 'enum', values: ['en', 'zh'], default: 'en' },
		version: { kind: 'text' },
		title: { kind: 'text' },
		standard_ref: { kind: 'text', optional: true },
		body: { kind: 'text', default: '{report}' },
		print_layout: { kind: 'file', accept: ['text/html'], max: '3MiB', optional: true },
		letterhead: { kind: 'file', accept: ['image/png'], max: '512KiB', optional: true },
		company_stamp: { kind: 'file', accept: ['image/png'], max: '512KiB', optional: true },
		published_at: { kind: 'instant', optional: true },
		status: {
			kind: 'state',
			initial: 'draft',
			states: { draft: { to: ['published'] }, published: {} }
		}
	},
	outputs: { default: { fields: 'all' } },
	indexes: { search: { text: ['title', 'standard_ref'] } },
	create: {
		fields: [
			'kind',
			'locale',
			'version',
			'title',
			'standard_ref',
			'body',
			'print_layout',
			'letterhead',
			'company_stamp'
		],
		filled: { fields: ['version'] },
		transform: function* (changes, ctx) {
			if (
				changes.some(
					({ after }) => after.body !== undefined && !validateReportTemplateBody(after.body)
				)
			) {
				return yield* ctx.refuse('errors.report_template_invalid');
			}
			const { report_templates: existing } = yield* ctx.query({
				report_templates: {
					where: { kind: { in: changes.map(({ after }) => after.kind) } },
					fields: ['kind', 'locale', 'version'],
					limit: 500
				}
			});
			const taken: Array<{
				readonly kind: string;
				readonly locale: string;
				readonly version: string;
			}> = existing.rows.map((row) => ({
				kind: row.kind,
				locale: row.locale,
				version: row.version
			}));
			return changes.map(({ set, after }) => {
				if (after.version?.trim()) return set;
				const locale = after.locale ?? 'en';
				const version = String(
					Math.max(
						0,
						...taken
							.filter((row) => row.kind === after.kind && row.locale === locale)
							.map((row) => Number(row.version) || 0)
					) + 1
				);
				taken.push({ kind: after.kind, locale, version });
				return { ...set, version };
			});
		}
	},
	update: {
		fields: [
			'title',
			'standard_ref',
			'body',
			'print_layout',
			'letterhead',
			'company_stamp',
			'status'
		],
		transform: function* (changes, ctx) {
			for (const { after } of changes) {
				if (!validateReportTemplateBody(after.body)) {
					return yield* ctx.refuse('errors.report_template_invalid');
				}
			}
			return changes.map(({ set }) =>
				set.status === 'published' ? { ...set, published_at: ctx.now } : set
			);
		}
	},
	constraints: {
		published: { locked: { status: { eq: 'published' } } }
	}
});
