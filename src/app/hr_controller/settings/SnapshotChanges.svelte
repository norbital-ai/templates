<script lang="ts">
	/**
	 * The Changes tab's body: two snapshots of one lineage and the leaf-level difference between
	 * them. It owns its own catalogue reads, so they start when the tab is first opened and the
	 * Settings page itself still opens exactly one query over the lineage.
	 *
	 * It opens on the version on screen against its predecessor, and either side is pickable, so
	 * "what did this version change?" and "what changed between these two?" are the same control.
	 */
	import { t } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';
	import { Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import { Combobox, Spinner } from '@norbital-ai/ui';
	import { formatSettingsRange } from '../../../lib/ui/display-formatters.js';
	import {
		diffCollection,
		diffSettingsRoot,
		formatLeafPath,
		type CollectionDiff,
		type LeafChange
	} from '../../../lib/snapshot_diff.js';
	import { snapshotId } from './jurisdiction-scope.svelte.js';
	import * as Predicate from 'effect/Predicate';

	type Version = {
		readonly id: Id<'jurisdiction_settings'>;
		readonly code: string;
		readonly name: string;
		readonly effective_range: unknown;
	};

	type Props = {
		code: string;
		versions: readonly Version[];
		selectedVersion: Version | null;
	};

	let { code, versions, selectedVersion }: Props = $props();

	let baseVersionId = $state<Id<'jurisdiction_settings'> | null>(null);
	let compareVersionId = $state<Id<'jurisdiction_settings'> | null>(null);
	const compareVersion = $derived(
		versions.find((version) => version.id === compareVersionId) ?? selectedVersion
	);
	const baseVersion = $derived.by(() => {
		const chosen = versions.find((version) => version.id === baseVersionId);
		if (chosen != null) return chosen;
		// `versions` is newest first, so the predecessor of the compared version is the next row.
		const index = compareVersion == null ? -1 : versions.indexOf(compareVersion);
		return versions[index + 1] ?? compareVersion;
	});
	const comparing = $derived(
		baseVersion != null && compareVersion != null && baseVersion.id !== compareVersion.id
	);
	const baseChoice = $derived(baseVersion?.id ?? null);
	const compareChoice = $derived(compareVersion?.id ?? null);
	const snapshotChoices = $derived(
		versions.map((version, offset) => ({
			value: version.id,
			label: snapshotId(code, versions, offset),
			description: formatSettingsRange(version.effective_range)
		}))
	);

	const COLLECTIONS = [
		'statutory_contributions',
		'leave_catalogue',
		'claim_catalogue',
		'allowance_catalogue',
		'adhoc_catalogue',
		'loan_catalogue'
	] as const;
	/**
	 * Both sides of every catalogue, read once (a comparison is a reading, not a subscription): a lineage's rules run
	 * to a megabyte a version (Malaysia's MTD rungs), so each version's rows are their own read.
	 */
	const reading = $derived.by(() => {
		if (!comparing || baseVersion == null || compareVersion == null) return null;
		const sides = [baseVersion.id, compareVersion.id];
		return Promise.all(
			COLLECTIONS.map(async (collection) => {
				const [previous = [], proposed = []] = await Promise.all(
					sides.map(
						async (id) =>
							(await bolt.read(collection, { where: { settings_id: { eq: id } }, all: true })).rows
					)
				);
				return previous.length === 0 && proposed.length === 0
					? null
					: diffCollection(collection, previous, proposed);
			})
		).then((diffs) => diffs.filter((diff): diff is CollectionDiff => diff != null));
	});
	const rootChanges = $derived(
		comparing && baseVersion != null && compareVersion != null
			? diffSettingsRoot(baseVersion, compareVersion)
			: ([] as readonly LeafChange[])
	);

	const collectionLabel = (collection: string): string => {
		switch (collection) {
			case 'statutory_contributions':
				return t('app.settings.contribution_catalogue');
			case 'leave_catalogue':
				return t('app.settings.leave_catalogue');
			case 'claim_catalogue':
				return t('app.settings.claim_catalogue');
			case 'allowance_catalogue':
				return t('app.settings.allowance_catalogue');
			case 'adhoc_catalogue':
				return t('app.settings.adhoc_catalogue');
			default:
				return t('app.settings.loan_catalogue');
		}
	};
	const formatDiffValue = (value: string | number | boolean | null): string => {
		if (value == null) return '—';
		// Numbers keep their grouping: a ceiling of 1086300 reads as 1,086,300, and the whole
		// value stays whole rather than being character-diffed against its predecessor.
		if (Predicate.isNumber(value))
			return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
		const text = String(value);
		return text.length > 140 ? `${text.slice(0, 137)}…` : text;
	};
	/**
	 * One changed value, trimmed to the text that actually changed.
	 *
	 * Short values print whole — a number diffed by character is how `1054.74 → 10863` becomes
	 * "1 05474 → 10863". Only long sentences are trimmed to their changed clause; the untrimmed
	 * pair stays on the hover title either way.
	 */
	const diffLine = (
		previous: string | number | boolean | null,
		proposed: string | number | boolean | null
	) => {
		const left = formatDiffValue(previous);
		const right = formatDiffValue(proposed);
		if (left === right) return { head: left, before: '', after: '', tail: '', title: left };
		if (left.length <= 40 && right.length <= 40)
			return { head: '', before: left, after: right, tail: '', title: `${left} → ${right}` };
		let start = 0;
		while (start < left.length && start < right.length && left[start] === right[start]) start++;
		let endLeft = left.length;
		let endRight = right.length;
		while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
			endLeft--;
			endRight--;
		}
		const context = 24;
		const headStart = Math.max(0, start - context);
		const suffixLength = Math.min(left.length - endLeft, right.length - endRight);
		const shownTail = Math.min(context, suffixLength);
		return {
			head: `${headStart > 0 ? '…' : ''}${left.slice(headStart, start)}`,
			before: left.slice(start, endLeft),
			after: right.slice(start, endRight),
			tail: `${left.slice(endLeft, endLeft + shownTail)}${suffixLength > context ? '…' : ''}`,
			title: `${left} → ${right}`
		};
	};
</script>

{#snippet diffValue(line: ReturnType<typeof diffLine>)}
	<span title={line.title}>
		<span class="text-muted-foreground">{line.head}</span>
		{#if line.before}
			<del class="text-destructive/80 line-through decoration-destructive/60">{line.before}</del>
		{/if}
		{#if line.before && line.after}<span class="text-muted-foreground"> → </span>{/if}
		{#if line.after}
			<ins class="font-medium text-emerald-600 no-underline dark:text-emerald-400">{line.after}</ins
			>
		{/if}
		<span class="text-muted-foreground">{line.tail}</span>
	</span>
{/snippet}

<Scroll name={t('app.settings.changes')} inset layout="stack" gap="lg">
	<Stack gap="sm">
		<Inline gap="lg" align="end">
			<Stack gap="xs">
				<span class="text-xs text-muted-foreground">{t('component.diff_against')}</span>
				<Combobox
					class="w-56"
					size="sm"
					aria-label={t('component.diff_against')}
					options={snapshotChoices}
					value={baseChoice}
					onChange={(next) => (baseVersionId = next)}
				/>
			</Stack>
			<Stack gap="xs">
				<span class="text-xs text-muted-foreground">{t('component.diff_compare')}</span>
				<Combobox
					class="w-56"
					size="sm"
					aria-label={t('component.diff_compare')}
					options={snapshotChoices}
					value={compareChoice}
					onChange={(next) => (compareVersionId = next)}
				/>
			</Stack>
		</Inline>
		<p class="text-meta">{t('component.diff_hint')}</p>
	</Stack>

	{#if !comparing}
		<p class="text-sm text-muted-foreground">{t('component.diff_same_version')}</p>
	{:else}
		{#await reading}
			<Inline
				justify="center"
				align="center"
				gap="sm"
				class="min-h-32 text-sm text-muted-foreground"
			>
				<Spinner class="size-4" />
				<span>{t('component.loading')}</span>
			</Inline>
		{:then collectionDiffs}
			{@render changes(collectionDiffs ?? [])}
		{/await}
	{/if}
</Scroll>

{#snippet changes(collectionDiffs: readonly CollectionDiff[])}
	{#if rootChanges.length === 0 && collectionDiffs.length === 0}
		<p class="text-sm text-muted-foreground">{t('component.diff_no_differences')}</p>
	{:else}
		{#if rootChanges.length > 0}
			<Stack gap="xs" data-settings-diff-root>
				<h3 class="text-sm font-semibold">{t('component.diff_settings_fields')}</h3>
				<Stack as="ul" gap="xs" class="text-sm">
					{#each rootChanges as change (change.path)}
						<li>
							<span class="text-xs font-medium">{formatLeafPath(change.path)}</span>
							{@render diffValue(diffLine(change.previous, change.proposed))}
						</li>
					{/each}
				</Stack>
			</Stack>
		{/if}
		{#each collectionDiffs as diff (diff.collection)}
			<Stack gap="sm" data-settings-diff-collection={diff.collection}>
				<h3 class="text-sm font-semibold">{collectionLabel(diff.collection)}</h3>
				{#each diff.rows as row (`${diff.collection}:${row.code}`)}
					<Stack
						gap="sm"
						class="rounded-md border p-3 {row.state === 'ADDED'
							? 'border-emerald-500/40 bg-emerald-500/5'
							: row.state === 'REMOVED'
								? 'border-destructive/40 bg-destructive/5'
								: ''}"
						data-settings-diff-row={row.code}
					>
						<Inline justify="between" align="center" gap="sm">
							<span class="text-sm font-medium">
								{row.code}
								<span class="text-muted-foreground">{row.name}</span>
							</span>
							{#if row.state !== 'CHANGED'}
								<span
									class="text-xs font-medium {row.state === 'ADDED'
										? 'text-emerald-700 dark:text-emerald-400'
										: 'text-destructive'}"
								>
									{row.state === 'ADDED' ? '+ ' : '− '}
									{row.state === 'ADDED' ? t('component.diff_added') : t('component.diff_removed')}
								</span>
							{/if}
						</Inline>
						{#if row.changes.length > 0}
							<Stack as="ul" gap="xs" class="text-sm">
								{#each row.changes as change (change.path)}
									<li>
										<span class="text-xs font-medium">{formatLeafPath(change.path)}</span>
										{@render diffValue(diffLine(change.previous, change.proposed))}
									</li>
								{/each}
							</Stack>
						{/if}
					</Stack>
				{/each}
			</Stack>
		{/each}
	{/if}
{/snippet}
