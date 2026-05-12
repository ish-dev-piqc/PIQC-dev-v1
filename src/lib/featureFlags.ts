// Build-time feature flags resolved from VITE_FF_* env vars at Vite build time.
// All flags default false — unset == disabled.
export const FLAGS = {
  SUBJECT_COMMAND_VIEW: import.meta.env.VITE_FF_SUBJECT_COMMAND_VIEW === 'true',
  WORKSHEET_COMPILER: import.meta.env.VITE_FF_WORKSHEET_COMPILER === 'true',
} as const;
