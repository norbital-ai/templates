/**
 * The columns a run *list* needs, stated explicitly so a future heavy column cannot ride into
 * every live list query unnoticed: a frozen 1.4 MB snapshot once did, and pushed the workspace's
 * sync connect answer past its 2 MiB ceiling until nothing on the page updated.
 */
export const PAYROLL_RUN_LIST_COLUMNS = {
	id: true,
	company_id: true,
	period: true,
	lifecycle: true,
	run_kind: true,
	sequence: true,
	configuration_hash: true,
	core_input_hash: true,
	statutory_snapshot_id: true,
	calculation_version: true,
	pay_date: true,
	attendance_from: true,
	attendance_to: true,
	created_at: true,
	updated_at: true,
	row_version: true
} as const;
