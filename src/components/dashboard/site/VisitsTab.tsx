import SitePlaceholder from './SitePlaceholder';

export default function VisitsTab() {
  return (
    <SitePlaceholder
      title="Visits"
      description="Cross-participant visit calendar and the guided execution flow."
      whatWillLiveHere={[
        'Calendar view of all scheduled visits across participants',
        'Step-by-step guided visit execution — grouped plain-language steps with protocol detail one tap away',
        'Inline deviation capture while you work',
        'Guidance surfacing high-risk or commonly-missed steps before they happen',
        'Launchable from Today, from a participant profile, or directly from this tab',
      ]}
    />
  );
}
