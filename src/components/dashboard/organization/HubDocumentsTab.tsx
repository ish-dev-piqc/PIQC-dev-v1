import { Folder } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// HubDocumentsTab — stub. Full content (protocol-scoped doc list, pinned
// board, source-unioned rows, upload flow, new Storage bucket) lands in
// PR 5 of the workspace-first sequence.
//
// Renders a centered card so the tab is clickable + route-stable without
// promising functionality that isn't there yet.
// =============================================================================

export default function HubDocumentsTab() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  return (
    <div className="p-8 max-w-2xl mx-auto text-center">
      <div
        className={`p-8 rounded-lg border ${
          isLight ? 'border-[#E2E8F0] bg-[#F8FAFC]' : 'border-white/10 bg-white/[0.03]'
        }`}
      >
        <Folder
          size={28}
          className={`mx-auto mb-3 ${isLight ? 'text-[#7F77DD]' : 'text-[#AFA9EC]'}`}
        />
        <h2 className={`text-lg font-semibold mb-1 ${isLight ? 'text-[#26215C]' : 'text-[#CECBF6]'}`}>
          Documents — coming soon
        </h2>
        <p className={`text-sm leading-relaxed ${isLight ? 'text-[#3C3489]/80' : 'text-[#AFA9EC]/80'}`}>
          Protocol-scoped document library with pinned attachments, manual
          uploads, and chat-attachment discoverability. Ships in the next
          workspace-first release.
        </p>
      </div>
    </div>
  );
}
