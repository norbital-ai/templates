<script lang="ts">
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	/**
	 * One person's whole file: who they are, the engagements they hold, the terms of each engagement
	 * and where each stands with the statutory schemes.
	 *
	 * These were four sibling tabs in the People app, which meant reading one person required knowing
	 * their employee number and then filtering three unrelated tables by it. They are all facts about
	 * one human being, so they are read from that human being's record.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Result, Schema } from 'effect';
	import type { RepresentationProps, WorkspaceRow } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { getDataRendererRuntimeContext } from '@norbital-ai/ui/data-renderer';
	import { Column, Cover, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { workPatternSchema, type WorkPattern } from '../../datatypes/work_pattern/+definition.js';
	import { readRange, StoredRangeSchema, type StoredRange } from '../payroll_runs/lib/effective.js';
	import {
		formatEffectiveRange,
		formatStatutoryFactStatus
	} from '../../lib/ui/display-formatters.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import FaceCaptureDialog from './face-capture-dialog.svelte';

	type EmploymentTerm = Pick<
		WorkspaceRow<'employment_terms'>,
		'employment_id' | 'effective_range' | 'work_pattern'
	>;

	const employmentScheduleSchema = Schema.Union([
		Schema.Struct({
			state: Schema.Literals(['current', 'next']),
			effectiveRange: StoredRangeSchema,
			summary: Schema.String
		}),
		Schema.Struct({ state: Schema.Literal('missing') })
	]);
	type EmploymentSchedule = Schema.Schema.Type<typeof employmentScheduleSchema>;

	/** The work-pattern decoder, built once — it is stateless, and a fresh one per term does the same work. */
	const decodeWorkPattern = Schema.decodeUnknownResult(workPatternSchema);

	function isEffectiveOn(range: StoredRange, date: string): boolean {
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
			const range = readRange(term.effective_range);
			const parsed = decodeWorkPattern(term.work_pattern);
			return range == null || !Result.isSuccess(parsed) ? [] : [{ range, pattern: parsed.success }];
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
	const fileRuntime = getDataRendererRuntimeContext();
	let captureOpen = $state(false);
	let justSavedUrl = $state<string | null>(null);

	const approved = { approval_id: { isNull: true } } as const;

	const employmentsQuery = $derived(
		record == null
			? null
			: client.db.employments.findMany({
					where: { ...approved, employee_id: { eq: record.id } },
					orderBy: { hire_date: 'desc' },
					limit: 100
				})
	);
	const employments = $derived(employmentsQuery?.current ?? []);
	// Terms are read only while the Employments tab is open. One employee-scoped query feeds every
	// row, so opening a profile does not mount a table or lookup per employment.
	const employmentTermsQuery = $derived(
		record == null || activeProfileTab !== 'employments'
			? null
			: client.db.employment_terms.findMany({
					where: {
						approval_id: { isNull: true },
						term_employment: { employee_id: { eq: record.id } }
					},
					limit: 500
				})
	);
	function employmentSummary(employment: { id: string; employee_number: unknown }): string {
		const employeeNumber =
			employment.employee_number == null ? '—' : String(employment.employee_number);
		const schedule = employmentScheduleOn(termsByEmployment.get(employment.id) ?? [], today);
		if (employmentTermsQuery?.loading) {
			return `${employeeNumber} · ${t('component.schedule_loading')}`;
		}
		if (schedule.state === 'missing') {
			return `${employeeNumber} · ${t('component.schedule_not_configured')}`;
		}
		const scheduleLabel =
			schedule.state === 'current'
				? t('component.schedule_current', { summary: schedule.summary })
				: t('component.schedule_next', { summary: schedule.summary });
		return `${employeeNumber} · ${scheduleLabel} · ${t('component.effective')} ${formatEffectiveRange(schedule.effectiveRange)}`;
	}
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

	const storedPhotoKey = $derived.by(() => {
		if (record === null || typeof record.face_photo !== 'object' || record.face_photo === null)
			return null;
		const key = (record.face_photo as { readonly storage_key?: unknown }).storage_key;
		return typeof key === 'string' ? key : null;
	});
	const photoHref = $derived(
		justSavedUrl ??
			(storedPhotoKey === null ? null : (fileRuntime?.fileUrl(storedPhotoKey) ?? null))
	);
	const displayFaceStatus = $derived(
		justSavedUrl !== null && record?.face_enrollment_status === 'NONE'
			? 'APPROVED'
			: (record?.face_enrollment_status ?? 'NONE')
	);
</script>

{#snippet person()}
	<CollectionForm
		{client}
		collection="employees"
		defaultValues={record ?? undefined}
		submitLabel={record ? t('component.save_person') : t('component.add_person')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Field name="user_id" hidden />
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
			view="employees:employments"
			title={t('component.employments')}
			description={t('component.employments_description')}
			query={{
				where: { employee_id: { eq: record.id } },
				orderBy: { hire_date: 'desc' }
			}}
		>
			{#snippet columns({ Column: TableColumn })}
				<TableColumn
					name="employee_number"
					card="title"
					minWidth={280}
					renderer={FormattedValueRenderer}
					rendererProps={{
						format: ({ row }) => employmentSummary(row as { id: string; employee_number: unknown })
					}}
				/>
				<TableColumn name="company_id" label={t('component.legal_entity')} card="subtitle" />
				<TableColumn name="hire_date" label={t('component.hired')} />
				<TableColumn name="exit_date" label={t('component.exited')} />
				<TableColumn name="exit_reason" label={t('component.exit_reason')} />
				<TableColumn name="effective_range" label={t('component.effective')} />
			{/snippet}
		</CollectionTable>
	{/if}
{/snippet}

{#snippet statutoryFacts()}
	<CollectionTable
		{client}
		collection="employment_statutory_facts"
		view="employees:statutory-facts"
		title={t('component.statutory_registrations')}
		description={t('component.statutory_registrations_description')}
		query={{
			where:
				record == null
					? { id: { in: [] } }
					: { statutory_fact_employment: { employee_id: { eq: record.id } } },
			orderBy: { created_at: 'desc' }
		}}
	>
		{#snippet columns({ Column: TableColumn })}
			<TableColumn name="employment_id" label={t('component.employment')} card="title" />
			<TableColumn
				name="statutory_contribution_id"
				label={t('component.contribution')}
				card="subtitle"
			/>
			<TableColumn
				name="status"
				label={t('component.registration')}
				renderer={FormattedValueRenderer}
				rendererProps={{ format: ({ value }) => formatStatutoryFactStatus(value, t) }}
			/>
			<TableColumn name="effective_range" label={t('component.effective')} />
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet faceIdentity()}
	{#if record}
		<Stack gap="sm">
			{#if photoHref !== null}
				<img class="w-40 rounded-lg" src={photoHref} alt="Enrolled face" />
			{:else}
				<p class="text-sm text-muted-foreground">No photo yet.</p>
			{/if}
			<p class="text-sm">
				{displayFaceStatus.toLowerCase()}
				{#if record.face_match_count > 0}
					· {record.face_match_count} match{record.face_match_count === 1 ? '' : 'es'}
				{/if}
			</p>
			<div>
				<button
					onclick={() => {
						captureOpen = true;
					}}
				>
					{photoHref === null ? 'Capture photo' : 'Re-capture photo'}
				</button>
			</div>
		</Stack>
	{/if}
{/snippet}

{#if record}
	{#snippet personSummary()}
		<Stack gap="xs">
			<Inline gap="sm" align="baseline">
				<h2 class="truncate text-heading">{record.name}</h2>
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
				},
				{
					name: 'face',
					label: 'Face ID',
					icon: 'lucide:scan-face',
					content: faceIdentity
				}
			] satisfies TabConfig[]}
		/>
	</Cover>
	<FaceCaptureDialog
		bind:open={captureOpen}
		{record}
		onsaved={(previewUrl) => {
			justSavedUrl = previewUrl;
		}}
	/>
{:else}
	{@render person()}
{/if}
