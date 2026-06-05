import { createContext, useContext } from 'react';

// =============================================================================
// ChatNavigationContext — App-level handlers for "open this visit/participant
// in Site Mode" actions triggered from chat reference chips.
//
// Implementation lives in App.tsx (write pending-id to localStorage +
// switch the active dashboard tab). The destination tabs (VisitsTab,
// ParticipantsTab) read those keys on mount to open their drawers.
//
// Default no-op so consumers don't crash if the provider isn't mounted
// (e.g., outside the dashboard tree).
// =============================================================================

interface ChatNavigationContextValue {
  navigateToVisit: (visitId: string) => void;
  navigateToParticipant: (participantCode: string) => void;
}

const ChatNavigationContext = createContext<ChatNavigationContextValue>({
  navigateToVisit: () => {},
  navigateToParticipant: () => {},
});

export function ChatNavigationProvider({
  value,
  children,
}: {
  value: ChatNavigationContextValue;
  children: React.ReactNode;
}) {
  return (
    <ChatNavigationContext.Provider value={value}>
      {children}
    </ChatNavigationContext.Provider>
  );
}

export function useChatNavigation(): ChatNavigationContextValue {
  return useContext(ChatNavigationContext);
}
