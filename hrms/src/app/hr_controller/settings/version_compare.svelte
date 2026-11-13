<script lang="ts">
	/** What one change did: the law the day it took effect, without it and with it. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Stack } from '@norbital-ai/ui/layout';
	import { Combobox, StructuredData, format } from '@norbital-ai/ui';
	import { inForce } from '../../../lib/dated.js';
	import { LAW_DEPTH } from '../../../lib/law.js';
	import { changeOf, standingChanges, type LawChange } from '../../../lib/ui/settings/law_save.js';

	let { ctx, chain, on }: { ctx: PageContext; chain: readonly LawChange[]; on: string } = $props();

	const changes = $derived(
		standingChanges(chain)
			.map(changeOf)
			.toSorted(
				(left, right) =>
					right.effective_from.localeCompare(left.effective_from) || right.id.localeCompare(left.id)
			)
	);
	let chosen = $state<string | null>(null);
	/** The chosen change, else the last one in force on the day the page shows. */
	const change = $derived(
		changes.find((row) => row.id === chosen) ??
			changes.find((row) => row.effective_from <= on) ??
			changes.at(-1)
	);
	const earlier = $derived(
		change === undefined
			? []
			: changes.filter(
					(row) =>
						row.effective_from < change.effective_from ||
						(row.effective_from === change.effective_from && row.id < change.id)
				)
	);
	const fold = (rows: typeof changes) =>
		change === undefined ? {} : inForce(rows, change.effective_from, LAW_DEPTH).state;
	const before = $derived(fold(earlier));
	const after = $derived(fold(change === undefined ? [] : [...earlier, change]));
</script>

<Stack gap="sm">
	<Combobox
		aria-label={ctx.t('settings_version.compare_change')}
		class="w-72"
		options={changes.map((row) => ({
			value: row.id,
			label: format({ kind: 'date' }, row.effective_from, { locale: ctx.locale })
		}))}
		value={change?.id ?? null}
		on_change={(next) => (chosen = next)}
	/>
	{#if change !== undefined}<StructuredData
			{ctx}
			id="settings-version-compare"
			mode="diff"
			kind={{ kind: 'json' }}
			{before}
			value={after}
			changes_only
			name={ctx.t('settings_version.compare')}
		/>{/if}
</Stack>
