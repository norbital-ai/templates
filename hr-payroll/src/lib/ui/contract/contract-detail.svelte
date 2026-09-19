<script lang="ts">
	/**
	 * One employment contract, whole: the stint (entity, employee number, contract number, bank,
	 * dates, departure) and the terms in force on it (pay, shift assignment, standing,
	 * organisation, dates), with every earlier or later revision listed beneath.
	 *
	 * It opens read-only and shows every field in display mode; Edit turns the same two forms
	 * editable in place. There is no shorter read view: what the reader sees is exactly what the
	 * editor can change. Save leaves edit mode with the committed values still mounted; Cancel bumps
	 * an epoch and remounts both forms from the rows as stored. Consumed terms refuse a change of
	 * facts at the transform — a revision is the contract's own Change terms flow.
	 */
	import { client } from '../../workspace-client.js';
	import { useI18n, type UiKeys } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Button } from '@norbital-ai/ui/button';
	import Icon from '@iconify/svelte';
	import { coversDate, readRange } from '../../../collections/payroll_runs/lib/effective.js';
	import { todayKey } from '../calendar.js';
	import { formatTermsDates } from '../display-formatters.js';
	import FormSection from '../form-section.svelte';
	import TermsFields from './terms-fields.svelte';
	import EffectiveRangeRenderer from '../effective-range-renderer.svelte';

	let {
		record,
		editable = true,
		scopedCompanyId,
		contracts = true
	}: {
		record: WorkspaceRow<'employments'>;
		/** Whether Edit is offered; an employee reading their own contract gets display only. */
		editable?: boolean;
		/** The entity the page is scoped to: its picker is prefilled and hidden. */
		scopedCompanyId?: string | undefined;
		/** Whether the terms in force and the other revisions follow the stint; the employment record lists them on their own tab. */
		contracts?: boolean;
	} = $props();
	const { t } = useI18n<TenantI18nKeys | UiKeys>();
	const today = todayKey();

	let editing = $state(false);
	let formEpoch = $state(0);
	function cancelEdit(): void {
		editing = false;
		formEpoch += 1;
	}

	// A contract is sealed by the rows that reference it; the transform is the guard, this is the hint.
	const consumers = $derived(
		[
			client.db.employment_terms,
			client.db.claim_requests,
			client.db.adhoc_requests,
			client.db.loans,
			client.db.loan_repayments,
			client.db.leave_entries,
			client.db.work_days,
			client.db.payslips
		].map((collection) =>
			collection.findFirst({ where: { employment_id: { eq: record.id } }, columns: { id: true } })
		)
	);
	const sealed = $derived(consumers.some((query) => query.current != null));
	const sealLoading = $derived(consumers.some((query) => query.loading));

	const termsQuery = $derived(
		client.db.employment_terms.findMany({
			where: { employment_id: { eq: record.id }, approval_id: { isNull: true } },
			orderBy: { created_at: 'asc' },
			limit: 100
		})
	);
	/** Every revision, earliest start first. */
	const revisions = $derived(
		(termsQuery.current ?? []).toSorted((left, right) => {
			const from = readRange(left.effective_range)?.start ?? '';
			const to = readRange(right.effective_range)?.start ?? '';
			return from.localeCompare(to);
		})
	);
	/** The revision in force today, else the latest one — a leaver's last terms, a joiner's first. */
	const inForce = $derived(
		revisions.find((row) => coversDate(row.effective_range, today)) ?? revisions.at(-1)
	);
	const otherRevisions = $derived(revisions.filter((row) => row.id !== inForce?.id));
</script>

<Stack gap="md">
	{#if editable || sealed}
		<Inline gap="sm" justify="between" align="center">
			{#if sealed}
				<Inline gap="xs" align="center" class="text-meta">
					<Icon icon="lucide:lock-keyhole" class="size-4" />
					<span>{t('component.employment_sealed')}</span>
				</Inline>
			{:else}
				<span></span>
			{/if}
			{#if !editable}
				<span></span>
			{:else}
				{#if editing}
					<Button variant="outline" size="sm" onclick={cancelEdit}>{t('common.cancel')}</Button>
				{:else}
					<Button variant="outline" size="sm" onclick={() => (editing = true)}>
						<Icon icon="lucide:pencil" class="size-4" />
						{t('common.edit')}
					</Button>
				{/if}
			{/if}
		</Inline>
	{/if}
	{#key formEpoch}
		<CollectionForm
			{client}
			collection="employments"
			disabled={sealLoading}
			readonly={!editing}
			defaultValues={record}
			submitLabel={t('component.save_employment')}
			onAfterSubmit={() => {
				editing = false;
			}}
		>
			{#snippet children({ Field })}
				<FormSection first title={t('component.employment')} hint={t('component.contract_hint')}>
					<Grid gap="md" minimum="panel">
						<Field
							name="employee_id"
							label={t('component.person')}
							disabled={sealed}
							relationOptions={{
								label: (person) =>
									person.name != null && person.name !== '' ? String(person.name) : '—',
								orderBy: { name: 'asc' },
								limit: 10_000
							}}
						/>
						{#if scopedCompanyId != null}
							<Field name="company_id" hidden />
						{:else}
							<Field
								name="company_id"
								label={t('component.legal_entity')}
								disabled={sealed}
								relationOptions={{
									label: (company) =>
										company.name != null && company.name !== '' ? String(company.name) : '—',
									orderBy: { name: 'asc' },
									limit: 500
								}}
							/>
						{/if}
						<Field
							name="employee_number"
							label={t('component.employee_number')}
							disabled={sealed}
						/>
						<!-- The stint's rolling number is the transform's, shown and never written. -->
						<Stack gap="xs">
							<span class="text-sm font-medium">{t('component.contract_number')}</span>
							<span class="text-sm text-muted-foreground">{record.contract_number}</span>
						</Stack>
						<Column span="all">
							<Field name="bank" label={t('component.pay_destination')} disabled={sealed} />
						</Column>
						<Column span="all">
							<Field
								name="effective_range"
								renderer={EffectiveRangeRenderer}
								label={t('component.effective_period')}
								disabled={sealed}
							/>
						</Column>
						<!-- Why the stint ended; the separation catalogue bands read it. Blank while in service. -->
						<Column span="all"
							><Field name="exit_reason" label={t('component.exit_reason')} /></Column
						>
						<Column span="all"><Field name="comments" label={t('component.comments')} /></Column>
					</Grid>
				</FormSection>
			{/snippet}
		</CollectionForm>
		{#if !contracts}
			<!-- The employment record lists its contracts on their own tab. -->
		{:else if termsQuery.loading}
			<p class="text-meta">{t('component.loading')}</p>
		{:else if inForce == null}
			<!-- A contract with no terms yet: the same form, empty, creates its first revision. -->
			<CollectionForm
				{client}
				collection="employment_terms"
				readonly={!editing}
				defaultValues={{ employment_id: record.id }}
				submitLabel={t('component.create_terms')}
				onAfterSubmit={() => {
					editing = false;
				}}
			>
				{#snippet children({ Field })}
					<TermsFields {Field} employmentScoped {scopedCompanyId} />
				{/snippet}
			</CollectionForm>
		{:else}
			<CollectionForm
				{client}
				collection="employment_terms"
				readonly={!editing}
				defaultValues={inForce}
				submitLabel={t('component.save_terms')}
				onAfterSubmit={() => {
					editing = false;
				}}
			>
				{#snippet children({ Field })}
					<TermsFields {Field} employmentScoped {scopedCompanyId} />
				{/snippet}
			</CollectionForm>
		{/if}
		{#if otherRevisions.length > 0}
			<FormSection
				title={t('component.terms_revisions')}
				hint={t('component.terms_revisions_hint')}
			>
				<ul class="text-sm">
					{#each otherRevisions as revision (revision.id)}
						<li>
							<Inline align="baseline" gap="sm">
								<span class="text-meta tabular-nums">{formatTermsDates(revision, t)}</span>
								<span>{revision.summary}</span>
							</Inline>
						</li>
					{/each}
				</ul>
			</FormSection>
		{/if}
	{/key}
</Stack>
