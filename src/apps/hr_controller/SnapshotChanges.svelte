<script lang="ts">
	/**
	 * The Changes tab's body: two snapshots of one lineage and the leaf-level difference between
	 * them. It owns its own catalogue reads, so they start when the tab is first opened and the
	 * Settings page itself still opens exactly one query over the lineage.
	 *
	 * It opens on the version on screen against its predecessor, and either side is pickable, so
	 * "what did this version change?" and "what changed between these two?" are the same control.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import { client } from '../../lib/workspace-client.js';
	import { formatSettingsRange } from '../../lib/ui/display-formatters.js';
	import {
		diffCollection,
		diffSettingsRoot,
		type CollectionDiff,
		type LeafChange
	} from '../../lib/snapshot_diff.js';
	import SnapshotPicker from './SnapshotPicker.svelte';
	import { snapshotId } from './jurisdiction-scope.svelte.js';

	type Version = WorkspaceRow<'jurisdiction_settings'>;

	type Props = {
		code: string;
		versions: readonly Version[];
		selectedVersion: Version | null;
	};

	let { code, versions, selectedVersion }: Props = $props();
	const { t } = useI18n<TenantI18nKeys>();

	let baseVersionId = $state<string | null>(null);
	let compareVersionId = $state<string | null>(null);
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
			description: formatSettingsRange(version.effective_range),
			type: version.name ?? code
		}))
	);

	/** One live query per catalogue, both sides at once. */
	const diffQueries = $derived.by(() => {
		if (!comparing || baseVersion == null || compareVersion == null) return null;
		const settings_id = { in: [baseVersion.id, compareVersion.id] };
		return {
			statutory_contributions: client.db.statutory_contributions.findMany({
				where: { settings_id },
				limit: 2_000
			}),
			work_catalogue: client.db.work_catalogue.findMany({ where: { settings_id }, limit: 2_000 }),
			leave_catalogue: client.db.leave_catalogue.findMany({ where: { settings_id }, limit: 2_000 }),
			claim_catalogue: client.db.claim_catalogue.findMany({ where: { settings_id }, limit: 2_000 }),
			allowance_catalogue: client.db.allowance_catalogue.findMany({
				where: { settings_id },
				limit: 2_000
			}),
			payment_catalogue: client.db.payment_catalogue.findMany({
				where: { settings_id },
				limit: 2_000
			}),
			loan_catalogue: client.db.loan_catalogue.findMany({ where: { settings_id }, limit: 2_000 })
		};
	});
	const diffLoading = $derived.by(() => {
		if (diffQueries == null) return false;
		for (const query of Object.values(diffQueries))
			if (query.current === undefined && query.loading) return true;
		return false;
	});
	const rootChanges = $derived(
		comparing && baseVersion != null && compareVersion != null
			? diffSettingsRoot(baseVersion, compareVersion)
			: ([] as readonly LeafChange[])
	);
	const collectionDiffs = $derived.by<CollectionDiff[]>(() => {
		if (diffQueries == null || baseVersion == null || compareVersion == null) return [];
		const settingsIdOf = (row: object): unknown => (row as { settings_id?: unknown }).settings_id;
		const rowsOf = (query: unknown): readonly object[] =>
			(query as { current?: readonly object[] }).current ?? [];
		const result: CollectionDiff[] = [];
		for (const [collection, query] of Object.entries(diffQueries)) {
			const rows = rowsOf(query);
			const previous = rows.filter((row) => settingsIdOf(row) === baseVersion.id);
			const proposed = rows.filter((row) => settingsIdOf(row) === compareVersion.id);
			if (previous.length === 0 && proposed.length === 0) continue;
			const diff = diffCollection(collection, previous, proposed);
			if (diff != null) result.push(diff);
		}
		return result;
	});

	const collectionLabel = (collection: string): string => {
		switch (collection) {
			case 'statutory_contributions':
				return t('app.settings.contribution_catalogue');
			case 'work_catalogue':
				return t('app.settings.work_catalogue');
			case 'leave_catalogue':
				return t('app.settings.leave_catalogue');
			case 'claim_catalogue':
				return t('app.settings.claim_catalogue');
			case 'allowance_catalogue':
				return t('app.settings.allowance_catalogue');
			case 'payment_catalogue':
				return t('app.settings.payment_catalogue');
			default:
				return t('app.settings.loan_catalogue');
		}
	};
	const formatDiffValue = (value: string | number | boolean | null): string => {
		if (value == null) return '—';
		const text = String(value);
		return text.length > 140 ? `${text.slice(0, 137)}…` : text;
	};
	/**
	 * One changed value, trimmed to the text that actually changed.
	 *
	 * A long authority sentence differs in one clause — the ceiling — and printing both sentences
	 * whole makes the reader diff them by eye. The common head and tail collapse to an ellipsis so
	 * the line shows the change itself; the untrimmed pair stays on the hover title.
	 */
	const diffLine = (
		previous: string | number | boolean | null,
		proposed: string | number | boolean | null
	) => {
		const left = formatDiffValue(previous);
		const right = formatDiffValue(proposed);
		if (left === right) return { head: left, before: '', after: '', tail: '', title: left };
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

<Scroll name={t('app.settings.changes')} layout="stack" gap="lg">
	<Stack gap="sm">
		<Inline gap="lg" align="end">
			<Stack gap="xs">
				<span class="text-xs text-muted-foreground">{t('component.diff_against')}</span>
				<SnapshotPicker
					options={snapshotChoices}
					value={baseChoice}
					label={t('component.diff_against')}
					onValueChange={(next) => {
						baseVersionId = next;
					}}
				/>
			</Stack>
			<Stack gap="xs">
				<span class="text-xs text-muted-foreground">{t('component.diff_compare')}</span>
				<SnapshotPicker
					options={snapshotChoices}
					value={compareChoice}
					label={t('component.diff_compare')}
					onValueChange={(next) => {
						compareVersionId = next;
					}}
				/>
			</Stack>
		</Inline>
		<p class="text-meta">{t('component.diff_hint')}</p>
	</Stack>

	{#if !comparing}
		<p class="text-sm text-muted-foreground">{t('component.diff_same_version')}</p>
	{:else if diffLoading}
		<Inline justify="center" align="center" gap="sm" class="min-h-32 text-sm text-muted-foreground">
			<Spinner class="size-4" />
			<span>{t('component.loading')}</span>
		</Inline>
	{:else if rootChanges.length === 0 && collectionDiffs.length === 0}
		<p class="text-sm text-muted-foreground">{t('component.diff_no_differences')}</p>
	{:else}
		{#if rootChanges.length > 0}
			<Stack gap="xs" data-settings-diff-root>
				<h3 class="text-sm font-semibold">{t('component.diff_settings_fields')}</h3>
				<ul class="space-y-1 text-sm">
					{#each rootChanges as change (change.path)}
						<li>
							<code class="text-xs">{change.path}</code>
							{@render diffValue(diffLine(change.previous, change.proposed))}
						</li>
					{/each}
				</ul>
			</Stack>
		{/if}
		{#each collectionDiffs as diff (diff.collection)}
			<Stack gap="sm" data-settings-diff-collection={diff.collection}>
				<h3 class="text-sm font-semibold">{collectionLabel(diff.collection)}</h3>
				{#each diff.rows as row (`${diff.collection}:${row.code}`)}
					<div
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
							<ul class="mt-2 space-y-1 text-sm">
								{#each row.changes as change (change.path)}
									<li>
										<code class="text-xs">{change.path}</code>
										{@render diffValue(diffLine(change.previous, change.proposed))}
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/each}
			</Stack>
		{/each}
	{/if}
</Scroll>
