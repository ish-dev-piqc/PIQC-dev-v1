import { useState } from 'react';
import { Mail, Building, ArrowRight, CheckCircle } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', company: '', message: '' });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise((r) => setTimeout(r, 900));
    setLoading(false);
    setSubmitted(true);
  };

  const bg = isLight ? 'bg-[#f5f7f5]' : 'bg-[#0d110e]';
  const headingColor = isLight ? 'text-[#1a1f1a]' : 'text-white';
  const bodyColor = isLight ? 'text-[#374137]/50' : 'text-[#d2d7d2]/50';
  const cardBg = isLight ? 'bg-white border-[#e2e8e2]' : 'bg-[#161d17] border-white/[0.07]';
  const iconCardBg = isLight ? 'bg-[#f0f4f0] border-[#e2e8e2]' : 'bg-[#161d17] border-white/[0.07]';
  const inputBg = isLight ? 'bg-[#f5f7f5] border-[#d8e0d8] text-[#1a1f1a] placeholder-[#374137]/30' : 'bg-[#0d110e] border-white/[0.1] text-white placeholder-[#3c3c3c]';
  const labelColor = isLight ? 'text-[#374137]/60' : 'text-[#d2d7d2]/50';
  const contactTextColor = isLight ? 'text-[#374137]/80 hover:text-[#1a1f1a]' : 'text-[#d2d7d2]/80 hover:text-[#6e966f]';
  const contactSubColor = isLight ? 'text-[#374137]/40' : 'text-[#d2d7d2]/40';

  return (
    <section id="contact" className={`py-20 px-4 sm:px-6 lg:px-8 ${bg}`}>
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <div className="lg:pt-2">
            <h2 className={`text-3xl sm:text-4xl font-bold ${headingColor} leading-tight mb-4`}>
              Ready to Transform Your Trials?
            </h2>
            <p className={`text-[15px] ${bodyColor} leading-relaxed mb-8`}>
              Join leading clinical trial organizations in leveraging AI to achieve operational
              excellence. Let's discuss how PIQClinical can streamline your protocol management.
            </p>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl ${iconCardBg} border flex items-center justify-center flex-shrink-0`}>
                  <Mail className="w-4 h-4 text-[#6e966f]" strokeWidth={1.75} />
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
                  <Building className="w-4 h-4 text-[#6e966f]" strokeWidth={1.75} />
                </div>
                <div>
                  <p className={`text-xs ${contactSubColor} font-medium mb-0.5`}>Enterprise Solutions</p>
                  <p className={`text-sm font-medium ${isLight ? 'text-[#374137]/80' : 'text-[#d2d7d2]/80'}`}>Custom pricing for organizations</p>
                </div>
              </div>
            </div>
          </div>

          <div className={`relative rounded-2xl ${cardBg} border p-7 overflow-hidden`}>
            <div
              className="absolute inset-0 pointer-events-none rounded-2xl"
              style={{
                background: 'radial-gradient(ellipse 80% 40% at 50% -5%, rgba(72,126,74,0.08) 0%, transparent 60%)',
              }}
            />

            {submitted ? (
              <div className="relative z-10 py-12 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-full bg-[#487e4a]/15 border border-[#487e4a]/25 flex items-center justify-center mb-4">
                  <CheckCircle className="w-7 h-7 text-[#6e966f]" strokeWidth={1.75} />
                </div>
                <h3 className={`text-xl font-bold ${headingColor} mb-2`}>Message sent!</h3>
                <p className={`text-[14px] ${bodyColor} max-w-xs leading-relaxed`}>
                  Thanks for reaching out. Our team will be in touch within one business day.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="relative z-10 space-y-4">
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
                    className={`w-full px-4 py-2.5 text-sm ${inputBg} border rounded-xl outline-none focus:border-[#487e4a]/50 focus:ring-1 focus:ring-[#487e4a]/30 transition-all`}
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
                    className={`w-full px-4 py-2.5 text-sm ${inputBg} border rounded-xl outline-none focus:border-[#487e4a]/50 focus:ring-1 focus:ring-[#487e4a]/30 transition-all`}
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
                    className={`w-full px-4 py-2.5 text-sm ${inputBg} border rounded-xl outline-none focus:border-[#487e4a]/50 focus:ring-1 focus:ring-[#487e4a]/30 transition-all`}
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
                    className={`w-full px-4 py-2.5 text-sm ${inputBg} border rounded-xl outline-none focus:border-[#487e4a]/50 focus:ring-1 focus:ring-[#487e4a]/30 transition-all resize-none`}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#487e4a] rounded-xl hover:bg-[#5a9a5c] disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200 shadow-btn hover:shadow-btn-hover group mt-2"
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
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
