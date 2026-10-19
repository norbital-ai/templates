import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Schema } from 'effect';
import { overtimeRule } from '../seed/overtime_policies.js';

const Rows = Schema.Array(Schema.Record(Schema.String, Schema.Json));
const files = new Map<string, typeof Rows.Type>();

/** Read stored collections or the suspension-kind values owned by the settings row. */
export function readSeedRows(directory: string, name: string) {
	const path = resolve(
		directory,
		`${name === 'suspension_kind' ? 'jurisdiction_settings' : name}.json`
	);
	let stored = files.get(path);
	if (stored === undefined) {
		stored = Schema.decodeUnknownSync(Rows)(JSON.parse(readFileSync(path, 'utf8')));
		files.set(path, stored);
	}
	// Each scenario owns its nested fixture values; decoded file snapshots never leave the cache.
	const rows = [...structuredClone(stored)];
	if (name === 'rule_set') {
		const settings = Schema.decodeUnknownSync(Rows)(
			JSON.parse(readFileSync(resolve(directory, 'jurisdiction_settings.json'), 'utf8'))
		);
		for (const row of settings) {
			const policy = overtimeRule(row);
			if (policy !== null) rows.push(policy);
		}
	}
	return name === 'suspension_kind'
		? rows.flatMap((settings) => Schema.decodeUnknownSync(Rows)(settings['suspension_kinds']))
		: rows;
}
