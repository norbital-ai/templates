/**
 * The payroll probe's oracles beyond the payslip (capability plan H1): saved rows and generated files, judged as pure
 * functions so `tests/probe-oracle.test.ts` proves them without a host.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };
type Row = { readonly [field: string]: Json };

/** A dotted key's value in a saved row. */
const field = (row: Row, key: string): Json | undefined =>
	key
		.split('.')
		.reduce<Json | undefined>(
			(v, k) =>
				typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Row)[k] : undefined,
			row
		);
const same = (want: Json, got: Json | undefined) =>
	typeof want === 'number'
		? got != null && Math.abs(Number(got) - want) < 0.005
		: isDeepStrictEqual(want, got ?? null);

/**
 * Every difference between the rows a case expects and the rows saved; `[]` is a pass. Each expected row takes the
 * first unmatched saved row that agrees on every field it lists, and a saved row nothing takes is a failure.
 * ponytail: greedy matching; expected rows that overlap on their listed fields must be listed most specific first.
 */
export function savedDifferences(expected: readonly Row[], actual: readonly Row[]) {
	const left = [...actual];
	const out: string[] = [];
	for (const want of expected) {
		const i = left.findIndex((row) =>
			Object.entries(want).every(([k, v]) => same(v, field(row, k)))
		);
		if (i < 0) out.push(`no saved row matches ${JSON.stringify(want)}`);
		else left.splice(i, 1);
	}
	const keys = [...new Set(expected.flatMap((row) => Object.keys(row)))];
	for (const row of left) {
		const shown =
			keys.length === 0 ? row : Object.fromEntries(keys.map((k) => [k, field(row, k) ?? null]));
		out.push(`unexpected saved row ${JSON.stringify(shown)}`);
	}
	return out;
}

/** Every stored file reference (`{ id, name, mime }`) anywhere in a value. */
export function fileRefs(v: Json): { id: string; name: string }[] {
	if (Array.isArray(v)) return (v as readonly Json[]).flatMap(fileRefs);
	if (typeof v !== 'object' || v === null) return [];
	const o = v as Row;
	if (typeof o.id === 'string' && typeof o.name === 'string' && typeof o.mime === 'string')
		return [{ id: o.id, name: o.name }];
	return Object.values(o).flatMap(fileRefs);
}

/** A generated file against the case's bytes: `[]` is a pass. */
export function fileDifferences(want: { text?: string; sha256?: string }, bytes: Uint8Array) {
	const out: string[] = [];
	if (want.text === undefined && want.sha256 === undefined)
		out.push('the case pins neither text nor sha256');
	if (want.text !== undefined) {
		const got = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
		if (got !== want.text) {
			let i = 0;
			while (i < got.length && got[i] === want.text[i]) i++;
			out.push(
				`text differs at character ${i}: expected ${JSON.stringify(want.text.slice(i, i + 40))}, saved ${JSON.stringify(got.slice(i, i + 40))}`
			);
		}
	}
	if (want.sha256 !== undefined) {
		const got = createHash('sha256').update(bytes).digest('hex');
		if (got !== want.sha256.toLowerCase()) out.push(`sha256 ${got}, expected ${want.sha256}`);
	}
	return out;
}
