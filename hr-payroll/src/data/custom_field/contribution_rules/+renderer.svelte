<script lang="ts">
	/**
	 * The rules of one statutory scheme as a matrix: each row is one rule — the condition
	 * it governs under and the employee and employer money it charges. Rules are read in order; the
	 * first whose `when` holds governs. Every expression compiles live against the scheme context.
	 */
	import { t } from '../../../lib/ui/t.js';
	import MatrixRenderer, { type MatrixColumn } from '../../../lib/ui/grid.svelte';
	import type { CollectionField } from '../../../lib/ui/grid.svelte';
	import { watch } from 'runed';
	import { Stack } from '@norbital-ai/ui/layout';

	import type { ContributionRule } from '../../../lib/datatypes/contribution_rules.js';
	import ExpressionCell from '../../../lib/ui/expression-cell.svelte';
	import type { ExpressionType } from '../../../lib/expressions/contexts.js';
	import type { CustomFieldView } from '@norbital-ai/ui';

	type RuleRow = {
		id: string;
		when: string;
		employee: string;
		employer: string;
		rebate: string;
		deduction: string;
		refusal: string;
		warning: string;
		per_unit: boolean;
		payment_occasion: boolean;
	};

	type Value = readonly ContributionRule[];

	let { view }: { view: CustomFieldView<Value> } = $props();
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const readonly = $derived(view.mode !== 'edit');
	const rows = $derived(view.value ?? []);

	const fieldOf = (
		name: string,
		kind: string,
		extra: Partial<CollectionField> = {}
	): CollectionField => ({ name, kind, nullable: false, ...extra });
	const schemeExpr = (name: string, type: ExpressionType) =>
		fieldOf(name, 'text', { options: { site: 'scheme', type } });

	let projected = $state<RuleRow[]>([]);
	watch(
		() => rows,
		(next) => {
			projected = next.map((rule, index) => ({
				id: String(index),
				when: rule.when,
				employee: rule.employee,
				employer: rule.employer,
				rebate: rule.rebate ?? '',
				deduction: rule.deduction ?? '',
				refusal: rule.refusal ?? '',
				warning: rule.warning ?? '',
				per_unit: rule.per_unit ?? false,
				payment_occasion: rule.payment_occasion ?? false
			}));
		},
		{ lazy: false }
	);

	const columns: MatrixColumn<RuleRow>[] = $derived([
		{
			key: 'per_unit',
			label: t('renderer.unit_assessments.rule'),
			field: fieldOf('per_unit', 'boolean'),
			width: 140
		},
		{
			key: 'payment_occasion',
			label: t('renderer.unit_assessments.payment_occasion'),
			field: fieldOf('payment_occasion', 'boolean'),
			width: 140
		},
		{
			key: 'warning',
			label: t('renderer.unit_assessments.warning'),
			field: fieldOf('warning', 'text'),
			width: 280
		},
		{
			key: 'when',
			label: t('component.rule_condition'),
			field: schemeExpr('when', 'boolean'),
			renderer: ExpressionCell,
			placeholder: 'base > 0.0 && base <= 5000.0',
			width: 360
		},
		{
			key: 'deduction',
			label: t('renderer.statutory_deductions.allowable_deduction'),
			field: schemeExpr('deduction', 'money'),
			renderer: ExpressionCell,
			placeholder: '0.0',
			width: 280
		},
		{
			key: 'refusal',
			label: t('renderer.statutory_deductions.refusal'),
			field: fieldOf('refusal', 'text'),
			width: 280
		},
		{
			key: 'employee',
			label: t('component.rule_employee'),
			field: schemeExpr('employee', 'money'),
			renderer: ExpressionCell,
			placeholder: 'base * 11.0 / 100.0',
			width: 280
		},
		{
			key: 'rebate',
			label: t('renderer.statutory_deductions.rebate'),
			field: schemeExpr('rebate', 'money'),
			renderer: ExpressionCell,
			placeholder: '0.0',
			width: 280
		},
		{
			key: 'employer',
			label: t('component.rule_employer'),
			field: schemeExpr('employer', 'money'),
			renderer: ExpressionCell,
			placeholder: 'base * 13.0 / 100.0',
			width: 280
		}
	]);

	function commit(next: RuleRow[]): void {
		projected = next;
		if (view.mode !== 'edit') return;
		view.onChange(
			next.map((row): Value[number] => ({
				when: row.when,
				employee: row.employee,
				employer: row.employer,
				...(row.rebate.trim() === '' ? {} : { rebate: row.rebate }),
				...(row.deduction.trim() === '' ? {} : { deduction: row.deduction }),
				...(row.refusal.trim() === '' ? {} : { refusal: row.refusal }),
				...(row.warning.trim() === '' ? {} : { warning: row.warning }),
				...(row.per_unit ? { per_unit: true } : {}),
				...(row.payment_occasion ? { payment_occasion: true } : {})
			}))
		);
	}
</script>

<Stack gap="sm" class="w-full">
	<p class="text-sm text-muted-foreground">{t('component.scheme_rules_description')}</p>
	<MatrixRenderer
		{disabled}
		{readonly}
		bind:rows={projected}
		{columns}
		allowAddRows={!disabled}
		bounded={false}
		getRowId={(row) => row.id}
		addRowLabel={t('component.add_rule')}
		createRow={() => ({
			id: String(projected.length),
			when: 'base > 0.0',
			employee: '0.0',
			employer: '0.0',
			rebate: '',
			deduction: '',
			refusal: '',
			warning: '',
			per_unit: false,
			payment_occasion: false
		})}
		onChange={commit}
	/>
</Stack>
