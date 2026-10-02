// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { createRawSnippet, mount, tick, unmount } from 'svelte';

type CatalogueRow = Parameters<typeof eligibleTypeIds>[0][number];
type CatalogueQuery = {
	where?: { settings_id?: { is?: { code?: { eq?: string } } } };
	select?: { eligibility: boolean };
	all?: boolean;
};
type PickerWhere = {
	settings_id?: { is: { code: { eq: string } } };
	id: { in: string[] };
};
const mocks = vi.hoisted(() => ({
	get: vi.fn<(collection: string, id: string, select: unknown) => Promise<unknown>>(),
	read: vi.fn<(collection: string, query: CatalogueQuery) => Promise<{ rows: CatalogueRow[] }>>()
}));
vi.mock('$bolt', () => ({ bolt: mocks }));
vi.mock('../../src/lib/ui/calendar.js', () => ({ todayKey: () => '2026-10-02' }));
import EligibleTypes from '../../src/lib/ui/eligible-types.svelte';
import { NO_ROW, type eligibleTypeIds, type personAsOf } from '../../src/lib/eligible-types.js';

let component: ReturnType<typeof mount> | undefined;
afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	vi.clearAllMocks();
	document.body.replaceChildren();
});

it('the mounted picker retains MY BONUS when an unrelated notice type lacks exit evidence', async () => {
	const catalogue = JSON.parse(
		readFileSync(`${process.cwd()}/seed/jurisdiction/MY/adhoc_catalogue.json`, 'utf8')
	) as CatalogueRow[];
	const bonus = catalogue.find((row) => row.id === 'abc248db-6d2f-5e75-8a4a-cf8199462618')!;
	const notice = catalogue.find((row) => row.id === '2ca51b85-711e-408f-bb90-739bfa402719')!;
	expect(bonus).toBeDefined();
	expect(notice).toBeDefined();
	const person = Promise.withResolvers<Parameters<typeof personAsOf>[0]>();
	mocks.get.mockReturnValue(person.promise);
	const foreignBonuses = ['CN', 'JP'].map((code) => ({
		id: `${code}-bonus`,
		eligibility: '',
		lineage: code
	}));
	mocks.read.mockImplementation(async (_catalogue, query) => ({
		rows:
			query.where?.settings_id?.is?.code?.eq === 'MY'
				? [notice, bonus]
				: [notice, bonus, ...foreignBonuses]
	}));
	const children = createRawSnippet<[Record<string, unknown>]>((getWhere) => ({
		render: () => `<output>${JSON.stringify(getWhere())}</output>`
	}));
	component = mount(EligibleTypes, {
		target: document.body,
		props: {
			catalogue: 'adhoc_catalogue',
			employmentId: 'synthetic-my-employment',
			settingsCode: undefined,
			children
		}
	});
	await tick();
	expect(JSON.parse(document.querySelector('output')!.textContent!)).toEqual({
		id: { in: [NO_ROW] }
	});
	person.resolve({
		effective_range: { from: '2020-01-01', to: null },
		company_id: { settings_code: 'MY', region: 'SELANGOR' },
		employee_id: {
			gender: 'MALE',
			date_of_birth: '1990-01-01',
			nationality: 'Malaysian',
			children: []
		},
		employment_terms: []
	});
	await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
	await tick();
	const where = JSON.parse(document.querySelector('output')!.textContent!) as PickerWhere;
	expect(where.settings_id?.is.code).toEqual({ eq: 'MY' });
	expect(where.id.in).toEqual([bonus.id]);
	expect(where.id.in).not.toContain(notice.id);
	for (const foreign of foreignBonuses) expect(where.id.in).not.toContain(foreign.id);
	expect(mocks.read.mock.calls[0]?.[1].where?.settings_id?.is?.code).toEqual({ eq: 'MY' });
	expect(mocks.read.mock.calls[0]?.[1]).toMatchObject({ select: { eligibility: true }, all: true });
});
