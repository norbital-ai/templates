const SITE_LOCATION_TOLERANCE_M = 500;

type GeoPoint = { readonly lat: number; readonly lon: number };

/** A geolocation as a `geolocation()` column or a site's `location` read back, tolerating nulls. */
type LocationLike =
	| {
			readonly geometry?: { readonly lat?: number | null; readonly lon?: number | null } | null;
	  }
	| null
	| undefined;

/** The concrete coordinates a geo shape carries, or nothing when either axis is missing. */
export function coordinatesOf(location: LocationLike): { lat: number; lon: number } | null {
	const lat = location?.geometry?.lat;
	const lon = location?.geometry?.lon;
	if (lat == null || lon == null) return null;
	return { lat, lon };
}

function haversineMeters(left: GeoPoint, right: GeoPoint): number {
	const R = 6371000;
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(right.lat - left.lat);
	const dLon = toRad(right.lon - left.lon);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(left.lat)) * Math.cos(toRad(right.lat)) * Math.sin(dLon / 2) ** 2;
	return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export function exceedsSiteTolerance(left: GeoPoint, right: GeoPoint): boolean {
	return haversineMeters(left, right) > SITE_LOCATION_TOLERANCE_M;
}
