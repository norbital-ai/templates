import { model } from '@norbital-ai/bolt';
import type { Actor, CreateInput, StoredTree, UpdateInput } from '@norbital-ai/bolt';
import { manualFields, markManual, PREFERENCES_FIELD } from '../../../lib/extracted.js';
import { companyKey, domainOf } from '../../../lib/leads.js';

/** Every column is the person's to set; the profile also `update_requirements`'s; the research is `research_lead`'s. */
const columns = [
	'name',
	'uen',
	'address',
	'domain',
	'website',
	'stage',
	'progress',
	'owner',
	'source',
	'follow_up_days',
	'industry',
	'description',
	'preferences',
	'region',
	'nda_required',
	'documents',
	'notes'
] as const;

/** Extraction writes as the system; a person's edit becomes manual and is never regenerated over. */
const marked = (
	input: Pick<
		CreateInput<'companies'> | UpdateInput<'companies'>,
		'industry' | 'description' | 'preferences'
	>,
	before: StoredTree<'companies', 'update'> | undefined,
	actor: Actor
) =>
	actor.kind !== 'member'
		? {}
		: {
				...((input.industry !== undefined || input.description !== undefined) && {
					manual_fields: manualFields(
						[
							{ field: 'industry', next: input.industry, before: before?.industry },
							{ field: 'description', next: input.description, before: before?.description }
						],
						before?.manual_fields
					)
				}),
				...(input.preferences !== undefined && {
					preferences: markManual(input.preferences, before?.preferences)
				})
			};

/** The domain a company is deduplicated on: the one given, else its website's, normalised. */
const keyed = (
	input: Pick<CreateInput<'companies'> | UpdateInput<'companies'>, 'domain' | 'website'>
) =>
	input.domain !== undefined || input.website !== undefined
		? { domain: domainOf(input.domain ?? input.website ?? null) }
		: {};

/**
 * A company HQ sells to or delivers for. It enters as a `lead` (by hand, a CSV upload or Apollo; one row per `domain`),
 * is `qualified`, and becomes a `client` once converted — only clients appear as customers — or is `lost`. `owner` is
 * the assigned salesperson in charge; its contacts are the company's PICs. A company is one row however it arrives:
 * `company_key` (its normalised legal name, computed natively) is unique, and so are `domain` and `uen`. A company
 * created without research is researched once (`research_lead`: cited `research`, proposed `use_cases`, each PIC's
 * `seniority` and `angle`); a qualified lead without an open follow-up gets one every `follow_up_days`
 * (`remind_follow_ups`). A client's NDA and MSA (and its jobs' SOWs) render from the template catalogue; their signed
 * copies are `signed_documents`. Its profile (`industry`, `description`, `preferences`) is extracted by
 * `update_requirements` from its activities and documents; `manual_fields` and each preference's `origin` mark what a
 * person wrote, which extraction never replaces.
 */
export default model('companies', {
	description: 'A company: a lead in the sales pipeline until it converts into a client.',
	icon: 'lucide:building-2',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text' },
		uen: { kind: 'text', optional: true },
		address: { kind: 'text', optional: true },
		domain: { kind: 'text', optional: true },
		website: { kind: 'text', optional: true },
		stage: {
			kind: 'state',
			initial: 'lead',
			states: {
				lead: { to: ['qualified', 'client', 'lost'] },
				qualified: { to: ['lead', 'client', 'lost'] },
				client: { to: ['qualified'] },
				lost: { to: ['lead', 'client'] }
			}
		},
		progress: { kind: 'enum', values: ['in_progress', 'maintenance'], optional: true },
		owner: { kind: 'ref', to: 'sys_user', optional: true, default: { var: 'actor.id' } },
		source: { kind: 'enum', values: ['manual', 'csv', 'apollo'], default: 'manual' },
		follow_up_days: { kind: 'int', min: 1, max: 90, default: 7 },
		job_count: { kind: 'count', of: 'projects' },
		industry: { kind: 'text', optional: true },
		description: { kind: 'text', optional: true },
		preferences: PREFERENCES_FIELD,
		manual_fields: {
			kind: 'enum',
			values: ['industry', 'description'],
			many: true,
			optional: true,
			hidden: true
		},
		profiled_at: { kind: 'instant', optional: true },
		profile_error: { kind: 'text', optional: true },
		research: { kind: 'text', format: 'markdown', optional: true },
		use_cases: { kind: 'text', many: true, optional: true },
		researched_at: { kind: 'instant', optional: true },
		research_error: { kind: 'text', optional: true },
		region: { kind: 'text', optional: true },
		nda_required: { kind: 'bool', optional: true },
		documents: { kind: 'file', accept: ['*/*'], max: '20MiB', many: true, optional: true },
		notes: { kind: 'text', format: 'markdown', optional: true },
		// `companyKey` (`lib/leads.ts`) in SQL: computed by the database on every path, seed rows included
		company_key: {
			kind: 'text',
			computed:
				"trim(regex_replace(trim(regex_replace(regex_replace(lower(name), '&', ' and '), r'[^0-9a-z\u00c0-\uffff]+', ' ')), r'( (private|pte|pvt|public|limited|ltd|sdn|bhd|berhad|inc|incorporated|llc|llp|lp|plc|pty|corp|corporation|co|company|gmbh|ag|sa|bv|nv|tbk|pt|jsc))+$', ''))"
		},
		uen_key: { kind: 'text', computed: "upper(regex_replace(uen, r'[^A-Za-z0-9]', ''))" }
	},
	constraints: {
		one_company: { unique: ['company_key'], message: 'errors.company_exists' },
		one_company_per_domain: { unique: ['domain'], message: 'errors.company_exists' },
		one_company_per_uen: { unique: ['uen_key'], message: 'errors.company_exists' }
	},
	indexes: { by_stage: { on: ['stage'] }, find: { text: ['name', 'uen', 'domain'] } },
	// an owner shows by name, as every member reads the directory
	outputs: {
		default: {
			fields: 'all',
			owner: { fields: ['name'] },
			cohort_memberships: {
				fields: ['cohort', 'active', 'contact'],
				cohort: { fields: ['name', 'status'] },
				contact: { fields: ['full_name'] }
			}
		}
	},
	create: {
		fields: columns,
		contacts: { fields: ['full_name', 'job_title', 'email', 'phone', 'is_primary'] },
		// a company enters as a lead unless its writer says otherwise
		filled: { fields: ['stage'] },
		transform: function* (changes, ctx) {
			if (changes.some(({ after }) => after.stage === 'client'))
				return yield* ctx.refuse('errors.client_needs_commitment', { field: 'stage' });
			const rows = changes.map(({ set }) => ({
				...set,
				stage: set.stage ?? 'lead',
				...keyed(set),
				...marked(set, undefined, ctx.actor)
			}));
			// a company already on file is named back to its writer (the constraints refuse a racing duplicate)
			const domains = rows.flatMap((row) => (row.domain == null ? [] : [row.domain]));
			const existing = (yield* ctx.query({
				companies: {
					where: {
						or: [
							{ company_key: { in: rows.map((row) => companyKey(row.name)) } },
							...(domains.length > 0 ? [{ domain: { in: domains } }] : [])
						]
					},
					fields: ['name', 'company_key', 'domain'],
					limit: 1
				}
			})).companies.rows[0];
			if (existing === undefined) return rows;
			const row = rows.findIndex(
				(one) => companyKey(one.name) === existing.company_key || one.domain === existing.domain
			);
			return yield* ctx.refuse('errors.company_on_file', {
				row,
				field: 'name',
				values: { name: existing.name }
			});
		},
		// a company without research is researched once on creation; once researched_at is set it is not re-researched unless manually triggered for that company
		effect: function* (changes, ctx) {
			for (const { after } of changes)
				if (after.researched_at == null)
					yield* ctx.schedule(
						'research_lead',
						{ company: after.id },
						{ at: ctx.now, key: `hq:research:${after.id}` }
					);
		}
	},
	update: {
		fields: [
			...columns,
			'manual_fields',
			'profiled_at',
			'profile_error',
			'research',
			'use_cases',
			'researched_at',
			'research_error'
		],
		transform: function* (changes, ctx) {
			const moving = changes.filter((c) => c.changed('stage'));
			if (moving.length > 0) {
				const templates = (yield* ctx.query({
					template_documents: { where: { commitment: { eq: true } }, fields: ['id'] }
				})).template_documents.rows;
				const signed = (yield* ctx.query({
					signed_documents: {
						as_of: 'act',
						where: {
							company: { in: moving.map((c) => c.after.id) },
							template_version: { in: templates.map((t) => t.id) }
						},
						fields: ['company']
					}
				})).signed_documents.rows;
				if (
					moving.some(
						(c) => (c.after.stage === 'client') !== signed.some((d) => d.company === c.after.id)
					)
				)
					return yield* ctx.refuse('errors.client_needs_commitment', { field: 'stage' });
			}
			return changes.map(({ before, set }) => ({
				...set,
				...keyed(set),
				...marked(set, before, ctx.actor)
			}));
		},
		effect: function* (changes, ctx) {
			for (const { before, after } of changes) {
				const prev = (before.documents ?? []).map((file) => file.id).join(',');
				const next = (after.documents ?? []).map((file) => file.id).join(',');
				if (prev !== next)
					yield* ctx.schedule(
						'research_lead',
						{ company: after.id },
						{ at: ctx.now, key: `hq:research:${after.id}` }
					);
			}
		}
	}
});
