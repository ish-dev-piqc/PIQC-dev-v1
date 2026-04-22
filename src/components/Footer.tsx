import { Activity } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export default function Footer() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const bg = isLight ? 'bg-[#f5f7fa] border-[#e2e8ee]' : 'bg-[#0d1118] border-white/[0.06]';
  const logoText = isLight ? 'text-[#1a1f28]' : 'text-white';
  const linkColor = isLight ? 'text-[#374152]/50 hover:text-[#1a1f28] hover:bg-[#1a1f28]/[0.05]' : 'text-[#d2d7e0]/50 hover:text-white hover:bg-white/[0.06]';
  const divider = isLight ? 'border-[#e2e8ee]' : 'border-white/[0.05]';
  const footerMeta = isLight ? 'text-[#374152]/25' : 'text-[#d2d7e0]/25';

  return (
    <footer className={`${bg} border-t`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <a href="#" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-lg bg-[#4a6fa5] flex items-center justify-center shadow-btn group-hover:bg-[#5b82b8] transition-colors">
              <Activity className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
            </div>
            <span className={`text-sm font-semibold ${logoText} tracking-tight`}>
              PIQ<span className="text-[#6e8fb5]">Clinical</span>
            </span>
          </a>

          <nav className="flex items-center gap-1">
            {[{ label: 'How It Works', href: '#what-it-does' }, { label: 'Contact', href: '#contact' }].map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`px-3 py-1.5 text-sm font-medium ${linkColor} rounded-lg transition-colors`}
              >
                {item.label}
              </a>
            ))}
            <a
              href="#contact"
              className="ml-1 px-3.5 py-1.5 text-sm font-semibold text-white bg-[#4a6fa5] rounded-lg hover:bg-[#5b82b8] transition-colors shadow-btn"
            >
              Get Started
            </a>
          </nav>
        </div>

        <div className={`mt-8 pt-6 border-t ${divider} flex flex-col sm:flex-row items-center justify-between gap-2 text-xs ${footerMeta}`}>
          <span>&copy; {new Date().getFullYear()} PIQClinical. All rights reserved.</span>
          <span>AI-Powered Clinical Intelligence Platform</span>
        </div>
      </div>
    </footer>
  );
}
