/** Bounded prompt helpers so AI routing and extraction never exceed token ceilings. */

export const PROMPT_MAX = 48_000;
const ITEM_MAX = 2_000;
const ITEMS_MAX = 60;

export const cap = (text: string, max: number): string =>
	text.length <= max ? text : `${text.slice(0, Math.max(0, max - 12)).trimEnd()} …[cut]`;

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
