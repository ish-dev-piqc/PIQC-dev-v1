import SitePlaceholder from './SitePlaceholder';

export default function TeamTab() {
  return (
    <SitePlaceholder
      title="Team"
      description="Site staff and the delegation log for this protocol."
      whatWillLiveHere={[
        'People on site: coordinators, sub-investigators, nurses, pharmacists',
        'Delegation log — who is authorized to perform which procedures',
        'Certification and training status per person',
        'Historical record of delegation changes (who was delegated what, when, by whom)',
        'Used as the single source of truth when a monitor or auditor asks',
      ]}
    />
  );
}
