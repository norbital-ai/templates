import { Effect, Option, Schema } from 'effect';
/**
 * A code a PAYROLL `rule_set` row of the governing version lists (`rules.kinds[] = { code, name }`): the exit grounds
 * (`exit_grounds`) and holiday kinds (`holiday_kinds`) are records, so a write is judged by the version in force on
 * its own day of the entity's lineage.
 */
import type { Id } from '@norbital-ai/bolt';
import type { Read } from './foundation.js';
const isString = Schema.is(Schema.String);
/** A kinds slot of a PAYROLL `rule_set` row (`exit_grounds`, `holiday_kinds`, `case_kinds`). */
const ListedKinds = Schema.Struct({
	kinds: Schema.Array(
		Schema.Struct({
			code: Schema.String.check(Schema.isMinLength(1)),
			name: Schema.optional(Schema.String)
		})
	)
});
/** The `{ code, name }` kinds a PAYROLL `rule_set` row lists under `rules.kinds`, decoded once; a malformed slot lists none. */
export function kindsOf(rules: unknown): readonly {
	readonly code: string;
	readonly name: string;
}[] {
	const decoded = Schema.decodeUnknownOption(ListedKinds)(rules);
	return Option.isNone(decoded)
		? []
		: decoded.value.kinds.map(({ code, name }) => ({ code, name: name ?? code }));
}
export type KindRequest = {
	readonly rule: string;
	readonly noun: string;
	readonly company_id: Id<'entity'>;
	readonly code: string;
	readonly day: string;
};
/** Every entity, version and kinds slot a write batch needs, in two reads (the lineage is named by the entity's code). */
export const refuseUnlistedKinds = Effect.fnUntraced(function* (
	inputs: readonly KindRequest[],
	read: Read
) {
	if (inputs.length === 0) return [];
	const { entity } = yield* read({
		entity: {
			where: { id: { in: [...new Set(inputs.map((input) => input.company_id))] } },
			fields: ['settings_code']
		}
	});
	const { jurisdiction_settings } = yield* read({
		jurisdiction_settings: {
			where: {
				code: {
					in: [
						...new Set(
							entity.rows.flatMap((row) => (isString(row.settings_code) ? [row.settings_code] : []))
						)
					]
				},
				sealed_at: { isNull: false },
				voided_at: { isNull: true }
			},
			fields: ['code', 'effective_range']
		},
		'jurisdiction_settings.rule_set': {
			where: {
				family: { eq: 'PAYROLL' },
				code: { in: [...new Set(inputs.map((input) => input.rule))] }
			},
			fields: ['settings_id', 'code', 'rules']
		}
	});
	const got = {
		entity,
		versions: jurisdiction_settings,
		rules: { rows: jurisdiction_settings.rows.flatMap((version) => version.rule_set) }
	};
	return inputs.map((input) => {
		const lineage = got.entity.rows.find((row) => row.id === input.company_id)?.settings_code;
		if (!isString(lineage)) return 'This needs its legal entity.';
		const version = got.versions.rows.find((row) => {
			const range = row.effective_range;
			return (
				row.code === lineage &&
				range != null &&
				range.from <= input.day &&
				(range.to == null || input.day <= range.to)
			);
		});
		if (version == null) return `No sealed ${lineage} jurisdiction version governs ${input.day}.`;
		return got.rules.rows.some(
			(row) =>
				row.settings_id === version.id &&
				row.code === input.rule &&
				kindsOf(row.rules).some((kind) => kind.code === input.code)
		)
			? null
			: `${lineage} lists no ${input.noun} ${input.code} on ${input.day}.`;
	});
});
