/**
 * L-TPL-hr-payroll-037: statutory standing lives on `employment_profile.facts.employment_statutory_facts`. One
 * standing per scheme per instant; a standing's elections are the keys its jurisdiction's `employee_input_schema`
 * declares.
 */
import { overlaps, PlainDate, type DatePeriod } from '@norbital-ai/std/date';
import { Schema } from 'effect';
import { type HostRead, isJsonObject } from './foundation.js';

const isString = Schema.is(Schema.String);

export type StatutoryFact = {
	readonly statutory_contribution_id: string;
	readonly effective_range: DatePeriod;
	readonly status: {
		readonly kind: string;
		readonly elections?: { readonly [key: string]: string | number | boolean };
	};
};

function periodFromUnknown(value: unknown): DatePeriod | null {
	if (!isJsonObject(value) || !isString(value.from) || value.from === '') return null;
	const to = value.to;
	if (to != null && !isString(to)) return null;
	return { from: PlainDate(value.from), to: to == null || to === '' ? null : PlainDate(to) };
}

export function statutoryFactsFromFacts(facts: unknown): readonly StatutoryFact[] {
	if (!isJsonObject(facts) || !Array.isArray(facts.employment_statutory_facts)) return [];
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
		const elections: { [key: string]: string | number | boolean } = {};
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
export function electionKeysOf(schema: unknown): readonly string[] {
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

export function refuseStatutoryFacts(
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

/** Refuse a profile's statutory facts against the input schemas of the versions their schemes belong to. */
export async function refuseEmploymentFacts(
	facts: unknown,
	read: HostRead
): Promise<string | null> {
	const standing = statutoryFactsFromFacts(facts);
	const ids = [...new Set(standing.map((fact) => fact.statutory_contribution_id))];
	if (ids.length === 0) return null;
	const schemes = await read('statutory_contribution_catalog', {
		where: { id: { in: ids } },
		select: { settings_id: true },
		all: true
	});
	const settingsIds = [
		...new Set(schemes.rows.map((row) => row.settings_id).filter((id) => id != null))
	];
	const versions =
		settingsIds.length === 0
			? { rows: [] }
			: await read('jurisdiction_settings', {
					where: { id: { in: settingsIds } },
					select: { employee_input_schema: true },
					all: true
				});
	return refuseStatutoryFacts(
		standing,
		versions.rows.flatMap((row) => electionKeysOf(row.employee_input_schema))
	);
}
