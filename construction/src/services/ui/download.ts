/** Client-side text/CSV/IFC file download helper. */
export function downloadTextFile(
	content: string,
	filename: string,
	mime = 'text/plain;charset=utf-8'
): void {
	const url = URL.createObjectURL(new Blob([content], { type: mime }));
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Sanitizes a project or document title for use as a download filename prefix. */
export const safeFilename = (raw: string, fallback = 'export'): string =>
	raw.replace(/[^a-zA-Z0-9_-]+/g, '_') || fallback;
