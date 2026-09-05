<script lang="ts" module>
	/**
	 * The arms `component_definition.cap.matrix.layers[]` and `leave_entitlement.layers[]` declare,
	 * and the picker for the one id either of them can name.
	 *
	 * The arms are identical between the two shapes — same literals, `employment_id` on the
	 * EMPLOYEE arm and on no other — and the scoping rule ("the people of the company this matrix
	 * belongs to, read as name · number") is a correctness rule rather than presentation.
	 * Duplicating it would give the matrices two chances to drift apart on who may be named. The
	 * STATUTORY arm both matrices once carried is gone: the statutory floor is the profile's, not
	 * a company-typed layer, so both shapes state company arms only.
	 */
	export type PolicyLayerLevel = 'ORGANISATION' | 'EMPLOYEE';

	interface LayerLevelPickerProps {
		readonly level: PolicyLayerLevel;
		/** The arms the caller's matrix declares, in picker order. */
		readonly levels: readonly PolicyLayerLevel[];
		/** The employment the EMPLOYEE arm names; `null` on the arms that name nobody. */
		readonly employmentId: string | null;
		/** The company whose people the EMPLOYEE arm may name. */
		readonly companyId: string | null;
		readonly disabled: boolean;
		/** Called with the chosen arm. The caller rebuilds the row, because only it knows the rest. */
		onLevelChange(level: PolicyLayerLevel): void;
		onEmploymentChange(employment: string): void;
	}
</script>

<script lang="ts">
	import { client } from '../../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Grid, Stack } from '@norbital-ai/ui/layout';

	let props: LayerLevelPickerProps = $props();

	const { t } = useI18n<TenantI18nKeys>();

	const ALL_LEVELS = [
		{
			value: 'ORGANISATION' as const,
			label: t('component.level_organisation'),
			description: t('component.level_organisation_description')
		},
		{
			value: 'EMPLOYEE' as const,
			label: t('component.level_employee'),
			description: t('component.level_employee_description')
		}
	];

	const LEVEL_OPTIONS = $derived(
		ALL_LEVELS.filter((option) => props.levels.includes(option.value))
	);

	/*
	 * The EMPLOYEE arm's id is a foreign key no constraint can declare — a layer is one JSONB value
	 * — so the option set is built here, scoped to the company the matrix belongs to. One query
	 * serves every row of the editor and the person's name travels with the row, rather than a
	 * lookup per option (controller-surfaces.md §5). This is an edit surface only: nothing here
	 * mounts in display mode, where a per-row lookup would be the N+1 §5 forbids.
	 */
	/**
	 * The joined shape the option set reads. The typed client models a row without its `with`
	 * payload, so the person's name is declared here and the query result is read through it — the
	 * same boundary `payslips/+representation.svelte` draws for its summary read.
	 */
	type EmploymentWithName = {
		readonly id: string;
		readonly employee_number: string;
		readonly employment_employee?: { readonly name?: string | null } | null;
	};

	const employmentsQuery = $derived(
		props.companyId == null
			? null
			: client.db.employments.findMany({
					where: { company_id: { eq: props.companyId } },
					with: { employment_employee: { columns: { name: true } } },
					orderBy: { employee_number: 'asc' },
					limit: 10_000
				})
	);
	const employments = $derived((employmentsQuery?.current ?? []) as readonly EmploymentWithName[]);
	const employmentOptions = $derived(
		employments.map((employment) => {
			const name = employment.employment_employee?.name ?? '';
			const number = employment.employee_number;
			return {
				value: employment.id,
				label: [name, number].filter((part) => part !== '').join(' · ') || '—',
				search_term: `${name} ${number}`
			};
		})
	);
</script>

<Grid gap="sm" minimum="compact">
	<label class="text-sm font-medium">
		<Stack gap="xs">
			{t('component.level')}
			<Combobox
				options={LEVEL_OPTIONS}
				value={props.level}
				disabled={props.disabled}
				searchable={false}
				emptyPlaceholder={t('component.select_a_level')}
				onValueChange={(level) => {
					if (level === 'ORGANISATION' || level === 'EMPLOYEE') {
						props.onLevelChange(level);
					}
				}}
			/>
		</Stack>
	</label>
	{#if props.level === 'EMPLOYEE'}
		<label class="text-sm font-medium">
			<Stack gap="xs">
				{t('component.person')}
				<Combobox
					ariaLabel={t('component.employment')}
					options={employmentOptions}
					value={props.employmentId === '' ? null : props.employmentId}
					disabled={props.disabled || props.companyId == null}
					searchPlaceholder={t('component.search_company_people')}
					emptyPlaceholder={t('component.choose_arrangement')}
					clientConfig={{
						isLoading: employmentsQuery?.loading ?? false,
						error: employmentsQuery?.error?.message ?? null
					}}
					onValueChange={(value) => props.onEmploymentChange(value ?? '')}
				/>
			</Stack>
		</label>
	{/if}
</Grid>
