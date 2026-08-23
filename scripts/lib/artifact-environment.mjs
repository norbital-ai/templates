export const templateEnvironmentVariables = new Map([
	['construction', ['REPORTS_WEBHOOK_SECRET']],
	['crm', ['EXTERNAL_SYSTEM_TOKEN']],
	['field-operations', ['DISPATCH_WEBHOOK_SECRET']],
	['hr-payroll', ['GEOCODING_API_KEY', 'MAP_TILE_URL', 'PAYROLL_EXPORT_SIGNING_SECRET']]
]);

/** Require the compiled artifact to expose exactly the environment declaration authored by a template. */
export function validateTemplateEnvironmentVariables(templateSlug, actualVariables) {
	const expected = templateEnvironmentVariables.get(templateSlug);
	if (expected === undefined) return undefined;

	const actual = [...actualVariables].toSorted();
	const expectedSorted = expected.toSorted();
	if (
		actual.length !== expectedSorted.length ||
		actual.some((variable, index) => variable !== expectedSorted[index])
	) {
		throw new Error(
			`${templateSlug} artifact environment variables differ: expected ${expectedSorted.join(', ')}, received ${actual.join(', ') || '(none)'}.`
		);
	}
	return actual;
}
