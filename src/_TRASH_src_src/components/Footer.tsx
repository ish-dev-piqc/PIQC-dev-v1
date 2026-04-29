import { Activity } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export default function Footer() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const bg = isLight ? 'bg-[#f5f7f5] border-[#e2e8e2]' : 'bg-[#0d110e] border-white/[0.06]';
  const logoText = isLight ? 'text-[#1a1f1a]' : 'text-white';
  const linkColor = isLight ? 'text-[#374137]/50 hover:text-[#1a1f1a] hover:bg-[#1a1f1a]/[0.05]' : 'text-[#d2d7d2]/50 hover:text-white hover:bg-white/[0.06]';
  const divider = isLight ? 'border-[#e2e8e2]' : 'border-white/[0.05]';
  const footerMeta = isLight ? 'text-[#374137]/25' : 'text-[#d2d7d2]/25';

  return (
    <footer className={`${bg} border-t`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <a href="#" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-lg bg-[#487e4a] flex items-center justify-center shadow-btn group-hover:bg-[#5a9a5c] transition-colors">
              <Activity className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
            </div>
            <span className={`text-sm font-semibold ${logoText} tracking-tight`}>
              PIQ<span className="text-[#6e966f]">Clinical</span>
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
              className="ml-1 px-3.5 py-1.5 text-sm font-semibold text-white bg-[#487e4a] rounded-lg hover:bg-[#5a9a5c] transition-colors shadow-btn"
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
