/**
 * A code a PAYROLL `rule_set` row of the governing version lists (`rules.kinds[] = { code, name }`): the exit grounds
 * (`exit_grounds`) and holiday kinds (`holiday_kinds`) are records, so a write is judged by the version in force on
 * its own day of the entity's lineage.
 */
import { Schema } from 'effect';
import { type HostRead, isJsonObject, joinedSetOf } from './foundation.js';

const isString = Schema.is(Schema.String);

/** The `{ code, name }` kinds a PAYROLL `rule_set` row lists under `rules.kinds`. */
export function kindsOf(
	rules: unknown
): readonly { readonly code: string; readonly name: string }[] {
	const listed = isJsonObject(rules) ? rules.kinds : undefined;
	return (Array.isArray(listed) ? listed : []).flatMap((kind) =>
		isJsonObject(kind) && isString(kind.code) && kind.code !== ''
			? [{ code: kind.code, name: isString(kind.name) ? kind.name : kind.code }]
			: []
	);
}

/** Refuses a code the version of the entity's lineage governing the day does not list under `rule`. */
export async function refuseUnlistedKind(
	input: {
		readonly rule: string;
		/** What the code is, for the refusal: `exit ground`, `holiday kind`. */
		readonly noun: string;
		readonly company_id: string;
		readonly code: string;
		readonly day: string;
	},
	read: HostRead
): Promise<string | null> {
	// One read: the entity, its lineage's sealed versions (by its `settings_code`) with their rows of the rule.
	const got = await joinedSetOf(read)({
		entity: {
			collection: 'entity',
			where: { id: { eq: input.company_id } },
			selection: { id: true, settings_code: true }
		},
		versions: {
			collection: 'jurisdiction_settings',
			where: {
				code: { in: { member: 'entity', field: 'settings_code' } },
				sealed_at: { isNull: false },
				voided_at: { isNull: true }
			},
			selection: {
				id: true,
				effective_range: true,
				rule_set: {
					many: { rules: true },
					where: { family: { eq: 'PAYROLL' }, code: { eq: input.rule } }
				}
			}
		}
	});
	const lineage = got<{ settings_code?: unknown }>('entity')[0]?.settings_code;
	if (!isString(lineage)) return 'This needs its legal entity.';
	const version = got<{ effective_range?: unknown; rule_set?: unknown }>('versions').find((row) => {
		const range = isJsonObject(row.effective_range) ? row.effective_range : null;
		return (
			range != null &&
			String(range['from']) <= input.day &&
			(range['to'] == null || input.day <= String(range['to']))
		);
	});
	if (version == null) return `No sealed ${lineage} jurisdiction version governs ${input.day}.`;
	const rows = {
		rows: (Array.isArray(version.rule_set) ? version.rule_set : []).flatMap((row: unknown) =>
			isJsonObject(row) ? [row] : []
		)
	};
	return rows.rows.some((row) => kindsOf(row['rules']).some((kind) => kind.code === input.code))
		? null
		: `${lineage} lists no ${input.noun} ${input.code} on ${input.day}.`;
}
