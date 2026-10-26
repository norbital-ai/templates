import { team } from '@norbital-ai/bolt';

/** Readable source handles; the sample bank projection preserves existing staff affiliations. */
export default team({
	employee: {
		name: 'Employee',
		parent: null,
		policies: ['employee']
	},
	supervisor: {
		name: 'Supervisor',
		parent: null,
		policies: ['supervisor']
	},
	manager: {
		name: 'L1 Manager',
		parent: null,
		policies: ['manager']
	},
	senior_management: {
		name: 'Senior Management',
		parent: null,
		policies: ['senior_management']
	},
	hr_controller: {
		name: 'HQ Payroll HR',
		parent: null,
		policies: ['hr_controller']
	},
	hr_manager: {
		name: 'HR Manager',
		parent: null,
		policies: ['hr_manager']
	},
	manager_hr_controller: {
		name: 'Manager (HR Controller)',
		parent: null,
		policies: ['hr_controller']
	},
	production_manager: {
		name: 'Production Manager',
		parent: null,
		policies: ['supervisor']
	},
	attendance_kiosk: {
		name: 'Attendance Kiosk',
		parent: null,
		policies: ['kiosk']
	}
});
