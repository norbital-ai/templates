import { team } from '@norbital-ai/bolt';
export default team({
	sales: { name: 'Sales', policies: ['sales', 'own_signature'] },
	procurement: { name: 'Procurement', policies: ['procurement'] },
	commercial_managers: { name: 'Commercial Managers', policies: ['manager', 'own_signature'] },
	finance: { name: 'Finance', policies: ['finance'] },
	logistics: { name: 'Logistics', policies: ['logistics'] },
	configurators: { name: 'Configurators', policies: ['configuration'] }
});
