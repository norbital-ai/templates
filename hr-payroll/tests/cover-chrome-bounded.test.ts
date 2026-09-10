/**
 * Cover chrome may not hold a row set.
 *
 * `Cover` lays out three grid rows — `auto` for `top`, `minmax(0,1fr)` for the body, `auto` for
 * `bottom` — and clips its overflow. An `auto` row is sized by its content, so chrome that grows
 * with the data takes the height first and the body, which is the part with the scrollport, is left
 * whatever remains. With enough rows that remainder is nothing: the body collapses and everything
 * inside it is clipped away with no way to scroll to it.
 *
 * Employee Self-Service shipped exactly that. `leaveChrome` rendered the leave-balance cards, one
 * per catalogue the person is entitled to, and on a real seed that starved the leave table to a
 * 26px band — the panel looked like a heading with nothing under it. The end-to-end sweep now walks
 * tabbed panels and would catch a repeat, but only after a browser boot and a seeded workspace; the
 * mistake is visible in the source, so it is cheaper to refuse it there.
 *
 * The rule is not "no `{#each}` in chrome" — a weekday header, a colour legend and a month's day
 * columns are all loops over sets the file itself bounds, and all three are correct chrome. What
 * cannot go in an `auto` row is a loop over rows that arrive from a query, because nothing in the
 * layout bounds how many there are. So the scan resolves each iterated identifier back to its
 * declaration and refuses the ones fed by a live query.
 *
 * A chrome snippet that renders another snippet is followed one hop, which is the shape the
 * Self-Service fault had after it was split into `leaveChrome` and `leaveBalances`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src', import.meta.url));

/** Every authored component under `src`, so a new directory is covered on arrival. */
function components(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) return components(path);
		return entry.name.endsWith('.svelte') ? [path] : [];
	});
}

/**
 * The text of `{#snippet name(…)}…{/snippet}`, or `null` when the file declares no such snippet.
 *
 * Svelte's block tags nest, so the closing tag is found by counting `{#…}` against `{/…}` rather
 * than by searching for the first `{/snippet}` — a snippet holding an `{#if}` closes twice.
 */
function snippetBody(text: string, name: string): string | null {
	const open = new RegExp(`\\{#snippet\\s+${name}\\s*\\(`).exec(text);
	if (open == null) return null;
	const tags = /\{[#/]\w+/g;
	tags.lastIndex = open.index;
	let depth = 0;
	let tag: RegExpExecArray | null;
	while ((tag = tags.exec(text)) != null) {
		depth += text[tag.index + 1] === '#' ? 1 : -1;
		if (depth === 0) return text.slice(open.index, tag.index);
	}
	return null;
}

/** The head of the statement that declares `name`, or `null` when it comes from elsewhere. */
function declaration(text: string, name: string): string | null {
	const match = new RegExp(`\\b(?:const|let)\\s+${name}\\s*(?::[^=]*)?=`).exec(text);
	return match == null ? null : text.slice(match.index, match.index + 400);
}

/**
 * Whether the declaration reads a query's result.
 *
 * `useQuery` results are read as `.current` (and `.rows` on a paged one) and the queries themselves
 * are named `<thing>Query` by convention throughout this template, so a derivation naming either is
 * fed by however many rows the workspace happens to hold.
 */
const LIVE = /Query\b|\.current\b|\.rows\b/;

test('Cover chrome never iterates a query result', () => {
	const offenders: string[] = [];
	for (const path of components(root)) {
		const text = readFileSync(path, 'utf8');
		const file = path.slice(root.length + 1);
		for (const cover of text.matchAll(/<Cover\b[^>]*>/g))
			for (const binding of cover[0].matchAll(/\b(top|bottom)=\{(\w+)\}/g)) {
				const [, edge, name] = binding;
				if (edge == null || name == null) continue;
				const direct = snippetBody(text, name);
				if (direct == null) continue;
				// One hop through `{@render other()}`: splitting a snippet in two must not launder it.
				const rendered = [...direct.matchAll(/\{@render\s+(\w+)\s*\(/g)]
					.map((call) => (call[1] == null ? null : snippetBody(text, call[1])))
					.filter((body): body is string => body != null);
				for (const body of [direct, ...rendered])
					for (const each of body.matchAll(/\{#each\s+([A-Za-z_$][\w$]*)\b/g)) {
						const source = each[1];
						if (source == null) continue;
						const declared = declaration(text, source);
						if (declared != null && LIVE.test(declared))
							offenders.push(`${file} ${edge}={${name}} iterates ${source}`);
					}
			}
	}
	assert.deepEqual(
		offenders,
		[],
		`Cover chrome sits in an \`auto\` grid row, so a query-length list there starves the body ` +
			`and clips it away. Move the list into the body, above whatever the body already holds:\n` +
			offenders.join('\n')
	);
});

test('the scan still finds the Cover chrome it is meant to police', () => {
	const bindings = components(root).flatMap((path) => {
		const text = readFileSync(path, 'utf8');
		return [...text.matchAll(/<Cover\b[^>]*>/g)].flatMap((cover) => [
			...cover[0].matchAll(/\b(top|bottom)=\{(\w+)\}/g)
		]);
	});
	// A rename of the component or the prop would leave the scan sweeping nothing and reporting
	// clean, which is the failure mode a source rule has instead of a red test.
	assert.ok(
		bindings.length >= 10,
		`only ${bindings.length} Cover chrome bindings found; the scan has stopped matching them`
	);
});
