import SitePlaceholder from './SitePlaceholder';

export default function ParticipantsTab() {
  return (
    <SitePlaceholder
      title="Participants"
      description="Everyone enrolled on this protocol and where they stand."
      whatWillLiveHere={[
        'Participant roster with status chips (screening, active, completed, withdrawn)',
        'Last visit, next scheduled visit, and any open deviations per participant',
        'Click-in profile: full visit history, consent status, inclusion/exclusion notes',
        'Filter by status, visit phase, or assigned coordinator',
        'Launch a visit directly from a participant profile',
      ]}
    />
  );
}
