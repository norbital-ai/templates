import { team } from '@norbital-ai/bolt';
export default team({
	sales: { name: 'Sales', policies: ['sales'] },
	procurement: { name: 'Procurement', policies: ['procurement'] },
	commercial_managers: { name: 'Commercial Managers', policies: ['manager'] },
	finance: { name: 'Finance', policies: ['finance'] },
	logistics: { name: 'Logistics', policies: ['logistics'] },
	configurators: { name: 'Configurators', policies: ['configuration'] }
});
