/**
 * The statutory schemes of the version on screen, as combobox options and as a code lookup.
 *
 * Every opt-in control picks a scheme by code, never by hand-typed UUID, and the code shown in a
 * matrix cell must be the same string the editor offers. One live query per call site, keyed by
 * the settings scope the surface already carries.
 */
import { client } from '../workspace-client.js';
import { hrCreateScope } from './create-scope.js';

type SchemeOption = {
	readonly value: string;
	readonly label: string;
	readonly search_term: string;
};

export function statutorySchemeOptions(): {
	readonly options: SchemeOption[];
	readonly codeOf: (contributionId: string) => string;
} {
	const scope = hrCreateScope();
	const settingsId = $derived(scope?.settingsId?.());
	const schemesQuery = $derived(
		client.db.statutory_contributions.findMany({
			where: {
				...(settingsId == null ? {} : { settings_id: { eq: settingsId } }),
				approval_id: { isNull: true }
			},
			columns: { id: true, code: true, name: true },
			orderBy: { code: 'asc' },
			limit: 500
		})
	);
	const options = $derived(
		(schemesQuery?.current ?? []).map((scheme) => ({
			value: scheme.id,
			label: scheme.code,
			search_term: `${scheme.code} ${scheme.name}`
		}))
	);
	const codeOf = (contributionId: string): string =>
		options.find((option) => option.value === contributionId)?.label ?? contributionId;
	return { options, codeOf };
}
