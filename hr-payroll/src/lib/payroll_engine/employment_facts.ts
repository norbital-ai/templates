import { Array as EffectArray } from 'effect';
import { Effect } from 'effect';
/**
 * L-TPL-hr-payroll-037: statutory standing lives on `employment_profile.facts.employment_statutory_facts`. One
 * standing per scheme per instant; a standing's elections are the keys its jurisdiction's `employee_input_schema`
 * declares.
 */
import { overlaps, PlainDate, type DatePeriod } from '@norbital-ai/std/date';
import { Schema } from 'effect';
import { IdValue } from '@norbital-ai/std/kind';
import type { Id, StoredRow } from '@norbital-ai/bolt';
import { type HostRead, isJsonObject, Refusal } from './foundation.js';
const isString = Schema.is(Schema.String);
type StatutoryFact = {
	readonly statutory_contribution_id: string;
	readonly effective_range: DatePeriod;
	readonly status: {
		readonly kind: string;
		readonly elections?: {
			readonly [key: string]: string | number | boolean;
		};
	};
};
function periodFromUnknown(value: unknown): DatePeriod | null {
	if (!isJsonObject(value) || !isString(value.from) || value.from === '') return null;
	const to = value.to;
	if (to != null && !isString(to)) return null;
	return { from: PlainDate(value.from), to: to == null || to === '' ? null : PlainDate(to) };
}
export function statutoryFactsFromFacts(facts: unknown): readonly StatutoryFact[] {
	if (!isJsonObject(facts) || !EffectArray.isArray(facts.employment_statutory_facts)) return [];
	const out: StatutoryFact[] = [];
	for (const row of facts.employment_statutory_facts) {
		if (
			!isJsonObject(row) ||
			!isString(row.statutory_contribution_id) ||
			row.statutory_contribution_id === ''
		)
			continue;
		const effective_range = periodFromUnknown(row.effective_range);
		if (effective_range == null) continue;
		const status = isJsonObject(row.status) ? row.status : null;
		if (status == null || !isString(status.kind) || status.kind === '') continue;
		const elections: {
			[key: string]: string | number | boolean;
		} = {};
		if (isJsonObject(status.elections))
			for (const [key, value] of Object.entries(status.elections))
				if (Schema.is(Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]))(value))
					elections[key] = value;
		out.push({
			statutory_contribution_id: row.statutory_contribution_id,
			effective_range,
			status: {
				kind: status.kind,
				...(Object.keys(elections).length === 0 ? {} : { elections })
			}
		});
	}
	return out;
}
/** The election keys one `employee_input_schema` declares for a statutory standing. */
function electionKeysOf(schema: unknown): readonly string[] {
	let node: unknown = schema;
	for (const key of [
		'properties',
		'employment_statutory_facts',
		'items',
		'properties',
		'status',
		'properties',
		'elections',
		'properties'
	])
		node = isJsonObject(node) ? node[key] : undefined;
	return isJsonObject(node) ? Object.keys(node) : [];
}
function refuseStatutoryFacts(
	facts: readonly StatutoryFact[],
	electionKeys: readonly string[]
): string | null {
	const allowed = new Set(electionKeys);
	for (const fact of facts)
		for (const key of Object.keys(fact.status.elections ?? {}))
			if (!allowed.has(key)) return `Unknown election '${key}'.`;
	for (const [i, current] of facts.entries())
		for (const other of facts.slice(i + 1))
			if (
				current.statutory_contribution_id === other.statutory_contribution_id &&
				overlaps(current.effective_range, other.effective_range)
			)
				return 'A person can have only one standing per scheme at a time.';
	return null;
}
const SchemeId = Schema.declare<Id<'statutory_contribution_catalog'>>(
	(value): value is Id<'statutory_contribution_catalog'> => Schema.is(IdValue)(value)
);
/** All profiles in one write share one schema lookup, independent of the batch size. */
export const refuseEmploymentFactsBatch = Effect.fnUntraced(function* (
	facts: readonly (StoredRow<'employment_profile'>['facts'] | undefined)[],
	read: HostRead
) {
	const standing = facts.map(statutoryFactsFromFacts);
	const candidates = [
		...new Set(standing.flatMap((rows) => rows.map((row) => row.statutory_contribution_id)))
	];
	if (candidates.length === 0) return facts.map(() => null);
	const ids = yield* Schema.decodeUnknownEffect(Schema.Array(SchemeId))(candidates).pipe(
		Effect.mapError(() => new Refusal({ message: 'A statutory standing needs its actual scheme.' }))
	);
	const { statutory_contribution_catalog: schemes } = yield* read({
		statutory_contribution_catalog: { where: { id: { in: ids } }, fields: ['settings_id'] }
	});
	const { jurisdiction_settings: versions } = yield* read({
		jurisdiction_settings: {
			where: { id: { in: [...new Set(schemes.rows.map((row) => row.settings_id))] } },
			fields: ['employee_input_schema']
		}
	});
	return standing.map((rows) => {
		const ownSchemes = new Set(rows.map((row) => row.statutory_contribution_id));
		const ownVersions = new Set(
			schemes.rows.filter((row) => ownSchemes.has(row.id)).map((row) => row.settings_id)
		);
		const keys = versions.rows
			.filter((row) => ownVersions.has(row.id))
			.flatMap((row) => electionKeysOf(row.employee_input_schema));
		return refuseStatutoryFacts(rows, keys);
	});
});
