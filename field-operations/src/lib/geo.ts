import { Schema } from 'effect';

const SITE_LOCATION_TOLERANCE_M = 500;

const geoPointSchema = Schema.Struct({
	lat: Schema.optional(Schema.NullOr(Schema.Number)),
	lon: Schema.optional(Schema.NullOr(Schema.Number))
});

/** A geolocation as a `geolocation()` column or a site's `location` read back, tolerating nulls. */
const locationLikeSchema = Schema.optional(
	Schema.NullOr(Schema.Struct({ geometry: Schema.optional(Schema.NullOr(geoPointSchema)) }))
);

export type LocationLike = Schema.Schema.Type<typeof locationLikeSchema>;

/** The concrete coordinates a geo shape carries, or nothing when either axis is missing. */
export function coordinatesOf(location: LocationLike): { lat: number; lon: number } | null {
	const lat = location?.geometry?.lat;
	const lon = location?.geometry?.lon;
	if (lat == null || lon == null) return null;
	return { lat, lon };
}

function haversineMeters(
	lat1: number | null | undefined,
	lon1: number | null | undefined,
	lat2: number | null | undefined,
	lon2: number | null | undefined
): number | null {
	if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
	const R = 6371000;
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export function exceedsSiteTolerance(
	left: { lat: number; lon: number } | null | undefined,
	right: { lat: number; lon: number } | null | undefined,
	maxDistanceM = SITE_LOCATION_TOLERANCE_M
): boolean {
	const distanceM = haversineMeters(left?.lat, left?.lon, right?.lat, right?.lon);
	return distanceM != null && distanceM > maxDistanceM;
}

export { SITE_LOCATION_TOLERANCE_M };
