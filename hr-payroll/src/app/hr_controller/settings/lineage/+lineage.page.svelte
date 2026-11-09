<script lang="ts">
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { AppShell, Cluster, Stack } from '@norbital-ai/ui/layout';
	import {
		Button,
		Combobox,
		EmptyState,
		highlightedLine,
		notifyOutcome,
		RecordShell,
		Sheet,
		Table,
		Tabs,
		Textarea,
		toast
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import {
		jurisdictionVersions,
		jurisdictionOptions,
		resolveJurisdictionScope
	} from '../jurisdiction_scope.svelte.js';
	import CalculationOverview from '../calculation_overview.svelte';
	import CatalogTabs from '../catalog_tabs.svelte';
	import VersionCompare from '../version_compare.svelte';
	import SettingsForm from '../../../../lib/ui/settings/settings_form.svelte';
	import LookupForm from '../../../../lib/ui/settings/lookup_form.svelte';
	const all = jurisdictionVersions();
	let chosen = $state<Id<'jurisdiction_settings'> | null>(null);
	const scope = $derived(
		resolveJurisdictionScope(all.current?.jurisdiction_settings.rows ?? [], chosen)
	);
	const version = $derived(
		all.current?.jurisdiction_settings.rows.find((r) => r.id === scope?.versionId)
	);
	const draft = $derived(version?.status === 'DRAFT');
	let voiding = $state(false);
	let voidReason = $state('');
	let voidSaving = $state(false);
	let starting = $state(false);
	const firstLine = (value: unknown): string =>
		String(value ?? '')
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line !== '' && line !== '// js' && !line.startsWith('//')) ?? '';
	/** Payroll reads only what `statutory_materialize` seals, so sealing a draft runs as that automation. */
	function seal(row: NonNullable<typeof version>) {
		starting = true;
		fork(
			bolt
				.start('statutory_materialize', {
					code: row.code,
					target: row.effective_range.from,
					seal: row.id
				})
				.pipe(
					Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
					Effect.ensuring(Effect.sync(() => (starting = false)))
				)
		);
	}
	function beginVoid() {
		voidReason = '';
		voiding = true;
	}
	function voidVersion() {
		if (version === undefined || voidSaving || voidReason.trim() === '') return;
		const id = version.id;
		const note = voidReason.trim();
		voidSaving = true;
		fork(
			bolt
				.act('jurisdiction_settings.update', [
					{ target: id, set: { status: 'VOID', reason: note } }
				])
				.pipe(
					Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
					Effect.tap((outcome) =>
						Effect.sync(() => {
							if (outcome.kind === 'committed') voiding = false;
						})
					),
					Effect.catch((error) =>
						Effect.sync(() =>
							toast.error(error instanceof Error ? error.message : bolt.t('component.error'))
						)
					),
					Effect.ensuring(Effect.sync(() => (voidSaving = false)))
				)
		);
	}
</script>

{#snippet codeCell({ value }: { value: unknown })}
	<code
		class="bg-muted block max-w-[16rem] truncate rounded-sm px-1.5 py-0.5 font-mono text-xs"
		data-cel
		>{#each highlightedLine(firstLine(value)) as token, i (i)}<span class={token.class || undefined}
				>{token.text}</span
			>{/each}</code
	>
{/snippet}

{#snippet jsonCell({ value }: { value: unknown })}
	<span class="block max-w-[16rem] truncate font-mono text-xs text-muted-foreground"
		>{JSON.stringify(value ?? {})}</span
	>
{/snippet}


{#snippet general()}{#if version}<RecordShell of="jurisdiction_settings" id={version.id}>
			{#snippet children(view)}<SettingsForm {view} />{/snippet}
		</RecordShell>{/if}{/snippet}

{#snippet lookup()}{#if version}<RecordShell of="jurisdiction_settings" id={version.id}>
			{#snippet children(view)}<LookupForm {view} />{/snippet}
		</RecordShell>{/if}{/snippet}

{#snippet overview()}{#if version}<CalculationOverview versionId={version.id} />{/if}{/snippet}

{#snippet catalog()}{#if version}<CatalogTabs versionId={version.id} {draft} />{/if}{/snippet}

{#snippet rules()}{#if version}<Table
			of="registered_rule"
			key="rules"
			where={{ settings_id: { eq: version.id } }}
			toolbar={{ new: draft, title: 'Registered rules' }}
			columns={[
				'description',
				'code',
				'target_collection',
				'events',
				{ field: 'reads', cell: jsonCell },
				{ field: 'condition', cell: codeCell },
				{ field: 'validate', cell: codeCell }
			]}
		/>{/if}{/snippet}

{#snippet compare()}{#if version}<VersionCompare
			versions={all.current?.jurisdiction_settings.rows ?? []}
			current={version.id}
		/>{/if}{/snippet}

{#snippet behaviour()}{#if version}<Table
			of="registered_effect"
			key="registered_effects"
			where={{ settings_id: { eq: version.id } }}
			toolbar={{ new: draft, title: 'Registered behaviour' }}
			columns={[
				'description',
				'code',
				'name',
				'source_collection',
				'events',
				'target_collection',
				'target_action',
				{ field: 'condition', cell: codeCell },
				{ field: 'effects', cell: codeCell }
			]}
		/>{/if}{/snippet}

<AppShell
	title={bolt.t('app.settings.header_title')}
	description={bolt.t('v2.settings_help')}
	icon="lucide:settings-2"
>
	{#snippet actions()}
		<div class="flex items-center gap-3">
			{#if version?.status === 'DRAFT'}
				<Button disabled={starting} onclick={() => version && seal(version)}
					>{bolt.t('settings_version.seal')}</Button
				>
			{/if}
			{#if version?.status === 'SEALED' || version?.status === 'DRAFT'}
				<Button variant="destructive" onclick={beginVoid}>{bolt.t('settings_version.void')}</Button>
			{/if}
			<Combobox
				aria-label={bolt.t('app.settings.jurisdiction')}
				class="min-w-72"
				options={jurisdictionOptions(all.current?.jurisdiction_settings.rows ?? [])}
				value={scope?.versionId ?? null}
				onChange={(next) => (chosen = next)}
			>
				{#snippet badge()}
					{#if version}<span
							class="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide {version.status ===
							'SEALED'
								? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
								: version.status === 'VOID'
									? 'border-destructive/40 bg-destructive/10 text-destructive'
									: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'}"
							>{version.status}</span
						>{/if}
				{/snippet}
			</Combobox>
		</div>
	{/snippet}
	{#if version}<Tabs
			tabs={[
				{ name: 'general', title: bolt.t('app.settings.general'), body: general },
				{ name: 'lookup', title: bolt.t('app.settings.lookup'), body: lookup },
				{ name: 'overview', title: 'Calculation overview', body: overview },
				{ name: 'catalog', title: 'Catalog', body: catalog },
				{ name: 'rules', title: 'Registered rules', body: rules },
				{ name: 'behaviour', title: 'Registered behaviour', body: behaviour },
				{ name: 'compare', title: bolt.t('settings_version.compare'), body: compare }
			]}
		/>
	{:else}<EmptyState title={bolt.t('app.settings.choose_jurisdiction_empty')} />{/if}
</AppShell>

<Sheet
	bind:open={voiding}
	title={bolt.t('settings_version.void_title', { name: version?.name ?? '' })}
>
	<Stack gap="md">
		<p class="text-muted-foreground text-sm">{bolt.t('settings_version.void_description')}</p>
		<label class="grid gap-1" for="settings-version-void-reason">
			<span class="text-xs font-medium text-muted-foreground"
				>{bolt.t('settings_version.reason')}</span
			>
			<Textarea id="settings-version-void-reason" bind:value={voidReason} disabled={voidSaving} />
		</label>
		<Cluster gap="sm" justify="end">
			<Button variant="outline" disabled={voidSaving} onclick={() => (voiding = false)}
				>{bolt.t('component.cancel')}</Button
			>
			<Button
				variant="destructive"
				disabled={voidSaving || voidReason.trim() === ''}
				onclick={voidVersion}>{bolt.t('settings_version.void')}</Button
			>
		</Cluster>
	</Stack>
</Sheet>
