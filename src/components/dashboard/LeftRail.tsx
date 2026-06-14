import {
  LayoutGrid,
  ClipboardList,
  ShieldCheck,
  Building2,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useMode, type DashboardMode } from '../../context/ModeContext';
import { useTheme } from '../../context/ThemeContext';
import { useUnreadMentionsDisplay } from '../../context/UnreadMentionsContext';
import type { DashboardTab } from './Dashboard';

// =============================================================================
// LeftRail — persistent 56px navigation rail mounted on every dashboard
// view. Five icons + avatar:
//
//   Workspace   (purple) → OrganizationPage (current org hub destination)
//   Site mode   (blue)   → Site Mode dashboard
//   Audit mode  (teal)   → Audit Mode dashboard
//   Sponsor     (purple) → Coming-soon placeholder; full page lands in PR 3
//   Chat        (coral)  → Stub (no-op); overlay wires in PR 4
//
// Active icon picked from current dashboardTab + mode:
//   - dashboardTab === 'organization' → workspace active
//   - dashboardTab === 'sponsor'      → sponsor active
//   - mode === 'site'                 → site active
//   - mode === 'audit'                → audit active
//
// Hover shows a label tooltip to the right of each icon.
// =============================================================================

interface LeftRailProps {
  dashboardTab: DashboardTab;
  /** Tab-change call routed through App's guardedNavigate (PR 1b). The
   *  caller decides whether to confirm-leave on dirty state. */
  onDashboardTabChange: (tab: DashboardTab) => void;
  /** Mode-change call routed through App's guardedNavigate (PR 1b).
   *  Optional — falls back to local `setMode` when absent (older callers). */
  onModeChange?: (mode: DashboardMode) => void;
  /** Toggle the chat overlay open/closed. Wired in PR 4. Optional so
   *  earlier callers don't have to provide it; the icon goes inert when
   *  absent. */
  onChatToggle?: () => void;
  /** True when the chat overlay is currently open — drives the active
   *  state on the Chat rail icon. */
  chatOverlayOpen?: boolean;
}

type RailKey = 'workspace' | 'site' | 'audit' | 'sponsor' | 'chat';

interface RailItem {
  key: RailKey;
  label: string;
  icon: LucideIcon;
  /** True when the destination isn't built yet (Sponsor in this PR). */
  soon?: boolean;
}

const ITEMS: ReadonlyArray<RailItem> = [
  { key: 'workspace', label: 'Workspace', icon: LayoutGrid },
  { key: 'site', label: 'Site mode', icon: ClipboardList },
  { key: 'audit', label: 'Audit mode', icon: ShieldCheck },
  { key: 'sponsor', label: 'Sponsor mode (coming soon)', icon: Building2, soon: true },
  { key: 'chat', label: 'Chat', icon: MessageCircle },
];

/** Per-icon palette. Inline hex matches the workspace-first brainstorm
 *  spec (Site=blue, Audit=teal, Workspace+Sponsor=purple, Chat=coral). */
const PALETTE: Record<RailKey, { activeBg: string; activeFg: string }> = {
  workspace: { activeBg: '#EEEDFE', activeFg: '#3C3489' },
  site: { activeBg: '#E6F1FB', activeFg: '#0C447C' },
  audit: { activeBg: '#E1F5EE', activeFg: '#085041' },
  sponsor: { activeBg: '#EEEDFE', activeFg: '#3C3489' },
  chat: { activeBg: '#FAECE7', activeFg: '#993C1D' },
};

const SITE_TABS: ReadonlySet<DashboardTab> = new Set<DashboardTab>([
  'today',
  'overview',
  'visits',
  'participants',
  'reports',
  'visit-execution',
]);

const AUDIT_TABS: ReadonlySet<DashboardTab> = new Set<DashboardTab>([
  'audit-overview',
  'chat',
  'knowledge',
  'workflows',
]);

function activeKey(dashboardTab: DashboardTab, mode: DashboardMode): RailKey | null {
  if (dashboardTab === 'organization') return 'workspace';
  if (dashboardTab === 'sponsor') return 'sponsor';
  if (SITE_TABS.has(dashboardTab) || mode === 'site') return 'site';
  if (AUDIT_TABS.has(dashboardTab) || mode === 'audit') return 'audit';
  return null;
}

/** True when the user is sitting on the hub's Chat tab — Chat icon dims so
 *  the user knows the overlay is redundant here. Reads from localStorage
 *  rather than threading another prop; staleness is fine because the dim
 *  is only an informational cue. */
function isOnHubChatTab(dashboardTab: DashboardTab): boolean {
  if (dashboardTab !== 'organization') return false;
  try {
    return localStorage.getItem('piq-org-tab-v1') === 'chat';
  } catch {
    return false;
  }
}

export default function LeftRail({
  dashboardTab,
  onDashboardTabChange,
  onModeChange,
  onChatToggle,
  chatOverlayOpen = false,
}: LeftRailProps) {
  const { theme } = useTheme();
  const { profile } = useAuth();
  const { mode, setMode: setModeDirect } = useMode();
  const setMode: (m: DashboardMode) => void = onModeChange ?? setModeDirect;
  const { count: unreadMentionCount } = useUnreadMentionsDisplay();
  const isLight = theme === 'light';
  const active = activeKey(dashboardTab, mode);
  const chatDimmed = isOnHubChatTab(dashboardTab);

  // Two-letter initials for the avatar at the bottom of the rail.
  const initials = (profile?.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '··';

  const railBg = isLight ? 'bg-[#F2F2F2]' : 'bg-white/[0.02]';
  const railBorder = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const idleFg = isLight ? 'text-[#334155]/70' : 'text-[#CBD5E1]/65';
  const idleHover = isLight ? 'hover:bg-[#0F172A]/[0.05]' : 'hover:bg-white/[0.06]';
  const dividerBg = isLight ? 'bg-[#E2E8F0]' : 'bg-white/10';
  const tipBg = isLight ? 'bg-[#0F172A] text-white' : 'bg-white text-[#0F172A]';

  const handleClick = (key: RailKey) => {
    switch (key) {
      case 'workspace':
        onDashboardTabChange('organization');
        return;
      case 'site':
        setMode('site');
        // Don't force-switch dashboardTab when already on a site tab — the
        // user keeps their place. If they were on an audit/org/sponsor tab,
        // land them on Today.
        if (!SITE_TABS.has(dashboardTab)) onDashboardTabChange('today');
        return;
      case 'audit':
        setMode('audit');
        if (!AUDIT_TABS.has(dashboardTab)) onDashboardTabChange('audit-overview');
        return;
      case 'sponsor':
        onDashboardTabChange('sponsor');
        return;
      case 'chat':
        if (chatDimmed) return;
        onChatToggle?.();
        return;
    }
  };

  return (
    <aside
      // Hidden below 480px — phone-class only. Anything wider (split-
      // screen laptops, narrow browser windows, tablets) gets the rail.
      // Match Navbar's `min-[480px]:hidden` hamburger toggle so the two
      // never overlap.
      className={`hidden min-[480px]:flex flex-col items-center flex-shrink-0 w-14 py-3 gap-1 border-r ${railBg} ${railBorder}`}
      aria-label="Mode navigation"
    >
      {ITEMS.map((item, idx) => {
        const isChat = item.key === 'chat';
        const isActive =
          isChat ? chatOverlayOpen && !chatDimmed : active === item.key;
        const palette = PALETTE[item.key];
        const Icon = item.icon;
        const styles = isActive
          ? { backgroundColor: palette.activeBg, color: palette.activeFg }
          : undefined;
        const dimmed = item.soon || (isChat && chatDimmed);
        const buttonClass = isActive
          ? 'relative w-10 h-10 rounded-md flex items-center justify-center group'
          : `relative w-10 h-10 rounded-md flex items-center justify-center group ${idleFg} ${idleHover} ${
              dimmed ? 'opacity-35' : ''
            }`;
        return (
          <>
            <button
              key={item.key}
              type="button"
              onClick={() => handleClick(item.key)}
              className={buttonClass}
              style={styles}
              aria-label={item.label}
              aria-pressed={isActive}
            >
              <Icon size={18} />
              {item.soon && (
                <span
                  className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: '#BA7517' }}
                  aria-hidden="true"
                />
              )}
              {/* Coral unread dot on the Chat icon when there are unread
                  mentions and the overlay isn't already open / dimmed. */}
              {isChat && unreadMentionCount > 0 && !chatOverlayOpen && !chatDimmed && (
                <span
                  className="absolute top-1 right-1 w-2 h-2 rounded-full"
                  style={{ backgroundColor: '#D85A30' }}
                  aria-label={`${unreadMentionCount} unread`}
                />
              )}
              <span
                className={`pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 whitespace-nowrap px-2 py-1 rounded-md text-[11px] font-medium opacity-0 group-hover:opacity-100 transition-opacity z-50 ${tipBg}`}
              >
                {item.label}
              </span>
            </button>
            {/* Visual dividers after Workspace and after Sponsor. The rail
                splits into: Workspace · Modes · Tool (Chat). */}
            {(idx === 0 || idx === 3) && (
              <span
                key={`div-${idx}`}
                className={`block w-6 h-px ${dividerBg} my-1`}
                aria-hidden="true"
              />
            )}
          </>
        );
      })}

      <span className="flex-1" />

      <div
        className={`flex items-center justify-center w-8 h-8 rounded-full text-[11px] font-medium ${
          isLight ? 'bg-[#E2E8F0] text-[#334155]' : 'bg-white/10 text-[#CBD5E1]'
        }`}
        aria-label="Your profile"
      >
        {initials}
      </div>
    </aside>
  );
}
