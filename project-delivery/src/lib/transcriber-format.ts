/**
 * Format a duration or timestamp in seconds as mm:ss. Shared by the transcriber app (recording
 * elapsed time, clip duration) and the transcription worker (per-line transcript timestamps) so
 * there is exactly one implementation of this formatting.
 */
export function formatDuration(totalSeconds: number): string {
	const total = Math.max(0, Math.round(totalSeconds));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
