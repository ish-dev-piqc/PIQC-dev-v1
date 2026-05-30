import { useRef, useState } from 'react';
import { ChevronDown, Building2, Check } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOrg } from '../../../context/OrgContext';

// =============================================================================
// OrgSwitcher — Navbar dropdown for users in more than one org.
//
// Single-org users see nothing (the active org is the only org). The
// localStorage persistence in OrgContext handles "remember my last pick"
// across reloads.
//
// v1 behaviour on switch: just calls setActiveOrg(); the UI components that
// depend on org scope re-render via OrgContext's value change. A full data
// refresh is left to the protocol switcher (since protocols are the actual
// data scope; orgs just filter the protocol list).
// =============================================================================

export default function OrgSwitcher() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { myOrgs, activeOrg, setActiveOrg } = useOrg();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // No org at all → render nothing.
  if (myOrgs.length === 0) return null;

  const bg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const hoverBg = isLight ? 'hover:bg-slate-50' : 'hover:bg-white/[0.04]';

  // Single org → there's nothing to switch to, so show it as a static label
  // (Building2 + name, no chevron, not clickable) instead of hiding it.
  if (myOrgs.length === 1) {
    const only = myOrgs[0];
    return (
      <div
        className={`inline-flex items-center gap-1.5 text-xs rounded-md px-2.5 py-1.5 border ${border} ${bg} text-fg-body`}
        title={only.name}
      >
        <Building2 size={12} />
        <span className="truncate max-w-[140px]">{activeOrg?.name ?? only.name}</span>
      </div>
    );
  }

  function close() {
    setOpen(false);
  }

  function handlePick(orgId: string) {
    setActiveOrg(orgId);
    close();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 text-xs rounded-md px-2.5 py-1.5 border ${border} ${bg} ${hoverBg} text-fg-body`}
      >
        <Building2 size={12} />
        <span className="truncate max-w-[140px]">
          {activeOrg?.name ?? 'Select org'}
        </span>
        <ChevronDown size={12} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden="true" />
          <div
            className={`absolute right-0 top-full mt-1 z-50 min-w-[200px] ${bg} border ${border} rounded-md shadow-lg py-1`}
          >
            {myOrgs.map((o) => {
              const isActive = activeOrg?.id === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => handlePick(o.id)}
                  className={`w-full text-left px-3 py-2 text-xs ${hoverBg} flex items-center justify-between gap-2`}
                >
                  <div className="min-w-0">
                    <p className="text-fg-body truncate">{o.name}</p>
                    <p className="text-fg-muted text-[10px]">{o.my_role}</p>
                  </div>
                  {isActive && <Check size={12} className="text-emerald-500" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
