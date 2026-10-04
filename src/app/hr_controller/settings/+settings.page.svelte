<script lang="ts">
	/**
	 * The jurisdiction configuration app: one version of one settings lineage (MY, SG, …), chosen in the header, shared
	 * by every entity bound to the lineage. Tabs: the version itself (its facts and work rules, the collection's record
	 * view, whose header carries the version's lifecycle: a new draft cloned from it, its seal, a wrong seal's void),
	 * statutory contributions, the five money catalogues, and the comparison of two snapshots. A sealed version is law
	 * that has frozen: no table under it offers a create.
	 */
	import { t } from '../../../lib/ui/i18n/t.js';
	import { Toaster } from 'svelte-sonner';
	import { AppShell } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import { Combobox, EmptyState, RecordShell, Table, Tabs } from '@norbital-ai/ui';
	import { newestFirst } from '../../../lib/jurisdiction_settings.js';
	import {
		jurisdictionOptions,
		jurisdictionVersions,
		resolveJurisdictionScope
	} from './jurisdiction-scope.svelte.js';
	import SnapshotChanges from './SnapshotChanges.svelte';
	import { setContext } from 'svelte';
	import { CHOOSE_SETTINGS_VERSION } from '../../../lib/ui/scopes/settings-version-lifecycle.svelte';

	const all = jurisdictionVersions();
	let chosen = $state<Id<'jurisdiction_settings'> | null>(null);
	const scope = $derived(resolveJurisdictionScope(all.current ?? [], chosen));
	const options = $derived(jurisdictionOptions(all.current ?? []));
	const versions = $derived(
		newestFirst((all.current ?? []).filter((row) => row.code === scope?.code))
	);
	const version = $derived(
		versions.find((row) => row.id === scope?.versionId) ?? versions[0] ?? null
	);
	const sealed = $derived(version?.sealed_at != null);
	const CATALOGUES = [
		['leave_catalogue', 'lucide:calendar-days'],
		['claim_catalogue', 'lucide:receipt-text'],
		['allowance_catalogue', 'lucide:calendar-clock'],
		['adhoc_catalogue', 'lucide:hand-coins'],
		['loan_catalogue', 'lucide:landmark']
	] as const;
	type Catalogue = (typeof CATALOGUES)[number][0];
	// a clone from the version's own actions shows the new draft here
	setContext(CHOOSE_SETTINGS_VERSION, (id: Id<'jurisdiction_settings'>) => (chosen = id));
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
				of="statutory_contributions"
				key="contributions"
				toolbar={{ title: t('component.statutory_contributions'), new: !sealed }}
				where={{ settings_id: { eq: version.id }, approval_id: { isNull: true } }}
				orderBy={{ code: 'asc' }}
				columns={[
					{ field: 'code', label: t('component.code') },
					{ field: 'name', label: t('component.name') },
					{ field: 'assessment_period', label: t('component.assessment_period') }
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
			{#if collection === 'leave_catalogue'}
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
				leave_catalogue: leaveTab,
				claim_catalogue: claimTab,
				allowance_catalogue: allowanceTab,
				adhoc_catalogue: adhocTab,
				loan_catalogue: loanTab
			}[collection]
		}))}
	/>
{/snippet}
{#snippet leaveTab()}{@render catalogue('leave_catalogue')}{/snippet}
{#snippet claimTab()}{@render catalogue('claim_catalogue')}{/snippet}
{#snippet allowanceTab()}{@render catalogue('allowance_catalogue')}{/snippet}
{#snippet adhocTab()}{@render catalogue('adhoc_catalogue')}{/snippet}
{#snippet loanTab()}{@render catalogue('loan_catalogue')}{/snippet}

{#snippet changes()}
	{#if version}<SnapshotChanges {versions} selectedVersion={version} />{/if}
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
	{/snippet}
	{#if all.current === undefined}
		
	{:else if scope == null}
		<EmptyState title={t('app.settings.choose_jurisdiction_empty')} />
	{:else}
		<Tabs
			tabs={[
				{ name: 'general', title: t('app.settings.general'), icon: 'lucide:scale', body: general },
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
				{ name: 'changes', title: t('app.settings.changes'), icon: 'lucide:diff', body: changes }
			]}
		/>
	{/if}
</AppShell>
