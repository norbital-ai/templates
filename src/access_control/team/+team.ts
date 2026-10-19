import { team } from '@norbital-ai/bolt';

/** Source handles retain existing staff affiliations; labels carry no authority. */
export default team({
	'019f8a10-0000-7000-8000-000000000001': {
		name: 'Employee',
		parent: null,
		policies: ['employee']
	},
	'019f8a10-0000-7000-8000-000000000002': {
		name: 'Supervisor',
		parent: null,
		policies: ['supervisor']
	},
	'019f8a10-0000-7000-8000-000000000003': {
		name: 'L1 Manager',
		parent: null,
		policies: ['manager']
	},
	'019f8a10-0000-7000-8000-000000000004': {
		name: 'Senior Management',
		parent: null,
		policies: ['senior_management']
	},
	'019f8a10-0000-7000-8000-000000000005': {
		name: 'HQ Payroll HR',
		parent: null,
		policies: ['hr_controller']
	},
	'019f8a10-0000-7000-8000-000000000006': {
		name: 'HR Manager',
		parent: null,
		policies: ['hr_manager']
	},
	'019f8a10-0000-7000-8000-000000000007': {
		name: 'Manager (HR Controller)',
		parent: null,
		policies: ['hr_controller']
	},
	'bb45fcf0-ee4c-5fc8-830f-73a002eff170': {
		name: 'Production Manager',
		parent: null,
		policies: ['supervisor']
	},
	'3d52a68b-017f-57d9-8fd2-fa7db4ca5965': {
		name: 'Attendance Kiosk',
		parent: null,
		policies: ['kiosk']
	}
});
