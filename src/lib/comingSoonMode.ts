// Coming-soon gate: true when served from the apex piqclinical.com domain
// (production launch placeholder). False on dev.piqclinical.com and localhost,
// where the full app behavior is preserved.
export const isComingSoonMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'piqclinical.com' || host === 'www.piqclinical.com';
};
