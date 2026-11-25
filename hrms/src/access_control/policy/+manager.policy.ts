import { policy } from '@norbital-ai/bolt';
import { READ_ALL } from './grants.js';
export default policy({
	description:
		'L1 management visibility across HR controller modules plus approval of employee leave/claims and payroll payment requests.',
	capabilities: { apps: ['hr_controller', 'hr_employee'] },
	grants: { ...READ_ALL }
});
