/**
 * Leave: the preview is the approval planner's answer; an HR write is committed with its dated charges; an
 * employee's own request waits for approval. (Ports public-seed-leave-catalogue, -preview-leave and -ns-leave.)
 */
import { beforeEach, expect, it } from 'vitest';
import { committed, DION, SG_2026_Q1, workspace } from './kit.ts';

let t: Awaited<ReturnType<typeof workspace>>;
let annual: string;
let dion: string;
beforeEach(async () => {
	t = await workspace();
	const admin = t.as(t.admin);
	annual = (
		await admin.read('leave_catalogue', {
			where: { settings_id: { eq: SG_2026_Q1 }, code: { eq: 'ANNUAL_LEAVE' } },
			limit: 1
		})
	).rows[0]!.id as string;
	const [person] = (await admin.read('employees', { where: { email: { eq: DION } }, limit: 1 }))
		.rows;
	dion = (
		await admin.read('employments', { where: { employee_id: { eq: person!.id! } }, limit: 1 })
	).rows[0]!.id as string;
	await recordSgAttendance(t, dion);
});

/**
 * The bank carries no Singapore attendance at all, and a closed annual year now reads it: the
 * final 2025 balance refuses to read an unrecorded working day as a day worked. State the year as
 * the office roster and the day sheet record it — Norbital's `OFFICEx5-OFF-REST` week is Monday
 * to Friday in `OFFICE` (09:00–18:00 less the granted hour), Saturday `OFF`, Sunday `REST` — so the
 * 2026 request's carry year is settled on evidence rather than on a guess.
 */
async function recordSgAttendance(
	workspace: Awaited<ReturnType<typeof workspace>>,
	employment: string
) {
	await workspace.db.write({
		text: `INSERT INTO work_days (id, employment_id, work_date, shift_definition_id, worked_intervals)
		       SELECT gen_random_uuid(), $1, day,
		         CASE EXTRACT(ISODOW FROM day) WHEN 6 THEN $3::uuid WHEN 7 THEN $4::uuid ELSE $2::uuid END,
		         CASE WHEN EXTRACT(ISODOW FROM day) <= 5
		              THEN jsonb_build_array(
		                     jsonb_build_object('start', to_char(day, 'YYYY-MM-DD') || 'T01:00:00.000Z',
		                                       'end', to_char(day, 'YYYY-MM-DD') || 'T05:00:00.000Z'),
		                     jsonb_build_object('start', to_char(day, 'YYYY-MM-DD') || 'T06:00:00.000Z',
		                                       'end', to_char(day, 'YYYY-MM-DD') || 'T10:00:00.000Z'))
		              ELSE '[]'::jsonb END
		       FROM generate_series('2025-01-01'::date, '2025-12-31'::date, '1 day') AS day`,
		params: [
			employment,
			'f631a46c-7682-5567-bd3c-dd5266d26249',
			'3539e584-63fb-53b4-8a71-5969adcd5bc7',
			'f8ff59c3-eb4d-57ba-aea7-0866ec6f3fb9'
		]
	});
}
const request = (employment_id: string) => ({
	employment_id,
	catalogue_id: annual,
	reference: 'AL-1',
	from_date: '2026-03-02',
	to_date: '2026-03-03',
	reason: 'Holiday'
});

it('the preview answers the days a request would charge', async () => {
	const preview = (await t.as(t.admin).query('leave_entries.preview_leave', {
		employment_id: dion,
		catalogue_id: annual,
		calendar_month: '2026-03'
	})) as { readonly [key: string]: unknown };
	expect(preview).toBeTypeOf('object');
});

it('an HR write commits the entry with its dated charges', async () => {
	const [row] = committed(await t.as(t.admin).act('leave_entries.create', request(dion)));
	const entry = await t.as(t.admin).get('leave_entries', row!.id as string);
	expect((entry!.charges as unknown[]).length).toBe(2);
});

it("an employee's own request waits for approval", async () => {
	const employee = t.as(t.member(['employee'], { email: DION }));
	expect((await employee.act('leave_entries.create', request(dion))).kind).toBe('pendingApproval');
});
