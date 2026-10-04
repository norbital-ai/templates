import sys_channel_connection from './sys_channel_connection.json' with { type: 'json' };
import sys_envoy_channel from './sys_envoy_channel.json' with { type: 'json' };
import sys_envoy from './sys_envoy.json' with { type: 'json' };
import type { BankReader, SeedSource } from '@norbital-ai/bolt';
import { hexToBinaryEmbedding, photoSourceKey, photoSummary } from '../src/lib/photo-integrity.js';
import { siteKey } from '../src/lib/site-key.js';
import * as Predicate from '../src/lib/guards.js';

/**
 * The sample pack from the bank tree `field-operations`, read without rewriting it. The rows are 0.0.0.x shapes; the
 * conversions are to 0.0.1 kinds: a `geolocation()` value becomes a point plus its address field, a day instant a
 * date, and the formerly generated `site_key` and photo `summary` are derived as the SQL did. The photos are produced
 * from `simulation.json` (one row per exported photo, its inspected facts included) and carry their JPEG as an asset.
 * `NORBITAL_SEED_PHOTOS` (`all` or a per-assignment count) samples them evenly across assignments, as before.
 */

type Row = { [field: string]: unknown };
type Geo = {
	geometry?: { lat?: number; lon?: number } | null;
	formatted_address?: string | null;
} | null;
type Photo = {
	fileName: string;
	sha256: string;
	perceptualHash: string;
	jobIndex: number;
	sentAt: string;
	flags: string[];
	matchedEvidenceIds: string[];
};
type Simulation = {
	conversationId: string;
	photoSeedPolicy?: { perAssignmentLimit?: number | 'all' };
	jobs: { contractor: string }[];
	photos: Photo[];
};

/** The sender each contractor appears as in the exported WhatsApp conversation. */
const SENDERS: { readonly [contractor: string]: string } = { bob: '~ B', yu_kiat: '~ YK - BCA' };
const pad12 = (n: number) => String(n).padStart(12, '0');

/** A `point` value, `{ lat, lng }`, from the bank's `geolocation()` geometry. */
const point = (geo: Geo) =>
	geo?.geometry?.lat == null || geo.geometry.lon == null
		? null
		: { lat: geo.geometry.lat, lng: geo.geometry.lon };
const day = (value: unknown) => (Predicate.isString(value) ? value.slice(0, 10) : value);
const amount = (value: unknown) =>
	Predicate.isObjectOrArray(value) && 'value' in value
		? (value as { value: unknown }).value
		: value;

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
		for (let i = 0; i < count; i += 1)
			chosen.add(
				entries[count === 1 ? 0 : Math.round((i * (entries.length - 1)) / (count - 1))]!.index
			);
	}
	return all.filter((entry) => chosen.has(entry.index));
}

function photoRows(bank: BankReader): Row[] {
	if (!bank.has('simulation.json')) return [];
	const simulation = bank.json<Simulation>('simulation.json');
	return sample(simulation).map(({ photo, index }) => {
		const source = {
			kind: 'channel' as const,
			provider: 'whatsapp',
			conversation_id: simulation.conversationId,
			// the export names each message by the first eight characters of its attachment file
			message_id: photo.fileName.slice(0, 8),
			attachment_id: photo.fileName,
			sender_id:
				SENDERS[simulation.jobs[photo.jobIndex]!.contractor] ??
				simulation.jobs[photo.jobIndex]!.contractor,
			sent_at: photo.sentAt
		};
		return {
			id: `019f6f10-5000-7000-8000-${pad12(index + 1)}`,
			created_at: photo.sentAt,
			updated_at: photo.sentAt,
			job_assignment_id: `019f6f10-3000-7000-8000-${pad12(photo.jobIndex + 1)}`,
			variation_request_id: null,
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
 * The public base pack (no bank): this directory's invented `<collection>.json` fixtures, read through the same
 * conversions. They name no member and carry no photos; an assignee no member on file holds is left unassigned.
 */
const PUBLIC = import.meta.glob<Row[]>('./*.json', { eager: true, import: 'default' });
// repository-health:allow R3b -- `rows` reads only `has` and `json` of the reader it is given
const fixtures = {
	has: (file: string) => `./${file}` in PUBLIC,
	json: (file: string) => PUBLIC[`./${file}`]
} as unknown as BankReader;

const source: SeedSource = {
	bank: 'field-operations',
	/** Seeded assignments arrive unchecked; the first admission reviews them. */
	start: ['review_job_assignment_suspicion'],
	rows(given) {
		const bank = given.has('sites.json') ? given : fixtures;
		const rows = (file: string) => (bank.has(file) ? bank.json<Row[]>(file) : []);
		const members = new Set(rows('user.json').map((r) => r['id']));
		return {
			sys_team: rows('team.json').map((r) => ({ id: r['id'], name: r['name'], parent: null })),
			sys_user: rows('user.json').map((r) => ({
				id: r['id'],
				name: r['name'],
				email: r['email'] ?? null,
				kind: 'staff',
				admin: r['status'] === 'admin',
				team: r['team_id'] ?? null
			})),
			sites: rows('sites.json').map(({ location, ...site }) => {
				const address = (location as Geo)?.formatted_address ?? null;
				return {
					...site,
					location: point(location as Geo),
					address,
					site_key: siteKey(String(site['name']), address)
				};
			}),
			job_assignments: rows('job_assignments.json').map(({ location, ...job }) => ({
				...job,
				assignee_user_id: members.has(job['assignee_user_id']) ? job['assignee_user_id'] : null,
				scheduled_for: day(job['scheduled_for']),
				amount_charged: amount(job['amount_charged']),
				location: point(location as Geo),
				location_address: (location as Geo)?.formatted_address ?? null,
				suspicion_checked_at: null
			})),
			communication_logs: rows('communication_logs.json'),
			photo_evidence: photoRows(bank)
		} as never;
	}
};
export default { ...source, async rows(bank: Parameters<SeedSource['rows']>[0]) { return { ...await source.rows(bank), sys_channel_connection, sys_envoy_channel, sys_envoy }; } } satisfies SeedSource;
