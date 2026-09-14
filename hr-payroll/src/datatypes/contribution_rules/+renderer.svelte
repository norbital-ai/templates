<script lang="ts">
	/**
	 * The rules of one statutory scheme (RFC 0002) as a matrix: each row is one rule — the condition
	 * it governs under and the employee and employer money it charges. Rules are read in order; the
	 * first whose `when` holds governs. Every expression compiles live against the scheme context.
	 */
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import type { CollectionField } from '@norbital-ai/std/collection';
	import { watch } from 'runed';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { contributionRuleSchema } from './+definition.js';
	import { Result, Schema } from 'effect';
	import ExpressionCell from '../../lib/ui/expression-cell.svelte';
	import type { RendererProps, Value } from './$types.js';

	type RuleRow = { id: string; when: string; employee: string; employer: string };

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const readonly = $derived(props.mode !== 'edit');
	const decoded = $derived.by(() =>
		Schema.decodeUnknownResult(Schema.Array(contributionRuleSchema))(props.value ?? [])
	);
	const rows = $derived(Result.isSuccess(decoded) ? decoded.success : []);

	const fieldOf = (
		name: string,
		kind: string,
		extra: Partial<CollectionField> = {}
	): CollectionField => ({ name, kind, nullable: false, ...extra });
	const schemeExpr = (name: string, type: 'boolean' | 'number') =>
		fieldOf(name, 'text', { options: { site: 'scheme', type } });

	let projected = $state<RuleRow[]>([]);
	watch(
		() => rows,
		(next) => {
			projected = next.map((rule, index) => ({
				id: String(index),
				when: rule.when,
				employee: rule.employee,
				employer: rule.employer
			}));
		},
		{ lazy: false }
	);

	const columns: MatrixColumn<RuleRow>[] = [
		{
			key: 'when',
			label: t('component.rule_condition'),
			field: schemeExpr('when', 'boolean'),
			renderer: ExpressionCell,
			placeholder: 'base > 0.0 && base <= 5000.0',
			width: 360
		},
		{
			key: 'employee',
			label: t('component.rule_employee'),
			field: schemeExpr('employee', 'number'),
			renderer: ExpressionCell,
			placeholder: 'base * 11.0 / 100.0',
			width: 280
		},
		{
			key: 'employer',
			label: t('component.rule_employer'),
			field: schemeExpr('employer', 'number'),
			renderer: ExpressionCell,
			placeholder: 'base * 13.0 / 100.0',
			width: 280
		}
	];

	function commit(next: RuleRow[]): void {
		projected = next;
		if (props.mode !== 'edit') return;
		props.onValueChange(
			next.map((row): Value[number] => ({
				when: row.when,
				employee: row.employee,
				employer: row.employer
			}))
		);
	}
</script>

<div class="flex w-full flex-col gap-2">
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
			employer: '0.0'
		})}
		onChange={commit}
	/>
</div>
