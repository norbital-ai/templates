/**
 * The columns a run *list* needs. `configuration_snapshot` is the frozen pay catalogue the run
 * calculated against — about 1.4 MB for a 17-employee company — and a live query that carries it
 * for every run pushes the workspace's sync connect answer past its 2 MiB ceiling, after which
 * nothing on the page updates. Lists read the hash; the snapshot stays on the record detail and
 * in the hooks that verify a later run against it.
 */
export const PAYROLL_RUN_LIST_COLUMNS = {
	id: true,
	company_id: true,
	period: true,
	lifecycle: true,
	run_kind: true,
	sequence: true,
	configuration_hash: true,
	statutory_snapshot_id: true,
	calculation_version: true,
	pay_date: true,
	attendance_from: true,
	attendance_to: true,
	created_at: true,
	updated_at: true,
	row_version: true
} as const;
