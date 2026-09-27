import type { Point } from '@norbital-ai/bolt';

/** A capture point farther than this from its site contradicts the site. */
const SITE_LOCATION_TOLERANCE_M = 500;

/** Great-circle distance in whole metres. */
export function haversineMeters(left: Point, right: Point): number {
	const R = 6371000;
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(right.lat - left.lat);
	const dLng = toRad(right.lng - left.lng);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(left.lat)) * Math.cos(toRad(right.lat)) * Math.sin(dLng / 2) ** 2;
	return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export const exceedsSiteTolerance = (left: Point, right: Point): boolean =>
	haversineMeters(left, right) > SITE_LOCATION_TOLERANCE_M;
