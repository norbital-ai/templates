import { Effect } from 'effect';
/**
 * A code a PAYROLL `rule_set` row of the governing version lists (`rules.kinds[] = { code, name }`): the exit grounds
 * (`exit_grounds`) and holiday kinds (`holiday_kinds`) are records, so a write is judged by the version in force on
 * its own day of the entity's lineage.
 */
import { Schema } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import { type Read, isJsonObject } from './foundation.js';
const isString = Schema.is(Schema.String);
/** The `{ code, name }` kinds a PAYROLL `rule_set` row lists under `rules.kinds`. */
export function kindsOf(rules: unknown): readonly {
	readonly code: string;
	readonly name: string;
}[] {
	const listed = isJsonObject(rules) ? rules.kinds : undefined;
	return (Array.isArray(listed) ? listed : []).flatMap((kind) =>
		isJsonObject(kind) && isString(kind.code) && kind.code !== ''
			? [{ code: kind.code, name: isString(kind.name) ? kind.name : kind.code }]
			: []
	);
}
/** Refuses a code the version of the entity's lineage governing the day does not list under `rule`. */
export const refuseUnlistedKind = Effect.fnUntraced(function* (
	input: {
		readonly rule: string;
		/** What the code is, for the refusal: `exit ground`, `holiday kind`. */
		readonly noun: string;
		readonly company_id: Id<'entity'>;
		readonly code: string;
		readonly day: string;
	},
	read: Read
) {
	// The entity, its lineage's sealed versions and the rule's rows share one native statement.
	const got = yield* read({
		entity: {
			collection: 'entity',
			where: { id: { eq: input.company_id } },
			select: { id: true, settings_code: true },
			all: true
		},
		versions: {
			collection: 'jurisdiction_settings',
			where: {
				code: { in: { member: 'entity', field: 'settings_code' } },
				sealed_at: { isNull: false },
				voided_at: { isNull: true }
			},
			select: { id: true, effective_range: true },
			all: true
		},
		rules: {
			collection: 'rule_set',
			where: {
				settings_id: { in: { member: 'versions', field: 'id' } },
				family: { eq: 'PAYROLL' },
				code: { eq: input.rule }
			},
			select: { settings_id: true, rules: true },
			all: true
		}
	});
	const lineage = got.entity.rows[0]?.settings_code;
	if (!isString(lineage)) return 'This needs its legal entity.';
	const version = got.versions.rows.find((row) => {
		const range = row.effective_range;
		return range != null && range.from <= input.day && (range.to == null || input.day <= range.to);
	});
	if (version == null) return `No sealed ${lineage} jurisdiction version governs ${input.day}.`;
	return got.rules.rows.some(
		(row) =>
			row.settings_id === version.id && kindsOf(row.rules).some((kind) => kind.code === input.code)
	)
		? null
		: `${lineage} lists no ${input.noun} ${input.code} on ${input.day}.`;
});
