/**
 * The probes one browser walk over every surface needs, and the assertions it makes on them.
 *
 * `HeadedPage` exposes `evaluate(expression)` and little else, so every question here is a string
 * the page answers about itself. That constraint is also why a scroll trap is measured from the
 * layout rather than by dispatching a wheel: the two shapes a trap takes — content clipped with no
 * way to scroll to it, and an inert region that contains scroll chaining — are both visible in
 * computed style, and neither needs an input event to find.
 */

import assert from 'node:assert/strict';
import type { HeadedPage } from '@norbital-ai/test-utilities';

/**
 * Installed before any page script runs, so a throw during bundle evaluation is recorded rather
 * than lost. Svelte 5 runtime faults arrive here as `svelte.dev/e/…` messages, and Bolt's own
 * representation-load failure arrives on `console.error`.
 */
export const ERROR_RECORDER = `(() => {
	if (globalThis.__sweepErrors !== undefined) return;
	const errors = [];
	globalThis.__sweepErrors = errors;
	addEventListener('error', (event) => {
		errors.push({
			kind: 'uncaught',
			message: String(event.message ?? ''),
			stack: String(event.error?.stack ?? '')
		});
	});
	addEventListener('unhandledrejection', (event) => {
		const reason = event.reason;
		errors.push({
			kind: 'rejection',
			message: String(reason?.message ?? reason ?? ''),
			stack: String(reason?.stack ?? '')
		});
	});
	const previous = console.error;
	console.error = (...args) => {
		errors.push({ kind: 'console', message: args.map((value) => String(value)).join(' ') });
		previous(...args);
	};
})();`;

export type SweepError = {
	readonly kind: 'uncaught' | 'rejection' | 'console';
	readonly message: string;
	readonly stack?: string;
};

/**
 * Console lines that say nothing about this workspace.
 *
 * Deliberately short. Every pattern is a line the platform prints on a healthy page; anything else
 * reaching `console.error` is a finding, because a swallowed error is exactly how a broken
 * representation reports itself as an empty one.
 */
const BENIGN_CONSOLE = [/favicon/i, /\[vite\]/i, /net::ERR_ABORTED/i, /Download the .* DevTools/i];

/** A Svelte runtime or reactivity fault, whatever channel it arrived on. */
const SVELTE_FAULT =
	/svelte\.dev\/e\/|effect_update_depth_exceeded|state_unsafe_mutation|derived_references_self|ownership_invalid_mutation|rune_outside_svelte|hydration_/;

/**
 * The browser's own notice that ResizeObserver callbacks coalesced in one frame. It arrives as an
 * `error` event with no error object, and it says the observation frame was re-entered, not that
 * the page misbehaved — Chrome's own advice is to ignore it. Kept short: any other uncaught error
 * is still a finding, because a swallowed one is how a broken representation looks like an empty
 * one.
 */
const RESIZE_OBSERVER_LOOP =
	/ResizeObserver loop (completed with undelivered notifications|limit exceeded)/;

export const readErrors = async (page: HeadedPage): Promise<readonly SweepError[]> =>
	JSON.parse(
		String(await page.evaluate('JSON.stringify(globalThis.__sweepErrors ?? [])'))
	) as readonly SweepError[];

const significant = (errors: readonly SweepError[]): readonly SweepError[] =>
	errors.filter((entry) => {
		if (RESIZE_OBSERVER_LOOP.test(entry.message)) return false;
		if (entry.kind !== 'console') return true;
		if (SVELTE_FAULT.test(entry.message)) return true;
		return !BENIGN_CONSOLE.some((pattern) => pattern.test(entry.message));
	});

/**
 * Fail on anything new since the last checkpoint, and return the new high-water mark so one
 * error is reported against the surface that raised it rather than against every later one.
 */
export const assertNoErrors = (
	errors: readonly SweepError[],
	label: string,
	seen: number
): number => {
	const all = significant(errors);
	const fresh = all.slice(seen);
	assert.equal(
		fresh.length,
		0,
		`${label} raised ${fresh.length} browser error(s): ${JSON.stringify(fresh, null, 2)}`
	);
	return all.length;
};

/**
 * The two measurable shapes of a scroll trap.
 *
 * `clipped` — a visible box whose content is taller than it is, whose `overflow-y` is hidden or
 * clipped. Whatever is below the fold cannot be reached by any gesture. This is the nested-form-
 * inside-a-shell case, and the reason `Cover`, `Bound clip` and `Sheet.Content` all depend on a
 * `Scroll` somewhere beneath them.
 *
 * `inertContain` — a container carrying `overscroll-behavior-y: contain` with nothing to scroll.
 * Chrome halts scroll chaining at every contain'ed container whether or not it overflows, so an
 * inert one swallows the wheel meant for the scrollport above it. `Scroll` applies containment
 * from the measured edges precisely to avoid this; anything hand-rolling `overscroll-contain`
 * reintroduces it.
 */
const SCROLL_AUDIT = `(() => {
	const describe = (node) => {
		const parts = [node.tagName.toLowerCase()];
		if (node.id) parts.push('#' + node.id);
		for (const name of node.getAttributeNames()) {
			if (name.startsWith('data-') && name !== 'data-overflow') parts.push('[' + name + ']');
		}
		const cls = String(node.getAttribute('class') ?? '');
		if (cls) parts.push('.' + cls.split(/\\s+/).slice(0, 8).join('.'));
		return parts.join('');
	};
	const clipped = [];
	const inertContain = [];
	for (const node of document.querySelectorAll('*')) {
		const rect = node.getBoundingClientRect();
		if (rect.width < 8 || rect.height < 8) continue;
		const style = getComputedStyle(node);
		if (style.visibility === 'hidden' || style.display === 'none') continue;
		const overflowY = style.overflowY;
		const overshoot = node.scrollHeight - node.clientHeight;
		if (overshoot > 4 && (overflowY === 'hidden' || overflowY === 'clip')) {
			// The child that overflows is what a person has to fix, so name it with the box that clips it.
			const children = [...node.children].map((child) => ({
				node: describe(child),
				height: Math.round(child.getBoundingClientRect().height),
				scrollHeight: child.scrollHeight,
				overflowY: getComputedStyle(child).overflowY
			}));
			clipped.push({
				node: describe(node),
				overshoot,
				overflowY,
				height: Math.round(rect.height),
				children
			});
		}
		if (style.overscrollBehaviorY === 'contain' && overshoot <= 2) {
			inertContain.push({ node: describe(node), overflowY });
		}
	}
	return JSON.stringify({ clipped, inertContain });
})()`;

export type ScrollAudit = {
	readonly clipped: readonly {
		node: string;
		overshoot: number;
		overflowY: string;
		height: number;
		children: readonly { node: string; height: number; scrollHeight: number; overflowY: string }[];
	}[];
	readonly inertContain: readonly { node: string; overflowY: string }[];
};

/**
 * Boxes whose content abandons most of their width.
 *
 * The counterpart to the clip audit. A trap hides content inside a box too small for it; this is
 * the opposite fault — a box far wider than anything it puts in it, so the surface reads as a
 * strip of content adrift in empty page. The settings sheet had one: the regional minimum-wage
 * table renders at its intrinsic 427 pixels inside a 1296-pixel field, because the renderer's
 * wrapper centres a content-sized child instead of stretching it, and two thirds of the row is
 * dead.
 *
 * Measured as *spread*: the distance from the leftmost child edge to the rightmost, against the
 * box's content width. Spread reads a row, a column and a grid the same way — a row of chips
 * spreads across its container even though no single chip is wide, and a column of full-width
 * cards spreads fully on one child — so one number covers every layout without asking which it is.
 *
 * Absolutely positioned children are skipped: an overlay, a tooltip and a focus ring are not the
 * box's content and a popover pinned to one corner would otherwise read as a full spread.
 */
const FILL_AUDIT = `(() => {
	const describe = (node) => {
		const parts = [node.tagName.toLowerCase()];
		if (node.id) parts.push('#' + node.id);
		for (const name of node.getAttributeNames())
			if (name.startsWith('data-')) parts.push('[' + name + ']');
		const cls = String(node.getAttribute('class') ?? '');
		if (cls) parts.push('.' + cls.split(/\\s+/).slice(0, 6).join('.'));
		return parts.join('');
	};
	const underfilled = [];
	for (const node of document.querySelectorAll('*')) {
		const rect = node.getBoundingClientRect();
		if (node.clientWidth < 500 || rect.height < 80) continue;
		const style = getComputedStyle(node);
		if (style.visibility === 'hidden' || style.display === 'none') continue;
		if (style.position === 'absolute' || style.position === 'fixed') continue;
		// A box that centres or distributes its children on the inline axis is narrow on purpose:
		// an empty state reading "No results found" in the middle of a wide panel is a choice, not
		// abandoned width. Only boxes whose children are meant to start at the edge are measured.
		if (style.justifyContent !== 'normal' && style.justifyContent !== 'flex-start') continue;
		if (style.textAlign === 'center') continue;
		let left = Infinity;
		let right = -Infinity;
		let children = 0;
		for (const child of node.children) {
			const box = child.getBoundingClientRect();
			if (box.width < 1 || box.height < 1) continue;
			const childStyle = getComputedStyle(child);
			if (childStyle.position === 'absolute' || childStyle.position === 'fixed') continue;
			children += 1;
			left = Math.min(left, box.left);
			right = Math.max(right, box.right);
		}
		if (children === 0) continue;
		const spread = right - left;
		const fill = spread / node.clientWidth;
		if (fill < 0.6)
			underfilled.push({
				node: describe(node),
				width: node.clientWidth,
				spread: Math.round(spread),
				fill: Math.round(fill * 100) / 100,
				children
			});
	}
	return JSON.stringify(underfilled);
})()`;

export type Underfilled = {
	node: string;
	width: number;
	spread: number;
	fill: number;
	children: number;
};

/**
 * Boxes that are wider than their content on purpose.
 *
 * A scroll shadow, a resize handle and a sticky rail are deliberately narrow inside a wide track;
 * a media header holds an image that keeps its aspect ratio; a chart's own frame is drawn, not
 * laid out. None of these read as dead page to anyone.
 */
const FILL_BY_DESIGN =
	/data-collection-grid-virtual-spacer|resize-handle|sr-only|\bcm-|\bleaflet-|data-layout=.app-media-header/;

/** Every box on this surface that leaves more than two fifths of its width empty. */
export const auditFill = async (page: HeadedPage, label: string): Promise<readonly string[]> => {
	const found = JSON.parse(String(await page.evaluate(FILL_AUDIT))) as Underfilled[];
	return found
		.filter((entry) => !FILL_BY_DESIGN.test(entry.node))
		.map(
			(entry) =>
				`${label}: ${entry.node} is ${entry.width}px wide and its ${entry.children} ` +
				`child(ren) span ${entry.spread}px (${Math.round(entry.fill * 100)}%)`
		);
};

/**
 * Boxes that clip on purpose and hide nothing anyone needs to reach.
 *
 * A truncating cell, a masked fade, an avatar and a virtual spacer are all "content taller than
 * the box" by design, and so is a map: Leaflet's panes are an absolutely positioned world many
 * screens wide inside a viewport-sized frame it pans itself. Everything else that clips must have
 * a scrollport beneath it.
 */
const CLIP_BY_DESIGN =
	/truncate|line-clamp|sr-only|animate-pulse|rounded-full|data-collection-grid-virtual-spacer|data-layout=.app-media-header|\bcm-|\bleaflet-/;

/**
 * Below this, the overshoot is a control's own decoration rather than content out of reach.
 *
 * An input group is a 36-pixel box around a 40-pixel affordance; a line of text is 18 or more.
 * Four pixels cannot hide a line, and asserting on them reports paddings, not traps.
 */
const CLIP_NOISE_PX = 4;

/**
 * Audit a layout that has stopped moving.
 *
 * A sheet measured mid-open reports whatever its transform had reached, which is an overshoot that
 * is gone a frame later. Two identical readings is the same rule `settle` uses, and it is the
 * difference between reporting a trap and reporting an animation.
 */
export const auditScroll = async (page: HeadedPage, label: string): Promise<ScrollAudit> => {
	let previous = '';
	let raw = '';
	for (let attempt = 0; attempt < 20; attempt += 1) {
		raw = String(await page.evaluate(SCROLL_AUDIT));
		if (raw === previous) break;
		previous = raw;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	const audit = JSON.parse(raw) as ScrollAudit;
	const traps = audit.clipped.filter(
		(entry) => entry.overshoot > CLIP_NOISE_PX && !CLIP_BY_DESIGN.test(entry.node)
	);
	assert.equal(
		traps.length,
		0,
		`${label} clips ${traps.length} region(s) whose content cannot be scrolled to: ` +
			JSON.stringify(traps, null, 2)
	);
	assert.equal(
		audit.inertContain.length,
		0,
		`${label} contains scroll chaining on ${audit.inertContain.length} region(s) that cannot ` +
			`scroll, so the wheel meant for the scrollport above them is swallowed: ` +
			JSON.stringify(audit.inertContain, null, 2)
	);
	return audit;
};

/**
 * The shell's own failure copy, and the two sentences that mean a representation did not load.
 *
 * "requires an explicit representation" is on this list because it is also what a representation
 * that exists and *threw* reports itself as.
 */
export const FAILURE_COPY =
	/could not|couldn't|went wrong|unexpected error|requires an explicit representation|failed to load|is not a function|undefined is not/i;

/** A surface has painted when its skeletons are gone, its shell is connected, and it has spoken. */
const PAINT_PROBE = `(() => {
	const body = document.body ? document.body.innerText : '';
	const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1) ?? null;
	const heading = document.querySelector('[data-layout="app-media-header"] h1, main h1');
	// The layout's own size, so "settled" means the boxes have stopped moving and not merely that
	// the text has stopped changing. A relation combobox that resolves late grows the form without
	// adding a character, and an audit taken before that reports a layout nobody will ever see.
	const geometry = [...document.querySelectorAll('[role="dialog"], [data-layout="cover"], form')]
		.map((node) => node.scrollHeight + ':' + node.clientHeight)
		.join('|');
	return JSON.stringify({
		geometry,
		path: location.pathname,
		search: location.search,
		skeletons: document.querySelectorAll('.animate-pulse').length,
		tables: document.querySelectorAll('[data-collection-table-surface]').length,
		rows: document.querySelectorAll('[data-record-id]').length,
		dialogs: document.querySelectorAll('[role="dialog"]').length,
		heading: heading == null ? '' : (heading.innerText ?? '').trim(),
		dialogBody: dialog == null ? '' : (dialog.innerText ?? ''),
		length: body.length,
		body: body.slice(0, 1500)
	});
})()`;

export type Paint = {
	readonly geometry: string;
	readonly path: string;
	readonly search: string;
	readonly skeletons: number;
	readonly tables: number;
	readonly rows: number;
	readonly dialogs: number;
	readonly heading: string;
	readonly dialogBody: string;
	readonly length: number;
	readonly body: string;
};

/** The sync banner while the replica is catching up: not yet the surface's own answer. */
const CONNECTING = /Reconnecting to live updates|Loading application|Connecting/i;

/**
 * Settled means still, not merely non-empty.
 *
 * Two identical readings in a row is the whole rule. Waiting for zero skeletons alone is wrong —
 * some surfaces keep a pulsing affordance for ever — and reading once is wrong too, because a
 * surface halfway through its first query answers with a shape it is about to replace.
 */
export const settle = async (
	page: HeadedPage,
	ready: (paint: Paint) => boolean,
	label: string,
	timeoutMs: number
): Promise<{ paint: Paint; elapsedMs: number }> => {
	const started = Date.now();
	const deadline = started + timeoutMs;
	const shape = (paint: Paint): string =>
		`${paint.path}|${paint.skeletons}|${paint.tables}|${paint.rows}|${paint.dialogs}|${paint.length}|${paint.geometry}`;
	let last: Paint | null = null;
	let previous = '';
	while (Date.now() < deadline) {
		const paint = JSON.parse(String(await page.evaluate(PAINT_PROBE))) as Paint;
		const current = shape(paint);
		if (!CONNECTING.test(paint.body) && ready(paint) && current === previous)
			return { paint, elapsedMs: Date.now() - started };
		previous = current;
		last = paint;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`${label} never settled in ${timeoutMs} ms: ${JSON.stringify(last, null, 2)}`);
};

/** The mounted shell publishes its navigation actions; nothing can be driven before it does. */
export const waitForShell = async (page: HeadedPage, timeoutMs: number): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if ((await page.evaluate('globalThis.__norbitalSessionActions != null')) === true) return;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	throw new Error(
		`the workspace never mounted in ${timeoutMs} ms: ` +
			String(await page.evaluate('document.body ? document.body.innerText.slice(0, 800) : ""'))
	);
};

/**
 * Release the shell's deferred queries.
 *
 * Notifications, the manifest, automations and the finder's collection list are all held until the
 * window sees its first pointer or key event, so a page only ever driven through `evaluate` never
 * starts them and paints "Loading application…" for ever.
 */
export const unlockDeferredQueries = async (page: HeadedPage): Promise<void> => {
	await page.evaluate(
		`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
	);
};

/** Client-side navigation, through the same action the shell's own links call. */
export const navigate = async (page: HeadedPage, href: string): Promise<void> => {
	const outcome = await page.evaluate(
		`(() => {
			const actions = globalThis.__norbitalSessionActions;
			if (actions == null) return 'missing-actions';
			actions.navigate(${JSON.stringify(href)});
			return 'navigated';
		})()`
	);
	assert.equal(outcome, 'navigated', `cannot navigate to ${href}: ${String(outcome)}`);
};

/**
 * The search that opens one record's representation, from any surface.
 *
 * The detail stack is a URL rather than a click path, which is the only way to reach a
 * representation whose collection no app puts a table in front of. `collection:sweep` names this
 * walk's frame the way the finder names its own.
 */
export const recordStackSearch = (collectionName: string, recordId: string): string =>
	`?stack=${encodeURIComponent(
		JSON.stringify({
			stack: [
				{
					collection_name: collectionName,
					record_id: recordId,
					node_id: 'collection:sweep',
					viewMode: 'sidesheet'
				}
			]
		})
	)}`;

/**
 * Every field of the open form, with what its renderer actually put on screen.
 *
 * `hasControl` is whether a person can operate it: a field wrapper with a label and nothing
 * operable is a renderer that did not render. `codeEditor` is the JSON fallback `DataRenderer`
 * reaches for when no builtin covers the field's kind — right for a genuinely structured column,
 * a defect when it is how an ordinary field ended up.
 */
const FORM_AUDIT = `(() => {
	const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1) ?? document;
	const form = dialog.querySelector('form');
	if (form == null) return JSON.stringify({ form: false, submit: null, fields: [] });
	const fields = [...form.querySelectorAll('[data-collection-field]')].map((node) => {
		const rect = node.getBoundingClientRect();
		return {
			name: node.getAttribute('data-collection-field'),
			label: (node.querySelector('label')?.innerText ?? '').trim(),
			hasControl:
				node.querySelector(
					'input, textarea, select, button, [role="combobox"], [role="switch"], [role="radiogroup"], [contenteditable="true"], .cm-content'
				) != null,
			codeEditor: node.querySelector('[aria-label="Code editor"], .cm-editor') != null,
			width: Math.round(rect.width),
			height: Math.round(rect.height)
		};
	});
	const submit = form.querySelector('button[type="submit"]');
	/**
	 * Every visible label a person reads in the form, not just each field's first \`<label>\`.
	 *
	 * A section heading and the field it holds are both labels to a reader, and so is a control
	 * label a renderer draws inside its own field frame. Collecting them together is what makes
	 * "Activity" printed three times over one control a finding rather than three passing fields.
	 */
	const labels = [...form.querySelectorAll('label, h3, legend')]
		.filter((node) => node.getBoundingClientRect().height > 0)
		.map((node) => (node.innerText ?? '').trim())
		.filter((text) => text !== '');
	return JSON.stringify({
		form: true,
		submit: submit == null ? null : (submit.textContent ?? '').trim(),
		labels,
		fields
	});
})()`;

export type FormAudit = {
	readonly form: boolean;
	readonly submit: string | null;
	readonly labels: readonly string[];
	readonly fields: readonly {
		readonly name: string;
		readonly label: string;
		readonly hasControl: boolean;
		readonly codeEditor: boolean;
		readonly width: number;
		readonly height: number;
	}[];
};

export const readFormAudit = async (page: HeadedPage): Promise<FormAudit> =>
	JSON.parse(String(await page.evaluate(FORM_AUDIT))) as FormAudit;

/**
 * A form is presentable when every field it shows is labelled, operable and laid out, and when the
 * JSON code editor is confined to the columns that genuinely carry a structured value.
 */
export const assertFormPresentable = (
	audit: FormAudit,
	label: string,
	structuredFields: ReadonlySet<string>
): void => {
	assert.equal(audit.form, true, `${label} opened no form`);
	assert.ok(audit.fields.length > 0, `${label} rendered a form with no fields`);
	const report = (
		predicate: (field: FormAudit['fields'][number]) => boolean,
		sentence: string
	): void => {
		const offenders = audit.fields.filter(predicate);
		assert.equal(
			offenders.length,
			0,
			`${label} ${sentence} (${offenders.length}): ${JSON.stringify(offenders, null, 2)}`
		);
	};
	report((field) => field.label === '', 'shows unlabelled field(s)');
	report((field) => !field.hasControl, 'has field(s) whose renderer produced nothing operable');
	report((field) => field.width < 40 || field.height < 16, 'has collapsed field(s)');
	report(
		(field) => field.codeEditor && !structuredFields.has(field.name),
		'fell through to the raw JSON code editor for field(s) that carry no structured value'
	);
	/**
	 * The same words twice in one form: a section heading that repeats the only field under it, a
	 * renderer drawing its own copy of the label its frame already carries. Neither is an error the
	 * browser raises, so without this the walk calls a form clean while a person reads "Activity"
	 * three times over one control.
	 */
	const counts = new Map<string, number>();
	for (const text of audit.labels) counts.set(text, (counts.get(text) ?? 0) + 1);
	const repeated = [...counts].filter(([, count]) => count > 1).map(([text]) => text);
	assert.deepEqual(
		repeated,
		[],
		`${label} prints the same label more than once: ${JSON.stringify(repeated)}`
	);
};

/** Close whatever sheet or dialog is open, by the escape a person would press. */
export const closeOverlay = async (page: HeadedPage): Promise<void> => {
	await page.evaluate(
		`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
	);
	await new Promise((resolve) => setTimeout(resolve, 250));
};

/**
 * Every app route and every collection the compiler emitted.
 *
 * Read from `.norbital/generated/authoring-types.ts` rather than listed in the test, so an app
 * added tomorrow is swept without anybody remembering to add it here.
 */
export const authoredNames = (
	generatedTypesPath: string,
	source: string
): { readonly apps: readonly string[]; readonly collections: readonly string[] } => {
	const read = (name: 'AppName' | 'CollectionName'): readonly string[] => {
		const line = new RegExp(`export type ${name} = ([^;]+);`).exec(source);
		if (line?.[1] == null)
			throw new Error(`${generatedTypesPath} declares no ${name} — run \`bolt sync\` first.`);
		return [...line[1].matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? '');
	};
	return { apps: read('AppName'), collections: read('CollectionName') };
};
