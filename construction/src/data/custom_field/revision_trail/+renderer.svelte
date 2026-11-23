<script lang="ts">
	import type { CustomFieldView } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Timeline, type TimelineEntry, type UiContext } from '@norbital-ai/ui';

	type Entry = {
		readonly version: string;
		readonly saved_on: string;
		readonly reference?: string | null;
		readonly summary?: string | null;
	};

	let {
		view,
		ctx
	}: {
		view: CustomFieldView<'revision_trail'>;
		ctx: UiContext & Partial<Pick<PageContext, 't'>>;
	} = $props();

	const t = (key: Parameters<PageContext['t']>[0]) => ctx.t?.(key) ?? key;
	const entries = $derived<readonly Entry[]>(view.value ?? []);
	const timelineEntries = $derived<TimelineEntry[]>(
		[...entries].reverse().map((entry, idx) => ({
			key: `${entry.version}:${entry.saved_on}:${idx}`,
			icon: 'lucide:git-commit-horizontal',
			...(idx === 0 ? { tone: 'brand' as const } : {}),
			title: entry.version,
			line: [entry.saved_on, ...(entry.reference ? [entry.reference] : [])],
			...(entry.summary ? { notes: [{ kind: 'summary', text: entry.summary }] } : {})
		}))
	);
</script>

{#if timelineEntries.length === 0}
	<span class="text-sm text-muted-foreground">{t('component.no_value')}</span>
{:else}
	<Timeline entries={timelineEntries} label={t('project_files.revision_history')} />
{/if}
