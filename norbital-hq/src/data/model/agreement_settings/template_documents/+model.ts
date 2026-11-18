import { model } from '@norbital-ai/bolt';

/** A `{{placeholder}}` in a body or subject. */
const PLACEHOLDER = /\{\{([a-z_]+)\}\}/g;

/**
 * The template catalogue: every text HQ fills from a company's (and, `scope: 'project'`, its job's) values — a document
 * to sign, an outreach email sample, or a research prompt. `key` names the template across versions; each new row is
 * the next version of its key, earlier versions stay with the copies signed on them. `required` lists the placeholders
 * a copy may not be issued without.
 */
export default model('template_documents', {
	description:
		'Template catalogue: documents to sign, outreach emails and research prompts, filled from company and job values.',
	icon: 'lucide:files',
	record_label: "record.title + ' v' + string(record.version)",
	fields: {
		title: { kind: 'text' },
		key: { kind: 'text' },
		commitment: { kind: 'bool', default: false },
		kind: { kind: 'enum', values: ['document', 'email', 'research'], default: 'document' },
		scope: { kind: 'enum', values: ['company', 'project'], default: 'company' },
		version: { kind: 'int', min: 1, default: 1 },
		required: { kind: 'text', many: true, optional: true },
		subject: { kind: 'text', optional: true },
		body: { kind: 'text', format: 'markdown' },
		drafting_instructions: { kind: 'text', format: 'markdown', optional: true }
	},
	constraints: { one_version_per_key: { unique: ['key', 'version'] } },
	indexes: { find: { text: ['title', 'key'] } },
	outputs: { default: { fields: 'all' } },
	create: {
		fields: [
			'title',
			'key',
			'kind',
			'commitment',
			'scope',
			'required',
			'subject',
			'body',
			'drafting_instructions'
		],
		// each new row is the next version of its key; what it requires must be a placeholder it uses
		transform: function* (changes, ctx) {
			const rows = changes.map(({ set }) => set);
			const empty = rows.findIndex((input) => !input.body.trim());
			if (empty >= 0)
				return yield* ctx.refuse('errors.template_needs_text', { field: 'body', row: empty });
			const unused = rows.findIndex((input) => {
				const used = new Set(
					[...`${input.subject ?? ''}\n${input.body}`.matchAll(PLACEHOLDER)].map((m) => m[1])
				);
				return (input.required ?? []).some((name) => !used.has(name));
			});
			if (unused >= 0)
				return yield* ctx.refuse('errors.template_required_unused', {
					field: 'required',
					row: unused
				});
			const latest = (yield* ctx.query({
				template_documents: {
					where: { key: { in: [...new Set(rows.map((input) => input.key))] } },
					fields: ['key', 'version']
				}
			})).template_documents;
			const versions = new Map<string, number>();
			for (const stored of latest.rows)
				versions.set(stored.key, Math.max(versions.get(stored.key) ?? 0, stored.version));
			return rows.map((input) => {
				const version = (versions.get(input.key) ?? 0) + 1;
				versions.set(input.key, version);
				return { ...input, version };
			});
		}
	},
	// Instructions guide the next draft; signed content remains on its immutable version.
	update: { fields: ['drafting_instructions'] }
});
