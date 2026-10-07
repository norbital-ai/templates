<script lang="ts">
	/** L-TPL-hr-payroll-032: create a contract with its first open terms on `facts.contract_terms`. */
	import { bolt } from '$bolt';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { toast } from 'svelte-sonner';
	import { Button, Combobox, DateInput, Input, Label, openRecord, Sheet } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import * as Predicate from 'effect/Predicate';
	import { hireContractSet, parseAmount } from '../../payroll_engine/contract_terms.js';
	import ContractAllowances from './contract_allowances.svelte';
	import { t } from '../i18n/t.js';
	import { todayKey } from '../format/calendar.js';
	import { liveRows } from '../state/live.svelte.js';

	let {
		employeeId,
		name
	}: {
		employeeId: Id<'employment_profile'>;
		name: string;
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

	let saving = $state(false);
	let sheetOpen = $state(false);
	let employeeNumber = $state('');
	let companyId = $state<Id<'entity'> | null>(null);
	let start = $state<string | null>(null);
	let salary = $state('');
	let employmentType = $state('PERMANENT');
	let residency = $state('CITIZEN');
	let classification = $state('EA_COVERED');
	let patternId = $state<string | null>(null);
	let allowances = $state<{ code: string; amount: string }[]>([]);

	const entities = liveRows(() =>
		sheetOpen
			? bolt.read('entity', { select: { id: true, name: true, settings_code: true }, all: true })
			: null
	);
	const settingsCode = $derived(
		(entities.current ?? []).find((row) => row.id === companyId)?.settings_code ?? null
	);
	const versions = liveRows(() =>
		sheetOpen && settingsCode != null
			? bolt.read('jurisdiction_settings', {
					where: {
						code: { eq: settingsCode },
						sealed_at: { isNull: false },
						voided_at: { isNull: true }
					},
					select: { effective_range: true, payroll: true },
					all: true
				})
			: null
	);
	/** The salary currency is the payroll currency of the version governing the start day. */
	const currency = $derived(
		(versions.current ?? []).find(
			(row) =>
				start != null &&
				row.effective_range != null &&
				row.effective_range.from <= start &&
				(row.effective_range.to == null || start <= row.effective_range.to)
		)?.payroll?.currency ?? ''
	);
	const patterns = liveRows(() =>
		sheetOpen && companyId != null
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
		employeeNumber = '';
		companyId = null;
		start = todayKey();
		salary = '';
		employmentType = 'PERMANENT';
		residency = 'CITIZEN';
		classification = 'EA_COVERED';
		patternId = null;
		allowances = [];
		sheetOpen = true;
	}

	async function submit(): Promise<void> {
		if (saving || companyId == null || start == null || start === '') return;
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
		const set = hireContractSet({
			employee_id: employeeId,
			company_id: companyId,
			employee_number: employeeNumber,
			draft: {
				start,
				salary: salaryAmount,
				currency,
				employment_type: employmentType,
				residency_status: residency,
				work_classification: classification,
				statutory_work_category: 'NON_MANUAL',
				...(patternId == null || patternId === '' ? {} : { shift_pattern_id: patternId }),
				allowances: allowanceLines
			}
		});
		if (Predicate.isString(set)) {
			toast.error(set);
			return;
		}
		saving = true;
		try {
			const payload: ActInput<'employment_contract.create'> = {
				employee_id: employeeId,
				company_id: companyId,
				employee_number: set.employee_number,
				effective_range: set.effective_range,
				facts: set.facts
			};
			const outcome = await bolt.act('employment_contract.create', payload);
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
				toast.success(
					outcome.kind === 'pendingApproval' ? t('offboarding.pending') : t('component.hire')
				);
				const created = outcome.records.find((row) => row.collection === 'employment_contract');
				if (created) openRecord('employment_contract', created.id);
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

<Button size="sm" variant="outline" disabled={saving} onclick={open}>{t('component.hire')}</Button>

<Sheet bind:open={sheetOpen} title={t('component.hire_title', { name })}>
	<Stack gap="md">
		<p class="text-sm text-muted-foreground">{t('component.hire_description')}</p>
		<Stack gap="xs">
			<Label for="hire-number">{t('component.employee_number')}</Label>
			<Input
				id="hire-number"
				value={employeeNumber}
				disabled={saving}
				onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
					(employeeNumber = event.currentTarget.value)}
			/>
		</Stack>
		<Stack gap="xs">
			<Label for="hire-company">{t('component.legal_entity')}</Label>
			<Combobox
				id="hire-company"
				class="w-full"
				options={(entities.current ?? []).map((row) => ({
					value: row.id,
					label: row.name ?? row.id
				}))}
				value={companyId}
				disabled={saving}
				onChange={(next) => {
					companyId = next;
					patternId = null;
				}}
			/>
		</Stack>
		<Stack gap="xs">
			<Label for="hire-start">{t('offboarding.new_start')}</Label>
			<DateInput
				id="hire-start"
				of="date"
				value={start}
				onChange={(next) => (start = next)}
				disabled={saving}
			/>
		</Stack>
		<Stack gap="xs">
			<Label for="hire-salary">{t('component.base_salary')}</Label>
			<Input
				id="hire-salary"
				type="number"
				value={salary}
				disabled={saving}
				onchange={(event: Event & { currentTarget: HTMLInputElement }) =>
					(salary = event.currentTarget.value)}
			/>
		</Stack>
		<Stack gap="xs">
			<Label for="hire-type">{t('component.employment_type')}</Label>
			<Combobox
				id="hire-type"
				class="w-full"
				options={labelled(EMPLOYMENT_TYPES)}
				value={employmentType}
				disabled={saving}
				onChange={(next) => next != null && (employmentType = next)}
			/>
		</Stack>
		<Stack gap="xs">
			<Label for="hire-residency">{t('component.residency_status')}</Label>
			<Combobox
				id="hire-residency"
				class="w-full"
				options={labelled(RESIDENCY)}
				value={residency}
				disabled={saving}
				onChange={(next) => next != null && (residency = next)}
			/>
		</Stack>
		<Stack gap="xs">
			<Label for="hire-class">{t('component.classification')}</Label>
			<Combobox
				id="hire-class"
				class="w-full"
				options={labelled(CLASSIFICATION)}
				value={classification}
				disabled={saving}
				onChange={(next) => next != null && (classification = next)}
			/>
		</Stack>
		{#if (patterns.current ?? []).length > 0}
			<Stack gap="xs">
				<Label for="hire-pattern">{t('component.shift_pattern')}</Label>
				<Combobox
					id="hire-pattern"
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
				disabled={saving || companyId == null || start == null || start === '' || salary === ''}
				onclick={() => void submit()}
			>
				{t('component.hire')}
			</Button>
		</Cluster>
	</Stack>
</Sheet>
