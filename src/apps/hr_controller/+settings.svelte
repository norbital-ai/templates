<script lang="ts">
	/**
	 * Settings is the jurisdiction configuration app: the version of one jurisdiction settings
	 * lineage (MY, SG, …) in force today, shared by every entity bound to it. It reads the lineage
	 * scope the header provides (the jurisdiction picker at the top right,
	 * `jurisdiction-scope.svelte.ts`), opens one live query for the lineage's versions, and shows
	 * the version in force (the newest otherwise) under five tabs: Payroll (the root scalars),
	 * Contributions (schemes and bands), Leave catalogue entries, Components and Holidays, one live table
	 * each. Sealing, voiding and cloning versions are not surfaced here.
	 *
	 * Layout is one `AppShell` (variant `full`) with a single page `Scroll`: a sticky tab strip
	 * scrolls with the content. Tab panels are natural height — the payroll form flows inside the
	 * page scrollport and each catalogue table is a bounded `CollectionTable` owning its own rows —
	 * so a tab owns exactly one vertical scrollport and wheel events never die inside a clipped
	 * panel or over chrome.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Bound, INSET_MX_CLASS, Inline, Scroll } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import { onLineage } from '../../lib/ui/settings-scope.js';
	import { newestFirst } from '../../lib/jurisdiction_settings.js';
	import SettingsRepresentation from '../../collections/jurisdiction_settings/+representation.svelte';
	import JurisdictionScopeCombobox from './JurisdictionScopeCombobox.svelte';
	import {
		jurisdictionsError as jurisdictionsErrorOf,
		jurisdictionsUnknown as jurisdictionsUnknownOf,
		resolveJurisdictionScope
	} from './jurisdiction-scope.svelte.js';

	type Version = WorkspaceRow<'jurisdiction_settings'>;

	const { t } = useI18n<TenantI18nKeys>();

	/**
	 * The header names a *version*, not a lineage. The page still reads the whole lineage — the
	 * catalogue tabs are keyed by the chosen version's id and the timeline is what makes a version
	 * meaningful — but which snapshot is shown is now the operator's choice rather than a silent
	 * "the one in force today", which was the one thing the old picker could not express.
	 */
	let chosenVersionId = $state<string | null>(null);
	const scope = $derived(resolveJurisdictionScope(chosenVersionId));
	const code = $derived(scope?.code ?? null);
	const jurisdictionsUnknown = $derived(jurisdictionsUnknownOf());
	const jurisdictionsError = $derived(jurisdictionsErrorOf());

	/** The one query of the page: every version of the scoped lineage. */
	const lineageQuery = $derived(
		code == null
			? null
			: client.db.jurisdiction_settings.findMany({
					where: onLineage(code),
					orderBy: { created_at: 'asc' },
					limit: 200
				})
	);
	const versions = $derived(newestFirst(lineageQuery?.current ?? []));
	const lineageUnknown = $derived(
		lineageQuery != null && lineageQuery.loading && lineageQuery.current === undefined
	);
	/** The version the header names; the scope resolver already defaulted it to the one in force. */
	const selectedVersion = $derived<Version | null>(
		versions.find((version) => version.id === scope?.versionId) ?? versions[0] ?? null
	);

	const banner =
		'/__bolt/request/api/template-seed-assets/hr-payroll/app-media/settings-banner.webp';
</script>

{#snippet payroll()}
	{#if selectedVersion}
		<SettingsRepresentation record={selectedVersion} close={() => {}} embedded />
	{/if}
{/snippet}

{#snippet contributions()}
	{#if selectedVersion}
		<CollectionTable
			{client}
			collection="statutory_contributions"
			view="hr_controller:settings:contributions"
			title={t('component.statutory_contributions')}
			description={t('component.statutory_contributions_description')}
			query={{
				where: { settings_id: { eq: selectedVersion.id }, approval_id: { isNull: true } },
				orderBy: { sequence: 'asc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="code" label={t('component.code')} card="title" />
				<Column name="name" label={t('component.name')} card="subtitle" />
				<Column name="is_statutory" label={t('component.is_statutory')} card="badge" />
				<Column name="payer" label={t('component.paid_by')} />
				<Column name="keyed_by" label={t('component.keyed_by')} />
				<Column name="sequence" label={t('component.applied_at')} />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#snippet catalogueLeaves()}
	{#if selectedVersion}
		<CollectionTable
			{client}
			collection="leave_catalogue"
			view="hr_controller:settings:leave_catalogue"
			title={t('app.settings.leave_catalogue')}
			description={t('app.settings.leave_catalogue_description')}
			query={{
				where: { settings_id: { eq: selectedVersion.id }, approval_id: { isNull: true } },
				orderBy: { code: 'asc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="code" label={t('component.code')} card="title" />
				<Column name="name" label={t('component.name')} card="subtitle" />
				<Column name="is_statutory" label={t('component.is_statutory')} card="badge" />
				<Column name="accrual" label={t('component.accrual_and_carry')} />
				<Column name="entitlement" label={t('component.entitlement_bands')} />
				<Column name="eligibility" label={t('component.who_may_take_it')} />
				<Column name="exit_settlement" label={t('component.on_exit')} />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#snippet catalogueComponents()}
	{#if selectedVersion}
		<CollectionTable
			{client}
			collection="component_catalogue"
			view="hr_controller:settings:component_catalogue"
			title={t('app.settings.component_catalogue')}
			description={t('app.settings.component_catalogue_description')}
			query={{
				where: { settings_id: { eq: selectedVersion.id }, approval_id: { isNull: true } },
				orderBy: { code: 'asc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="code" label={t('component.code')} card="title" />
				<Column name="nature" label={t('component.economic_type')} card="subtitle" />
				<Column name="is_statutory" label={t('component.is_statutory')} card="badge" />
				<Column name="sequence" label={t('component.applied_at')} />
				<Column name="eligibility" label={t('component.who_receives')} />
				<Column name="contribution_treatments" label={t('component.contribution_treatments')} />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#snippet holidays()}
	{#if selectedVersion}
		<CollectionTable
			{client}
			collection="company_holidays"
			view="hr_controller:settings:holidays"
			title={t('app.settings.holidays')}
			description={t('app.settings.holidays_description')}
			query={{
				where: { settings_id: { eq: selectedVersion.id }, approval_id: { isNull: true } },
				orderBy: { date: 'asc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="date" label={t('component.observed_on')} card="title" />
				<Column name="name" label={t('component.holiday')} card="subtitle" />
				<Column name="is_statutory" label={t('component.is_statutory')} card="badge" />
				<Column name="substitutes_date" label={t('component.substitute_for')} />
				<Column name="scope" label={t('component.who_observes_it')} />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

<AppShell
	icon="lucide:settings-2"
	title={t('app.settings.header_title')}
	description={t('app.settings.header_description')}
	{banner}
	variant="full"
>
	<AppHeaderActions>
		<JurisdictionScopeCombobox
			value={scope?.versionId ?? null}
			onValueChange={(next) => {
				chosenVersionId = next;
			}}
		/>
	</AppHeaderActions>

	{#if jurisdictionsError != null}
		<Bound size="full" inset>
			<p class="py-6 text-sm text-destructive">{jurisdictionsError.message}</p>
		</Bound>
	{:else if jurisdictionsUnknown}
		<Bound size="full" inset>
			<Inline
				justify="center"
				align="center"
				gap="sm"
				class="min-h-48 text-sm text-muted-foreground"
			>
				<Spinner class="size-4" />
				<span>{t('component.loading')}</span>
			</Inline>
		</Bound>
	{:else if code == null}
		<Bound size="full" inset>
			<p class="py-6 text-sm text-muted-foreground">
				{t('app.settings.choose_jurisdiction_empty')}
			</p>
		</Bound>
	{:else if lineageQuery?.error && lineageQuery.current === undefined}
		<Bound size="full" inset>
			<p class="py-8 text-center text-sm text-destructive">{lineageQuery.error.message}</p>
		</Bound>
	{:else if lineageUnknown}
		<Bound size="full" inset>
			<Inline
				justify="center"
				align="center"
				gap="sm"
				class="min-h-48 text-sm text-muted-foreground"
			>
				<Spinner class="size-4" />
				<span>{t('component.loading')}</span>
			</Inline>
		</Bound>
	{:else if versions.length === 0}
		<Bound size="full" inset>
			<p class="py-6 text-sm text-destructive">
				{t('app.settings.lineage_missing', { code })}
			</p>
		</Bound>
	{:else}
		<!--
			One page scrollport for the whole lineage view: the tab strip scrolls with the
			content and sticks to the top. Tab panels are natural
			height — the payroll form's own scroll region stays inert in flow and the
			catalogue tables keep their bounded row scrolls — so a tab owns exactly one
			vertical scrollport and the wheel never dies over chrome or inside a nested
			region. Inset parity with the hero comes from the strip's INSET_MX and the
			panels' own padding; no content adds its own.
			No edge fade: the mask would wash out the sticky strip as content slides
			under it; the stable scrollbar gutter marks the scrollport instead.
		-->
		<Scroll name={t('app.settings.header_title')} layout="stack" gap="md" fade={false}>
			<Tabs
				animate={false}
				layout="responsive"
				class="h-auto"
				listClass={`sticky top-0 z-10 ${INSET_MX_CLASS} w-auto`}
				config={[
					{
						name: 'payroll',
						label: t('component.payroll_rules'),
						icon: 'lucide:scale',
						content: payroll
					},
					{
						name: 'contributions',
						label: t('component.statutory_contributions'),
						icon: 'lucide:landmark',
						content: contributions
					},
					{
						name: 'leave_catalogue',
						label: t('app.settings.leave_catalogue'),
						icon: 'lucide:calendar-days',
						content: catalogueLeaves
					},
					{
						name: 'component_catalogue',
						label: t('app.settings.component_catalogue'),
						icon: 'lucide:receipt',
						content: catalogueComponents
					},
					{
						name: 'holidays',
						label: t('app.settings.holidays'),
						icon: 'lucide:calendar-x',
						content: holidays
					}
				] satisfies TabConfig[]}
			/>
		</Scroll>
	{/if}
</AppShell>
