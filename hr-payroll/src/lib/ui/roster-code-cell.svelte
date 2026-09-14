<script lang="ts" generics="TRow extends MatrixRow">
	/**
	 * One roster-code cell for a matrix: the codes of the row's company, by code and name. The
	 * company rides the matrix row (`company_id`), so the same cell serves every day of a pattern.
	 */
	import type { MatrixCellRendererProps, MatrixRow } from '@norbital-ai/ui/data-renderer/matrix';
	import { client } from '../workspace-client.js';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';

	let { value, row, disabled, placeholder, onValueChange }: MatrixCellRendererProps<TRow> =
		$props();
	const { t } = useI18n<TenantI18nKeys>();
	const companyId = $derived(
		typeof (row as Record<string, unknown>).company_id === 'string'
			? ((row as Record<string, unknown>).company_id as string)
			: null
	);
	const codesQuery = $derived(
		companyId == null
			? null
			: client.db.shift_definitions.findMany({
					where: { company_id: { eq: companyId }, approval_id: { isNull: true } },
					columns: { id: true, code: true, name: true },
					orderBy: { code: 'asc' },
					limit: 10_000
				})
	);
	const options = $derived(
		(codesQuery?.current ?? []).map((code) => ({
			value: code.id,
			label: `${code.code} · ${code.name}`,
			search_term: `${code.code} ${code.name}`
		}))
	);
</script>

<Combobox
	ariaLabel={t('component.code')}
	{options}
	value={typeof value === 'string' && value !== '' ? value : null}
	{disabled}
	emptyPlaceholder={placeholder ?? t('roster.choose_roster_code')}
	onValueChange={(id) => onValueChange(id ?? '')}
/>
