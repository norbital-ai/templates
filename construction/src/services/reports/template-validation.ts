const REPORT_BODY_VARIABLES = new Set(['report', 'reference', 'title', 'version', 'standard']);

export function validateReportTemplateBody(body: string): boolean {
	if (!body.trim()) return false;
	let reportCount = 0;
	for (const [, key] of body.matchAll(/\{([^{}]+)\}/g)) {
		if (key === undefined || !REPORT_BODY_VARIABLES.has(key)) return false;
		if (key === 'report') reportCount++;
	}
	return reportCount === 1;
}
