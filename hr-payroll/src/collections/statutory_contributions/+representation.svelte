<script lang="ts">
	/**
	 * One statutory scheme: the rules that price it and the lines that opted into it. A row like
	 * "5.5% from RM0 to RM5,000" is meaningless without the EPF/SOCSO/EIS scheme whose ladder it is a
	 * rung of, so the rules are the scheme's own `rules` column; the datatype compiles every
	 * expression against the scheme context when the row is written. Nothing declares which lines
	 * the scheme charges and nothing declares its order — the lines opt in, and a rule that names
	 * `produced.<code>` is the only dependency.
	 *
	 * `settings_id` is never a field on the Settings page: the page names the version and the form
	 * prefills and hides it. Opened without that scope it keeps a plain version picker.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import type { StatutoryOptIn } from '../../datatypes/work_rules/+definition.js';
	import { optInLines } from '../../lib/payroll/opt-in-lines.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { TabConfig } from '@norbital-ai/ui/tabs';
	import FormSection from '../../lib/ui/form-section.svelte';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const settingsId = $derived(createScope?.settingsId?.());
	const formValues = $derived(record ?? (settingsId ? { settings_id: settingsId } : undefined));
	const recordId = $derived(record == null ? '' : String(record.id));
	const versionId = $derived(record == null ? '' : String(record.settings_id));

	const approved = { approval_id: { isNull: true } } as const;
	const catalogueQuery = () => ({
		where: { settings_id: { eq: versionId }, ...approved },
		columns: { id: true, code: true, bands: true },
		limit: 500
	});
	const leave = $derived(client.db.leave_catalogue.findMany(catalogueQuery())?.current ?? []);
	const loan = $derived(client.db.loan_catalogue.findMany(catalogueQuery())?.current ?? []);
	const claim = $derived(client.db.claim_catalogue.findMany(catalogueQuery())?.current ?? []);
	const allowance = $derived(
		client.db.allowance_catalogue.findMany(catalogueQuery())?.current ?? []
	);
	const payment = $derived(client.db.payment_catalogue.findMany(catalogueQuery())?.current ?? []);
	const version = $derived(
		client.db.jurisdiction_settings.findFirst({
			where: { id: { eq: versionId } },
			columns: { id: true, code: true, work_rules: true, sealed_at: true }
		})?.current ?? null
	);
	const sealed = $derived(version?.sealed_at != null);

	type Membership = {
		readonly key: string;
		readonly code: string;
		readonly family: string;
		readonly where: string;
		readonly effect: StatutoryOptIn['effect'];
	};
	const lines = $derived(
		optInLines({
			catalogues: [
				['LEAVE', leave],
				['LOAN', loan],
				['CLAIM', claim],
				['ALLOWANCE', allowance],
				['PAYMENT', payment]
			],
			work: version?.work_rules,
			engineLineLabels: {
				salary: t('renderer.work_rules.line_salary'),
				absence: t('renderer.work_rules.line_absence'),
				night: t('renderer.work_rules.line_night')
			}
		})
	);
	const memberships = $derived(
		recordId === ''
			? ([] as Membership[])
			: lines
					.filter((line) => line.contribution_id === recordId)
					.map((line, index): Membership => ({ key: `${line.family}:${index}`, ...line }))
	);
	const tabs = $derived<TabConfig[]>([
		{
			name: 'scheme',
			label: t('component.scheme_section_identity'),
			icon: 'lucide:landmark',
			content: scheme
		},
		...(record == null
			? []
			: [
					{
						name: 'used-by',
						label: t('component.scheme_section_used_by'),
						icon: 'lucide:list-tree',
						content: usedBy
					}
				])
	]);
</script>

{#snippet scheme()}
	<CollectionForm
		{client}
		collection="statutory_contributions"
		defaultValues={formValues}
		readonly={sealed}
		submitLabel={record ? t('component.save_scheme') : t('component.create_scheme')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.scheme_section_identity')}
					hint={t('component.scheme_section_identity_hint')}
				>
					<Grid gap="sm" minimum="compact">
						{#if settingsId != null || record != null}
							<Field name="settings_id" hidden />
						{:else}
							<Field
								name="settings_id"
								label={t('component.settings_version')}
								relationOptions={{
									label: (version) =>
										[version.code, version.name, version.sealed_at ? 'sealed' : 'draft']
											.filter((part) => part != null && part !== '')
											.join(' · ') || '—',
									orderBy: { code: 'asc' },
									limit: 200
								}}
							/>
						{/if}
						<Field name="code" label={t('component.code')} />
						<Field name="name" label={t('component.name')} />
						<Field name="is_statutory" label={t('component.is_statutory')} />
						<Field name="authority" label={t('component.authority')} />
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.scheme_section_assessment')}
					hint={t('component.scheme_section_assessment_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="assessment_period" label={t('component.assessment_period')} />
						<Field
							name="employee_share_annual_cap"
							label={t('component.employee_share_annual_cap')}
						/>
						<Field name="shared_cap_group" label={t('component.shared_cap_group')} />
						<Field name="project_relief_annually" label={t('component.project_relief_annually')} />
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.scheme_section_rules')}
					hint={t('component.scheme_section_rules_hint')}
				>
					<Field name="rules" label={t('component.scheme_rules')} />
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
{/snippet}

{#snippet usedBy()}
	<Stack gap="sm">
		<p class="text-sm text-muted-foreground">{t('component.scheme_section_used_by_hint')}</p>
		{#if memberships.length === 0}
			<p class="text-sm">{t('component.scheme_used_by_empty')}</p>
		{:else}
			<ul class="flex flex-col text-sm">
				{#each memberships as row (row.key)}
					<li class="flex items-baseline gap-2 border-t border-border py-1">
						<span class="font-medium">{row.code}</span>
						<span class="text-meta">{row.family}</span>
						{#if row.where !== ''}
							<span class="text-meta truncate" title={row.where}>{row.where}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Stack>
{/snippet}

<!-- Tab content must be snippets (TabConfig.content); the shell always renders tabs so no snippet is ever render-called elsewhere. -->
<RecordShell {tabs} />
