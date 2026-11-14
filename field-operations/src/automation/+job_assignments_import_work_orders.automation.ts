import { Effect, Option, Schema } from 'effect';
import { automation, type Id } from '@norbital-ai/bolt';
import { siteKey } from '../lib/site-key.js';
import {
	decodeWorkOrders,
	IngestSheets,
	sheetRecords,
	type WorkOrder as Row
} from '../lib/work-order-sheet.js';

const UNIT = /#[0-9]+-[0-9A-Z]+/i;

const unitOf = (row: Row) => row.unit_number?.trim() || UNIT.exec(row.site)?.[0] || null;

/** The address a row names, with a separately supplied postal code folded in. */
const addressOf = (row: Row) => {
	const site = row.site.replace(UNIT, '').replace(/\s+,/g, ',').trim();
	const postal = row.postal_code?.trim() ?? '';
	return postal === '' || site.includes(postal) ? site : `${site}, Singapore ${postal}`;
};

/** A job with no dispatch reference is the same job when it is the same work, day and site. */
const sameWork = (siteId: string, day: string, title: string) =>
	`${siteId}|${day}|${title.trim().replace(/\s+/g, ' ').toLowerCase()}`;
export default automation({
	description:
		'Creates job assignments from a work-order sheet, matching existing sites and skipping filed rows. The complete sheet is checked before sites and jobs commit together.',
	policies: ['field_ops_controller'],
	input: {
		/** Columns by lower-cased header: site, postal_code, unit_number, latitude, longitude, scheduled_for (YYYY-MM-DD
		 * or an xlsx day serial), title, nature, description, assignee_contact (email or phone), external_ref. */
		file: {
			kind: 'file',
			accept: [
				'text/csv',
				'application/vnd.ms-excel',
				'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			],
			max: '5MiB'
		}
	},
	output: {
		kind: 'object',
		fields: { created: { kind: 'int' }, sites: { kind: 'int' }, skipped: { kind: 'int' } }
	},
	run: function* ({ file }, ctx) {
		const read = yield* ctx.convert.ingest(file);
		const sheet =
			read.kind === 'data'
				? Option.getOrUndefined(Schema.decodeUnknownOption(IngestSheets)(read.json))?.sheets[0]
				: undefined;
		if (sheet === undefined) return yield* ctx.refuse('errors.sheet_unreadable');
		const records = sheetRecords(sheet);
		if (records.length === 0 || records.length > 5000)
			return yield* ctx.refuse('errors.sheet_size');
		const rows = yield* decodeWorkOrders(records).pipe(
			Effect.catchTag('SheetInvalid', (invalid) =>
				ctx.refuse('errors.sheet_invalid', { values: { detail: invalid.message } })
			)
		);
		// the sheet's first problem refuses the whole import, naming its row and column
		const problems: { row: number; refusal: ReturnType<typeof ctx.refuse> }[] = [];
		/** The sheet row as a person finds it: its number, title, site and day. */
		const where = (index: number, row: Row) => ({
			row: index + 1,
			title: row.title?.trim() ?? '',
			site: row.site.trim(),
			date: String(row.scheduled_for)
		});
		const refs = new Set<string>();
		for (const [index, row] of rows.entries()) {
			const values = where(index, row);
			if ((row.title?.trim() ?? '') === '')
				problems.push({
					row: index,
					refusal: ctx.refuse('errors.sheet_title_empty', { row: index, field: 'title', values })
				});
			if (addressOf(row) === '' || siteKey(addressOf(row), unitOf(row)) === '')
				problems.push({
					row: index,
					refusal: ctx.refuse('errors.sheet_site_unaddressed', {
						row: index,
						field: 'site',
						values
					})
				});
			const ref = row.external_ref?.trim() ?? '';
			if (ref !== '') {
				if (refs.has(ref))
					problems.push({
						row: index,
						refusal: ctx.refuse('errors.sheet_ref_repeated', {
							row: index,
							field: 'external_ref',
							values: { ...values, ref }
						})
					});
				refs.add(ref);
			}
		}
		const keys = [...new Set(rows.map((row) => siteKey(addressOf(row), unitOf(row))))];
		const codes = [...new Set(rows.map((row) => row.site?.trim() ?? ''))];
		// the sites the sheet names, the work already filed on them, and any job already holding a sheet reference
		const MATCHED = { or: [{ site_key: { in: keys } }, { site_code: { in: codes } }] } as const;
		const { sites, job_assignments: work } = yield* ctx.query({
			sites: { where: MATCHED, fields: ['site_code', 'site_key'] },
			job_assignments: {
				where: { or: [{ site_id: { is: MATCHED } }, { external_ref: { in: [...refs] } }] },
				fields: ['site_id', 'scheduled_for', 'title', 'external_ref']
			}
		});
		const byCode = new Map(
			sites.rows.flatMap((s) => (s.site_code == null ? [] : [[s.site_code, s.id] as const]))
		);
		const byKey = new Map(sites.rows.map((s) => [s.site_key, s.id] as const));
		const siteOf = (row: Row) =>
			byCode.get(row.site?.trim() ?? '') ?? byKey.get(siteKey(addressOf(row), unitOf(row)));
		const filed = new Set([
			...work.rows.flatMap((job) => (job.external_ref == null ? [] : [job.external_ref])),
			...work.rows.map((job) => sameWork(String(job.site_id), String(job.scheduled_for), job.title))
		]);
		const job = (row: Row) => {
			const contact = row.assignee_contact?.trim() ?? '';
			return {
				title: row.title?.trim() ?? '',
				nature: (row.nature?.trim() ?? '') || null,
				scheduled_for: row.scheduled_for,
				description: row.description?.trim() ?? '',
				...(contact === '' ? {} : { assignee_contact: contact }),
				...((row.external_ref?.trim() ?? '') === ''
					? {}
					: { external_ref: row.external_ref?.trim() ?? '' })
			};
		};
		const onSites: (ReturnType<typeof job> & {
			site_id: Id<'sites'>;
		})[] = [];
		const fresh = new Map<
			string,
			{
				address: string;
				unit_number: string | null;
				location: { lat: number; lng: number };
				jobs: ReturnType<typeof job>[];
			}
		>();
		let skipped = 0;
		for (const [index, row] of rows.entries()) {
			const siteId = siteOf(row);
			const key = siteKey(addressOf(row), unitOf(row));
			const identity =
				(row.external_ref?.trim() ?? '') ||
				sameWork(siteId ?? `new:${key}`, row.scheduled_for, row.title);
			if (filed.has(identity)) {
				skipped += 1;
				continue;
			}
			filed.add(identity);
			if (siteId !== undefined) onSites.push({ ...job(row), site_id: siteId });
			else {
				const { latitude, longitude } = row;
				if (
					latitude == null ||
					longitude == null ||
					!Number.isFinite(latitude) ||
					!Number.isFinite(longitude) ||
					latitude < -90 ||
					latitude > 90 ||
					longitude < -180 ||
					longitude > 180
				) {
					problems.push({
						row: index,
						refusal: ctx.refuse('errors.sheet_site_unlocated', {
							row: index,
							field: 'latitude',
							values: where(index, row)
						})
					});
					continue;
				}
				// one new site per location and unit, labelled as the sheet first did
				const site = fresh.get(key) ?? {
					address: addressOf(row),
					unit_number: unitOf(row),
					location: { lat: latitude, lng: longitude },
					jobs: []
				};
				site.jobs.push(job(row));
				fresh.set(key, site);
			}
		}
		const [first] = problems.toSorted((a, b) => a.row - b.row);
		if (first !== undefined) return yield* first.refusal;
		const newSites = [...fresh.values()].map((site) => ({
			address: site.address,
			unit_number: site.unit_number,
			location: site.location,
			job_assignments: site.jobs
		}));
		// Fresh sites carry their own jobs; the other jobs name existing sites. Both settle together.
		if (newSites.length > 0 || onSites.length > 0)
			yield* ctx.act({
				...(newSites.length > 0 ? { 'sites.create': newSites } : {}),
				...(onSites.length > 0 ? { 'job_assignments.create': onSites } : {})
			});
		return { created: rows.length - skipped, sites: fresh.size, skipped };
	}
});
