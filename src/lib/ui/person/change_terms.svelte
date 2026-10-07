<script lang="ts">
	/**
	 * L-TPL-hr-payroll-033: one `employment_contract.update` that closes the terms in force the day before
	 * the successor starts (L-TPL-hr-payroll-036 overlap refusal lives in the collection transform).
	 */
	import { bolt } from '$bolt';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { toast } from 'svelte-sonner';
	import { Button, Combobox, DateInput, Input, Label, Sheet } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import * as Predicate from 'effect/Predicate';
	import {
		changeTermsSet,
		parseAmount,
		termInForceOn,
		type ContractTerm
	} from '../../payroll_engine/contract_terms.js';
	import ContractAllowances from './contract_allowances.svelte';
	import { t } from '../i18n/t.js';
	import { todayKey } from '../format/calendar.js';
	import { liveRows } from '../state/live.svelte.js';

	let {
		id,
		companyId,
		terms,
		ended
	}: {
		id: Id<'employment_contract'>;
		companyId: Id<'entity'>;
		terms: readonly ContractTerm[];
		ended: boolean;
	} = $props();

	const EMPLOYMENT_TYPES = [
		'PERMANENT',
		'CONTRACT',
		'PROBATION',
		'INTERN',
		'CONSULTANT',
		'PART_TIME',
		'APPRENTICE',
		'DOMESTIC'
	] as const;
	const RESIDENCY = ['CITIZEN', 'PERMANENT_RESIDENT', 'FOREIGNER'] as const;
	const CLASSIFICATION = ['EA_COVERED', 'NON_EA', 'MANAGERIAL'] as const;
	const PAY_FREQUENCY = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'] as const;

	const current = $derived(termInForceOn(terms, todayKey()));
	let saving = $state(false);
	let sheetOpen = $state(false);
	let start = $state<string | null>(null);
	let salary = $state('');
	let employmentType = $state('PERMANENT');
	let residency = $state('CITIZEN');
	let classification = $state('EA_COVERED');
	let payFrequency = $state('MONTHLY');
	let grade = $state('');
	let jobTitle = $state('');
	let department = $state('');
	let payrollGroup = $state('');
	let patternId = $state<string | null>(null);
	let allowances = $state<{ code: string; amount: string }[]>([]);

	const patterns = liveRows(() =>
		sheetOpen
			? bolt.read('shift_pattern', {
					where: { company_id: { eq: companyId } },
					select: { id: true, code: true, name: true },
					all: true
				})
			: null
	);

	function labelled(values: readonly string[]): { value: string; label: string }[] {
		return values.map((value) => ({ value, label: value }));
	}

	function open(): void {
		const from = current;
		if (from == null) {
			toast.error(t('offboarding.no_terms_in_force'));
			return;
		}
		start = todayKey();
		salary = String(from.base_salary.value);
		employmentType = from.employment_type ?? 'PERMANENT';
		residency = from.residency_status ?? 'CITIZEN';
		classification = from.work_classification ?? 'EA_COVERED';
		payFrequency = from.pay_frequency ?? 'MONTHLY';
		grade = from.grade ?? '';
		jobTitle = from.job_title ?? '';
		department = from.department ?? '';
		payrollGroup = from.payroll_group ?? '';
		patternId = from.shift_pattern_id ?? null;
		allowances = from.allowances.map((line) => ({
			code: line.code,
			amount: String(line.amount.value)
		}));
		sheetOpen = true;
	}

	async function submit(): Promise<void> {
		if (saving || start == null || start === '') return;
		const salaryAmount = parseAmount(salary);
		if (salaryAmount == null) {
			toast.error(t('offboarding.need_valid_salary'));
			return;
		}
		const allowanceLines: { code: string; amount: number }[] = [];
		for (const line of allowances) {
			if (line.code.trim() === '' && line.amount.trim() === '') continue;
			const amount = parseAmount(line.amount);
			if (amount == null) {
				toast.error(t('offboarding.need_valid_salary'));
				return;
			}
			allowanceLines.push({ code: line.code, amount });
		}
		const set = changeTermsSet(terms, {
			start,
			salary: salaryAmount,
			currency: current?.base_salary.currency ?? '',
			employment_type: employmentType,
			residency_status: residency,
			work_classification: classification,
			pay_frequency: payFrequency,
			grade,
			job_title: jobTitle,
			department,
			payroll_group: payrollGroup,
			...(patternId == null || patternId === '' ? {} : { shift_pattern_id: patternId }),
			allowances: allowanceLines
		});
		if (Predicate.isString(set)) {
			toast.error(set);
			return;
		}
		saving = true;
		try {
			const payload: ActInput<'employment_contract.update'> = { target: id, set };
			const outcome = await bolt.act('employment_contract.update', payload);
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
				toast.success(
					outcome.kind === 'pendingApproval'
						? t('offboarding.terms_pending')
						: t('offboarding.terms_submitted')
				);
				sheetOpen = false;
			} else {
				toast.error(
					outcome.kind === 'refused'
						? (outcome.message ?? t('component.error'))
						: t('component.error')
				);
			}
		} catch {
			toast.error(t('component.error'));
		} finally {
			saving = false;
		}
	}
</script>

{#if !ended && current}
	<Button size="sm" variant="outline" disabled={saving} onclick={open}
		>{t('offboarding.change_terms')}</Button
	>

	<Sheet bind:open={sheetOpen} title={t('offboarding.change_terms_title')}>
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">{t('offboarding.change_terms_description')}</p>
			<p class="text-xs text-muted-foreground">{t('offboarding.new_start_hint')}</p>
			<Stack gap="xs">
				<Label for="terms-start">{t('offboarding.new_start')}</Label>
				<DateInput
					id="terms-start"
					of="date"
					value={start}
					onChange={(next) => (start = next)}
					disabled={saving}
				/>
			</Stack>
			<Stack gap="xs">
				<Label for="terms-salary">{t('component.base_salary')}</Label>
				<Input
					id="terms-salary"
					type="number"
					value={salary}
					disabled={saving}
					onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
						(salary = event.currentTarget.value)}
				/>
			</Stack>
			<Stack gap="xs">
				<Label for="terms-pay">{t('component.pay_frequency')}</Label>
				<Combobox
					id="terms-pay"
					class="w-full"
					options={labelled(PAY_FREQUENCY)}
					value={payFrequency}
					disabled={saving}
					onChange={(next) => next != null && (payFrequency = next)}
				/>
			</Stack>
			<Stack gap="xs">
				<Label for="terms-type">{t('component.employment_type')}</Label>
				<Combobox
					id="terms-type"
					class="w-full"
					options={labelled(EMPLOYMENT_TYPES)}
					value={employmentType}
					disabled={saving}
					onChange={(next) => next != null && (employmentType = next)}
				/>
			</Stack>
			<Stack gap="xs">
				<Label for="terms-residency">{t('component.residency_status')}</Label>
				<Combobox
					id="terms-residency"
					class="w-full"
					options={labelled(RESIDENCY)}
					value={residency}
					disabled={saving}
					onChange={(next) => next != null && (residency = next)}
				/>
			</Stack>
			<Stack gap="xs">
				<Label for="terms-class">{t('component.classification')}</Label>
				<Combobox
					id="terms-class"
					class="w-full"
					options={labelled(CLASSIFICATION)}
					value={classification}
					disabled={saving}
					onChange={(next) => next != null && (classification = next)}
				/>
			</Stack>
			<Stack gap="xs">
				<Label for="terms-title">{t('component.job_title')}</Label>
				<Input
					id="terms-title"
					value={jobTitle}
					disabled={saving}
					onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
						(jobTitle = event.currentTarget.value)}
				/>
			</Stack>
			<Stack gap="xs">
				<Label for="terms-dept">{t('component.department')}</Label>
				<Input
					id="terms-dept"
					value={department}
					disabled={saving}
					onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
						(department = event.currentTarget.value)}
				/>
			</Stack>
			<Stack gap="xs">
				<Label for="terms-grade">{t('component.grade')}</Label>
				<Input
					id="terms-grade"
					value={grade}
					disabled={saving}
					onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
						(grade = event.currentTarget.value)}
				/>
			</Stack>
			<Stack gap="xs">
				<Label for="terms-group">{t('component.payroll_group')}</Label>
				<Input
					id="terms-group"
					value={payrollGroup}
					disabled={saving}
					onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
						(payrollGroup = event.currentTarget.value)}
				/>
			</Stack>
			{#if (patterns.current ?? []).length > 0}
				<Stack gap="xs">
					<Label for="terms-pattern">{t('component.shift_pattern')}</Label>
					<Combobox
						id="terms-pattern"
						class="w-full"
						options={(patterns.current ?? []).map((row) => ({
							value: row.id,
							label: row.name ?? row.code ?? row.id
						}))}
						value={patternId}
						disabled={saving}
						onChange={(next) => (patternId = next)}
					/>
				</Stack>
			{/if}
			<ContractAllowances bind:lines={allowances} disabled={saving} />
			<Cluster gap="sm" justify="end">
				<Button variant="outline" disabled={saving} onclick={() => (sheetOpen = false)}>
					{t('component.cancel')}
				</Button>
				<Button
					disabled={saving || start == null || start === '' || salary === ''}
					onclick={() => void submit()}
				>
					{t('offboarding.save_terms')}
				</Button>
			</Cluster>
		</Stack>
	</Sheet>
{/if}
