import type { BankReader, FieldKind, SeedSource } from '@norbital-ai/bolt';
import * as Predicate from 'effect/Predicate';

/**
 * The sample pack: the bank's `construction` row snapshots, read without rewriting them. Rows are the template's
 * 0.0.0.x shapes; each value is converted to its 0.0.1 kind from the model: `{ start, end }` day ranges become
 * inclusive `{ from, to }` periods (a UTC-midnight end is exclusive, a year-9999 end is open), day instants become
 * dates in the business zone, and `{ value, currency }` money splits into the amount and the row's `currency`. The
 * seed IFC model moves from Colony's seed-asset route to the workspace's own `/assets/`.
 */
const ZONE = 'Asia/Singapore';
type Row = { [field: string]: unknown };
const models = import.meta.glob<{ default: { fields: { [name: string]: FieldKind } } }>(
	'../src/data/model/*/+model.ts',
	{ eager: true }
);
const FIELDS = new Map(
	Object.entries(models).map(([path, m]) => [path.split('/').at(-2)!, m.default.fields])
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
	const to =
		end == null || end.startsWith('9999') ? null : midnight ? dayBefore(midnight[1]!) : day(end);
	return { from: day(value.start), to };
}

function convert(collection: string, row: Row): Row {
	const fields = FIELDS.get(collection) ?? {};
	const out: Row = { ...row };
	for (const [name, kind] of Object.entries(fields)) {
		const value = row[name];
		if (value == null) continue;
		if (kind.kind === 'date' && Predicate.isString(value)) out[name] = day(value);
		else if (kind.kind === 'period')
			out[name] = period(value as { start: string; end: string | null });
		else if (kind.kind === 'money') {
			const money = value as { value: number; currency: string };
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
const PUBLIC = import.meta.glob<Row[]>('./*.json', { eager: true, import: 'default' });

export default {
	bank: 'construction',
	rows(bank: BankReader) {
		const out: { [collection: string]: Row[] } = {};
		const files: [string, Row[]][] = bank.has('projects.json')
			? bank
					.files()
					.filter((f) => /^[^/]+\.json$/.test(f))
					.map((f) => [f, bank.json<Row[]>(f)])
			: Object.entries(PUBLIC).map(([path, rows]) => [path.slice(2), rows]);
		for (const [file, rows] of files) {
			const name = file.slice(0, -'.json'.length);
			if (name === 'team')
				out['sys_team'] = rows.map((r) => ({
					id: r['id'],
					name: r['name'],
					parent: r['parent_id'] ?? null
				}));
			else if (name === 'user')
				out['sys_user'] = rows.map((r) => ({
					id: r['id'],
					name: r['name'],
					email: r['email'] ?? null,
					kind: 'staff',
					admin: r['status'] === 'admin',
					team: r['team_id'] ?? null
				}));
			else out[name] = rows.map((row) => convert(name, row));
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
		return out as never;
	}
} satisfies SeedSource;
