import { useEffect, useState } from 'react';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useMode } from '../../../context/ModeContext';
import {
  fetchFlaggedResponsesSignal,
  fetchSotrAwaitingReviewSignal,
} from '../../../lib/crossMode/auditSignals';

// =============================================================================
// AuditSignalsBanner — slim Site Mode banner that surfaces Audit Mode
// signals (flagged questionnaire responses, SOTR items awaiting review)
// for the active protocol.
//
// Renders nothing when both counts are 0 or while loading. Clicking
// switches the app into Audit Mode so the user can investigate.
// =============================================================================

interface AuditSignalsBannerProps {
  protocolId: string | null;
}

export default function AuditSignalsBanner({ protocolId }: AuditSignalsBannerProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { setMode } = useMode();
  const [flaggedCount, setFlaggedCount] = useState(0);
  const [sotrCount, setSotrCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!protocolId) {
      setFlaggedCount(0);
      setSotrCount(0);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    Promise.all([
      fetchFlaggedResponsesSignal(protocolId),
      fetchSotrAwaitingReviewSignal(protocolId),
    ]).then(([flagged, sotr]) => {
      if (cancelled) return;
      setFlaggedCount(flagged.count);
      setSotrCount(sotr.count);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [protocolId]);

  if (!loaded || (flaggedCount === 0 && sotrCount === 0)) return null;

  const fragments: string[] = [];
  if (flaggedCount > 0) {
    fragments.push(
      `${flaggedCount} flagged response${flaggedCount === 1 ? '' : 's'}`,
    );
  }
  if (sotrCount > 0) {
    fragments.push(
      `${sotrCount} SOTR item${sotrCount === 1 ? '' : 's'} awaiting review`,
    );
  }
  const message = fragments.join(' · ');

  return (
    <button
      type="button"
      onClick={() => setMode('audit')}
      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border text-xs w-full text-left transition-colors ${
        isLight
          ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
          : 'bg-amber-500/[0.08] border-amber-500/30 text-amber-300 hover:bg-amber-500/[0.12]'
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <ShieldAlert size={12} className="flex-shrink-0" />
        <span className="truncate">
          <strong className="font-semibold">Audit signals:</strong> {message}
        </span>
      </div>
      <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium">
        View in Audit
        <ArrowRight size={11} />
      </span>
    </button>
  );
}
