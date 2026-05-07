import { Beaker } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useSiteData } from '../../../context/SiteDataContext';

// =============================================================================
// MockCalendarToggle — shared switch for the demo-data toggle.
//
// When ON, the visits stream in SiteDataContext returns MOCK_VISITS instead
// of site_visits rows. Only the calendar/visits/reports tabs use this.
// =============================================================================

export default function MockCalendarToggle() {
  const { theme } = useTheme();
  const { useMockCalendar, setUseMockCalendar } = useSiteData();
  const isLight = theme === 'light';

  const onTone = isLight
    ? 'bg-amber-100 border-amber-300 text-amber-800'
    : 'bg-amber-500/15 border-amber-500/30 text-amber-300';
  const offTone = isLight
    ? 'bg-white border-[#e2e8ee] text-[#374152]/65 hover:border-[#cbd2db]'
    : 'bg-[#131a22] border-white/10 text-[#d2d7e0]/55 hover:border-white/20';

  return (
    <button
      type="button"
      onClick={() => setUseMockCalendar(!useMockCalendar)}
      title={
        useMockCalendar
          ? 'Showing built-in demo visits — click to switch to live data'
          : 'Showing live data — click to preview demo visits'
      }
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-colors ${
        useMockCalendar ? onTone : offTone
      }`}
    >
      <Beaker size={11} />
      <span>Demo data</span>
      <span
        className={`inline-block w-7 h-3.5 rounded-full relative transition-colors ${
          useMockCalendar
            ? isLight ? 'bg-amber-500' : 'bg-amber-400'
            : isLight ? 'bg-[#cbd2db]' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${
            useMockCalendar ? 'left-4' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

export function MockCalendarBanner() {
  const { theme } = useTheme();
  const { useMockCalendar } = useSiteData();
  const isLight = theme === 'light';

  if (!useMockCalendar) return null;

  return (
    <div
      className={`px-4 py-2 text-[11px] flex items-center gap-2 border ${
        isLight
          ? 'bg-amber-50 border-amber-200 text-amber-800'
          : 'bg-amber-500/[0.06] border-amber-500/20 text-amber-300'
      }`}
    >
      <Beaker size={11} className="flex-shrink-0" />
      <span>
        <span className="font-semibold">Demo data</span> — switch off to see live visits from the database.
      </span>
    </div>
  );
}
