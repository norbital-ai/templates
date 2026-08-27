import { defineConfig, reactivePack, stringlyPack } from '@norbital-ai/doctor';

/**
 * Workspace health rules for this published template.
 *
 * This file ships with the template, so a tenant created from it in Colony is audited by the
 * same rules the template was. Add YAML extensions beside this file; they join automatically.
 */
export default defineConfig({ packs: ['norbital', reactivePack, stringlyPack] });
