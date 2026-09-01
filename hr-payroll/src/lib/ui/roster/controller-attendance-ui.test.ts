// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const daySheetSource = readFileSync(new URL('./day-sheet.svelte', import.meta.url), 'utf8');
const schedulingSource = readFileSync(
	new URL('../../../apps/hr_controller/+scheduling.svelte', import.meta.url),
	'utf8'
);
const employeeSource = readFileSync(
	new URL('../../../apps/+hr_employee.svelte', import.meta.url),
	'utf8'
);

test('controller attendance exposes distinct reviewed-empty and clear-to-null actions', () => {
	assert.match(daySheetSource, /function markReviewedNoWork/);
	assert.match(daySheetSource, /function clearAttendance/);
	assert.match(daySheetSource, /day_sheet_problem_missing_start/);
	assert.match(daySheetSource, /intervals: draftAttendance\.intervals/);
});

test('the footer names the independently dirty halves', () => {
	assert.match(daySheetSource, /draftCodeId !== baselineCodeId/);
	assert.match(daySheetSource, /attendanceChanged\(baselineAttendance, draftAttendance\)/);
	assert.match(daySheetSource, /roster\.save_assignment/);
	assert.match(daySheetSource, /roster\.save_attendance/);
	assert.match(daySheetSource, /roster\.save_changes/);
});

test('the active sheet owns pending approval and authoritative server error states', () => {
	assert.match(daySheetSource, /day_sheet_pending_approval/);
	assert.match(daySheetSource, /day_sheet_save_failed/);
	assert.match(schedulingSource, /submitCollectionMutation/);
	assert.doesNotMatch(schedulingSource, /settlement\.(wait|settled)/);
	assert.doesNotMatch(schedulingSource, /settlement\.kind/);
});

test('employee attendance also waits for authoritative settlement and preserves null versus empty', () => {
	assert.match(employeeSource, /submitCollectionMutation/);
	assert.match(employeeSource, /submission\.kind === 'pendingApproval'/);
	assert.match(employeeSource, /attendance\.intervals == null\s*\? null/);
	assert.match(employeeSource, /pendingApproval=\{daySheetPendingApproval\}/);
	assert.match(employeeSource, /error=\{daySheetError\}/);
	assert.doesNotMatch(
		employeeSource,
		/Effect\.tryPromise\(\{\s*try: \(\) =>\s*client\.db\.work_days\.mutate/
	);
});
