<script lang="ts">
	import { t } from '../t.js';
	import { everyField } from '../../every-field.js';
	/**
	 * One employment contract, whole: the stint (entity, employee number, contract number, bank, dates, departure) and
	 * the terms in force on it (pay, shift assignment, standing, organisation, dates), with every earlier or later
	 * revision listed beneath. Consumed terms refuse a change of facts at the transform — a revision is the contract's
	 * own Change terms flow — and a sealed contract takes only its departure.
	 */
	import { bolt } from '$bolt';
	import { fromStore } from 'svelte/store';
	import Icon from '@iconify/svelte';
	import type { Id, Row } from '@norbital-ai/bolt';
	import { Field, Form, Picker } from '@norbital-ai/ui';
	import { Column, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { coversDate } from '../../../lib/payroll/run/effective.js';
	import { todayKey } from '../calendar.js';
	import { formatTermsDates } from '../display-formatters.js';
	import FormSection from '../form-section.svelte';
	import ExitFactsRenderer from '../offboarding/exit-facts-renderer.svelte';
	import { contractSeal } from './contract-seal.svelte.js';
	import TermsFields from './terms-fields.svelte';
	import * as Predicate from 'effect/Predicate';

	let {
		record,
		scopedCompanyId,
		contracts = true,
		sealNotice = true
	}: {
		record: Row<'employments'>;
		/** The entity the page is scoped to: its picker is not offered. */
		scopedCompanyId?: Id<'companies'> | undefined;
		/** Whether the terms in force and the other revisions follow the stint. */
		contracts?: boolean;
		/** Whether the seal is stated here; the employment record states it in its header instead. */
		sealNotice?: boolean;
	} = $props();
	const today = todayKey();
	const seal = contractSeal(() => record.id);
	const lastDay = $derived(record.effective_range.to);
	// Read as Bolt hands it (decimals stay `Decimal`): the in-force revision is the terms form's `record`.
	const terms = $derived(
		fromStore(
			bolt.live(
				bolt.read('employment_terms', {
					select: everyField('employment_terms'),
					where: { employment_id: { eq: record.id }, approval_id: { isNull: true } },
					all: true
				})
			)
		)
	);
	/** Every revision, earliest start first. */
	const revisions = $derived(
		(terms.current?.rows ?? []).toSorted((left, right) =>
			left.effective_range.from.localeCompare(right.effective_range.from)
		)
	);
	/** The revision in force today, else the latest one — a leaver's last terms, a joiner's first. */
	const inForce = $derived(
		revisions.find((row) => coversDate(row.effective_range, today)) ?? revisions.at(-1)
	);
	const otherRevisions = $derived(revisions.filter((row) => row.id !== inForce?.id));
	const text = (value: unknown) => (Predicate.isString(value) ? value : null);
</script>

<Stack gap="md">
	{#if seal.sealed && sealNotice}
		<Inline gap="xs" align="center" class="text-meta">
			<Icon icon="lucide:lock-keyhole" class="size-4" />
			<span>{t('component.employment_sealed')}</span>
		</Inline>
	{/if}
	<Form
		of="employments"
		mode="update"
		id={record.id}
		{record}
		submit={t('component.save_employment')}
	>
		<FormSection first title={t('component.employment')} hint={t('component.contract_hint')}>
			<Grid gap="md" minimum="panel">
				<Field name="employee_id" label={t('component.person')} readonly={seal.sealed}>
					{#snippet editor(field)}
						<Picker
							of="employees"
							label={['name']}
							orderBy={{ name: 'asc' }}
							value={text(field.value)}
							onChange={field.onChange}
							disabled={field.disabled}
						/>
					{/snippet}
				</Field>
				{#if scopedCompanyId == null}
					<Field name="company_id" label={t('component.legal_entity')} readonly={seal.sealed}>
						{#snippet editor(field)}
							<Picker
								of="companies"
								label={['name']}
								orderBy={{ name: 'asc' }}
								value={text(field.value)}
								onChange={field.onChange}
								disabled={field.disabled}
							/>
						{/snippet}
					</Field>
				{/if}
				<Field name="employee_number" label={t('component.employee_number')} />
				<!-- The stint's rolling number is the platform's sequence, shown and never written. -->
				<Field name="contract_number" label={t('component.contract_number')} readonly />
				<Column span="all"><Field name="bank" label={t('component.pay_destination')} /></Column>
				<Column span="all"
					><Field name="effective_range" label={t('component.effective_period')} /></Column
				>
				<Field name="prior_service_months" label={t('component.prior_service_months')} />
				<!-- Why the stint ended; the separation catalogue bands read it. Blank while in service. -->
				<Column span="all"><Field name="exit_reason" label={t('component.exit_reason')} /></Column>
				<Column span="all"><Field name="comments" label={t('component.comments')} /></Column>
				{#if lastDay != null}
					<Column span="all">
						<Field
							name="exit_facts"
							label={t('component.exit_facts')}
							help={t('component.exit_facts_hint')}
						>
							{#snippet editor(field)}
								<ExitFactsRenderer
									view={{
										mode: 'edit',
										name: field.name,
										value: field.value as never,
										disabled: field.disabled,
										onChange: field.onChange as never
									}}
									companyId={record.company_id}
									{lastDay}
								/>
							{/snippet}
						</Field>
					</Column>
				{/if}
			</Grid>
		</FormSection>
	</Form>
	{#if !contracts}
		<!-- The employment record lists its contracts on their own tab. -->
	{:else if terms.current === undefined}
		<p class="text-meta">{t('component.loading')}</p>
	{:else if inForce == null}
		<!-- A contract with no terms yet: the same form, empty, creates its first revision. -->
		<Form
			of="employment_terms"
			mode="create"
			values={{ employment_id: record.id }}
			submit={t('component.create_terms')}
		>
			<TermsFields employmentScoped {scopedCompanyId} />
		</Form>
	{:else}
		<Form
			of="employment_terms"
			mode="update"
			id={inForce.id}
			record={inForce}
			submit={t('component.save_terms')}
		>
			<TermsFields employmentScoped {scopedCompanyId} />
		</Form>
	{/if}
	{#if contracts && otherRevisions.length > 0}
		<FormSection title={t('component.terms_revisions')} hint={t('component.terms_revisions_hint')}>
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
</Stack>
