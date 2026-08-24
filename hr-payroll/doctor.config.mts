import { defineConfig, reactivePack, stringlyPack } from '@norbital-ai/doctor';

/**
 * Workspace health rules for this template.
 *
 * This file ships with the template, so a tenant created from it in Colony is audited by the same
 * rules the template was — `norbital-doctor` writes to `.norbital/diagnosis/` either way. Add rules
 * under `dr/rules/` and list them here; they are ordinary TypeScript and need no build step.
 */
export default defineConfig({ packs: [reactivePack, stringlyPack] });
