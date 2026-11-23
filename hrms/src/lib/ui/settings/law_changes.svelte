<script lang="ts">
	/**
	 * A law's dated changes, newest first. Each row expands in place to show the structured before → after diff
	 * of every path changed on that date, plus a direct action to open the underlying `jurisdiction_change` record
	 * to edit its patch, move its date, or delete it.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Badge,
		Button,
		Timeline,
		format,
		open_record,
		type TimelineEntry
	} from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { inForce, leaves, type Change } from '../../dated.js';
	import { LAW_DEPTH, LAW_ROWS } from '../../../data/model/jurisdiction/service/law.js';
	import { isJsonObject, stableJson, type Json, type JsonObject } from '../../foundation.js';
	import { changeOf, standingChanges, type LawChange } from './law_save.js';

	let { ctx, chain, today }: { ctx: PageContext; chain: readonly LawChange[]; today: string } =
		$props();

	const title = (name: string) => `${name[0]?.toUpperCase()}${name.slice(1).replaceAll('_', ' ')}`;
	const familyLabel = (family: string): string => {
		const rows = LAW_ROWS.find((name) => name === family);
		return rows === undefined ? title(family) : ctx.t(`law_family.${rows}`);
	};

	/** Walks a folded law state along a `/`-separated leaf path; returns `undefined` when absent. */
	const readAt = (state: JsonObject, path: string): Json | undefined => {
		let cur: Json | undefined = state;
		for (const key of path.split('/')) {
			if (!isJsonObject(cur) || !(key in cur)) return undefined;
			cur = cur[key];
		}
		return cur;
	};

	const formatValue = (value: Json): string =>
		typeof value === 'string'
			? value
			: typeof value === 'number' || typeof value === 'boolean'
				? String(value)
				: JSON.stringify(value, null, 2);

	type DiffKind = 'added' | 'removed' | 'changed';
	type DiffRow = {
		readonly path: string;
		readonly label: string;
		readonly kind: DiffKind;
		readonly before: Json | undefined;
		readonly after: Json;
	};
	type DiffGroup = {
		readonly family: string;
		readonly title: string;
		readonly rows: readonly DiffRow[];
	};

	/** Family, then each row or key with the fields set under it; a long list is cut. */
	const summary = (patch: JsonObject): string =>
		[...Map.groupBy(leaves(patch, LAW_DEPTH), ([path]) => path.split('/')[0] ?? '')]
			.map(([family, paths]) => {
				const codes = [...Map.groupBy(paths, ([path]) => path.split('/')[1] ?? '')].map(
					([code, set]) => {
						const names = set.flatMap(([path, value]) => {
							const field = path.split('/')[2];
							return field !== undefined
								? [field]
								: value === null
									? [ctx.t('law_changes.removed')]
									: [];
						});
						// a lookup changed key by key names its field once
						const fields = [...new Set(names)];
						const shown = fields.length > 4 ? [...fields.slice(0, 4), '…'] : fields;
						return shown.length === 0 ? code : `${code} (${shown.join(', ')})`;
					}
				);
				const shown = codes.length > 6 ? [...codes.slice(0, 6), '…'] : codes;
				return `${familyLabel(family)}: ${shown.join(', ')}`;
			})
			.join(' · ');

	const chronological = $derived(
		standingChanges(chain)
			.map(changeOf)
			.toSorted(
				(left, right) =>
					left.effective_from.localeCompare(right.effective_from) || left.id.localeCompare(right.id)
			)
	);

	/** Compute structured before → after diff groups for one change against all prior standing changes. */
	const diffGroupsFor = (change: Change): readonly DiffGroup[] => {
		const prior = chronological.filter(
			(other) =>
				other.id !== change.id &&
				(other.effective_from < change.effective_from ||
					(other.effective_from === change.effective_from && other.id < change.id))
		);
		const priorState =
			prior.length === 0 ? {} : inForce(prior, change.effective_from, LAW_DEPTH).state;
		const rows: (DiffRow & { readonly family: string })[] = [];
		for (const [path, after] of leaves(change.patch, LAW_DEPTH)) {
			const before = readAt(priorState, path);
			if (after === null && before === undefined) continue;
			if (before !== undefined && after !== null && stableJson(before) === stableJson(after))
				continue;
			const parts = path.split('/');
			const family = parts[0] ?? '';
			const label = parts.slice(1).join(' › ') || family;
			const kind: DiffKind =
				after === null ? 'removed' : before === undefined ? 'added' : 'changed';
			rows.push({ family, path, label, kind, before, after });
		}
		return [...Map.groupBy(rows, (row) => row.family)].map(([family, groupRows]) => ({
			family,
			title: familyLabel(family),
			rows: groupRows
		}));
	};

	const baselineCounts = (
		patch: JsonObject
	): readonly { readonly title: string; readonly count: number }[] =>
		Object.entries(patch)
			.filter(([, value]) => isJsonObject(value) && Object.keys(value).length > 0)
			.map(([family, value]) => ({
				title: familyLabel(family),
				count: isJsonObject(value) ? Object.keys(value).length : 0
			}));

	const items = $derived.by(() => {
		const ordered = chain
			.map((row) => ({ row, change: changeOf(row) }))
			.toSorted(
				(left, right) =>
					right.change.effective_from.localeCompare(left.change.effective_from) ||
					right.change.id.localeCompare(left.change.id)
			);
		const first = ordered.at(-1)?.change.id;
		return ordered.map(({ row, change }) => {
			const finding = row.finding_id?.status;
			const isBaseline = change.id === first;
			const what = isBaseline ? ctx.t('law_changes.whole') : summary(change.patch);
			const active =
				(finding === undefined || finding === 'CONFIRMED') && change.effective_from <= today;
			return {
				id: change.id,
				change,
				isBaseline,
				active,
				period: format({ kind: 'date' }, change.effective_from, { locale: ctx.locale }),
				status:
					finding !== undefined && finding !== 'CONFIRMED'
						? ctx.t('law_changes.not_confirmed')
						: change.effective_from > today
							? ctx.t('law_changes.upcoming')
							: ctx.t('app.settings.version_in_force'),
				detail:
					finding === undefined
						? what
						: `${what} — ${ctx.t('law_changes.research', { status: finding })}`
			};
		});
	});

	let opened = $state('');

	type LawTimelineEntry = TimelineEntry & {
		readonly item: (typeof items)[number];
	};
	const timelineEntries = $derived<readonly LawTimelineEntry[]>(
		items.map((item) => ({
			key: item.id,
			icon: item.isBaseline ? 'lucide:landmark' : 'lucide:file-diff',
			...(item.active ? { tone: 'brand' as const } : {}),
			...(item.change.effective_from > today ? { status: 'future' as const } : {}),
			current: item.active,
			title: item.period,
			line: item.detail === '' ? [] : [item.detail],
			mark: { text: item.status, variant: item.active ? ('brand' as const) : ('outline' as const) },
			expanded: opened === item.id,
			ontoggle: () => {
				opened = opened === item.id ? '' : item.id;
			},
			item
		}))
	);
</script>

<Timeline entries={timelineEntries} label={ctx.t('app.settings.changes')}>
	{#snippet item({ item: entry })}
		<Stack gap="sm" class="pb-2">
			<Cluster gap="xs" justify="end">
				<Button variant="outline" onclick={() => open_record('jurisdiction_change', entry.id)}>
					{ctx.t('law_changes.open_record')}
				</Button>
			</Cluster>
			{#if entry.isBaseline}
				{@const counts = baselineCounts(entry.change.patch)}
				<div class="overflow-hidden rounded-md border border-border bg-card">
					<div class="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
						{#each counts as countRow (countRow.title)}
							<div class="flex items-center justify-between gap-2 bg-card px-3 py-2 text-xs">
								<span class="truncate text-muted-foreground">{countRow.title}</span>
								<span class="font-mono font-medium text-foreground tabular-nums"
									>{countRow.count}</span
								>
							</div>
						{/each}
					</div>
				</div>
			{:else}
				{@const groups = diffGroupsFor(entry.change)}
				{#if groups.length === 0}
					<p class="text-xs text-muted-foreground">{ctx.t('law_changes.empty_diff')}</p>
				{:else}
					{#each groups as group (group.family)}
						<div class="overflow-hidden rounded-md border border-border bg-card">
							<div
								class="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground"
							>
								<span>{group.title}</span>
								<span class="font-mono text-muted-foreground tabular-nums">{group.rows.length}</span
								>
							</div>
							<div class="divide-y divide-border/70">
								{#each group.rows as row (row.path)}
									<div class="flex flex-col gap-1.5 px-3 py-2">
										<div class="flex items-center justify-between gap-2">
											<span class="min-w-0 truncate font-mono text-xs font-medium text-foreground"
												>{row.label}</span
											>
											<Badge
												variant={row.kind === 'removed'
													? 'destructive'
													: row.kind === 'added'
														? 'success'
														: 'outline'}
											>
												{ctx.t(
													row.kind === 'removed'
														? 'law_changes.removed'
														: row.kind === 'added'
															? 'law_changes.added'
															: 'law_changes.changed'
												)}
											</Badge>
										</div>
										{#if row.before !== undefined}
											<div
												class="flex items-start gap-2 rounded-badge bg-destructive/10 px-2 py-1 font-mono text-xs text-destructive"
											>
												<span class="shrink-0 select-none opacity-70">-</span>
												<pre
													class="m-0 min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs">{formatValue(
														row.before
													)}</pre>
											</div>
										{/if}
										{#if row.after !== null}
											<div
												class="flex items-start gap-2 rounded-badge bg-success/10 px-2 py-1 font-mono text-xs text-success"
											>
												<span class="shrink-0 select-none opacity-70">+</span>
												<pre
													class="m-0 min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs">{formatValue(
														row.after
													)}</pre>
											</div>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/each}
				{/if}
			{/if}
		</Stack>
	{/snippet}
</Timeline>
