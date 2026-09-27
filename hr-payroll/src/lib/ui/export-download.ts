/** How long a saved file's object URL outlives the click that downloads it. */
const OBJECT_URL_LIFETIME_MS = 60_000;

/** Saves bytes the browser built (the roster import template) as a file. */
export function saveBlob(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = name;
	anchor.rel = 'noopener';
	anchor.click();
	// The URL is revoked after the download has had time to start; revoking on return would cancel it.
	setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
}
