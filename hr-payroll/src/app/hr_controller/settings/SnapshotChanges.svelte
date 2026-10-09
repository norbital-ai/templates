<script lang="ts">
	/**
	 * Two versions of one lineage compared as a code diff: the settings fields, then every catalogue and the rule sets
	 * row by row (keyed by code). Each changed value is its indented lines diffed against the other version's, CEL
	 * broken over lines, with unchanged runs folded. Sections with nothing changed stay closed.
	 */
	import { bolt } from '$bolt';
	import type { Id, MessageKey } from '@norbital-ai/bolt';
	import { Badge, Combobox, EmptyState } from '@norbital-ai/ui';
	import { Bound, Cluster, Inline, Stack } from '@norbital-ai/ui/layout';
	import * as Predicate from 'effect/Predicate';
	import { t } from '../../../lib/ui/i18n/t.js';
	import { formatSettingsRange } from '../../../lib/ui/format/display_formatters.js';
	import { live, liveRows } from '../../../lib/ui/state/live.svelte.js';
	import { SETTINGS_DIFF_FIELDS } from '../../../lib/payroll_engine/settings_version.js';
	import { foldDiff, lineDiff, valueLines } from '../../../lib/ui/format/code_text.js';

	type Version = {
		id: Id<'jurisdiction_settings'>;
		name: string;
		effective_range: { from: string; to: string | null };
	};

	let {
		version,
		versions
	}: {
		version: { id: Id<'jurisdiction_settings'>; name: string } | null;
		versions: readonly Version[];
	} = $props();

	let picked = $state<Id<'jurisdiction_settings'> | null>(null);
	const others = $derived(versions.filter((row) => row.id !== version?.id));
	const against = $derived(
		picked != null && others.some((row) => row.id === picked) ? picked : (others[0]?.id ?? null)
	);
	const options = $derived(
		others.map((row) => ({
			value: row.id,
			label: `${row.name} · ${formatSettingsRange(row.effective_range)}`
		}))
	);

	const CHILDREN = [
		['leave_catalog', 'app.settings.leave_catalog'],
		['claim_catalog', 'app.settings.claim_catalog'],
		['allowance_catalog', 'app.settings.allowance_catalog'],
		['adhoc_catalog', 'app.settings.adhoc_catalog'],
		['loan_catalog', 'app.settings.loan_catalog'],
		['work_catalog', 'models.work_catalog.label'],
		['statutory_contribution_catalog', 'component.statutory_contributions'],
		['suspension_kind', 'models.suspension_kind.label'],
		['rule_set', 'section.rule_sets']
	] as const satisfies readonly (readonly [string, MessageKey])[];
	type Child = (typeof CHILDREN)[number][0];
	/** Row identity and audit columns: never a difference between two versions. */
	const SYSTEM = new Set([
		'id',
		'settings_id',
		'approval_id',
		'revision',
		'created_at',
		'updated_at'
	]);

	const rowsOf = (of: Child, id: () => Id<'jurisdiction_settings'> | null | undefined) =>
		liveRows(() => {
			const at = id();
			return at == null
				? null
				: bolt.read(of, {
						where: { settings_id: { eq: at }, approval_id: { isNull: true } },
						all: true
					});
		});
	const head = live(() => (version == null ? null : bolt.get('jurisdiction_settings', version.id)));
	const base = live(() => (against == null ? null : bolt.get('jurisdiction_settings', against)));
	const children = CHILDREN.map(([of, title]) => ({
		of,
		title,
		head: rowsOf(of, () => version?.id),
		base: rowsOf(of, () => against)
	}));

	type Entry = {
		label: string;
		status: 'same' | 'changed' | 'added' | 'removed';
		lines: ReturnType<typeof foldDiff>;
	};
	const strip = (row: object): Record<string, unknown> =>
		Object.fromEntries(Object.entries(row).filter(([key]) => !SYSTEM.has(key)));
	function entry(label: string, before: unknown, after: unknown, key = ''): Entry {
		const missing = (value: unknown) => value === undefined || value === null;
		const a = missing(before) ? [] : valueLines(before, key);
		const b = missing(after) ? [] : valueLines(after, key);
		const same = a.length === b.length && a.every((line, at) => line === b[at]);
		return {
			label,
			status: same ? 'same' : a.length === 0 ? 'added' : b.length === 0 ? 'removed' : 'changed',
			lines: same ? [] : foldDiff(lineDiff(a, b))
		};
	}
	const keyOf = (row: { readonly [key: string]: unknown }) =>
		[row['family'], row['code']].filter(Predicate.isString).join(' / ');

	const sections = $derived.by(() => {
		const left = base.current;
		const right = head.current;
		if (left == null || right == null) return null;
		const out = [
			{
				name: 'settings',
				title: t('component.diff_settings_fields'),
				entries: SETTINGS_DIFF_FIELDS.map((field) => entry(field, left[field], right[field], field))
			}
		];
		for (const child of children) {
			const before = child.base.current;
			const after = child.head.current;
			if (before === undefined || after === undefined) return null;
			const byKey = (rows: readonly object[]) =>
				new Map(rows.map((row) => [keyOf(strip(row)), strip(row)]));
			const a = byKey(before);
			const b = byKey(after);
			const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
			out.push({
				name: child.of,
				title: t(child.title),
				entries: keys.map((key) => entry(key, a.get(key), b.get(key)))
			});
		}
		return out.map((section) => ({
			...section,
			changed: section.entries.filter((row) => row.status !== 'same'),
			count: (status: Entry['status']) =>
				section.entries.filter((row) => row.status === status).length
		}));
	});
	const total = $derived(sections?.reduce((sum, section) => sum + section.changed.length, 0) ?? 0);
	const baseName = $derived(versions.find((row) => row.id === against)?.name ?? '');

	const STATUS = {
		changed: ['component.diff_changed', 'warning'],
		added: ['component.diff_added', 'success'],
		removed: ['component.diff_removed', 'destructive']
	} as const;
</script>

{#snippet counts(section: NonNullable<typeof sections>[number])}
	<span class="text-meta tabular-nums">
		{#if section.count('changed') > 0}<span class="text-warning">~{section.count('changed')}</span
			>{/if}
		{#if section.count('added') > 0}<span class="text-success">+{section.count('added')}</span>{/if}
		{#if section.count('removed') > 0}<span class="text-destructive"
				>−{section.count('removed')}</span
			>{/if}
		{t('component.diff_unchanged', { count: section.count('same') })}
	</span>
{/snippet}

{#if version == null}
	<EmptyState title={t('app.settings.changes')} />
{:else}
	<Stack gap="md">
		<p class="text-meta">{t('component.diff_hint')}</p>
		<Cluster gap="sm" align="center">
			<Combobox
				class="w-72 max-w-full"
				size="sm"
				aria-label={t('component.diff_against')}
				placeholder={t('component.diff_compare')}
				{options}
				value={against}
				onChange={(next) => (picked = next)}
			/>
			{#if against != null}
				<span class="text-meta">{baseName} → {version.name}</span>
			{/if}
		</Cluster>
		{#if against == null}
			<EmptyState title={t('component.diff_same_version')} />
		{:else if sections == null}
			<p class="text-meta">{t('component.loading')}</p>
		{:else if total === 0}
			<EmptyState title={t('component.diff_no_differences')} />
		{:else}
			<Stack gap="sm">
				{#each sections as section (section.name)}
					<details class="group rounded-md border" open={section.changed.length > 0}>
						<summary
							class="cursor-pointer list-none px-3 py-2 select-none [&::-webkit-details-marker]:hidden"
						>
							<Inline gap="sm" align="center">
								<span
									class="text-muted-foreground transition-transform group-open:rotate-90"
									aria-hidden="true">›</span
								>
								<span class="text-sm font-medium">{section.title}</span>
								{@render counts(section)}
							</Inline>
						</summary>
						{#if section.changed.length > 0}
							<Stack gap="sm" class="border-t p-3">
								{#each section.changed as row (row.label)}
									{@const [label, variant] = STATUS[row.status === 'same' ? 'changed' : row.status]}
									<Bound size="auto" clip class="rounded-sm border">
										<Inline gap="sm" align="center" class="border-b bg-muted/50 px-3 py-1.5">
											<span class="min-w-0 truncate font-mono text-xs" title={row.label}
												>{row.label}</span
											>
											<Badge {variant}>{t(label)}</Badge>
										</Inline>
										<div class="font-mono text-xs leading-5">
											{#each row.lines as line, at (at)}
												{#if line.kind === 'fold'}
													<div class="bg-muted/30 px-3 text-muted-foreground">
														⋯ {t('component.diff_folded', { count: line.count })}
													</div>
												{:else}
													<div
														class={[
															'pr-3 pl-7 -indent-4 break-words whitespace-pre-wrap',
															line.kind === 'removed' && 'bg-destructive/10',
															line.kind === 'added' && 'bg-success/10'
														]}
													>
														<span
															class={[
																'inline-block w-4 indent-0 select-none',
																line.kind === 'removed' && 'text-destructive',
																line.kind === 'added' && 'text-success'
															]}
															>{line.kind === 'removed'
																? '−'
																: line.kind === 'added'
																	? '+'
																	: ' '}</span
														>{line.text}
													</div>
												{/if}
											{/each}
										</div>
									</Bound>
								{/each}
							</Stack>
						{:else}
							<p class="text-meta border-t px-3 py-2">{t('component.diff_section_unchanged')}</p>
						{/if}
					</details>
				{/each}
			</Stack>
		{/if}
	</Stack>
{/if}
