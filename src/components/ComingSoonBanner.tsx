import { useTheme } from '../context/ThemeContext';

export default function ComingSoonBanner() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const bg = isLight
    ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/25'
    : 'bg-[#4a6fa5]/15 border-[#4a6fa5]/30';
  const dot = isLight ? 'bg-[#4a6fa5]' : 'bg-[#6e8fb5]';

  return (
    <div className={`fixed top-0 left-0 right-0 z-[60] border-b backdrop-blur-md ${bg}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-9 flex items-center justify-center gap-2.5 text-fg-heading">
        <span className={`w-1.5 h-1.5 rounded-full ${dot} animate-pulse`} />
        <span className="text-[12px] font-medium tracking-tight">
          PIQClinical is launching soon — chat with our assistant to learn more
        </span>
      </div>
    </div>
  );
}
