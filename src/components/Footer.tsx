import { useTheme } from '../context/ThemeContext';
import type { AppView } from '../App';

interface FooterProps {
  onViewChange: (view: AppView) => void;
}

export default function Footer({ onViewChange }: FooterProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const bg = isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#020617] border-white/[0.06]';
  const logoText = 'text-fg-heading';
  const linkColor = isLight ? 'text-[#334155]/50 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/50 hover:text-white hover:bg-white/[0.06]';
  const divider = isLight ? 'border-[#E2E8F0]' : 'border-white/[0.05]';
  const footerMeta = isLight ? 'text-[#334155]/25' : 'text-[#CBD5E1]/25';

  return (
    <footer className={`${bg} border-t`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <a href="#" className="flex items-center gap-2.5 group">
            <img
              src="/PIQC_Logo.png"
              alt=""
              className="w-7 h-7 object-contain group-hover:scale-105 transition-transform"
            />
            <span className={`text-sm font-semibold ${logoText} tracking-tight`}>
              <span className="text-[#017BC8]">PIQC</span>linical
            </span>
          </a>

          <nav className="flex items-center gap-1">
            {[{ label: 'How It Works', href: '#what-it-does' }, { label: 'Pricing', href: '#pricing' }, { label: 'FAQ', href: '#faq' }, { label: 'Contact', href: '#contact' }].map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`px-3 py-1.5 text-sm font-medium ${linkColor} rounded-lg transition-colors`}
              >
                {item.label}
              </a>
            ))}
            <button
              onClick={() => onViewChange('login')}
              className="ml-1 px-3.5 py-1.5 text-sm font-semibold text-white bg-[#017BC8] rounded-lg hover:bg-[#1595D1] transition-colors shadow-btn"
            >
              Get Started
            </button>
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
