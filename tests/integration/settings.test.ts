/**
 * Law is versioned: a sealed version never changes, a new version is a cloned draft, and a draft refuses a catalogue
 * row or scheme the engine could not price lawfully. (Ports public-seed-settings-immutability, -settings-version,
 * -jurisdiction-sealed-law and the gross-recovery and per-unit refusals of the deduction-limit work.)
 */
import { beforeAll, expect, it } from 'vitest';
import { committed, refused, SG_2026_Q1, workspace } from './kit.ts';

let t: Awaited<ReturnType<typeof workspace>>;
let draft: string;
beforeAll(async () => {
	t = await workspace();
	const o = await t.as(t.admin).act('jurisdiction_settings.new_settings_version', {
		settings_id: SG_2026_Q1,
		starts_on: '2030-01-01',
		name: 'Singapore — 2030 draft'
	});
	draft = (o as { output: string }).output;
	committed(o);
});
const admin = () => t.as(t.admin);

it('a sealed version refuses a change', async () => {
	expect(
		refused(
			await admin().act('jurisdiction_settings.update', { target: SG_2026_Q1, set: { name: 'x' } })
		)
	).toMatch(/sealed/);
});

it('a new version is an unsealed clone of the lineage with every scheme', async () => {
	const version = await admin().get('jurisdiction_settings', draft);
	expect(version).toMatchObject({ code: 'SG', sealed_at: null });
	const schemes = await admin().read('statutory_contributions', {
		where: { settings_id: { eq: draft } },
		all: true
	});
	expect(schemes.rows.map((row) => row.code)).toContain('CPF');
});

it('a loan line that would reduce gross wages is refused', async () => {
	expect(
		refused(
			await admin().act('loan_catalogue.create', {
				settings_id: draft,
				code: 'GROSS_RECOVERY',
				name: 'Gross recovery',
				destination: 'PAY',
				direction: 'SUBTRACT'
			})
		)
	).toMatch(/net pay/);
});

it('a per-unit rule is refused on a month-to-date scheme', async () => {
	expect(
		refused(
			await admin().act('statutory_contributions.create', {
				settings_id: draft,
				code: 'DAILY',
				name: 'Daily withholding',
				assessment_period: 'MONTH_TO_DATE',
				assessed_on: 'BASE',
				rules: [{ when: 'true', employee: '0.0', employer: '0.0', per_unit: true }]
			})
		)
	).toMatch(/Per-unit rules/);
});
