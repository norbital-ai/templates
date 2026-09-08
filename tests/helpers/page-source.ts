import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const source = (path: string) =>
	readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');
export const registrations = (text: string) => [
	...[...text.matchAll(/client\.db\.([a-z_]+)\.(findMany|findFirst)\(/g)].map(
		(match) => `db.${match[1]}.${match[2]}`
	),
	...[...text.matchAll(/client\.pending\.findMany\('([a-z_]+)'/g)].map(
		(match) => `pending.${match[1]}`
	),
	...[...text.matchAll(/<CollectionTable\b/g)].map(() => 'CollectionTable')
];

/** Select a complete Svelte snippet, including nested column and content snippets. */
export function snippet(text: string, name: string): string {
	const start = text.indexOf(`{#snippet ${name}(`);
	assert.ok(start >= 0, `snippet ${name} exists`);
	const tags = /\{#snippet\b|\{\/snippet\}/g;
	tags.lastIndex = start;
	let depth = 0;
	for (let match = tags.exec(text); match != null; match = tags.exec(text)) {
		depth += match[0] === '{/snippet}' ? -1 : 1;
		if (depth === 0) return text.slice(start, match.index);
	}
	throw new Error(`snippet ${name} never closes`);
}
