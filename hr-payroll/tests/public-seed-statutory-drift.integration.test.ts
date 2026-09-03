import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAiBinding } from '@norbital-ai/bolt-server';
import { asRecord, bearerHeaders, postGuestCommand } from '@norbital-ai/test-utilities';
import {
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const SG_PROFILE_ID = '22222222-2222-4222-8222-222222222201';
const MY_PROFILE_ID = '22222222-2222-4222-8222-222222222202';
const SG_CPF_ID = 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaaa5';
const MY_EPF_ID = 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaaa6';

const PUB_REGIME = {
	overtime_coverage: null,
	overtime_rules: [],
	overtime_limits: []
};

const PUB_STATUTORY_LEAVE = [
	{
		kind: 'ANNUAL',
		ladder: [{ band_from: 0, days: 8 }],
		per_child: null,
		max_days: null,
		authority: 'Public fixture — not a sealed statutory table.'
	}
];

const PUB_PRORATION = { by: 'CALENDAR_DAYS' };

const PUB_OVERTIME_TREATMENTS = [
	{
		authority: 'Public fixture — overtime excluded',
		treatment: { kind: 'EXCLUDE' },
		effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
	}
];

const testAiCatalog = {
	_tag: 'Catalog' as const,
	languageModels: [{ id: 'test/language' }],
	defaultLanguageModelId: 'test/language',
	embeddingModels: [{ id: 'test/embedding' }],
	defaultEmbeddingModelId: 'test/embedding'
};

const reportFor = (code: string, url: string) => ({
	summary: `${code} official statutory material was reviewed.`,
	highlights: [`${code} research completed.`],
	official_sources: [
		{
			title: `${code} official source`,
			url,
			jurisdiction_code: code,
			finding: `Current official material for ${code}.`
		}
	],
	changes_to_review: []
});

const driftAi = () =>
	makeAiBinding({
		call: async (_metadata, request) => {
			if (request._tag !== 'Generate') return testAiCatalog;
			const prompt = JSON.stringify(request);
			const code =
				/Research ONLY the latest statutory payroll position for (SG|MY)/.exec(prompt)?.[1] ??
				/for (SG|MY)/.exec(prompt)?.[1] ??
				'SG';
			const url =
				code === 'SG'
					? 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay'
					: 'https://www.kwsp.gov.my/en/employer/responsibility/contribution';
			return {
				_tag: 'Generated',
				result: { _tag: 'Object', value: reportFor(code, url) },
				observation: {
					callId: 'drift-1',
					provider: 'fixture',
					model: 'provider/model',
					operation: 'language',
					charge: { currency: 'USD', coefficient: '125', scale: 6 },
					chargeSource: 'provider'
				}
			};
		}
	});

const driftFindings = (
	value: unknown
): ReadonlyArray<{ readonly kind?: unknown; readonly label?: unknown }> => {
	if (typeof value === 'string') {
		try {
			return driftFindings(JSON.parse(value));
		} catch {
			return [];
		}
	}
	if (!Array.isArray(value)) return [];
	return value.filter(
		(row): row is { readonly kind?: unknown; readonly label?: unknown } =>
			typeof row === 'object' && row !== null && !Array.isArray(row)
	);
};

const insertSealedProfile = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	profile: Readonly<{
		readonly id: string;
		readonly code: string;
		readonly name: string;
		readonly currency: string;
		readonly effective_range: Readonly<{ readonly start: string; readonly end: string | null }>;
	}>
) => {
	await session.query(
		`insert into jurisdictions (
			id, code, name, lifecycle, currency, tax_year_start_month,
			proration, ordinary_rate_basis, ordinary_rate_divisor, regime,
			statutory_leave, effective_range
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		[
			profile.id,
			profile.code,
			profile.name,
			'SEALED',
			profile.currency,
			1,
			PUB_PRORATION,
			'DAYS_PER_MONTH',
			26,
			PUB_REGIME,
			PUB_STATUTORY_LEAVE,
			profile.effective_range
		]
	);
};

const insertContribution = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	contribution: Readonly<{
		readonly id: string;
		readonly jurisdiction_id: string;
		readonly statutory_profile_id: string;
		readonly code: string;
		readonly name: string;
	}>
) => {
	await session.query(
		`insert into statutory_contributions (
			id, jurisdiction_id, statutory_profile_id, code, name, authority, payer, keyed_by,
			rounding, relief_for, sequence, special_rules, overtime_treatments, overtime_excess_treatments
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
		[
			contribution.id,
			contribution.jurisdiction_id,
			contribution.statutory_profile_id,
			contribution.code,
			contribution.name,
			'Public fixture — not a sealed statutory table.',
			'BOTH',
			'WAGE',
			'NEAREST_CENT',
			[],
			1,
			[],
			PUB_OVERTIME_TREATMENTS,
			PUB_OVERTIME_TREATMENTS
		]
	);
};

test(
	'public seed statutory_profile_drift records rate_gap for SEALED SG and MY schemes without rates',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-p1-drift', { ai: driftAi() });
		try {
			await session.query(`update jurisdictions set effective_range = $1 where id = $2`, [
				{ start: '2020-01-01', end: '2026-01-01' },
				JURISDICTION_ID
			]);

			await insertSealedProfile(session, {
				id: SG_PROFILE_ID,
				code: 'SG',
				name: 'Singapore fixture profile',
				currency: 'SGD',
				effective_range: { start: '2026-01-02', end: null }
			});
			await insertSealedProfile(session, {
				id: MY_PROFILE_ID,
				code: 'MY',
				name: 'Malaysia fixture profile',
				currency: 'MYR',
				effective_range: { start: '2026-01-02', end: null }
			});

			await insertContribution(session, {
				id: SG_CPF_ID,
				jurisdiction_id: SG_PROFILE_ID,
				statutory_profile_id: SG_PROFILE_ID,
				code: 'SG-CPF',
				name: 'Singapore fixture CPF'
			});
			await insertContribution(session, {
				id: MY_EPF_ID,
				jurisdiction_id: MY_PROFILE_ID,
				statutory_profile_id: MY_PROFILE_ID,
				code: 'MY-EPF',
				name: 'Malaysia fixture EPF'
			});

			const started = await postGuestCommand(
				session.host.baseUrl,
				'automations.start',
				{ name: 'statutory_profile_drift', input: {} },
				bearerHeaders(session.credential)
			);
			assert.ok(
				started.status >= 200 && started.status < 300,
				`automations.start returned ${started.status}: ${JSON.stringify(started.value)}`
			);
			const body = asRecord(started.value, 'automations.start');
			assert.equal(typeof body.taskId, 'string');

			const logs = (await session.query(
				`select status, local_findings from statutory_profile_drift_logs order by checked_at desc limit 1`
			)) as ReadonlyArray<{ readonly status: string; readonly local_findings: unknown }>;
			const log = logs[0];
			assert.ok(log, 'expected a statutory_profile_drift_logs row');
			assert.equal(log.status, 'SUCCEEDED', `drift run failed: ${JSON.stringify(logs)}`);

			const rateGaps = driftFindings(log.local_findings).filter((row) => row.kind === 'rate_gap');
			assert.ok(
				rateGaps.length >= 2,
				`expected rate_gap findings, got ${JSON.stringify(rateGaps)}`
			);
			const labels = rateGaps.map((row) => String(row.label ?? ''));
			assert.ok(
				labels.some((label) => label.includes('SG-CPF') || label.includes('(SG)')),
				`expected SG-CPF rate_gap, got ${JSON.stringify(labels)}`
			);
			assert.ok(
				labels.some((label) => label.includes('MY-EPF') || label.includes('(MY)')),
				`expected MY-EPF rate_gap, got ${JSON.stringify(labels)}`
			);
		} finally {
			await session.stop();
		}
	}
);
