<script lang="ts">
	/**
	 * Settings is the entity's configuration app: the version timeline of the jurisdiction settings
	 * lineage the scoped company operates under. It reads the company scope the group header
	 * provides (the entity picker at the top right, `company-scope.svelte.ts`), opens one live query
	 * for the lineage's versions, and shows the chosen version (the one in force today by default)
	 * under five tabs: Payroll (the root scalars), Contributions (schemes and bands), Leave types,
	 * Pay components and Holidays, one live table each.
	 *
	 * Three actions belong to the timeline and nowhere else. **Seal** freezes a draft and every row
	 * under it; it lists the entities the seal affects and, when the lineage's current version is
	 * open-ended, ends that version the day before the draft begins in the same write, which is
	 * what lets the database's no-overlap exclusion accept the seal. **Void** retires a sealed
	 * version with a reason; it is one action and is never undone. **New version** clones the
	 * chosen version and all its rows into a draft starting on a given day.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { Effect } from 'effect';
	import { toast } from 'svelte-sonner';
	import { getErrorMessage } from '@norbital-ai/std';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import { Cluster, Cover, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { Badge } from '@norbital-ai/ui/badge';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import { formatEffectiveRange } from '../../lib/ui/display-formatters.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { onLineage } from '../../lib/ui/settings-scope.js';
	import {
		coversDay,
		halfOpenOverlap,
		isInForceCandidate,
		newestFirst
	} from '../../lib/jurisdiction_settings.js';
	import { readRange } from '../../collections/payroll_runs/lib/effective.js';
	import SettingsRepresentation from '../../collections/jurisdiction_settings/+representation.svelte';
	import { isStatutoryProposal } from '../../datatypes/statutory_proposal/+definition.js';
	import CompanyScopeCombobox from './CompanyScopeCombobox.svelte';
	import {
		companiesError as companiesErrorOf,
		companiesOnLineage,
		companyById,
		resolveCompanyId
	} from './company-scope.svelte.js';

	type Version = WorkspaceRow<'jurisdiction_settings'>;
	type VersionWrite = Parameters<typeof client.db.jurisdiction_settings.mutate>[0][number];

	const { t } = useI18n<TenantI18nKeys>();

	let chosenCompanyId = $state<string | null>(null);
	const selectedCompanyId = $derived(resolveCompanyId(chosenCompanyId));
	const selectedCompany = $derived(companyById(selectedCompanyId));
	const companiesError = $derived(companiesErrorOf());
	const code = $derived(selectedCompany?.settings_code ?? null);

	/** The one query of the page: every version of the scoped entity's lineage. */
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
	const today = todayKey();
	const inForce = $derived(
		versions.find(
			(version) => isInForceCandidate(version) && coversDay(version.effective_range, today)
		) ?? null
	);

	let chosenVersionId = $state<string | null>(null);
	const selectedVersion = $derived<Version | null>(
		versions.find((version) => version.id === chosenVersionId) ?? inForce ?? versions[0] ?? null
	);
	const sealed = $derived(selectedVersion?.sealed_at != null);
	const voided = $derived(selectedVersion?.voided_at != null);
	const affected = $derived(code == null ? [] : companiesOnLineage(code));

	/**
	 * The sealed version the seal must end: the one whose range overlaps the draft's and begins
	 * before it. Its end moves to the draft's start (half-open, so the day before in calendar
	 * terms) in the same write as the seal.
	 */
	const predecessor = $derived.by((): Version | null => {
		if (selectedVersion == null || sealed) return null;
		const range = readRange(selectedVersion.effective_range);
		if (range == null) return null;
		return (
			versions.find((version) => {
				if (version.id === selectedVersion.id || !isInForceCandidate(version)) return false;
				const other = readRange(version.effective_range);
				return other != null && other.start < range.start && halfOpenOverlap(range, other);
			}) ?? null
		);
	});

	/** The review sheet the statutory drift automation left on a draft it proposed, if any. */
	const proposal = $derived(
		selectedVersion != null && isStatutoryProposal(selectedVersion.research_notes)
			? selectedVersion.research_notes
			: null
	);

	function statusOf(version: Version): string {
		if (version.voided_at != null) return t('component.voided');
		if (version.sealed_at == null) return t('component.unsealed');
		return inForce?.id === version.id ? t('component.in_force') : t('component.sealed');
	}

	let sealOpen = $state(false);
	let voidOpen = $state(false);
	let voidReason = $state('');
	let newOpen = $state(false);
	let newStart = $state('');
	let busy = $state(false);

	const now = () => new Date().toISOString();

	/**
	 * The rows a seal writes, in commit order: the predecessor's range ended first, so the
	 * database's no-overlap exclusion sees it before the draft's `sealed_at` lands, then the seal.
	 * The writes themselves are inline on the buttons below: authored client writes are event
	 * handlers, never named helpers.
	 */
	function sealRows(version: Version): VersionWrite[] {
		const rows: VersionWrite[] = [];
		const draftRange = readRange(version.effective_range);
		const previous = predecessor;
		if (previous != null && draftRange != null) {
			const previousRange = readRange(previous.effective_range);
			if (previousRange != null)
				rows.push({
					id: previous.id,
					effective_range: { start: previousRange.start, end: draftRange.start }
				});
		}
		rows.push({ id: version.id, sealed_at: now() });
		return rows;
	}

	/** One outcome for every timeline action: a toast either way, and the dialog closed on success. */
	function settle(label: string, work: Promise<unknown>, done: () => void): void {
		busy = true;
		void work
			.then(() => {
				toast.success(label);
				done();
			})
			.catch((cause: unknown) => toast.error(label, { description: getErrorMessage(cause) }))
			.finally(() => {
				busy = false;
			});
	}
</script>

<svelte:head>
	<title>Settings</title>
	<meta name="description" content={t('app.settings.description')} />
	<meta name="bolt:icon" content="lucide:settings-2" />
	<meta
		name="bolt:thumbnail"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/settings-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/app-media/settings-banner.webp"
	/>
</svelte:head>

<AppHeaderActions>
	<CompanyScopeCombobox
		value={selectedCompanyId}
		onValueChange={(id) => {
			chosenCompanyId = id;
		}}
	/>
</AppHeaderActions>

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

{#snippet leaveTypes()}
	{#if selectedVersion}
		<CollectionTable
			{client}
			collection="leave_types"
			view="hr_controller:settings:leave_types"
			title={t('app.settings.leave_types')}
			description={t('app.settings.leave_types_description')}
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

{#snippet payComponents()}
	{#if selectedVersion}
		<CollectionTable
			{client}
			collection="pay_components"
			view="hr_controller:settings:pay_components"
			title={t('app.settings.pay_components')}
			description={t('app.settings.pay_components_description')}
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

{#snippet timeline()}
	<Stack gap="sm" data-settings-timeline>
		<Stack gap="xs">
			<h2 class="text-sm font-semibold">
				{t('app.settings.lineage_title', { code: code ?? '' })}
			</h2>
			<p class="text-meta">{t('app.settings.lineage_description')}</p>
			{#if inForce == null}
				<p class="text-sm text-destructive" data-settings-no-version-in-force>
					{t('app.settings.no_version_in_force')}
				</p>
			{/if}
		</Stack>
		<Stack gap="none" class="overflow-hidden rounded-lg border">
			{#each versions as version (version.id)}
				<button
					type="button"
					data-settings-version={version.id}
					aria-pressed={selectedVersion?.id === version.id}
					class="hover:bg-muted/60 focus-visible:bg-muted/60 aria-pressed:bg-muted w-full border-b px-4 py-3 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onclick={() => {
						chosenVersionId = version.id;
					}}
				>
					<Cluster gap="sm" align="center">
						<span class="min-w-0 truncate text-sm font-medium">{version.name}</span>
						<Badge variant={inForce?.id === version.id ? 'default' : 'outline'}
							>{statusOf(version)}</Badge
						>
						{#if isStatutoryProposal(version.research_notes)}
							<Badge variant="info" data-settings-proposed
								>{t('app.settings.proposed_by_drift')}</Badge
							>
						{/if}
						<span class="text-sm text-muted-foreground"
							>{formatEffectiveRange(version.effective_range)}</span
						>
					</Cluster>
				</button>
			{/each}
		</Stack>
		{#if selectedVersion}
			<Cluster gap="sm" align="center" data-settings-actions>
				<Badge variant="outline" data-settings-status>{statusOf(selectedVersion)}</Badge>
				<span class="text-sm text-muted-foreground">
					{t('app.settings.affects_entities', {
						entities: affected.map((company) => company.name).join(', ') || '—'
					})}
				</span>
				{#if !sealed}
					<Button
						size="sm"
						data-settings-seal
						disabled={busy}
						onclick={() => {
							sealOpen = true;
						}}>{t('app.settings.seal')}</Button
					>
				{/if}
				{#if sealed && !voided}
					<Button
						size="sm"
						variant="outline"
						data-settings-void
						disabled={busy}
						onclick={() => {
							voidOpen = true;
						}}>{t('app.settings.void')}</Button
					>
				{/if}
				<Button
					size="sm"
					variant="outline"
					data-settings-new-version
					disabled={busy}
					onclick={() => {
						newStart = today;
						newOpen = true;
					}}>{t('app.settings.new_version')}</Button
				>
			</Cluster>
			{#if proposal}
				<Stack gap="xs" class="rounded-lg border p-4" data-settings-proposal>
					<p class="text-sm font-medium">{t('app.settings.proposed_by_drift')}</p>
					<p class="text-meta">
						{t('app.settings.proposal_description', {
							date: proposal.proposed_at.slice(0, 10),
							count: proposal.changes.length
						})}
					</p>
					<ul class="list-disc space-y-1 pl-5 text-sm">
						{#each proposal.changes as change (`${change.collection}:${change.code}:${change.field}`)}
							<li>
								<span class="font-medium">{change.code}</span>
								<span class="text-muted-foreground"> {change.field}</span>
								<span class="text-muted-foreground">
									{t('app.settings.proposal_values', {
										previous: JSON.stringify(change.previous),
										proposed: JSON.stringify(change.proposed)
									})}
								</span>
								<a
									class="text-muted-foreground underline"
									href={change.source_url}
									target="_blank"
									rel="noreferrer">{t('app.settings.proposal_source')}</a
								>
							</li>
						{/each}
					</ul>
					{#if proposal.notes.length > 0}
						<p class="text-meta">{proposal.notes.join(' ')}</p>
					{/if}
					{#if proposal.unreachable.length > 0}
						<p class="text-meta" data-settings-proposal-unreachable>
							{t('app.settings.proposal_unreachable', { count: proposal.unreachable.length })}
						</p>
						<ul class="list-disc space-y-1 pl-5 text-sm">
							{#each proposal.unreachable as source (source.url)}
								<li>
									<a
										class="text-muted-foreground underline"
										href={source.url}
										target="_blank"
										rel="noreferrer">{source.url}</a
									>
									<span class="text-muted-foreground"> {source.reason}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</Stack>
			{/if}
		{/if}
	</Stack>
{/snippet}

<Cover>
	{#if companiesError != null}
		<p class="p-6 text-sm text-destructive">{companiesError.message}</p>
	{:else if selectedCompany == null || code == null}
		<p class="p-6 text-sm text-muted-foreground">{t('app.settings.choose_entity')}</p>
	{:else if lineageQuery?.error && lineageQuery.current === undefined}
		<p class="py-8 text-center text-sm text-destructive">{lineageQuery.error.message}</p>
	{:else if lineageUnknown}
		<Inline justify="center" align="center" gap="sm" class="min-h-48 text-sm text-muted-foreground">
			<Spinner class="size-4" />
			<span>{t('component.loading')}</span>
		</Inline>
	{:else if versions.length === 0}
		<p class="p-6 text-sm text-destructive">
			{t('app.settings.lineage_missing', { code })}
		</p>
	{:else}
		<Stack gap="md">
			{@render timeline()}
			<Tabs
				animate={false}
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
						name: 'leave_types',
						label: t('app.settings.leave_types'),
						icon: 'lucide:calendar-days',
						content: leaveTypes
					},
					{
						name: 'pay_components',
						label: t('app.settings.pay_components'),
						icon: 'lucide:receipt',
						content: payComponents
					},
					{
						name: 'holidays',
						label: t('app.settings.holidays'),
						icon: 'lucide:calendar-x',
						content: holidays
					}
				] satisfies TabConfig[]}
			/>
		</Stack>
	{/if}
</Cover>

<Dialog.Root bind:open={sealOpen}>
	<Dialog.Content class="max-w-md" data-settings-seal-dialog>
		<Dialog.Header>
			<Dialog.Title
				>{t('app.settings.seal_title', { name: selectedVersion?.name ?? '' })}</Dialog.Title
			>
			<Dialog.Description>{t('app.settings.seal_description')}</Dialog.Description>
		</Dialog.Header>
		<Stack gap="xs" class="text-sm">
			<p>
				{t('app.settings.affects_entities', {
					entities: affected.map((company) => company.name).join(', ') || '—'
				})}
			</p>
			{#if predecessor}
				<p class="text-muted-foreground">
					{t('app.settings.seal_ends_previous', {
						name: predecessor.name,
						start: readRange(selectedVersion?.effective_range)?.start ?? ''
					})}
				</p>
			{/if}
		</Stack>
		<Dialog.Footer>
			<Dialog.Close>{t('roster.cancel')}</Dialog.Close>
			<Button
				data-settings-seal-confirm
				disabled={busy || selectedVersion == null}
				onclick={() => {
					const version = selectedVersion;
					if (version == null) return;
					settle(
						t('app.settings.sealed_toast', { name: version.name }),
						Effect.runPromise(
							submitCollectionMutation(() =>
								client.db.jurisdiction_settings.mutate(sealRows(version))
							)
						),
						() => {
							sealOpen = false;
						}
					);
				}}>{t('app.settings.seal')}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={voidOpen}>
	<Dialog.Content class="max-w-md" data-settings-void-dialog>
		<Dialog.Header>
			<Dialog.Title
				>{t('app.settings.void_title', { name: selectedVersion?.name ?? '' })}</Dialog.Title
			>
			<Dialog.Description>{t('app.settings.void_description')}</Dialog.Description>
		</Dialog.Header>
		<Input bind:value={voidReason} placeholder={t('app.settings.void_reason')} />
		<Dialog.Footer>
			<Dialog.Close>{t('roster.cancel')}</Dialog.Close>
			<Button
				variant="destructive"
				data-settings-void-confirm
				disabled={busy || selectedVersion == null}
				onclick={() => {
					const version = selectedVersion;
					if (version == null) return;
					settle(
						t('app.settings.voided_toast', { name: version.name }),
						Effect.runPromise(
							submitCollectionMutation(() =>
								client.db.jurisdiction_settings.mutate([
									{ id: version.id, voided_at: now(), void_reason: voidReason.trim() || null }
								])
							)
						),
						() => {
							voidOpen = false;
							voidReason = '';
						}
					);
				}}>{t('app.settings.void')}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={newOpen}>
	<Dialog.Content class="max-w-md" data-settings-new-version-dialog>
		<Dialog.Header>
			<Dialog.Title>{t('app.settings.new_version_title', { code: code ?? '' })}</Dialog.Title>
			<Dialog.Description>{t('app.settings.new_version_description')}</Dialog.Description>
		</Dialog.Header>
		<Input type="date" bind:value={newStart} />
		<Dialog.Footer>
			<Dialog.Close>{t('roster.cancel')}</Dialog.Close>
			<Button
				data-settings-new-version-confirm
				disabled={busy || newStart === '' || selectedVersion == null}
				onclick={() => {
					const version = selectedVersion;
					if (version == null || newStart === '') return;
					settle(
						t('app.settings.new_version_toast', { code: version.code, start: newStart }),
						Promise.resolve(
							client.invoke.new_settings_version({ settings_id: version.id, starts_on: newStart })
						).then((created) => {
							chosenVersionId = String((created as { readonly id: string }).id);
						}),
						() => {
							newOpen = false;
							newStart = '';
						}
					);
				}}>{t('app.settings.new_version')}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
