import { useState } from 'react';
import { Mail, Building, ArrowRight, CheckCircle } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { sendContactMessage } from '../lib/contact/contactApi';

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', company: '', message: '', website: '' });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await sendContactMessage({
      name: form.name.trim(),
      email: form.email.trim(),
      company: form.company.trim(),
      message: form.message.trim(),
      website: form.website,
    });

    setLoading(false);

    if (!result.ok) {
      setError("Couldn't send your message. Please try again, or email contact@piqclinical.com directly.");
      return;
    }

    setSubmitted(true);
  };

  const bg = isLight ? 'bg-[#F8FAFC]' : 'bg-[#020617]';
  const headingColor = 'text-fg-heading';
  const bodyColor = 'text-fg-sub';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/[0.07]';
  const iconCardBg = isLight ? 'bg-[#F2F2F2] border-[#E2E8F0]' : 'bg-[#0F172A] border-white/[0.07]';
  const inputBg = isLight ? 'bg-[#F8FAFC] border-[#E2E8F0] text-[#0F172A] placeholder-[#334155]/30' : 'bg-[#020617] border-white/[0.1] text-white placeholder-[#334155]';
  const labelColor = isLight ? 'text-[#334155]/60' : 'text-[#CBD5E1]/50';
  const contactTextColor = isLight ? 'text-[#334155]/80 hover:text-[#0F172A]' : 'text-[#CBD5E1]/80 hover:text-[#74B4DC]';
  const contactSubColor = isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/40';

  return (
    <section id="contact" className={`py-20 px-4 sm:px-6 lg:px-8 ${bg}`}>
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <div className="lg:pt-2">
            <h2 className={`text-3xl sm:text-4xl font-bold ${headingColor} leading-tight mb-4`}>
              Transform How Your Team Runs Trials
            </h2>
            <p className={`text-[15px] ${bodyColor} leading-relaxed mb-8`}>
              Tell us about your trials and we'll show you what guided execution looks like on your actual protocol.
            </p>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl ${iconCardBg} border flex items-center justify-center flex-shrink-0`}>
                  <Mail className="w-4 h-4 text-[#74B4DC]" strokeWidth={1.75} />
                </div>
                <div>
                  <p className={`text-xs ${contactSubColor} font-medium mb-0.5`}>Email us</p>
                  <a
                    href="mailto:contact@piqclinical.com"
                    className={`text-sm font-medium ${contactTextColor} transition-colors`}
                  >
                    contact@piqclinical.com
                  </a>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl ${iconCardBg} border flex items-center justify-center flex-shrink-0`}>
                  <Building className="w-4 h-4 text-[#74B4DC]" strokeWidth={1.75} />
                </div>
                <div>
                  <p className={`text-xs ${contactSubColor} font-medium mb-0.5`}>Enterprise Solutions</p>
                  <p className={`text-sm font-medium ${isLight ? 'text-[#334155]/80' : 'text-[#CBD5E1]/80'}`}>Custom pricing for organizations</p>
                </div>
              </div>
            </div>
          </div>

          <div className={`relative rounded-2xl ${cardBg} border p-7 overflow-hidden`}>
            <div
              className="absolute inset-0 pointer-events-none rounded-2xl"
              style={{
                background: 'radial-gradient(ellipse 80% 40% at 50% -5%, rgba(74,111,165,0.08) 0%, transparent 60%)',
              }}
            />

            {submitted ? (
              <div className="relative z-10 py-12 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-full bg-[#017BC8]/15 border border-[#017BC8]/25 flex items-center justify-center mb-4">
                  <CheckCircle className="w-7 h-7 text-[#74B4DC]" strokeWidth={1.75} />
                </div>
                <h3 className={`text-xl font-bold ${headingColor} mb-2`}>Message sent!</h3>
                <p className={`text-[14px] ${bodyColor} max-w-xs leading-relaxed`}>
                  Thanks for reaching out. Our team will be in touch within one business day.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="relative z-10 space-y-4">
                {/* Honeypot — hidden from real users; bots fill every field. */}
                <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: '1px', height: '1px', overflow: 'hidden' }}>
                  <label htmlFor="website">Website</label>
                  <input
                    id="website"
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={form.website}
                    onChange={handleChange}
                  />
                </div>

                <div>
                  <label className={`block text-xs font-medium ${labelColor} mb-1.5`} htmlFor="name">
                    Name
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    value={form.name}
                    onChange={handleChange}
                    placeholder="Your name"
                    className={`w-full px-4 py-2.5 text-sm ${inputBg} border rounded-xl outline-none focus:border-[#017BC8]/50 focus:ring-1 focus:ring-[#017BC8]/30 transition-all`}
                  />
                </div>

                <div>
                  <label className={`block text-xs font-medium ${labelColor} mb-1.5`} htmlFor="email">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    value={form.email}
                    onChange={handleChange}
                    placeholder="your@email.com"
                    className={`w-full px-4 py-2.5 text-sm ${inputBg} border rounded-xl outline-none focus:border-[#017BC8]/50 focus:ring-1 focus:ring-[#017BC8]/30 transition-all`}
                  />
                </div>

                <div>
                  <label className={`block text-xs font-medium ${labelColor} mb-1.5`} htmlFor="company">
                    Company
                  </label>
                  <input
                    id="company"
                    name="company"
                    type="text"
                    value={form.company}
                    onChange={handleChange}
                    placeholder="Your company"
                    className={`w-full px-4 py-2.5 text-sm ${inputBg} border rounded-xl outline-none focus:border-[#017BC8]/50 focus:ring-1 focus:ring-[#017BC8]/30 transition-all`}
                  />
                </div>

                <div>
                  <label className={`block text-xs font-medium ${labelColor} mb-1.5`} htmlFor="message">
                    Message
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={4}
                    required
                    value={form.message}
                    onChange={handleChange}
                    placeholder="Tell us about your needs..."
                    className={`w-full px-4 py-2.5 text-sm ${inputBg} border rounded-xl outline-none focus:border-[#017BC8]/50 focus:ring-1 focus:ring-[#017BC8]/30 transition-all resize-none`}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#017BC8] rounded-xl hover:bg-[#1595D1] disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200 shadow-btn hover:shadow-btn-hover group mt-2"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                      </svg>
                      Sending...
                    </span>
                  ) : (
                    <>
                      Send Message
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </>
                  )}
                </button>

                {error && (
                  <p className="text-xs text-red-400 text-center">{error}</p>
                )}
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
