/** A file name from a project name: `Client Portal!` → `client-portal`. */
export function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
}

/** Saves Markdown text as a download built in the browser (L-TPL-project-delivery-002). */
export function downloadMarkdown(markdown: string, filename: string): void {
	const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}
