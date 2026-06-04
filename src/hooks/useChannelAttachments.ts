import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listChannelAttachments } from '../lib/orgs/orgsApi';
import {
  adaptChatAttachment,
  type ChatAttachmentRow,
} from '../lib/orgs/chatAttachmentsAdapter';
import type { ChatAttachment } from '../types/orgs';

// =============================================================================
// useChannelAttachments — fetches every chat_attachments row for the active
// channel and keeps the list live via a realtime subscription. Lives here
// (src/hooks) per the "realtime in context/hook layer, not components" rule.
//
// Returns:
//   {
//     attachments: ChatAttachment[],
//     byMessageId: Map<messageId, ChatAttachment[]>,
//     loading: boolean,
//     addLocal: (a) => void,    // optimistic-append helper for uploadChatAttachment
//     removeLocal: (id) => void // optimistic-remove helper for deleteChatAttachment
//   }
// =============================================================================

interface UseChannelAttachmentsParams {
  kind: 'org' | 'protocol';
  channelId: string | null;
}

export interface UseChannelAttachmentsResult {
  attachments: ChatAttachment[];
  byMessageId: Map<string, ChatAttachment[]>;
  loading: boolean;
  addLocal: (attachment: ChatAttachment) => void;
  removeLocal: (id: string) => void;
}

export function useChannelAttachments({
  kind,
  channelId,
}: UseChannelAttachmentsParams): UseChannelAttachmentsResult {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!channelId) {
      setAttachments([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listChannelAttachments(kind, channelId).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setAttachments(res.data);
    });

    const filterField = kind === 'org' ? 'org_id' : 'protocol_id';
    const ch = supabase
      .channel(`chat_attachments:${kind}:${channelId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_attachments',
          filter: `${filterField}=eq.${channelId}`,
        },
        (payload) => {
          const a = adaptChatAttachment(payload.new as ChatAttachmentRow);
          setAttachments((prev) => {
            if (prev.some((x) => x.id === a.id)) return prev;
            return [...prev, a];
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'chat_attachments',
          filter: `${filterField}=eq.${channelId}`,
        },
        (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (!id) return;
          setAttachments((prev) => prev.filter((x) => x.id !== id));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [kind, channelId]);

  const byMessageId = useMemo(() => {
    const m = new Map<string, ChatAttachment[]>();
    for (const a of attachments) {
      const key = a.org_message_id ?? a.protocol_message_id;
      if (!key) continue;
      const arr = m.get(key);
      if (arr) arr.push(a);
      else m.set(key, [a]);
    }
    return m;
  }, [attachments]);

  return {
    attachments,
    byMessageId,
    loading,
    addLocal: (a) =>
      setAttachments((prev) => (prev.some((x) => x.id === a.id) ? prev : [...prev, a])),
    removeLocal: (id) => setAttachments((prev) => prev.filter((x) => x.id !== id)),
  };
}
