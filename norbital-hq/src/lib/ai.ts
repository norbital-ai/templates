/**
 * What the summaries and meeting notes send to the model, bounded: a model handed an unbounded payload answers
 * nothing, so every part is capped and the whole prompt has a ceiling.
 */

import { Duration } from 'effect';

/** The prompt ceiling, in characters (about 12k tokens). */
export const PROMPT_MAX = 48_000;
/** One item's ceiling: a message, an activity, a transcript line. */
export const ITEM_MAX = 2_000;
/** At most this many items per section. */
export const ITEMS_MAX = 60;

/** `text` cut to `max` characters, marked when cut. */
export const cap = (text: string, max: number): string =>
	text.length <= max ? text : `${text.slice(0, Math.max(0, max - 12)).trimEnd()} …[cut]`;

/** Sections of items, each item and section capped, the whole cut to `PROMPT_MAX`. */
export function bounded(sections: readonly { title: string; items: readonly string[] }[]): string {
	const out = sections
		.filter((s) => s.items.length > 0)
		.map((s) => {
			const shown = s.items
				.slice(0, ITEMS_MAX)
				.map((item) => `- ${cap(item.replace(/\s+/g, ' ').trim(), ITEM_MAX)}`);
			const more = s.items.length - shown.length;
			return `## ${s.title}\n${shown.join('\n')}${more > 0 ? `\n- …and ${more} more not shown` : ''}`;
		})
		.join('\n\n');
	return cap(out, PROMPT_MAX);
}

export type Segment = { speaker: string; start: number; end: number; text: string };

/** `mm:ss` (or `h:mm:ss`) of a segment's start. */
const CLOCK = new Intl.DurationFormat('en', { style: 'digital', hoursDisplay: 'auto' });

/** The transcript as Markdown lines, each speaker shown by the name a person gave it. */
export const transcriptMarkdown = (
	segments: readonly Segment[],
	names: { readonly [label: string]: string }
) =>
	segments
		.map(
			(s) =>
				`**[${CLOCK.format(Duration.parts(Duration.seconds(s.start)))}] ${names[s.speaker] ?? s.speaker}:** ${s.text}`
		)
		.join('\n\n');

/** The transcript for the notes prompt: consecutive lines of one speaker joined, capped to `PROMPT_MAX`. */
export function transcriptPrompt(
	segments: readonly Segment[],
	names: { readonly [label: string]: string }
): string {
	const turns: { speaker: string; start: number; text: string }[] = [];
	for (const s of segments) {
		const last = turns.at(-1);
		if (last?.speaker === s.speaker) last.text += ` ${s.text}`;
		else turns.push({ speaker: s.speaker, start: s.start, text: s.text });
	}
	return cap(
		turns
			.map(
				(t) =>
					`[${CLOCK.format(Duration.parts(Duration.seconds(t.start)))}] ${names[t.speaker] ?? t.speaker}: ${t.text}`
			)
			.join('\n'),
		PROMPT_MAX
	);
}
