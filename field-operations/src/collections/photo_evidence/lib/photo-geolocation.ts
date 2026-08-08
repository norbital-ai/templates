import { SITE_LOCATION_TOLERANCE_M, exceedsSiteTolerance } from '../../../lib/haversine.js';
import type { PhotoIntegrityFlag } from './photo-integrity.js';

export function evaluateCaptureGeolocation(
	capture: { lat: number; lon: number } | null,
	site: { lat: number; lon: number } | null,
	maxDistanceM = SITE_LOCATION_TOLERANCE_M
): PhotoIntegrityFlag[] {
	if (capture == null) return ['missing_geolocation'];
	if (site == null) return [];
	if (exceedsSiteTolerance(capture, site, maxDistanceM)) return ['location_mismatch'];
	return [];
}
