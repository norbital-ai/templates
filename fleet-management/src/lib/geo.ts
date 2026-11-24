import { BigDecimal, DateTime, Option, Schema } from 'effect';
import type { PlainTime } from '@norbital-ai/bolt';
import * as Predicate from 'effect/Predicate';
import { isArray } from 'effect/Array';

const PLAIN_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

/** Effect Schema validating an HH:MM[:SS] clock string into Bolt's branded `PlainTime`. */
export const PlainTimeSchema = Schema.declare(
	(u: unknown): u is PlainTime => typeof u === 'string' && PLAIN_TIME_RE.test(u),
	{ identifier: 'PlainTime', expected: 'an HH:MM or HH:MM:SS clock time' }
);

/** Parses a clock string into Bolt's branded `PlainTime`, returning `null` if blank or invalid. */
export const parsePlainTime = (raw: string | null | undefined): PlainTime | null =>
	raw == null ? null : Option.getOrNull(Schema.decodeUnknownOption(PlainTimeSchema)(raw.trim()));

export type GeoPoint = {
	readonly lat: number;
	readonly lng: number;
};

export type RouteWaypoint = {
	readonly name: string;
	readonly lat: number;
	readonly lng: number;
	readonly eta?: string | null;
	readonly arrived_at?: string | null;
	readonly status?: 'pending' | 'arrived' | 'skipped' | null;
};

export type NormalizedPing = {
	readonly transponder_id: string;
	readonly recorded_at: string;
	readonly location: GeoPoint;
	readonly speed_kmh: string;
	readonly heading_deg: string | null;
	readonly altitude_m: string | null;
	readonly ignition_on: boolean;
	readonly odometer_km: string | null;
	readonly fuel_pct: string | null;
	readonly hdop: string | null;
	readonly external_ping_id: string | null;
};

const EARTH_RADIUS_KM = 6371.0088;
const ZERO_DEC = BigDecimal.fromBigInt(0n);
const MOVING_SPEED_KMH = BigDecimal.fromBigInt(3n);

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/** Parses a decimal string or number into an exact Effect BigDecimal (never float arithmetic). */
export function toDecimal(
	value: string | number | null | undefined,
	fallback: BigDecimal.BigDecimal = ZERO_DEC
): BigDecimal.BigDecimal {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed === '') return fallback;
		return Option.getOrElse(BigDecimal.fromString(trimmed), () => fallback);
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Option.getOrElse(BigDecimal.fromNumber(value), () => fallback);
	}
	return fallback;
}

/** Exact fixed-scale formatter for an Effect BigDecimal. */
export function formatBigDecimal(value: BigDecimal.BigDecimal, scale: number): string {
	const rounded = BigDecimal.round(value, { scale, mode: 'half-even' });
	const raw = BigDecimal.format(rounded);
	if (scale <= 0) return raw;
	const dot = raw.indexOf('.');
	if (dot === -1) return `${raw}.${'0'.repeat(scale)}`;
	const frac = raw.slice(dot + 1);
	return frac.length >= scale
		? raw.slice(0, dot + 1 + scale)
		: `${raw}${'0'.repeat(scale - frac.length)}`;
}

/** Exact decimal formatting helper backed by Effect BigDecimal. */
export function formatDecimal(value: number | string, scale: number): string {
	return formatBigDecimal(toDecimal(value, ZERO_DEC), scale);
}

/**
 * Parses an ISO instant strictly via Effect DateTime; rejects unzoned strings and impossible
 * calendar dates (such as 2026-02-30T00:00:00Z that would otherwise roll over).
 */
export function parseInstant(raw: string | null | undefined): DateTime.Utc | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	const match =
		/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/i.exec(
			trimmed
		);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const cal = DateTime.make({ year, month, day });
	if (Option.isNone(cal)) return null;
	const parts = DateTime.toPartsUtc(cal.value);
	if (parts.year !== year || parts.month !== month || parts.day !== day) return null;
	return Option.getOrNull(DateTime.make(trimmed));
}

/** Great-circle distance in kilometers between two WGS84 points. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
	const dLat = toRadians(b.lat - a.lat);
	const dLng = toRadians(b.lng - a.lng);
	const lat1 = toRadians(a.lat);
	const lat2 = toRadians(b.lat);
	const sinLat = Math.sin(dLat / 2);
	const sinLng = Math.sin(dLng / 2);
	const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Great-circle distance in meters between two WGS84 points. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
	return haversineKm(a, b) * 1000;
}

/** Whether `point` lies within `radiusM` meters of `center`. */
export function isInsideGeofence(point: GeoPoint, center: GeoPoint, radiusM: number): boolean {
	return haversineMeters(point, center) <= radiusM;
}

/** Computes total polyline route distance (origin -> waypoints -> destination) in km. */
export function computeRouteDistanceKm(
	origin: GeoPoint,
	destination: GeoPoint,
	waypoints?: readonly RouteWaypoint[] | null
): string {
	const points: GeoPoint[] = [origin];
	if (waypoints) {
		for (const wp of waypoints) {
			if (Number.isFinite(wp.lat) && Number.isFinite(wp.lng)) {
				points.push({ lat: wp.lat, lng: wp.lng });
			}
		}
	}
	points.push(destination);
	let totalKm = 0;
	for (let i = 1; i < points.length; i++) {
		const prev = points[i - 1];
		const curr = points[i];
		if (prev && curr) totalKm += haversineKm(prev, curr);
	}
	return formatDecimal(totalKm * 1.22, 2);
}

/** Estimates travel duration in whole minutes from remaining distance and current/assumed road speed. */
export function estimateEtaMinutes(
	current: GeoPoint,
	destination: GeoPoint,
	currentSpeedKmh?: number | string | null,
	fallbackSpeedKmh = 42
): number {
	const straightKm = haversineKm(current, destination);
	if (straightKm < 0.08) return 0;
	const roadKm = straightKm * 1.22;
	const rawSpeed = BigDecimal.toNumberUnsafe(toDecimal(currentSpeedKmh, ZERO_DEC));
	const effectiveSpeed = rawSpeed >= 15 ? Math.min(95, rawSpeed) : Math.max(20, fallbackSpeedKmh);
	return Math.max(1, Math.ceil((roadKm / effectiveSpeed) * 60));
}

/** Derives live vehicle operational status from the latest GPS transponder ping using exact BigDecimal speed. */
export function deriveVehicleStatus(
	currentStatus: string,
	speedKmh: BigDecimal.BigDecimal,
	ignitionOn: boolean
): 'available' | 'en_route' | 'idle' | 'stopped' | 'maintenance' | 'offline' {
	if (currentStatus === 'maintenance') return 'maintenance';
	if (BigDecimal.isGreaterThan(speedKmh, MOVING_SPEED_KMH)) return 'en_route';
	if (ignitionOn) return 'idle';
	return 'stopped';
}

const asRecord = (v: unknown): Readonly<Record<string, unknown>> | null =>
	Predicate.isObject(v) && !isArray(v) ? v : null;

const readString = (obj: Readonly<Record<string, unknown>>, ...keys: string[]): string | null => {
	for (const k of keys) {
		const v = obj[k];
		if (Predicate.isString(v) && v.trim() !== '') return v.trim();
	}
	return null;
};

const readNumber = (obj: Readonly<Record<string, unknown>>, ...keys: string[]): number | null => {
	for (const k of keys) {
		const v = obj[k];
		if (Predicate.isNumber(v) && Number.isFinite(v)) return v;
		if (Predicate.isString(v) && v.trim() !== '') {
			const n = Number(v.trim());
			if (Number.isFinite(n)) return n;
		}
	}
	return null;
};

const readBool = (obj: Readonly<Record<string, unknown>>, ...keys: string[]): boolean | null => {
	for (const k of keys) {
		const v = obj[k];
		if (Predicate.isBoolean(v)) return v;
		if (v === 1 || v === '1' || v === 'true') return true;
		if (v === 0 || v === '0' || v === 'false') return false;
	}
	return null;
};

/**
 * Normalizes raw GPS transponder polling payloads (single object, array, or `{ pings | positions | data | items }`).
 * Invalid coordinates, unzoned/malformed timestamps, or entries missing a transponder ID are handled safely at the boundary.
 */
export function normalizeTransponderPayload(
	payload: unknown,
	fallbackInstant: string
): readonly NormalizedPing[] {
	const rawList: unknown[] = (() => {
		if (isArray(payload)) return payload;
		const root = asRecord(payload);
		if (!root) return [];
		for (const key of ['pings', 'positions', 'telemetry', 'items', 'data', 'records']) {
			const candidate = root[key];
			if (isArray(candidate)) return candidate;
		}
		return [root];
	})();

	const fallbackDt = parseInstant(fallbackInstant);
	const safeFallback = fallbackDt ? DateTime.formatIso(fallbackDt) : fallbackInstant;

	const out: NormalizedPing[] = [];
	for (const item of rawList) {
		const rec = asRecord(item);
		if (!rec) continue;
		const transponderId = readString(
			rec,
			'transponder_id',
			'device_id',
			'imei',
			'unit_id',
			'tracker_id'
		);
		const locObj =
			asRecord(rec['location']) ?? asRecord(rec['position']) ?? asRecord(rec['coords']);
		const lat =
			readNumber(rec, 'lat', 'latitude') ?? (locObj ? readNumber(locObj, 'lat', 'latitude') : null);
		const lng =
			readNumber(rec, 'lng', 'lon', 'longitude') ??
			(locObj ? readNumber(locObj, 'lng', 'lon', 'longitude') : null);
		if (!transponderId || lat === null || lng === null) continue;
		if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

		const rawTs = readString(rec, 'recorded_at', 'timestamp', 'fix_time', 'gps_time', 'at');
		const parsedTs = rawTs !== null ? parseInstant(rawTs) : null;
		// Reject malformed/unzoned explicit vendor timestamps; default only when timestamp omitted.
		if (rawTs !== null && parsedTs === null) continue;
		const recordedAt = parsedTs !== null ? DateTime.formatIso(parsedTs) : safeFallback;

		const speedRaw = Math.max(0, readNumber(rec, 'speed_kmh', 'speed', 'velocity_kmh') ?? 0);
		const headingRaw = readNumber(rec, 'heading_deg', 'heading', 'course', 'bearing');
		const altRaw = readNumber(rec, 'altitude_m', 'altitude', 'alt');
		const odoRaw = readNumber(rec, 'odometer_km', 'odometer');
		const fuelRaw = readNumber(rec, 'fuel_pct', 'fuel_level', 'fuel');
		const hdopRaw = readNumber(rec, 'hdop', 'accuracy_hdop');
		const ignition = readBool(rec, 'ignition_on', 'ignition', 'acc') ?? speedRaw > 1;
		const externalId = readString(rec, 'external_ping_id', 'ping_id', 'event_id', 'id');

		out.push({
			transponder_id: transponderId,
			recorded_at: recordedAt,
			location: { lat, lng },
			speed_kmh: formatDecimal(speedRaw, 1),
			heading_deg: headingRaw !== null ? formatDecimal(((headingRaw % 360) + 360) % 360, 1) : null,
			altitude_m: altRaw !== null ? formatDecimal(altRaw, 1) : null,
			ignition_on: ignition,
			odometer_km: odoRaw !== null && odoRaw >= 0 ? formatDecimal(odoRaw, 1) : null,
			fuel_pct: fuelRaw !== null ? formatDecimal(Math.max(0, Math.min(100, fuelRaw)), 1) : null,
			hdop: hdopRaw !== null && hdopRaw >= 0 ? formatDecimal(hdopRaw, 2) : null,
			external_ping_id: externalId
		});
	}
	return out;
}
