import type { BankReader, SeedSource } from '@norbital-ai/bolt';
import { hexToBinaryEmbedding, photoSourceKey, photoSummary } from '../src/lib/photo-integrity.js';
import { siteKey } from '../src/lib/site-key.js';
import { Instant } from '@norbital-ai/std/date';
import { Predicate, Schema, SchemaTransformation } from 'effect';

/**
 * The sample pack from the bank tree `field-operations`, read without rewriting it. The rows are 0.0.0.x shapes; the
 * conversions are to 0.0.1 kinds: a `geolocation()` value becomes a point plus its address field, a day instant a
 * date, a member's team id its team handle, and the formerly generated `site_key` and photo `summary` are derived as
 * the SQL did. The photos are produced from `simulation.json` (one row per exported photo, its inspected facts included)
 * and carry their JPEG as an asset.
 * `NORBITAL_SEED_PHOTOS` (`all` or a per-assignment count) samples them evenly across assignments.
 */

const Row = Schema.Record(Schema.String, Schema.Json);
type Row = Schema.Schema.Type<typeof Row>;
const decodeRows = Schema.decodeUnknownSync(Schema.Array(Row));
const User = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	email: Schema.optionalKey(Schema.NullOr(Schema.String)),
	phone: Schema.optionalKey(Schema.NullOr(Schema.String)),
	active: Schema.optionalKey(Schema.Boolean),
	status: Schema.optionalKey(Schema.String),
	team_id: Schema.optionalKey(Schema.NullOr(Schema.String))
});
const Geo = Schema.UndefinedOr(
	Schema.NullOr(
		Schema.Struct({
			geometry: Schema.optionalKey(
				Schema.NullOr(
					Schema.Struct({
						lat: Schema.optionalKey(Schema.Number),
						lon: Schema.optionalKey(Schema.Number)
					})
				)
			),
			formatted_address: Schema.optionalKey(Schema.NullOr(Schema.String))
		})
	)
);
type Geo = Schema.Schema.Type<typeof Geo>;
const Simulation = Schema.Struct({
	conversationId: Schema.String,
	photoSeedPolicy: Schema.optionalKey(
		Schema.Struct({
			perAssignmentLimit: Schema.optionalKey(Schema.Union([Schema.Natural, Schema.Literal('all')]))
		})
	),
	jobs: Schema.Array(Schema.Struct({ contractor: Schema.String })),
	photos: Schema.Array(
		Schema.Struct({
			fileName: Schema.String,
			sha256: Schema.String,
			perceptualHash: Schema.String,
			jobIndex: Schema.Natural,
			sentAt: Schema.String,
			flags: Schema.Array(Schema.String),
			matchedEvidenceIds: Schema.Array(Schema.String)
		})
	)
});
type Simulation = Schema.Schema.Type<typeof Simulation>;

/** The bank's team ids as this template's team handles (`+team.ts`); the bank itself is never rewritten. */
const TEAMS: { readonly [bankTeam: string]: string } = {
	'019f8a40-0000-7000-8000-000000000001': 'field_ops_controllers',
	'019f8a40-0000-7000-8000-000000000002': 'contractors',
	'019f8a40-0000-7000-8000-000000000003': 'contractor_controllers'
};
const teamOf = (bankTeam: string | null | undefined) => {
	if (bankTeam == null) return null;
	const handle = TEAMS[bankTeam];
	if (handle === undefined)
		throw new Error(`user.json names team ${bankTeam}, which no team handle maps`);
	return handle;
};
/** The sender each contractor appears as in the exported WhatsApp conversation. */
const SENDERS: { readonly [contractor: string]: string } = { bob: '~ B', yu_kiat: '~ YK - BCA' };
const pad12 = (n: number) => String(n).padStart(12, '0');

/** A `point` value, `{ lat, lng }`, from the bank's `geolocation()` geometry. */
const point = (geo: Geo) =>
	geo?.geometry?.lat == null || geo.geometry.lon == null
		? null
		: { lat: geo.geometry.lat, lng: geo.geometry.lon };
const day = (value: Row[string]) => (Predicate.isString(value) ? value.slice(0, 10) : value);
/** A 0.0.0.x money object `{ value }` unwraps to its value; any other value passes through. */
const amount = Schema.decodeUnknownSync(
	Schema.Union([
		Schema.Struct({ value: Schema.Json }).pipe(
			Schema.decodeTo(
				Schema.Json,
				SchemaTransformation.transform({
					decode: ({ value }) => value,
					encode: (value) => ({ value })
				})
			)
		),
		Schema.Json
	])
);

/** Photos per assignment, spread evenly; ids come from the index in the full manifest, so a sample is a subset. */
function sample(simulation: Simulation, override = process.env['NORBITAL_SEED_PHOTOS']) {
	const configured = (override ?? '').trim().toLowerCase();
	const limit =
		configured === ''
			? simulation.photoSeedPolicy?.perAssignmentLimit === 'all' ||
				simulation.photoSeedPolicy === undefined
				? Number.POSITIVE_INFINITY
				: (simulation.photoSeedPolicy.perAssignmentLimit ?? Number.POSITIVE_INFINITY)
			: configured === 'all'
				? Number.POSITIVE_INFINITY
				: Number.parseInt(configured, 10);
	const all = simulation.photos.map((photo, index) => ({ photo, index }));
	if (limit === Number.POSITIVE_INFINITY) return all;
	const chosen = new Set<number>();
	for (const entries of Map.groupBy(all, (entry) => entry.photo.jobIndex).values()) {
		const count = Math.min(limit, entries.length);
		for (let i = 0; i < count; i += 1) {
			const entry = entries[count === 1 ? 0 : Math.round((i * (entries.length - 1)) / (count - 1))];
			if (entry !== undefined) chosen.add(entry.index);
		}
	}
	return all.filter((entry) => chosen.has(entry.index));
}

function photoRows(bank: Pick<BankReader, 'has' | 'json'>): Row[] {
	if (!bank.has('simulation.json')) return [];
	const simulation = Schema.decodeUnknownSync(Simulation)(bank.json('simulation.json'));
	return sample(simulation).map(({ photo, index }) => {
		const job = simulation.jobs[photo.jobIndex];
		if (job === undefined)
			throw new Error(`simulation.json photo ${index} names missing job ${photo.jobIndex}`);
		const source = {
			kind: 'message' as const,
			integration: 'whatsapp',
			conversation_id: simulation.conversationId,
			// the export names each message by the first eight characters of its attachment file
			message_id: photo.fileName.slice(0, 8),
			attachment_id: photo.fileName,
			sender_id: SENDERS[job.contractor] ?? job.contractor,
			sent_at: Instant(photo.sentAt)
		};
		return {
			id: `019f6f10-5000-7000-8000-${pad12(index + 1)}`,
			created_at: photo.sentAt,
			updated_at: photo.sentAt,
			job_assignment_id: `019f6f10-3000-7000-8000-${pad12(photo.jobIndex + 1)}`,
			photo: { asset: `assets/${photo.fileName}` },
			source,
			source_key: photoSourceKey(source, ''),
			sha256: photo.sha256,
			perceptual_embedding: hexToBinaryEmbedding(photo.perceptualHash),
			scene_embedding: null,
			flags: photo.flags,
			matched_evidence_ids: photo.matchedEvidenceIds,
			summary: photoSummary(source)
		};
	});
}

/**
 * The public base pack (no bank): this directory's invented `<model>.json` fixtures, read through the same
 * conversions. They name no member and carry no photos; an assignee no member on file holds is left unlinked.
 */
const PUBLIC = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' });

const source: SeedSource = {
	bank: 'field-operations',
	/** Seeded assignments arrive unchecked; the first admission reviews them. */
	start: ['review_job_assignment_suspicion'],
	rows(given) {
		const bank = given.has('sites.json') ? given : null;
		const rows = (file: string) =>
			bank === null
				? decodeRows(PUBLIC[`./${file}`] ?? [])
				: bank.has(file)
					? decodeRows(bank.json(file))
					: [];
		const users = rows('user.json').map((value) => Schema.decodeUnknownSync(User)(value));
		const members = new Set(users.map((r) => r.id));
		return {
			sys_user: users.map((r) => ({
				id: r['id'],
				name: r['name'],
				email: r['email'] ?? null,
				phone: r['phone'] ?? null,
				kind: 'staff',
				active: r['active'] ?? true,
				admin: r['status'] === 'admin',
				team: teamOf(r['team_id'])
			})),
			sites: rows('sites.json').map(({ location, ...site }) => {
				const geo = Schema.decodeUnknownSync(Geo)(location);
				const address = geo?.formatted_address ?? null;
				return {
					...site,
					location: point(geo),
					address,
					site_key: siteKey(
						address || String(site['name']),
						/#[0-9]+-[0-9A-Z]+/i.exec(String(site['name']))?.[0]
					)
				};
			}),
			job_assignments: rows('job_assignments.json').map(({ location, ...job }) => {
				const geo = Schema.decodeUnknownSync(Geo)(location);
				const assignee = job['assignee_user_id'];
				return {
					...job,
					// a job is pending until completed; who holds it is the link, not a status
					...(job['status'] === undefined
						? {}
						: { status: job['status'] === 'completed' ? 'completed' : 'pending' }),
					assignee_user_id: Predicate.isString(assignee) && members.has(assignee) ? assignee : null,
					...(job['scheduled_for'] === undefined
						? {}
						: { scheduled_for: day(job['scheduled_for']) }),
					...(job['amount_charged'] === undefined
						? {}
						: { amount_charged: amount(job['amount_charged']) }),
					location: point(geo),
					location_address: geo?.formatted_address ?? null,
					suspicion_checked_at: null
				};
			}),
			communication_logs: rows('communication_logs.json'),
			photo_evidence: bank === null ? [] : photoRows(bank)
		};
	}
};
export default source;
