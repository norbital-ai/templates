<script lang="ts">
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Inline } from '@norbital-ai/ui/layout';
	import { Spinner } from '@norbital-ai/ui/spinner';
	import {
		activeCompany as activeCompanyOf,
		activeCompanyId as activeCompanyIdOf,
		companies as companiesOf,
		companiesError as companiesErrorOf,
		companiesUnknown as companiesUnknownOf,
		selectCompany
	} from './company-scope.svelte.js';

	const { t } = useI18n<TenantI18nKeys>();
	const companies = $derived(companiesOf());
	const companiesUnknown = $derived(companiesUnknownOf());
	const companiesError = $derived(companiesErrorOf());
	const activeCompany = $derived(activeCompanyOf());
	const activeCompanyId = $derived(activeCompanyIdOf());
</script>

<svelte:head>
	<title>Entities</title>
	<meta name="description" content="Choose the legal entity every HR operation is scoped to" />
	<meta name="bolt:icon" content="lucide:building-2" />
</svelte:head>

<p class="mb-2 text-sm text-muted-foreground">{t('app.hr_controller.entities_description')}</p>

{#if companiesError}
	<p class="py-8 text-center text-sm text-destructive">{companiesError.message}</p>
{:else if companiesUnknown}
	<Inline justify="center" align="center" gap="sm" class="min-h-48 text-sm text-muted-foreground">
		<Spinner class="size-4" />
		<span>{t('component.loading')}</span>
	</Inline>
{:else}
	<div class="divide-y divide-border/70 rounded-md border border-border/70">
		{#each companies as company (company.id)}
			<button
				type="button"
				class="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-muted/40"
				aria-pressed={String(company.id) === String(activeCompanyId)}
				data-entity-row={String(company.id)}
				onclick={() => selectCompany(String(company.id))}
			>
				<span>
					<span class="block font-medium text-foreground">{company.name}</span>
					{#if company.registration_number}
						<span class="block text-xs text-muted-foreground">{company.registration_number}</span>
					{/if}
				</span>
				{#if String(company.id) === String(activeCompany?.id)}
					<span class="text-xs font-semibold text-primary">
						{t('app.hr_controller.entities_active')}
					</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}
