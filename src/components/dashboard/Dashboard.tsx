import { useState } from 'react';
import { MessageSquare, LayoutDashboard, Activity, FileText, Settings, Database } from 'lucide-react';
import DashboardChat from './DashboardChat';
import KnowledgeBase from './KnowledgeBase';
import { useTheme } from '../../context/ThemeContext';
import type { ChatMessage, RagStatus } from '../../lib/supabase';

type ExtendedMessage = ChatMessage & { streaming?: boolean; ragStatus?: RagStatus; ragError?: string };

type Tab = 'overview' | 'chat' | 'knowledge' | 'workflows' | 'reports' | 'settings';

interface TabConfig {
  id: Tab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const TABS: TabConfig[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'knowledge', label: 'Knowledge Base', icon: Database },
  { id: 'workflows', label: 'Workflows', icon: Activity },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const STAT_CARDS = [
  { label: 'Active Protocols', value: '24', change: '+3 this week', positive: true },
  { label: 'Avg. Resolution Time', value: '4.2h', change: '-12% vs last month', positive: true },
  { label: 'Compliance Score', value: '98.4%', change: '+0.6% this month', positive: true },
  { label: 'Staff Trained', value: '187', change: '12 pending', positive: false },
];

const RECENT_PROTOCOLS = [
  { name: 'Sepsis Early Detection', status: 'Active', updated: '2h ago', category: 'Critical Care' },
  { name: 'Fall Prevention Bundle', status: 'Active', updated: '1d ago', category: 'Patient Safety' },
  { name: 'Medication Reconciliation', status: 'Review', updated: '3d ago', category: 'Pharmacy' },
  { name: 'Hand Hygiene Compliance', status: 'Active', updated: '4d ago', category: 'Infection Control' },
  { name: 'Chest Pain Triage', status: 'Active', updated: '1w ago', category: 'Emergency' },
];

function OverviewTab() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const cardBg = isLight ? 'bg-white border-[#e2e8e2]' : 'bg-[#131a14] border-white/5';
  const headingColor = isLight ? 'text-[#1a1f1a]' : 'text-white';
  const subColor = isLight ? 'text-[#374137]/40' : 'text-[#d2d7d2]/40';
  const statVal = isLight ? 'text-[#1a1f1a]' : 'text-white';
  const rowHover = isLight ? 'hover:bg-[#f5f7f5]' : 'hover:bg-white/[0.02]';
  const rowDivide = isLight ? 'divide-[#f0f4f0]' : 'divide-white/[0.03]';
  const protocolName = isLight ? 'text-[#1a1f1a]/90' : 'text-[#d2d7d2]/90';
  const protocolCat = isLight ? 'text-[#374137]/30' : 'text-[#d2d7d2]/30';
  const lastUpdated = isLight ? 'text-[#374137]/25' : 'text-[#d2d7d2]/25';
  const tableHeader = isLight ? 'text-[#374137]/25' : 'text-[#d2d7d2]/25';
  const tableBorder = isLight ? 'border-[#f0f4f0]' : 'border-white/5';

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div>
        <h2 className={`${headingColor} font-semibold text-lg mb-1`}>Dashboard Overview</h2>
        <p className={`${subColor} text-sm`}>Clinical workflow performance at a glance</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map((card, i) => (
          <div key={i} className={`${cardBg} border rounded-xl p-4`}>
            <p className={`${subColor} text-xs mb-2`}>{card.label}</p>
            <p className={`${statVal} font-bold text-2xl mb-1`}>{card.value}</p>
            <p className={`text-xs ${card.positive ? 'text-emerald-500' : 'text-amber-500'}`}>
              {card.change}
            </p>
          </div>
        ))}
      </div>

      <div className={`${cardBg} border rounded-xl overflow-hidden`}>
        <div className={`px-5 py-4 border-b ${tableBorder} flex items-center justify-between`}>
          <h3 className={`${headingColor} font-medium text-sm`}>Recent Protocols</h3>
          <span className={`text-xs ${tableHeader}`}>Last updated</span>
        </div>
        <div className={`divide-y ${rowDivide}`}>
          {RECENT_PROTOCOLS.map((p, i) => (
            <div key={i} className={`px-5 py-3.5 flex items-center justify-between ${rowHover} transition-colors`}>
              <div className="flex items-center gap-3">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  p.status === 'Active' ? 'bg-emerald-400' : 'bg-amber-400'
                }`} />
                <div>
                  <p className={`${protocolName} text-sm font-medium`}>{p.name}</p>
                  <p className={`${protocolCat} text-xs mt-0.5`}>{p.category}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-4">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  p.status === 'Active'
                    ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
                    : 'text-amber-500 bg-amber-500/10 border-amber-500/20'
                }`}>
                  {p.status}
                </span>
                <p className={`${lastUpdated} text-xs mt-1`}>{p.updated}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlaceholderTab({ label }: { label: string }) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-6">
      <div className={`w-12 h-12 rounded-2xl ${isLight ? 'bg-[#1a1f1a]/[0.03] border border-[#e2e8e2]' : 'bg-white/[0.03] border border-white/5'} flex items-center justify-center mb-4`}>
        <FileText size={20} className={isLight ? 'text-[#374137]/25' : 'text-[#d2d7d2]/25'} />
      </div>
      <h3 className={`${isLight ? 'text-[#374137]/50' : 'text-[#d2d7d2]/50'} font-medium text-sm mb-1`}>{label}</h3>
      <p className={`${isLight ? 'text-[#374137]/20' : 'text-[#d2d7d2]/20'} text-xs max-w-xs`}>This section is coming soon.</p>
    </div>
  );
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [chatMessages, setChatMessages] = useState<ExtendedMessage[]>([]);
  const [chatSelectedDocIds, setChatSelectedDocIds] = useState<string[]>([]);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const pageBg = isLight ? 'bg-[#f5f7f5]' : 'bg-[#0d110e]';
  const tabBarBg = isLight ? 'border-[#e2e8e2] bg-[#f5f7f5]/80' : 'border-white/5 bg-[#0d110e]/80';
  const activeTabClass = isLight
    ? 'text-[#1a1f1a] bg-white border border-[#e2e8e2]'
    : 'text-white bg-white/[0.06] border border-white/10';
  const inactiveTabClass = isLight
    ? 'text-[#374137]/40 hover:text-[#374137]/70 hover:bg-[#1a1f1a]/[0.03]'
    : 'text-[#d2d7d2]/40 hover:text-[#d2d7d2]/70 hover:bg-white/[0.03]';
  const panelBg = isLight ? 'bg-white border-[#e2e8e2]' : 'bg-[#131a14] border-white/5';

  const renderContent = () => {
    switch (activeTab) {
      case 'overview': return <OverviewTab />;
      case 'chat': return (
        <DashboardChat
          messages={chatMessages}
          setMessages={setChatMessages}
          selectedDocIds={chatSelectedDocIds}
          setSelectedDocIds={setChatSelectedDocIds}
        />
      );
      case 'knowledge': return <KnowledgeBase />;
      case 'workflows': return <PlaceholderTab label="Workflows" />;
      case 'reports': return <PlaceholderTab label="Reports" />;
      case 'settings': return <PlaceholderTab label="Settings" />;
    }
  };

  return (
    <div className={`h-screen ${pageBg} pt-16 flex flex-col overflow-hidden`}>
      <div className={`flex-shrink-0 border-b ${tabBarBg} backdrop-blur-sm`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-150 whitespace-nowrap ${
                    isActive ? activeTabClass : inactiveTabClass
                  }`}
                >
                  <Icon size={15} className={isActive ? 'text-[#6e966f]' : ''} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col" style={{ minHeight: 0 }}>
        <div className={`flex-1 ${panelBg} border rounded-2xl overflow-hidden flex flex-col`} style={{ minHeight: 0 }}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
