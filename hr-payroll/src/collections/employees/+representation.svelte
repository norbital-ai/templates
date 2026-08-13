<script lang="ts">
	/**
	 * One person's whole file: who they are, the engagements they hold, the terms of each engagement
	 * and where each stands with the statutory schemes.
	 *
	 * These were four sibling tabs in the People app, which meant reading one person required knowing
	 * their employee number and then filtering three unrelated tables by it. They are all facts about
	 * one human being, so they are read from that human being's record.
	 */
	import { client } from '$pod/client';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$pod/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Column, Cover, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { renderSnippet } from '@norbital-ai/ui/utils';
	import {
		workPatternSchema,
		type WorkPattern
	} from '../../custom-types/work_pattern/+definition.js';
	import {
		formatEffectiveRange,
		formatStatutoryFactStatus
	} from '../../lib/ui/display-formatters.js';
	import { todayKey } from '../../lib/ui/calendar.js';

	type EmploymentTerm = {
		readonly employment_id: string;
		readonly effective_range: unknown;
		readonly work_pattern: unknown;
	};

	type EmploymentSchedule =
		| {
				readonly state: 'current' | 'next';
				readonly effectiveRange: unknown;
				readonly summary: string;
		  }
		| { readonly state: 'missing' };

	type Range = { readonly start: string; readonly end: string | null };

	function rangeOf(value: unknown): Range | null {
		if (value == null || typeof value !== 'object') return null;
		const start = Reflect.get(value, 'start');
		const end = Reflect.get(value, 'end');
		if (typeof start !== 'string' || start.length === 0) return null;
		return { start, end: typeof end === 'string' && end.length > 0 ? end : null };
	}

	function isEffectiveOn(range: Range, date: string): boolean {
		return (
			range.start.slice(0, 10) <= date && (range.end == null || range.end.slice(0, 10) >= date)
		);
	}

	function summarizePattern(pattern: WorkPattern): string {
		if (pattern.type === 'ROSTERED') {
			if (pattern.expectation.kind === 'AS_ASSIGNED') {
				return pattern.expectation.maximum_paid_minutes == null
					? 'Roster-assigned · as assigned'
					: `Roster-assigned · up to ${pattern.expectation.maximum_paid_minutes / 60}h/${pattern.expectation.period.toLowerCase()}`;
			}
			return `Roster-assigned · ${pattern.expectation.required_work_days}d · ${pattern.expectation.required_paid_minutes / 60}h/${pattern.expectation.period.toLowerCase()}`;
		}

		const continuous =
			pattern.phases.length === 1 && pattern.phases[0]?.duration.kind === 'CONTINUOUS';
		if (continuous) {
			const days = pattern.phases[0]?.day_cycle.length ?? 0;
			return `Patterned · ${days}-day cycle · starts ${pattern.anchor_date}`;
		}
		return `Patterned · ${pattern.phases.length} calendar phases · starts ${pattern.anchor_date}`;
	}

	function employmentScheduleOn(
		terms: readonly Pick<EmploymentTerm, 'effective_range' | 'work_pattern'>[],
		date: string
	): EmploymentSchedule {
		const candidates = terms.flatMap((term) => {
			const range = rangeOf(term.effective_range);
			const parsed = workPatternSchema.safeParse(term.work_pattern);
			return range == null || !parsed.success ? [] : [{ range, pattern: parsed.data }];
		});
		const current = candidates.find((candidate) => isEffectiveOn(candidate.range, date));
		if (current) {
			return {
				state: 'current',
				effectiveRange: current.range,
				summary: summarizePattern(current.pattern)
			};
		}
		const next = candidates
			.filter((candidate) => candidate.range.start.slice(0, 10) > date)
			.toSorted((left, right) => left.range.start.localeCompare(right.range.start))[0];
		if (next) {
			return {
				state: 'next',
				effectiveRange: next.range,
				summary: summarizePattern(next.pattern)
			};
		}
		return { state: 'missing' };
	}

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	let activeProfileTab = $state('person');
	const today = todayKey();

	const approved = { norbital_approval_id: { isNull: true } } as const;

	const employmentsQuery = $derived(
		record == null
			? null
			: client.db.employments.findMany({
					where: { ...approved, employee_id: { eq: record.norbital_id } },
					orderBy: { hire_date: 'desc' },
					limit: 100
				})
	);
	const employments = $derived(employmentsQuery?.current ?? []);
	const employmentLabelsById = $derived(
		new Map(employments.map((employment) => [employment.norbital_id, employment.employee_number]))
	);
	// Terms are read only while the Employments tab is open. One employee-scoped query feeds every
	// row, so opening a profile does not mount a table or lookup per employment.
	const employmentTermsQuery = $derived(
		record == null || activeProfileTab !== 'employments'
			? null
			: client.db.employment_terms.findMany({
					where: {
						norbital_approval_id: { isNull: true },
						term_employment: { employee_id: { eq: record.norbital_id } }
					},
					limit: 500
				})
	);
	const termsByEmployment = $derived.by(() => {
		const terms = new Map<string, EmploymentTerm[]>();
		for (const term of employmentTermsQuery?.current ?? []) {
			if (typeof term.employment_id !== 'string') continue;
			const bucket = terms.get(term.employment_id);
			if (bucket) bucket.push(term);
			else terms.set(term.employment_id, [term]);
		}
		return terms;
	});
	// One scoped query and a map per relation column, rather than a label lookup per row.
	const companiesQuery = client.db.companies.findMany({ where: approved, limit: 500 });
	const companyLabelsById = $derived(
		new Map((companiesQuery.current ?? []).map((company) => [company.norbital_id, company.name]))
	);
	const contributionsQuery = client.db.statutory_contributions.findMany({
		where: approved,
		limit: 500
	});
	const contributionLabelsById = $derived(
		new Map(
			(contributionsQuery.current ?? []).map((contribution) => [
				contribution.norbital_id,
				`${contribution.code} · ${contribution.name}`
			])
		)
	);
</script>

{#snippet person()}
	<CollectionForm
		{client}
		collection="employees"
		recordId={record?.norbital_id}
		defaultValues={record ?? undefined}
		submitLabel={record ? t('component.save_person') : t('component.add_person')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Grid gap="md" minimum="panel">
				<Field name="name" />
				<Field name="email" />
				<Field name="phone" />
				<Field name="date_of_birth" label={t('component.date_of_birth')} />
				<Field name="nationality" />
				<Field name="identity_number" label={t('component.identity_number')} />
				<Field name="gender" />
				<Field name="marital_status" label={t('component.marital_status')} />
				<Field name="spouse_status" label={t('component.spouse')} />
				<Field name="dependents_count" label={t('component.dependents')} />
				<Column span="all"><Field name="address" /></Column>
			</Grid>
		{/snippet}
	</CollectionForm>
{/snippet}

{#snippet engagements()}
	{#if record}
		<CollectionTable
			{client}
			collection="employments"
			view={`employees:employments:${record.norbital_id}`}
			title={t('component.employments')}
			description={t('component.employments_description')}
			query={{
				where: { employee_id: { eq: record.norbital_id } },
				orderBy: { hire_date: 'desc' }
			}}
		>
			{#snippet columns({ Column: TableColumn })}
				<TableColumn
					name="employee_number"
					card="title"
					minWidth={280}
					render={({ row }) => renderSnippet(employmentCell, { employment: row })}
				/>
				<TableColumn
					name="company_id"
					label={t('component.legal_entity')}
					card="subtitle"
					render={({ value }) =>
						value == null || value === '' ? '—' : (companyLabelsById.get(String(value)) ?? '—')}
				/>
				<TableColumn name="hire_date" label={t('component.hired')} />
				<TableColumn name="exit_date" label={t('component.exited')} />
				<TableColumn name="exit_reason" label={t('component.exit_reason')} />
				<TableColumn name="effective_range" label={t('component.effective')} />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#snippet employmentCell({
	employment
}: {
	employment: { norbital_id: string; employee_number: unknown };
})}
	{@const schedule = employmentScheduleOn(
		termsByEmployment.get(employment.norbital_id) ?? [],
		today
	)}
	<Stack gap="none" class="min-w-0 py-0.5">
		<span class="truncate font-medium"
			>{employment.employee_number == null ? '—' : String(employment.employee_number)}</span
		>
		{#if employmentTermsQuery?.loading}
			<span class="truncate text-tiny text-muted-foreground">{t('component.schedule_loading')}</span
			>
		{:else if schedule.state === 'missing'}
			<span class="truncate text-tiny text-muted-foreground"
				>{t('component.schedule_not_configured')}</span
			>
		{:else}
			<span class="truncate text-tiny text-muted-foreground">
				{schedule.state === 'current'
					? t('component.schedule_current', { summary: schedule.summary })
					: t('component.schedule_next', { summary: schedule.summary })}
			</span>
			<span class="truncate text-micro text-muted-foreground">
				{t('component.effective')} · {formatEffectiveRange(schedule.effectiveRange)}
			</span>
		{/if}
	</Stack>
{/snippet}

{#snippet statutoryFacts()}
	<CollectionTable
		{client}
		collection="employment_statutory_facts"
		view={`employees:statutory-facts:${record?.norbital_id ?? 'none'}`}
		title={t('component.statutory_registrations')}
		description={t('component.statutory_registrations_description')}
		query={{
			where:
				record == null
					? { norbital_id: { in: [] } }
					: { statutory_fact_employment: { employee_id: { eq: record.norbital_id } } },
			orderBy: { norbital_created_at: 'desc' }
		}}
	>
		{#snippet columns({ Column: TableColumn })}
			<TableColumn
				name="employment_id"
				label={t('component.employment')}
				card="title"
				render={({ value }) =>
					value == null || value === '' ? '—' : (employmentLabelsById.get(String(value)) ?? '—')}
			/>
			<TableColumn
				name="statutory_contribution_id"
				label={t('component.contribution')}
				card="subtitle"
				render={({ value }) =>
					value == null || value === '' ? '—' : (contributionLabelsById.get(String(value)) ?? '—')}
			/>
			<TableColumn
				name="status"
				label={t('component.registration')}
				render={({ value }) => formatStatutoryFactStatus(value, t)}
			/>
			<TableColumn name="effective_range" label={t('component.effective')} />
		{/snippet}
	</CollectionTable>
{/snippet}

{#if record}
	{#snippet personSummary()}
		<Stack gap="xs">
			<Inline gap="sm" align="baseline">
				<h2 class="truncate text-lg font-semibold">{record.name}</h2>
				<span class="text-sm text-muted-foreground">
					{employments.length}
					{t('component.employment_count', {
						count: employments.length,
						s: employments.length === 1 ? '' : 's'
					})}
				</span>
			</Inline>
			<p class="text-sm text-muted-foreground">
				{record.email ?? t('component.no_email_recorded')} · {record.nationality ??
					t('component.nationality_not_recorded')}
			</p>
		</Stack>
	{/snippet}

	<Cover as="main" gap="md" top={personSummary}>
		<!-- The detail sheet already insets this surface; the list must not inset itself again. -->
		<Tabs
			animate={false}
			listClass="mx-0 w-full"
			contentPadding={false}
			bind:value={activeProfileTab}
			config={[
				{ name: 'person', label: t('component.person'), icon: 'lucide:user', content: person },
				{
					name: 'employments',
					label: t('component.employments'),
					icon: 'lucide:briefcase',
					content: engagements
				},
				{
					name: 'statutory-facts',
					label: t('component.statutory_facts'),
					icon: 'lucide:id-card',
					content: statutoryFacts
				}
			] satisfies TabConfig[]}
		/>
	</Cover>
{:else}
	{@render person()}
{/if}
