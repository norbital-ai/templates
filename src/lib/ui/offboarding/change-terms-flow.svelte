<script lang="ts">
	/**
	 * Amend an active employment's terms: the form opens prefilled from the terms in force, with a
	 * new effective start. Submit closes the previous row the day before and creates the successor
	 * in one batch, through the hook's existing amendment rule — never by editing a consumed row.
	 */
	import { Effect } from 'effect';
	import { client } from '../../workspace-client.js';
	import { getErrorMessage } from '@norbital-ai/std/error';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { toast } from 'svelte-sonner';
	import { dateKey, PAYROLL_TIME_ZONE } from '../../iso-day.js';
	import { startOfDayInstant, todayKey } from '../calendar.js';
	import { numberFrom } from '../renderer-input.js';
	import { coversDate, readRange } from '../../../collections/payroll_runs/lib/effective.js';
	import FormSection from '../form-section.svelte';
	import {
		buildChangeTermsWrites,
		previousDay,
		type ChangeTermsFacts
	} from './change-terms-submit.js';

	let {
		employment,
		onclose
	}: {
		employment: { readonly id: string; readonly company_id: string };
		onclose: () => void;
	} = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const today = todayKey();

	const termsQuery = $derived(
		client.db.employment_terms.findMany({
			where: { employment_id: { eq: employment.id }, approval_id: { isNull: true } },
			columns: {
				id: true,
				residency_status: true,
				residency_since: true,
				base_salary: true,
				pay_frequency: true,
				work_classification: true,
				statutory_work_category: true,
				employment_type: true,
				department: true,
				job_title: true,
				payroll_group: true,
				grade: true,
				shift_pattern_id: true,
				effective_range: true
			},
			limit: 100
		})
	);
	type TermsRow = {
		readonly id: string;
		readonly residency_status: string | null;
		readonly residency_since: string | null;
		readonly base_salary: { readonly value: number; readonly currency: string };
		readonly pay_frequency: string;
		readonly work_classification: string;
		readonly statutory_work_category: string;
		readonly employment_type: string;
		readonly department: string | null;
		readonly job_title: string | null;
		readonly payroll_group: string | null;
		readonly grade: string | null;
		readonly shift_pattern_id: string | null;
		readonly effective_range: unknown;
	};
	const inForce = $derived.by((): TermsRow | null => {
		for (const row of (termsQuery?.current ?? []) as readonly TermsRow[])
			if (coversDate(row.effective_range, today)) return row;
		return null;
	});
	const patternsQuery = $derived(
		client.db.shift_patterns.findMany({
			where: { company_id: { eq: employment.company_id }, approval_id: { isNull: true } },
			columns: { id: true, code: true, name: true },
			orderBy: { code: 'asc' },
			limit: 500
		})
	);

	let draftFor = $state<string | null>(null);
	let newStart = $state(today);
	let baseSalaryValue = $state('');
	let baseSalaryCurrency = $state('');
	let payFrequency = $state('');
	let employmentType = $state('');
	let residencyStatus = $state('');
	let residencySince = $state('');
	let workClassification = $state('');
	let statutoryWorkCategory = $state('');
	let department = $state('');
	let jobTitle = $state('');
	let payrollGroup = $state('');
	let grade = $state('');
	let shiftPatternId = $state('');
	let formError = $state<string | null>(null);
	let submitting = $state(false);
	$effect(() => {
		const row = inForce;
		if (row == null || draftFor === row.id) return;
		draftFor = row.id;
		newStart = today;
		baseSalaryValue = String(row.base_salary.value);
		baseSalaryCurrency = row.base_salary.currency;
		payFrequency = row.pay_frequency;
		employmentType = row.employment_type;
		residencyStatus = row.residency_status ?? '';
		residencySince = row.residency_since == null ? '' : dateKey(row.residency_since);
		workClassification = row.work_classification;
		statutoryWorkCategory = row.statutory_work_category;
		department = row.department ?? '';
		jobTitle = row.job_title ?? '';
		payrollGroup = row.payroll_group ?? '';
		grade = row.grade ?? '';
		shiftPatternId = row.shift_pattern_id ?? '';
		formError = null;
	});

	const PAY_FREQUENCIES = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'].map((value) => ({
		value,
		label: value
	}));
	const EMPLOYMENT_TYPES = ['PERMANENT', 'CONTRACT', 'PROBATION', 'INTERN', 'CONSULTANT'].map(
		(value) => ({ value, label: value })
	);
	const RESIDENCY_STATUSES = ['CITIZEN', 'PERMANENT_RESIDENT', 'FOREIGNER'].map((value) => ({
		value,
		label: value
	}));
	const WORK_CLASSIFICATIONS = ['EA_COVERED', 'NON_EA', 'MANAGERIAL'].map((value) => ({
		value,
		label: value
	}));
	const STATUTORY_WORK_CATEGORIES = [
		'NON_MANUAL',
		'MANUAL_LABOUR',
		'MANUAL_LABOUR_SUPERVISOR',
		'COMMERCIAL_VEHICLE_OPERATOR',
		'VESSEL_WORK'
	].map((value) => ({ value, label: value }));
	const patternOptions = $derived(
		(patternsQuery?.current ?? []).map((pattern) => ({
			value: String(pattern.id),
			label: [pattern.code, pattern.name].filter(Boolean).join(' · ') || String(pattern.id)
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
		if (row == null) {
			formError = t('offboarding.no_terms_in_force');
			return null;
		}
		const range = readRange(row.effective_range);
		if (range == null) {
			formError = t('offboarding.no_terms_in_force');
			return null;
		}
		const salary = numberFrom(baseSalaryValue, Number.NaN);
		if (!Number.isFinite(salary) || salary < 0) {
			formError = t('offboarding.need_valid_salary');
			return null;
		}
		const facts: ChangeTermsFacts = {
			residency_status: residencyStatus === '' ? null : residencyStatus,
			residency_since:
				residencySince === '' ? null : startOfDayInstant(residencySince, PAYROLL_TIME_ZONE),
			base_salary: { value: salary, currency: baseSalaryCurrency.toUpperCase() },
			pay_frequency: payFrequency,
			work_classification: workClassification,
			statutory_work_category: statutoryWorkCategory,
			employment_type: employmentType,
			department: department.trim() === '' ? null : department.trim(),
			job_title: jobTitle.trim() === '' ? null : jobTitle.trim(),
			payroll_group: payrollGroup.trim() === '' ? null : payrollGroup.trim(),
			grade: grade.trim() === '' ? null : grade.trim(),
			shift_pattern_id: shiftPatternId === '' ? null : shiftPatternId
		};
		try {
			return buildChangeTermsWrites({
				previousId: row.id,
				employmentId: employment.id,
				previousStart: range.start,
				closeEnd: startOfDayInstant(previousDay(newStart), PAYROLL_TIME_ZONE),
				newStart: startOfDayInstant(newStart, PAYROLL_TIME_ZONE),
				newId: crypto.randomUUID(),
				facts
			});
		} catch (error) {
			formError = getErrorMessage(error);
			return null;
		}
	}
</script>

{#snippet select(
	label: string,
	value: string,
	change: (value: string) => void,
	options: readonly { value: string; label: string }[],
	allowEmpty: boolean
)}
	<label class="text-sm font-medium"
		><Stack gap="xs"
			>{label}<select
				class="border-input bg-background flex h-8 rounded-md border px-3 text-sm"
				{value}
				onchange={(event) => change(event.currentTarget.value)}
			>
				{#if allowEmpty}<option value=""></option>{/if}
				{#each options as option}<option value={option.value}>{option.label}</option>{/each}
			</select></Stack
		></label
	>
{/snippet}

{#snippet text(label: string, value: string, change: (value: string) => void)}
	<label class="text-sm font-medium"
		><Stack gap="xs"
			>{label}<Input {value} oninput={(event) => change(event.currentTarget.value)} /></Stack
		></label
	>
{/snippet}

{#if termsQuery?.loading}
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
			first
			title={t('component.terms_section_pay')}
			hint={t('component.terms_section_pay_hint')}
		>
			<Grid gap="sm" minimum="compact">
				{@render text(
					t('component.base_salary'),
					baseSalaryValue,
					(value) => (baseSalaryValue = value)
				)}
				{@render select(
					t('component.pay_frequency'),
					payFrequency,
					(value) => (payFrequency = value),
					PAY_FREQUENCIES,
					false
				)}
				{@render select(
					t('component.shift_pattern'),
					shiftPatternId,
					(value) => (shiftPatternId = value),
					patternOptions,
					true
				)}
			</Grid>
		</FormSection>

		<FormSection title={t('component.standing')} hint={t('component.terms_section_standing_hint')}>
			<Grid gap="sm" minimum="compact">
				{@render select(
					t('component.employment_type'),
					employmentType,
					(value) => (employmentType = value),
					EMPLOYMENT_TYPES,
					false
				)}
				{@render select(
					t('component.residency_status'),
					residencyStatus,
					(value) => (residencyStatus = value),
					RESIDENCY_STATUSES,
					true
				)}
				<label class="text-sm font-medium"
					><Stack gap="xs"
						>{t('component.residency_since')}<Input
							type="date"
							value={residencySince}
							oninput={(event) => {
								residencySince = event.currentTarget.value;
							}}
						/></Stack
					></label
				>
				{@render select(
					t('component.classification'),
					workClassification,
					(value) => (workClassification = value),
					WORK_CLASSIFICATIONS,
					false
				)}
				{@render select(
					t('component.statutory_work_category'),
					statutoryWorkCategory,
					(value) => (statutoryWorkCategory = value),
					STATUTORY_WORK_CATEGORIES,
					false
				)}
				{@render text(t('component.grade'), grade, (value) => (grade = value))}
			</Grid>
		</FormSection>

		<FormSection
			title={t('component.terms_section_organisation')}
			hint={t('component.terms_section_organisation_hint')}
		>
			<Grid gap="sm" minimum="compact">
				{@render text(t('component.job_title'), jobTitle, (value) => (jobTitle = value))}
				{@render text(t('component.department'), department, (value) => (department = value))}
				{@render text(
					t('component.payroll_group'),
					payrollGroup,
					(value) => (payrollGroup = value)
				)}
			</Grid>
		</FormSection>

		<FormSection title={t('component.section_period')} hint={t('offboarding.new_start_hint')}>
			<Grid gap="sm" minimum="compact">
				<label class="text-sm font-medium"
					><Stack gap="xs"
						>{t('offboarding.new_start')}<Input
							type="date"
							value={newStart}
							oninput={(event) => {
								newStart = event.currentTarget.value;
							}}
						/></Stack
					></label
				>
			</Grid>
		</FormSection>

		{#if formError}<p class="text-sm text-destructive" role="alert">{formError}</p>{/if}
		<Cluster>
			<Button type="button" variant="secondary" disabled={submitting} onclick={onclose}
				>{t('offboarding.back')}</Button
			>
			<Button
				type="button"
				disabled={submitting || newStart === ''}
				onclick={() => {
					const writes = draftWrites();
					if (writes == null) return;
					submitting = true;
					Effect.runFork(
						submitCollectionMutation(() =>
							client.db.employment_terms.mutate([writes.close, writes.create])
						).pipe(
							Effect.tap((result) =>
								Effect.sync(() => {
									toast.success(
										result.kind === 'pendingApproval'
											? t('offboarding.terms_pending')
											: t('offboarding.terms_submitted')
									);
									onclose();
								})
							),
							Effect.catch((cause) =>
								Effect.sync(() => {
									formError = getErrorMessage(cause);
									submitting = false;
								})
							)
						)
					);
				}}>{t('offboarding.save_terms')}</Button
			>
		</Cluster>
	</Stack>
{/if}
