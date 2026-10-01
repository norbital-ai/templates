<script lang="ts">
	import terms from '../../../data/model/employment_terms/+model.ts';
	import Labelled from '../Labelled.svelte';
	import { t } from '../t.js';
	import { everyField } from '../../every-field.js';
	/**
	 * Amend an active employment's terms: the form opens prefilled from the terms in force, with a
	 * new effective start. Submit closes the previous row the day before, through the transform's
	 * amendment rule, then creates the successor — never by editing a consumed row.
	 */
	import type { Id } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { untrack } from 'svelte';
	import { Button, Combobox, DateInput, Input } from '@norbital-ai/ui';
	import { Cluster, Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import ContractAllowancesEditor from '../contract-allowances-editor.svelte';
	import { toast } from 'svelte-sonner';
	import { todayKey } from '../calendar.js';
	import { live, liveRows } from '../live.svelte.js';
	import { nullableNumberFrom, numberFrom } from '../renderer-input.js';
	import { coversDate } from '../../../lib/payroll/run/effective.js';
	import FormSection from '../form-section.svelte';
	import {
		buildChangeTermsWrites,
		previousDay,
		type ChangeTermsFacts
	} from './change-terms-submit.js';
	import { getErrorMessage } from '../../refuse.js';
	import { vocabularyOptions } from '../contract/vocabulary-options.svelte.js';

	let {
		employment,
		onclose
	}: {
		employment: { readonly id: Id<'employments'>; readonly company_id: Id<'companies'> };
		onclose: () => void;
	} = $props();
	const today = todayKey();

	const termsQuery = liveRows(() =>
		bolt.read('employment_terms', {
			select: everyField('employment_terms'),
			where: { employment_id: { eq: employment.id }, approval_id: { isNull: true } },
			all: true
		})
	);
	const inForce = $derived(
		(termsQuery.current ?? []).find((row) => coversDate(row.effective_range, today)) ?? null
	);
	// The patterns belong to the employing entity, like its roster codes: the flow already knows
	// which entity it is changing terms for.
	const patternsQuery = liveRows(() =>
		bolt.read('shift_patterns', {
			where: { company_id: { eq: employment.company_id }, approval_id: { isNull: true } },
			select: { code: true, name: true },
			orderBy: { code: 'asc' },
			all: true
		})
	);
	const company = live(() => bolt.get('companies', employment.company_id, { settings_code: true }));

	/**
	 * The form, prefilled from the terms in force: seeded again only when another row comes into force (a live
	 * re-read of the same row keeps what the person typed), and edited as a whole value.
	 */
	const inForceId = $derived(inForce?.id);
	let draft = $derived.by(() => {
		void inForceId;
		return untrack(() => ({
			newStart: today as string | null,
			baseSalary: inForce == null ? '' : String(inForce.base_salary),
			allowances: inForce?.allowances ?? [],
			payFrequency: inForce?.pay_frequency ?? null,
			employmentType: inForce?.employment_type ?? null,
			residencyStatus: inForce?.residency_status ?? null,
			residencySince: (inForce?.residency_since ?? null) as string | null,
			workClassification: inForce?.work_classification ?? null,
			statutoryWorkCategory: inForce?.statutory_work_category ?? null,
			department: inForce?.department ?? '',
			jobTitle: inForce?.job_title ?? '',
			payrollGroup: inForce?.payroll_group ?? '',
			grade: inForce?.grade ?? '',
			ordinaryHoursPerWeek:
				inForce?.ordinary_hours_per_week == null ? '' : String(inForce.ordinary_hours_per_week),
			comparableFullTimePresence: inForce?.comparable_full_time_presence ?? null,
			comparableFullTimeDailyHours:
				inForce?.comparable_full_time_daily_hours == null
					? ''
					: String(inForce.comparable_full_time_daily_hours),
			comparableFullTimeWeeklyHours:
				inForce?.comparable_full_time_weekly_hours == null
					? ''
					: String(inForce.comparable_full_time_weekly_hours),
			shiftPatternId: inForce?.shift_pattern_id ?? null
		}));
	});
	const edit = (patch: Partial<typeof draft>) => (draft = { ...draft, ...patch });
	let formError = $state<string | null>(null);
	let submitting = $state(false);

	// The model's own enums: a value the model admits is a value the flow offers.
	const optionsOf = <V extends string>(values: readonly V[]) =>
		values.map((value) => ({ value, label: value }));
	const PAY_FREQUENCIES = optionsOf(terms.fields.pay_frequency.values);
	const EMPLOYMENT_TYPES = optionsOf(terms.fields.employment_type.values);
	const RESIDENCY_STATUSES = optionsOf(terms.fields.residency_status.values);
	// The classification codes are the version in force on the new start's.
	const codesOf = vocabularyOptions(
		() => company.current?.settings_code,
		() => draft.newStart
	);
	const COMPARABLE_FULL_TIME_PRESENCE = optionsOf(
		terms.fields.comparable_full_time_presence.values
	);
	const patternOptions = $derived(
		(patternsQuery.current ?? []).map((pattern) => ({
			value: pattern.id,
			label: [pattern.code, pattern.name].filter(Boolean).join(' · ') || pattern.id
		}))
	);

	type DraftedChange = ReturnType<typeof buildChangeTermsWrites>;

	/**
	 * Validate and build the close-plus-successor pair. The batch write itself stays onsite in
	 * the save button below: authored client writes belong at the interaction site.
	 */
	function draftWrites(): DraftedChange | null {
		formError = null;
		const row = inForce;
		if (row == null || draft.newStart == null) {
			formError = t('offboarding.no_terms_in_force');
			return null;
		}
		const salary = numberFrom(draft.baseSalary, Number.NaN);
		if (!Number.isFinite(salary) || salary < 0) {
			formError = t('offboarding.need_valid_salary');
			return null;
		}
		if (draft.shiftPatternId == null) {
			formError = t('offboarding.need_pattern');
			return null;
		}
		const ordinaryHours = nullableNumberFrom(draft.ordinaryHoursPerWeek);
		const comparableDailyHours = nullableNumberFrom(draft.comparableFullTimeDailyHours);
		const comparableWeeklyHours = nullableNumberFrom(draft.comparableFullTimeWeeklyHours);
		if (
			(draft.ordinaryHoursPerWeek.trim() !== '' &&
				(ordinaryHours == null || !Number.isInteger(ordinaryHours) || ordinaryHours < 1)) ||
			(draft.comparableFullTimeDailyHours.trim() !== '' &&
				(comparableDailyHours == null || comparableDailyHours <= 0 || comparableDailyHours > 24)) ||
			(draft.comparableFullTimeWeeklyHours.trim() !== '' &&
				(comparableWeeklyHours == null ||
					comparableWeeklyHours <= 0 ||
					comparableWeeklyHours > 168))
		) {
			formError = t('offboarding.need_valid_hours');
			return null;
		}
		const { payFrequency, workClassification, statutoryWorkCategory, employmentType } = draft;
		if (
			payFrequency == null ||
			workClassification == null ||
			statutoryWorkCategory == null ||
			employmentType == null
		) {
			formError = t('offboarding.no_terms_in_force');
			return null;
		}
		const text = (value: string) => (value.trim() === '' ? null : value.trim());
		const facts: ChangeTermsFacts = {
			residency_status: draft.residencyStatus,
			residency_since: draft.residencySince == null ? null : PlainDate(draft.residencySince),
			currency: row.currency,
			base_salary: salary,
			worksite: row.worksite,
			worksite_sector: row.worksite_sector,
			worksite_id: row.worksite_id,
			facts: row.facts,
			allowances: draft.allowances,
			pay_frequency: payFrequency,
			work_classification: workClassification,
			statutory_work_category: statutoryWorkCategory,
			weather_dependent_piece: row.weather_dependent_piece,
			employment_type: employmentType,
			department: text(draft.department),
			job_title: text(draft.jobTitle),
			payroll_group: text(draft.payrollGroup),
			grade: text(draft.grade),
			ordinary_hours_per_week: ordinaryHours,
			comparable_full_time_presence: draft.comparableFullTimePresence,
			comparable_full_time_daily_hours: comparableDailyHours,
			comparable_full_time_weekly_hours: comparableWeeklyHours,
			shift_pattern_id: draft.shiftPatternId,
			// Other dated terms remain on the successor until their own fields are changed.
			pass_type: row.pass_type,
			tax_residency: row.tax_residency,
			notice_days: row.notice_days,
			paid_rest_days: row.paid_rest_days,
			proration: row.proration
		};
		try {
			return buildChangeTermsWrites({
				previousId: row.id,
				employmentId: employment.id,
				previousStart: row.effective_range.from,
				closeEnd: previousDay(draft.newStart),
				newStart: draft.newStart,
				facts
			});
		} catch (error) {
			formError = getErrorMessage(error);
			return null;
		}
	}
</script>

{#snippet text(label: string, value: string, change: (value: string) => void)}
	<Labelled {label} class="text-sm font-medium">
		<Input {value} oninput={(event) => change(event.currentTarget.value)} />
	</Labelled>
{/snippet}

{#if termsQuery.loading}
	<p class="text-meta">{t('component.loading')}</p>
{:else if inForce == null}
	<Stack gap="sm">
		<p class="text-sm">{t('offboarding.no_terms_in_force')}</p>
		<Cluster
			><Button type="button" variant="secondary" onclick={onclose}>{t('offboarding.back')}</Button
			></Cluster
		>
	</Stack>
{:else}
	<Stack gap="lg">
		<FormSection
			name="terms_section_pay"
			first
			title={t('component.terms_section_pay')}
			hint={t('component.terms_section_pay_hint')}
		>
			<Grid gap="sm" minimum="compact">
				{@render text(t('component.base_salary'), draft.baseSalary, (baseSalary) =>
					edit({ baseSalary })
				)}
				<Labelled label={t('component.pay_frequency')} class="text-sm font-medium">
					<Combobox
						options={PAY_FREQUENCIES}
						value={draft.payFrequency}
						onChange={(payFrequency) => edit({ payFrequency })}
					/>
				</Labelled>
				<Column span="all">
					<Stack gap="xs">
						<span class="text-sm font-medium">{t('component.allowances')}</span>
						<ContractAllowancesEditor
							value={draft.allowances}
							settingsCode={company.current?.settings_code}
							firstDay={draft.newStart ?? undefined}
							onValueChange={(allowances) => edit({ allowances })}
						/>
					</Stack>
				</Column>
			</Grid>
		</FormSection>

		<FormSection
			name="shift_assignment"
			title={t('component.shift_assignment')}
			hint={t('component.shift_assignment_hint')}
		>
			<Grid gap="sm" minimum="compact">
				{@render text(
					t('component.ordinary_hours_per_week'),
					draft.ordinaryHoursPerWeek,
					(ordinaryHoursPerWeek) => edit({ ordinaryHoursPerWeek })
				)}
				<Labelled label={t('component.comparable_full_time_presence')} class="text-sm font-medium">
					<Combobox
						options={COMPARABLE_FULL_TIME_PRESENCE}
						value={draft.comparableFullTimePresence}
						clearable
						onChange={(comparableFullTimePresence) =>
							edit({
								comparableFullTimePresence,
								...(comparableFullTimePresence === 'ABSENT'
									? { comparableFullTimeDailyHours: '', comparableFullTimeWeeklyHours: '' }
									: {})
							})}
					/>
				</Labelled>
				{@render text(
					t('component.comparable_full_time_daily_hours'),
					draft.comparableFullTimeDailyHours,
					(comparableFullTimeDailyHours) => edit({ comparableFullTimeDailyHours })
				)}
				{@render text(
					t('component.comparable_full_time_weekly_hours'),
					draft.comparableFullTimeWeeklyHours,
					(comparableFullTimeWeeklyHours) => edit({ comparableFullTimeWeeklyHours })
				)}
				<Labelled label={t('component.shift_pattern')} class="text-sm font-medium">
					<Combobox
						options={patternOptions}
						value={draft.shiftPatternId}
						clearable
						onChange={(shiftPatternId) => edit({ shiftPatternId })}
					/>
				</Labelled>
			</Grid>
		</FormSection>

		<FormSection
			name="standing"
			title={t('component.standing')}
			hint={t('component.terms_section_standing_hint')}
		>
			<Grid gap="sm" minimum="compact">
				<Labelled label={t('component.employment_type')} class="text-sm font-medium">
					<Combobox
						options={EMPLOYMENT_TYPES}
						value={draft.employmentType}
						onChange={(employmentType) => edit({ employmentType })}
					/>
				</Labelled>
				<Labelled label={t('component.residency_status')} class="text-sm font-medium">
					<Combobox
						options={RESIDENCY_STATUSES}
						value={draft.residencyStatus}
						clearable
						onChange={(residencyStatus) => edit({ residencyStatus })}
					/>
				</Labelled>
				<Labelled label={t('component.residency_since')} class="text-sm font-medium">
					<DateInput
						value={draft.residencySince}
						onChange={(residencySince) => edit({ residencySince })}
					/>
				</Labelled>
				<Labelled label={t('component.classification')} class="text-sm font-medium">
					<Combobox
						options={codesOf('work_classification')}
						value={draft.workClassification}
						onChange={(workClassification) => edit({ workClassification })}
					/>
				</Labelled>
				<Labelled label={t('component.statutory_work_category')} class="text-sm font-medium">
					<Combobox
						options={codesOf('statutory_work_category')}
						value={draft.statutoryWorkCategory}
						onChange={(statutoryWorkCategory) => edit({ statutoryWorkCategory })}
					/>
				</Labelled>
				{@render text(t('component.grade'), draft.grade, (grade) => edit({ grade }))}
			</Grid>
		</FormSection>

		<FormSection
			name="terms_section_organisation"
			title={t('component.terms_section_organisation')}
			hint={t('component.terms_section_organisation_hint')}
		>
			<Grid gap="sm" minimum="compact">
				{@render text(t('component.job_title'), draft.jobTitle, (jobTitle) => edit({ jobTitle }))}
				{@render text(t('component.department'), draft.department, (department) =>
					edit({ department })
				)}
				{@render text(t('component.payroll_group'), draft.payrollGroup, (payrollGroup) =>
					edit({ payrollGroup })
				)}
			</Grid>
		</FormSection>

		<FormSection
			name="section_period"
			title={t('component.section_period')}
			hint={t('offboarding.new_start_hint')}
		>
			<Grid gap="sm" minimum="compact">
				<Labelled label={t('offboarding.new_start')} class="text-sm font-medium">
					<DateInput value={draft.newStart} onChange={(newStart) => edit({ newStart })} />
				</Labelled>
			</Grid>
		</FormSection>

		{#if formError}<p class="text-sm text-destructive" role="alert">{formError}</p>{/if}
		<Cluster>
			<Button type="button" variant="secondary" disabled={submitting} onclick={onclose}
				>{t('offboarding.back')}</Button
			>
			<Button
				type="button"
				disabled={submitting || draft.newStart == null}
				onclick={() => {
					const writes = draftWrites();
					if (writes == null) return;
					submitting = true;
					// Close the row in force first: its amendment rule refuses a close that would uncover consumed dates.
					void (async () => {
						const closed = await bolt.act('employment_terms.update', writes.close);
						const created =
							closed.kind === 'committed' || closed.kind === 'pendingApproval'
								? await bolt.act('employment_terms.create', writes.create)
								: closed;
						if (created.kind === 'committed' || created.kind === 'pendingApproval') {
							toast.success(
								created.kind === 'pendingApproval'
									? t('offboarding.terms_pending')
									: t('offboarding.terms_submitted')
							);
							onclose();
							return;
						}
						formError =
							'message' in created ? String(created.message) : t('offboarding.save_terms');
						submitting = false;
					})();
				}}>{t('offboarding.save_terms')}</Button
			>
		</Cluster>
	</Stack>
{/if}
