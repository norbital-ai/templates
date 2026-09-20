import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

/** Payroll creates these only through the payslip graph; there is no direct write surface. */
export default defineCollection({ model });
