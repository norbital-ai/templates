/**
 * Leads entering the one company table from a CSV upload or Apollo: read into one shape, then planned against what is
 * stored so a company is created once per domain and per `companyKey`, and a PIC once per email address.
 */
import { Option, Schema } from 'effect';
import type { CreateInput, Id, Json } from '@norbital-ai/bolt';

/** A company's dedupe key: the host of a domain or website, lower case, without `www.`; `null` when there is none. */
export const domainOf = (value: string | null | undefined): string | null => {
	const host = (value ?? '')
		.trim()
		.toLowerCase()
		.replace(/^[a-z]+:\/\//, '')
		.replace(/^www\./, '')
		.split(/[/?#:\s]/)[0];
	return host !== undefined && host.includes('.') ? host : null;
};

/** Legal-form words a name may end with, which do not tell two companies apart. */
const LEGAL_FORM =
	/(\s(private|pte|pvt|public|limited|ltd|sdn|bhd|berhad|inc|incorporated|llc|llp|lp|plc|pty|corp|corporation|co|company|gmbh|ag|sa|bv|nv|tbk|pt|jsc))+$/;
/**
 * A company's identity, as the database computes `companies.company_key` (unique): its legal name in lower case, `&` as
 * `and`, punctuation dropped (any non-Latin letter is kept) and a trailing legal form dropped (`Harbour Pte. Ltd.` and
 * `harbour` are one company). Imports plan with it; the column, not this function, is the guard.
 */
export const companyKey = (name: string): string =>
	name
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^0-9a-z\u00c0-\uffff]+/g, ' ')
		.trim()
		.replace(LEGAL_FORM, '')
		.trim();

/** One lead as either source gives it: its company and, optionally, its PIC. */
export type Lead = {
	readonly company: string;
	readonly domain: string | null;
	readonly website: string | null;
	readonly industry: string | null;
	readonly full_name: string | null;
	readonly job_title: string | null;
	readonly email: string | null;
	readonly phone: string | null;
};

/** The CSV columns a lead is read from, by any of these header names (case and spacing ignored). */
const COLUMNS = {
	company: ['company', 'company name', 'organization', 'organisation', 'account'],
	domain: ['domain', 'company domain'],
	website: ['website', 'company website', 'url'],
	industry: ['industry'],
	full_name: ['name', 'full name', 'contact', 'contact name', 'pic', 'person in charge'],
	first_name: ['first name'],
	last_name: ['last name'],
	job_title: ['title', 'job title', 'position', 'role'],
	email: ['email', 'email address', 'work email'],
	phone: ['phone', 'mobile', 'phone number', 'work phone']
} as const;
const norm = (header: string) =>
	header
		.trim()
		.toLowerCase()
		.replace(/[_\s]+/g, ' ');
const text = (value: Json | undefined) => {
	const out = value == null ? '' : String(value).trim();
	return out === '' ? null : out;
};

/** `ctx.convert.ingest`'s answer for a spreadsheet or CSV: its sheets' header row and cells. */
export const IngestSheets = Schema.Struct({
	sheets: Schema.Array(
		Schema.Struct({
			columns: Schema.Array(Schema.String),
			rows: Schema.Array(Schema.Array(Schema.Json))
		})
	)
});
type Sheet = (typeof IngestSheets.Type)['sheets'][number];
/** A sheet's rows as leads; a row with neither company nor domain is left out. */
export const leadsFromSheet = (sheet: Sheet): Lead[] => {
	const headers = sheet.columns.map(norm);
	const cell = (row: readonly Json[], names: readonly string[]) => {
		const at = headers.findIndex((header) => names.includes(header));
		return at < 0 ? null : text(row[at]);
	};
	return sheet.rows.flatMap((row) => {
		const website = cell(row, COLUMNS.website);
		const email = cell(row, COLUMNS.email)?.toLowerCase() ?? null;
		const domain = domainOf(cell(row, COLUMNS.domain) ?? website ?? email?.split('@')[1]);
		const company = cell(row, COLUMNS.company) ?? domain;
		if (company === null) return [];
		const named = [cell(row, COLUMNS.first_name), cell(row, COLUMNS.last_name)]
			.filter((part) => part !== null)
			.join(' ');
		return [
			{
				company,
				domain,
				website,
				industry: cell(row, COLUMNS.industry),
				full_name: cell(row, COLUMNS.full_name) ?? (named === '' ? null : named),
				job_title: cell(row, COLUMNS.job_title),
				email,
				phone: cell(row, COLUMNS.phone)
			}
		];
	});
};

/** An Apollo contact (`POST /api/v1/contacts/search`), the fields a lead takes. */
const ApolloContact = Schema.Struct({
	name: Schema.optionalKey(Schema.NullOr(Schema.String)),
	title: Schema.optionalKey(Schema.NullOr(Schema.String)),
	email: Schema.optionalKey(Schema.NullOr(Schema.String)),
	organization_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
	phone_numbers: Schema.optionalKey(
		Schema.NullOr(
			Schema.Array(
				Schema.Struct({ sanitized_number: Schema.optionalKey(Schema.NullOr(Schema.String)) })
			)
		)
	),
	organization: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				name: Schema.optionalKey(Schema.NullOr(Schema.String)),
				website_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
				primary_domain: Schema.optionalKey(Schema.NullOr(Schema.String)),
				industry: Schema.optionalKey(Schema.NullOr(Schema.String))
			})
		)
	)
});
/** One page of Apollo's saved contacts. */
export const ApolloPage = Schema.Struct({
	contacts: Schema.Array(Schema.Json),
	pagination: Schema.optionalKey(Schema.Struct({ total_pages: Schema.optionalKey(Schema.Number) }))
});
/** Apollo's contacts as leads; a contact that does not decode, or names no company, is left out. */
export const leadsFromApollo = (contacts: readonly Json[]): Lead[] =>
	contacts.flatMap((raw) =>
		Option.match(Schema.decodeUnknownOption(ApolloContact)(raw), {
			onNone: () => [],
			onSome: (c) => {
				const website = c.organization?.website_url ?? null;
				const domain = domainOf(
					c.organization?.primary_domain ?? website ?? c.email?.split('@')[1]
				);
				const company = c.organization?.name ?? c.organization_name ?? domain;
				return company == null
					? []
					: [
							{
								company,
								domain,
								website,
								industry: c.organization?.industry ?? null,
								full_name: c.name ?? null,
								job_title: c.title ?? null,
								email: c.email?.toLowerCase() ?? null,
								phone: c.phone_numbers?.[0]?.sanitized_number ?? null
							}
						];
			}
		})
	);

type Pic = Pick<
	CreateInput<'contacts'>,
	'full_name' | 'job_title' | 'email' | 'phone' | 'is_primary'
>;
/**
 * What an import writes: new companies with their PICs, and PICs new to a stored company.
 * A lead joins the company of its domain, else of its `companyKey`, stored or earlier in the batch; a PIC whose email is
 * already held, or that has neither name nor email, is skipped. A new company's first PIC is its primary contact.
 */
export const planLeads = (
	leads: readonly Lead[],
	stored: {
		readonly companies: readonly {
			readonly id: Id<'companies'>;
			readonly company_key: string | null;
			readonly domain: string | null;
		}[];
		readonly emails: ReadonlySet<string>;
	},
	defaults: Pick<CreateInput<'companies'>, 'source' | 'owner'>
) => {
	const known = new Map<string, Id<'companies'>>();
	for (const company of stored.companies) {
		if (company.company_key !== null) known.set(`name:${company.company_key}`, company.id);
		if (company.domain !== null) known.set(`domain:${company.domain}`, company.id);
	}
	const fresh = new Map<string, { company: CreateInput<'companies'>; pics: Pic[] }>();
	const added: (Pic & { readonly company_id: Id<'companies'> })[] = [];
	const emails = new Set(stored.emails);
	let skipped = 0;
	for (const lead of leads) {
		const name = `name:${companyKey(lead.company)}`;
		const key = lead.domain === null ? name : `domain:${lead.domain}`;
		const id = known.get(key) ?? known.get(name);
		const draft = id === undefined ? (fresh.get(key) ?? fresh.get(name)) : undefined;
		const pic: Pic | null =
			(lead.full_name ?? lead.email) === null || (lead.email !== null && emails.has(lead.email))
				? null
				: {
						full_name: lead.full_name ?? lead.email ?? '',
						job_title: lead.job_title,
						email: lead.email,
						phone: lead.phone,
						is_primary: id === undefined && (draft?.pics.length ?? 0) === 0
					};
		if (pic === null) skipped++;
		if (pic?.email != null) emails.add(pic.email);
		if (id !== undefined) {
			if (pic !== null) added.push({ ...pic, company_id: id });
		} else if (draft !== undefined) {
			if (pic !== null) draft.pics.push(pic);
		} else {
			const created = {
				company: {
					name: lead.company,
					domain: lead.domain,
					website: lead.website,
					industry: lead.industry,
					...defaults
				},
				pics: pic === null ? [] : [pic]
			};
			fresh.set(key, created);
			fresh.set(name, created);
		}
	}
	return {
		companies: [...new Set(fresh.values())].map(({ company, pics }) => ({
			...company,
			contacts: pics
		})),
		contacts: added,
		skipped
	};
};
