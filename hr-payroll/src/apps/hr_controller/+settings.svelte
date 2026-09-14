<script lang="ts">
	/**
	 * Settings is the jurisdiction configuration app: the version of one jurisdiction settings
	 * lineage (MY, SG, …) in force today, shared by every entity bound to it. It reads the lineage
	 * scope the header provides (the jurisdiction picker at the top right,
	 * `jurisdiction-scope.svelte.ts`), opens one live query for the lineage's versions, and shows
	 * the version in force (the newest otherwise) under five tabs: General (the version's own facts),
	 * Work rules (day pricing, limits and breaks), Statutory contributions, Catalog (the five
	 * monetary catalogues) and Compare snapshots. Roster codes and shift patterns are the entity's
	 * and live on its record. Sealing, voiding and cloning versions are not surfaced here.
	 *
	 * Statutory contributions is a tab of its own, not a catalogue: a scheme owns a rate ladder
	 * rather than a family of entries, and the schemes are read as a set with their own reliefs.
	 * Work rules are the version's, not a catalogue, and roster codes and patterns belong to the
	 * employing entity rather than the lineage — each is hoisted so no surface has to be read
	 * through another. Catalog keeps the five families only.
	 *
	 * Layout is one `AppShell` (variant `full`) and no page scroll: a tab panel never scrolls, the
	 * thing inside it does. The version forms own a `Scroll` of their own; every catalogue table is
	 * a bounded `CollectionTable` owning its rows; the Compare snapshots tab owns a `Scroll` of its
	 * own. So a tab owns exactly one vertical scrollport and wheel events never die inside a clipped
	 * panel or over chrome.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import { AppShell } from '@norbital-ai/ui/app-shell';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Bound, Inline, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import { setContext } from 'svelte';
	import { HR_CREATE_SCOPE, type HrCreateScope } from '../../lib/ui/create-scope.js';
	import { onLineage } from '../../lib/ui/settings-scope.js';
	import { newestFirst } from '../../lib/jurisdiction_settings.js';
	import SettingsRepresentation from '../../collections/jurisdiction_settings/+representation.svelte';
	import JurisdictionScopeCombobox from './JurisdictionScopeCombobox.svelte';
	import SnapshotChanges from './SnapshotChanges.svelte';
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
	/**
	 * A sealed version is law that has frozen: its forms render read-only and no table under it
	 * offers a create.
	 */
	const sealed = $derived(selectedVersion?.sealed_at != null);

	/**
	 * The scope every catalogue form opened from here is drawn against: the version on screen. The
	 * form prefills and hides `settings_id` and keys its statutory opt-ins by that version's schemes;
	 * the getters read the derived state lazily, so the context is set once at init.
	 */
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		companyId: () => undefined,
		settingsCode: () => selectedVersion?.code,
		settingsId: () => selectedVersion?.id
	});
</script>

{#snippet general()}
	{#if selectedVersion}
		<Scroll name={t('app.settings.general')} layout="stack" gap="lg">
			<SettingsRepresentation
				record={selectedVersion}
				close={() => {}}
				embedded
				section="GENERAL"
			/>
		</Scroll>
	{/if}
{/snippet}

{#snippet contributions()}
	{#if selectedVersion}
		<Stack gap="lg">
			<CollectionTable
				{client}
				collection="statutory_contributions"
				view="hr_controller:settings:contributions"
				title={t('component.statutory_contributions')}
				description={t('component.statutory_contributions_description')}
				features={{ create: !sealed }}
				query={{
					where: { settings_id: { eq: selectedVersion.id }, approval_id: { isNull: true } },
					orderBy: { code: 'asc' }
				}}
			>
				{#snippet columns({ Column })}
					<Column name="code" label={t('component.code')} card="title" />
					<Column name="name" label={t('component.name')} card="subtitle" />
					<Column name="is_statutory" label={t('component.is_statutory')} card="badge" />
					<Column name="assessment_period" label={t('component.assessment_period')} />
				{/snippet}
			</CollectionTable>
		</Stack>
	{/if}
{/snippet}

{#snippet catalogueTable(
	collection: 'claim_catalogue' | 'allowance_catalogue' | 'payment_catalogue' | 'loan_catalogue',
	title: string,
	description: string
)}
	<!--
		Four catalogues, one table. They share one spine — a code, its destination and direction,
		its place in the reduction order and who it covers — and the family is the table rather than
		a column on it. Four copies of this markup would be four places for the order column to go
		missing from one. `leave_catalogue` is not one of them: its row is a leave first and a pay
		line second, so it has its own snippet below.
	-->
	{#if selectedVersion}
		<CollectionTable
			{client}
			{collection}
			view={`hr_controller:settings:${collection}`}
			{title}
			{description}
			features={{ create: !sealed }}
			query={{
				where: { settings_id: { eq: selectedVersion.id }, approval_id: { isNull: true } },
				orderBy: { code: 'asc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="code" label={t('component.code')} card="title" />
				<Column name="destination" label={t('component.economic_type')} card="subtitle" />
				<Column name="direction" label={t('component.settlement')} />
				<Column name="eligibility" label={t('component.who_receives')} />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#snippet workRules()}
	{#if selectedVersion}
		<Scroll name={t('component.work_rules')} layout="stack" gap="lg">
			<SettingsRepresentation
				record={selectedVersion}
				close={() => {}}
				embedded
				section="WORK_RULES"
			/>
		</Scroll>
	{/if}
{/snippet}

{#snippet catalogueClaims()}
	{@render catalogueTable(
		'claim_catalogue',
		t('app.settings.claim_catalogue'),
		t('app.settings.claim_catalogue_description')
	)}
{/snippet}

{#snippet catalogueAllowances()}
	{@render catalogueTable(
		'allowance_catalogue',
		t('app.settings.allowance_catalogue'),
		t('app.settings.allowance_catalogue_description')
	)}
{/snippet}

{#snippet cataloguePayments()}
	{@render catalogueTable(
		'payment_catalogue',
		t('app.settings.payment_catalogue'),
		t('app.settings.payment_catalogue_description')
	)}
{/snippet}

{#snippet catalogueLoans()}
	{@render catalogueTable(
		'loan_catalogue',
		t('app.settings.loan_catalogue'),
		t('app.settings.loan_catalogue_description')
	)}
{/snippet}

{#snippet catalogueLeaves()}
	{#if selectedVersion}
		<CollectionTable
			{client}
			collection="leave_catalogue"
			view="hr_controller:settings:leave_catalogue"
			title={t('app.settings.leave_catalogue')}
			description={t('app.settings.leave_catalogue_description')}
			features={{ create: !sealed }}
			query={{
				where: { settings_id: { eq: selectedVersion.id }, approval_id: { isNull: true } },
				orderBy: { code: 'asc' }
			}}
		>
			{#snippet columns({ Column })}
				<Column name="code" label={t('component.code')} card="title" />
				<Column name="name" label={t('component.name')} card="subtitle" />
				<Column name="is_statutory" label={t('component.is_statutory')} card="badge" />
				<Column name="paid" label={t('component.paid')} />
				<Column name="eligibility" label={t('component.who_may_take_it')} />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#snippet changes()}
	{#if selectedVersion}
		<SnapshotChanges code={selectedVersion.code} {versions} {selectedVersion} />
	{/if}
{/snippet}

{#snippet catalogues()}
	<!-- Five catalogues down the left, one table on the right; the table scrolls, the rail does not. -->
	<Tabs
		animate={false}
		layout="vertical"
		variant="underline"
		config={[
			{
				name: 'leave_catalogue',
				label: t('app.settings.leave_catalogue'),
				icon: 'lucide:calendar-days',
				content: catalogueLeaves
			},
			{
				name: 'claim_catalogue',
				label: t('app.settings.claim_catalogue'),
				icon: 'lucide:receipt-text',
				content: catalogueClaims
			},
			{
				name: 'allowance_catalogue',
				label: t('app.settings.allowance_catalogue'),
				icon: 'lucide:calendar-clock',
				content: catalogueAllowances
			},
			{
				name: 'payment_catalogue',
				label: t('app.settings.payment_catalogue'),
				icon: 'lucide:gift',
				content: cataloguePayments
			},
			{
				name: 'loan_catalogue',
				label: t('app.settings.loan_catalogue'),
				icon: 'lucide:landmark',
				content: catalogueLoans
			}
		] satisfies TabConfig[]}
	/>
{/snippet}

<AppShell
	icon="lucide:settings-2"
	title={t('app.settings.header_title')}
	description={t('app.settings.header_description')}
	banner="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/settings-banner.webp"
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
		<Tabs
			animate={false}
			layout="responsive"
			config={[
				{
					name: 'general',
					label: t('app.settings.general'),
					icon: 'lucide:scale',
					content: general
				},
				{
					name: 'work_rules',
					label: t('component.work_rules'),
					icon: 'lucide:receipt',
					content: workRules
				},
				{
					name: 'contributions',
					label: t('component.statutory_contributions'),
					icon: 'lucide:landmark',
					content: contributions
				},
				{
					name: 'catalog',
					label: t('app.settings.catalogues'),
					icon: 'lucide:library',
					content: catalogues
				},
				{
					name: 'changes',
					label: t('app.settings.changes'),
					icon: 'lucide:diff',
					content: changes
				}
			] satisfies TabConfig[]}
		/>
	{/if}
</AppShell>
