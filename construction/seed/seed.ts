import type { BankReader, FieldKind, SeedSource } from '@norbital-ai/bolt';
import { Predicate, Schema } from 'effect';

/**
 * The sample pack: the bank's `construction` row snapshots, read without rewriting them. Rows are the template's
 * 0.0.0.x shapes; each value is converted to its 0.0.1 kind from the model: `{ start, end }` day ranges become
 * inclusive `{ from, to }` periods (a UTC-midnight end is exclusive, a year-9999 end is open), day instants become
 * dates in the business zone, and `{ value, currency }` money splits into the amount and the row's `currency`. The
 * seed IFC model moves from Colony's seed-asset route to the workspace's own `/assets/`.
 */
const ZONE = 'Asia/Singapore';
const Row = Schema.Record(Schema.String, Schema.Json);
type Row = Schema.Schema.Type<typeof Row>;
const rows = Schema.decodeUnknownSync(Schema.Array(Row));
const User = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	email: Schema.optionalKey(Schema.NullOr(Schema.String)),
	status: Schema.optionalKey(Schema.String),
	team_id: Schema.optionalKey(Schema.NullOr(Schema.String))
});
const Range = Schema.Struct({ start: Schema.String, end: Schema.NullOr(Schema.String) });
const Money = Schema.Struct({ value: Schema.Number, currency: Schema.String });
const models = import.meta.glob<{ default: { fields: { [name: string]: FieldKind } } }>(
	'../src/data/model/+*.model.ts',
	{ eager: true }
);
const FIELDS = new Map(
	Object.entries(models).map(([path, m]) => [
		path.slice(path.lastIndexOf('/') + 2, -'.model.ts'.length),
		m.default.fields
	])
);

const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?Z$/;
const zoneDay = new Intl.DateTimeFormat('en-CA', {
	timeZone: ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});
const day = (value: string) =>
	/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : zoneDay.format(new Date(value));
const dayBefore = (value: string) =>
	new Date(Date.parse(`${value}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
function period(value: { start: string; end: string | null }) {
	const end = value.end;
	const midnight = end == null ? null : MIDNIGHT.exec(end);
	const midnightDay = midnight?.[1];
	const to =
		end == null || end.startsWith('9999')
			? null
			: midnightDay !== undefined
				? dayBefore(midnightDay)
				: day(end);
	return { from: day(value.start), to };
}

function convert(collection: string, row: Row): Row {
	const fields = FIELDS.get(collection) ?? {};
	const out: { [field: string]: Row[string] } = { ...row };
	for (const [name, kind] of Object.entries(fields)) {
		const value = row[name];
		if (value == null) continue;
		if (kind.kind === 'date' && Predicate.isString(value)) out[name] = day(value);
		else if (kind.kind === 'period') out[name] = period(Schema.decodeUnknownSync(Range)(value));
		else if (kind.kind === 'money') {
			const money = Schema.decodeUnknownSync(Money)(value);
			out[name] = money.value;
			out['currency'] = money.currency;
		}
	}
	if (Predicate.isString(out['document_url']))
		out['document_url'] = out['document_url'].replace(
			'/api/template-seed-assets/construction/',
			'/assets/'
		);
	return out;
}

/** A join row's `name` is its two sides' labels, as its collection's transform derives it: a seed runs no transform. */
const JOINS = {
	jobs_certification_types: [
		['job_id', 'jobs', 'job_title'],
		['certification_type_id', 'certification_types', 'certification_name']
	],
	jobs_site_locations: [
		['job_id', 'jobs', 'job_title'],
		['site_location_id', 'site_locations', 'location_name']
	],
	permits_to_work_certification_types: [
		['permits_to_work_id', 'permits_to_work', 'permit_number'],
		['certification_type_id', 'certification_types', 'certification_name']
	],
	permits_to_work_workers: [
		['permits_to_work_id', 'permits_to_work', 'permit_number'],
		['worker_id', 'workers', 'worker_name']
	]
} as const;

/** The public base pack: this directory's `<collection>.json` fixtures. */
const PUBLIC = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' });

export default {
	bank: 'construction',
	rows(bank: BankReader) {
		const out: { [collection: string]: Row[] } = {};
		const files: [string, readonly Row[]][] = bank.has('projects.json')
			? bank
					.files()
					.filter((f) => /^[^/]+\.json$/.test(f))
					.map((f) => [f, rows(bank.json(f))])
			: Object.entries(PUBLIC).map(([path, value]) => [path.slice(2), rows(value)]);
		for (const [file, values] of files) {
			const name = file.slice(0, -'.json'.length);
			if (name === 'team') continue;
			if (name === 'user')
				out['sys_user'] = values
					.map((value) => Schema.decodeUnknownSync(User)(value))
					.map((r) => ({
						id: r['id'],
						name: r['name'],
						email: r['email'] ?? null,
						kind: 'staff',
						admin: r['status'] === 'admin',
						team: r['team_id'] ?? null
					}));
			else out[name] = values.map((row) => convert(name, row));
		}
		for (const [join, sides] of Object.entries(JOINS)) {
			const labels = sides.map(
				([fk, of, label]) => [fk, new Map((out[of] ?? []).map((r) => [r['id'], r[label]]))] as const
			);
			const rows = out[join];
			if (rows !== undefined)
				out[join] = rows.map((row) => ({
					...row,
					name: labels.map(([fk, names]) => String(names.get(row[fk]) ?? '—')).join(' · ')
				}));
		}
		return out;
	}
} satisfies SeedSource;
