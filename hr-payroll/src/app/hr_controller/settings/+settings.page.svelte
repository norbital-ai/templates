<script lang="ts">
	/**
	 * The jurisdiction configuration app: one version of one settings lineage (MY, SG, …), chosen in the header, shared
	 * by every entity bound to the lineage. Tabs: the version itself (its facts and work rules, the collection's record
	 * view), statutory contributions and the five money catalogues. A sealed version is law that has frozen: no table
	 * under it offers a create.
	 */
	import { t } from '../../../lib/ui/i18n/t.js';
	import { Toaster } from 'svelte-sonner';
	import { AppShell } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import { Combobox, EmptyState, RecordShell, Table, Tabs } from '@norbital-ai/ui';
	import { newest_first } from '../../../lib/ui/scopes/settings_scope.js';
	import {
		jurisdictionOptions,
		jurisdictionVersions,
		resolveJurisdictionScope
	} from './jurisdiction_scope.svelte.js';
	import VersionLifecycle from './VersionLifecycle.svelte';
	import SnapshotChanges from './SnapshotChanges.svelte';

	const all = jurisdictionVersions();
	let chosen = $state<Id<'jurisdiction_settings'> | null>(null);
	const scope = $derived(resolveJurisdictionScope(all.current ?? [], chosen));
	const options = $derived(jurisdictionOptions(all.current ?? []));
	const versions = $derived(
		newest_first((all.current ?? []).filter((row) => row.code === scope?.code))
	);
	const version = $derived(
		versions.find((row) => row.id === scope?.versionId) ?? versions[0] ?? null
	);
	const sealed = $derived(version?.sealed_at != null);
	const CATALOGUES = [
		['leave_catalog', 'lucide:calendar-days'],
		['claim_catalog', 'lucide:receipt-text'],
		['allowance_catalog', 'lucide:calendar-clock'],
		['adhoc_catalog', 'lucide:hand-coins'],
		['loan_catalog', 'lucide:landmark']
	] as const;
	type Catalogue = (typeof CATALOGUES)[number][0];
</script>

{#snippet general()}
	{#if version}
		{#key version.id}<RecordShell of="jurisdiction_settings" id={version.id} />{/key}
	{/if}
{/snippet}

{#snippet contributions()}
	{#if version}
		{#key version.id}
			<Table
				of="statutory_contribution_catalog"
				key="contributions"
				toolbar={{ title: t('component.statutory_contributions'), new: !sealed }}
				where={{ settings_id: { eq: version.id }, approval_id: { isNull: true } }}
				orderBy={{ code: 'asc' }}
				columns={[
					{ field: 'code', label: t('component.code') },
					{ field: 'name', label: t('component.name') },
					{ field: 'authority', label: t('component.authority') }
				]}
			/>
		{/key}
	{/if}
{/snippet}

{#snippet catalogue(collection: Catalogue)}
	{#if version}
		{#key version.id}
			{@const where = { settings_id: { eq: version.id }, approval_id: { isNull: true } } as const}
			{@const toolbar = { title: t(`app.settings.${collection}`), new: !sealed }}
			{#if collection === 'leave_catalog'}
				<Table
					of={collection}
					key={collection}
					{toolbar}
					{where}
					orderBy={{ code: 'asc' }}
					columns={[
						{ field: 'code', label: t('component.code') },
						{ field: 'name', label: t('component.name') },
						{ field: 'is_npl', label: t('component.is_npl') },
						{ field: 'eligibility', label: t('component.who_may_take_it') }
					]}
				/>
			{:else}
				<Table
					of={collection}
					key={collection}
					{toolbar}
					{where}
					orderBy={{ code: 'asc' }}
					columns={[
						{ field: 'code', label: t('component.code') },
						{ field: 'destination', label: t('component.economic_type') },
						{ field: 'direction', label: t('component.settlement') },
						{ field: 'eligibility', label: t('component.who_receives') }
					]}
				/>
			{/if}
		{/key}
	{/if}
{/snippet}

{#snippet catalogues()}
	<Tabs
		tabs={CATALOGUES.map(([collection, icon]) => ({
			name: collection,
			title: t(`app.settings.${collection}`),
			icon,
			body: {
				leave_catalog: leaveTab,
				claim_catalog: claimTab,
				allowance_catalog: allowanceTab,
				adhoc_catalog: adhocTab,
				loan_catalog: loanTab
			}[collection]
		}))}
	/>
{/snippet}
{#snippet leaveTab()}{@render catalogue('leave_catalog')}{/snippet}
{#snippet claimTab()}{@render catalogue('claim_catalog')}{/snippet}
{#snippet allowanceTab()}{@render catalogue('allowance_catalog')}{/snippet}
{#snippet adhocTab()}{@render catalogue('adhoc_catalog')}{/snippet}
{#snippet loanTab()}{@render catalogue('loan_catalog')}{/snippet}

{#snippet changes()}
	<SnapshotChanges {version} {versions} />
{/snippet}

<Toaster />
<AppShell
	icon="lucide:settings-2"
	title={t('app.settings.header_title')}
	description={t('app.settings.header_description')}
	variant="full"
>
	{#snippet actions()}
		<Combobox
			class="w-64"
			size="sm"
			aria-label={t('app.settings.jurisdiction')}
			{options}
			value={scope?.versionId ?? null}
			onChange={(next) => (chosen = next)}
		/>
		<VersionLifecycle {version} {versions} onCreated={(id) => (chosen = id)} />
	{/snippet}
	{#if all.current !== undefined}
		{#if scope == null}
			<EmptyState title={t('app.settings.choose_jurisdiction_empty')} />
		{:else}
			<Tabs
				tabs={[
					{
						name: 'general',
						title: t('app.settings.general'),
						icon: 'lucide:scale',
						body: general
					},
					{
						name: 'contributions',
						title: t('component.statutory_contributions'),
						icon: 'lucide:landmark',
						body: contributions
					},
					{
						name: 'catalog',
						title: t('app.settings.catalogues'),
						icon: 'lucide:library',
						body: catalogues
					},
					{
						name: 'changes',
						title: t('app.settings.changes'),
						icon: 'lucide:git-compare',
						body: changes
					}
				]}
			/>
		{/if}
	{/if}
</AppShell>
