import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageCircle,
  Send,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Paperclip,
  File as FileIcon,
  X as XIcon,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { useOrg } from '../../../context/OrgContext';
import { useOrgChat } from '../../../context/OrgChatContext';
import { useProtocolChat } from '../../../context/ProtocolChatContext';
import {
  listMyChatProtocols,
  listOrgMembersWithProfile,
  uploadChatAttachment,
} from '../../../lib/orgs/orgsApi';
import { useChannelAttachments } from '../../../hooks/useChannelAttachments';
import AttachmentRender from './chat/AttachmentRender';
// Reuse the shared protocol palette so the dot here matches the one shown
// on visit chips, calendar accents, and the protocol picker. lib/site is
// the canonical home for this palette; the import is allowed because
// organization/ isn't in the mode-isolation scanned domains.
import { getProtocolColors } from '../../../lib/site/protocolColors';
import { useChatUnread, type ChatChannelKey } from '../../../hooks/useChatUnread';
import { useChatDecisions } from '../../../hooks/useChatDecisions';
import DecisionPromoteModal from './chat/DecisionPromoteModal';
import DecisionList from './chat/DecisionList';
import type {
  ChatProtocolSummary,
  OrgMemberWithProfile,
} from '../../../types/orgs';

// =============================================================================
// ChatTab — Slack-style chat surface with #general at the top of the sidebar
// and one channel per protocol the user can chat in below it.
//
// Channels:
//   - #general (org-wide) — OrgChatContext (already in use; unchanged in PR 4a)
//   - #{protocolCode} — ProtocolChatContext, one active protocol channel at
//     a time. Switching channels swaps the realtime subscription via
//     ProtocolChatContext.setActiveProtocolId.
//
// Sidebar:
//   - Wide (default ~220px) or collapsed (icon-only ~48px). Toggle persists.
//   - Active channel highlighted. Tooltips on collapsed rows show the label.
//
// Author display + composer + auto-scroll behavior are shared across both
// channel types — the message shape is structurally compatible.
//
// Persisted state:
//   - `piq-chat-channel-v1` → 'general' | <protocol_id>
//   - `piq-chat-sidebar-wide-v1` → 'true' | 'false'
// =============================================================================

const MAX_MESSAGE_LENGTH = 10000;
const SCROLL_BOTTOM_THRESHOLD_PX = 80;
const MENTION_PICKER_MAX_RESULTS = 8;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const CHANNEL_STORAGE_KEY = 'piq-chat-channel-v1';
const SIDEBAR_WIDE_STORAGE_KEY = 'piq-chat-sidebar-wide-v1';

// Matches a `<@<uuid>>` mention token embedded in a message body.
const MENTION_TOKEN_REGEX =
  /<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;

/**
 * Look backwards from cursorPos for an `@` that starts a mention. Returns
 * the position of the `@` and the filter typed since (no whitespace in v1).
 * Returns null if the cursor isn't inside a mention-eligible word.
 */
function detectMentionAtCursor(
  text: string,
  cursorPos: number,
): { start: number; filter: string } | null {
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '@') {
      // @ must be at start of text or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1])) {
        return { start: i, filter: text.slice(i + 1, cursorPos) };
      }
      return null;
    }
    // Any whitespace before @ means we're past the mention
    if (/\s/.test(ch)) return null;
  }
  return null;
}

type ActiveChannel =
  | { kind: 'org' }
  | { kind: 'protocol'; id: string };

interface ChatMessageLike {
  id: string;
  author_user_id: string | null;
  body: string;
  created_at: string;
}

function readStoredChannel(): ActiveChannel | null {
  try {
    const v = localStorage.getItem(CHANNEL_STORAGE_KEY);
    if (!v) return null;
    if (v === 'general') return { kind: 'org' };
    // Treat anything else as a protocol id; we'll validate against the
    // chat-protocols list once it loads and fall back to org if it's gone.
    return { kind: 'protocol', id: v };
  } catch {
    return null;
  }
}

function readStoredSidebarWide(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_WIDE_STORAGE_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* ignore */
  }
  return true;
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const isToday = date.toDateString() === new Date().toDateString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (isToday) return `Today at ${time}`;
  if (isYesterday) return `Yesterday at ${time}`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ChatTab() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { session } = useAuth();
  const currentUserId = session?.user?.id ?? null;
  const { activeOrg } = useOrg();
  const orgChat = useOrgChat();
  const protocolChat = useProtocolChat();

  // --- Channel discovery -----------------------------------------------------
  const [chatProtocols, setChatProtocols] = useState<ChatProtocolSummary[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);

  useEffect(() => {
    if (!activeOrg) {
      setChatProtocols([]);
      setChannelsLoading(false);
      return;
    }
    let cancelled = false;
    setChannelsLoading(true);
    listMyChatProtocols(activeOrg.id).then((res) => {
      if (cancelled) return;
      setChannelsLoading(false);
      if (res.ok) setChatProtocols(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [activeOrg]);

  // --- Active channel + sidebar state ---------------------------------------
  const [activeChannel, setActiveChannel] = useState<ActiveChannel>(
    () => readStoredChannel() ?? { kind: 'org' },
  );
  const [sidebarWide, setSidebarWide] = useState<boolean>(() => readStoredSidebarWide());

  // Sync ProtocolChatContext when active channel is a protocol; idle it for org.
  useEffect(() => {
    if (activeChannel.kind === 'protocol') {
      protocolChat.setActiveProtocolId(activeChannel.id);
    } else {
      protocolChat.setActiveProtocolId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel]);

  // Channel key form used by the unread hook.
  const activeChannelKey: ChatChannelKey =
    activeChannel.kind === 'org' ? 'org' : `protocol:${activeChannel.id}`;

  const protocolIds = useMemo(
    () => chatProtocols.map((p) => p.id),
    [chatProtocols],
  );

  const {
    counts: unreadCounts,
    mentionCounts,
    markAsRead,
    unreadCap,
  } = useChatUnread({
    orgId: activeOrg?.id ?? null,
    protocolIds,
    activeChannelKey,
    currentUserId,
  });

  // --- Decisions for the active channel -------------------------------------
  const [decisionsPanelOpen, setDecisionsPanelOpen] = useState(false);
  const [promoteSource, setPromoteSource] = useState<
    { id: string; body: string; authorUserId: string | null; createdAt: string } | null
  >(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);

  const isOrgAdmin = activeOrg?.my_role === 'admin';
  const channelKind: 'org' | 'protocol' =
    activeChannel.kind === 'org' ? 'org' : 'protocol';
  const channelRefId: string | null =
    activeChannel.kind === 'org'
      ? activeOrg?.id ?? null
      : activeChannel.kind === 'protocol'
        ? activeChannel.id
        : null;

  const {
    decisions,
    acksByDecisionId,
    loading: decisionsLoading,
    add: addDecisionLocal,
    remove: removeDecisionLocal,
    upsertAck: upsertAckLocal,
  } = useChatDecisions({ kind: channelKind, channelId: channelRefId });

  // --- Attachments ----------------------------------------------------------
  const {
    byMessageId: attachmentsByMessageId,
    addLocal: addAttachmentLocal,
    removeLocal: removeAttachmentLocal,
  } = useChannelAttachments({ kind: channelKind, channelId: channelRefId });

  // Files queued in the composer, waiting to be uploaded when the user sends.
  const [pendingFiles, setPendingFiles] = useState<
    { id: string; file: File; error?: string }[]
  >([]);
  const [draggingOver, setDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addPendingFiles(files: FileList | File[]) {
    const arr: { id: string; file: File; error?: string }[] = [];
    for (const f of Array.from(files)) {
      const error =
        f.size > MAX_ATTACHMENT_BYTES
          ? `Too large (${(f.size / 1024 / 1024).toFixed(1)} MB > 10 MB)`
          : undefined;
      arr.push({ id: crypto.randomUUID(), file: f, error });
    }
    if (arr.length === 0) return;
    setPendingFiles((prev) => [...prev, ...arr]);
  }

  function removePendingFile(id: string) {
    setPendingFiles((prev) => prev.filter((p) => p.id !== id));
  }

  function handleFilePickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      addPendingFiles(e.target.files);
      // Reset the input so the same file can be picked again later.
      e.target.value = '';
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!e.clipboardData?.files || e.clipboardData.files.length === 0) return;
    e.preventDefault();
    addPendingFiles(e.clipboardData.files);
  }

  function handleSectionDragOver(e: React.DragEvent) {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      setDraggingOver(true);
    }
  }
  function handleSectionDragLeave(e: React.DragEvent) {
    if (e.currentTarget === e.target) setDraggingOver(false);
  }
  function handleSectionDrop(e: React.DragEvent) {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      setDraggingOver(false);
      addPendingFiles(e.dataTransfer.files);
    }
  }

  const decisionsBySourceId = useMemo(() => {
    const m = new Map<string, typeof decisions[number]>();
    for (const d of decisions) {
      const src = d.source_org_message_id ?? d.source_protocol_message_id;
      if (src) m.set(src, d);
    }
    return m;
  }, [decisions]);

  function jumpToSourceMessage(sourceMessageId: string) {
    setDecisionsPanelOpen(false);
    setHighlightMessageId(sourceMessageId);
    requestAnimationFrame(() => {
      const el = document.getElementById(`chat-msg-${sourceMessageId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    setTimeout(() => setHighlightMessageId(null), 2000);
  }

  // Persist channel + sidebar state.
  useEffect(() => {
    try {
      const v = activeChannel.kind === 'org' ? 'general' : activeChannel.id;
      localStorage.setItem(CHANNEL_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }, [activeChannel]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDE_STORAGE_KEY, sidebarWide ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, [sidebarWide]);

  // If the persisted protocol channel no longer exists (user lost access),
  // fall back to #general so we don't render an empty broken view.
  useEffect(() => {
    if (channelsLoading) return;
    if (activeChannel.kind !== 'protocol') return;
    if (!chatProtocols.some((p) => p.id === activeChannel.id)) {
      setActiveChannel({ kind: 'org' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelsLoading, chatProtocols]);

  // --- Author lookup ---------------------------------------------------------
  const [profiles, setProfiles] = useState<Map<string, OrgMemberWithProfile>>(new Map());

  useEffect(() => {
    if (!activeOrg) return;
    let cancelled = false;
    listOrgMembersWithProfile(activeOrg.id).then((res) => {
      if (cancelled) return;
      if (!res.ok) return;
      setProfiles(new Map(res.data.map((m) => [m.user_id, m])));
    });
    return () => {
      cancelled = true;
    };
  }, [activeOrg]);

  const authorOf = useMemo(() => {
    return (userId: string | null) => {
      if (!userId) return { name: 'Deleted user', isAdmin: false };
      const m = profiles.get(userId);
      if (!m) return { name: 'Unknown', isAdmin: false };
      return { name: m.name, isAdmin: m.role === 'admin' };
    };
  }, [profiles]);

  /**
   * Parse a message body and return React nodes — plain text spans with
   * `<@uuid>` tokens replaced by MentionChip components. Reset the regex's
   * lastIndex per call since the same regex instance is reused.
   */
  function renderMessageBody(body: string, isSelfMessage: boolean): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    MENTION_TOKEN_REGEX.lastIndex = 0;
    let cursor = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    while ((match = MENTION_TOKEN_REGEX.exec(body)) !== null) {
      if (match.index > cursor) {
        nodes.push(body.slice(cursor, match.index));
      }
      const mentionedUserId = match[1];
      const member = profiles.get(mentionedUserId);
      const displayName = member?.name ?? 'unknown';
      const isSelfMention = mentionedUserId === currentUserId;
      // Self-mention gets a stronger background so the user notices being
      // pinged. Otherwise the chip uses a subtle tint that reads on both
      // self-bubble (brand) and other-bubble (muted) backgrounds.
      const chipClass = isSelfMention
        ? isLight
          ? 'bg-amber-200 text-amber-900'
          : 'bg-amber-500/30 text-amber-200'
        : isSelfMessage
          ? 'bg-white/20 text-inherit'
          : isLight
            ? 'bg-brand-600/15 text-brand-600'
            : 'bg-brand-300/15 text-brand-300';
      nodes.push(
        <span
          key={`m-${key++}`}
          className={`inline-block rounded px-1 font-medium ${chipClass}`}
          title={member?.name ?? 'Unknown user'}
        >
          @{member ? displayName.split(/\s+/)[0] : 'unknown'}
        </span>,
      );
      cursor = match.index + match[0].length;
    }
    if (cursor < body.length) {
      nodes.push(body.slice(cursor));
    }
    return nodes;
  }

  // --- Composer + scroll -----------------------------------------------------
  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // --- Mention picker --------------------------------------------------------
  // null = picker closed. When open, tokenStart is the index of the `@` in
  // composer text, filter is the chars typed after it, and selectedIdx is
  // the highlighted row in the popover.
  const [mentionPicker, setMentionPicker] = useState<
    | { tokenStart: number; filter: string; selectedIdx: number }
    | null
  >(null);

  // Friendly composer placeholder → userId map. We insert `@FirstName ` into
  // the textarea (so the user sees a name, not a UUID) and remember which
  // user that maps to. On send, every still-present placeholder gets
  // substituted with the `<@<uuid>>` wire token. Orphaned entries (user
  // edited the text out) silently drop on send.
  const [pendingMentions, setPendingMentions] = useState<
    Map<string, string>
  >(new Map());

  // Org-member list used by the picker. Sorted by name for predictable order.
  const memberList = useMemo(
    () =>
      Array.from(profiles.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [profiles],
  );

  const filteredMentionResults = useMemo(() => {
    if (!mentionPicker) return [];
    const q = mentionPicker.filter.toLowerCase();
    if (!q) return memberList.slice(0, MENTION_PICKER_MAX_RESULTS);
    // Starts-with matches first, then contains. Stable sort within each.
    const startsWith: typeof memberList = [];
    const contains: typeof memberList = [];
    for (const m of memberList) {
      const name = m.name.toLowerCase();
      if (name.startsWith(q)) startsWith.push(m);
      else if (name.includes(q)) contains.push(m);
    }
    return [...startsWith, ...contains].slice(0, MENTION_PICKER_MAX_RESULTS);
  }, [memberList, mentionPicker]);

  // Keep selectedIdx clamped to results length.
  useEffect(() => {
    if (!mentionPicker) return;
    if (mentionPicker.selectedIdx >= filteredMentionResults.length) {
      setMentionPicker({
        ...mentionPicker,
        selectedIdx: Math.max(0, filteredMentionResults.length - 1),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredMentionResults.length]);

  function refreshMentionPickerFromCaret(
    nextValue: string,
    caretPos: number,
  ) {
    const detected = detectMentionAtCursor(nextValue, caretPos);
    if (!detected) {
      if (mentionPicker) setMentionPicker(null);
      return;
    }
    setMentionPicker({
      tokenStart: detected.start,
      filter: detected.filter,
      selectedIdx: 0,
    });
  }

  function handleComposerChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    const caret = e.target.selectionStart ?? value.length;
    setComposer(value);
    refreshMentionPickerFromCaret(value, caret);
  }

  function handleComposerSelect(e: React.SyntheticEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    refreshMentionPickerFromCaret(el.value, el.selectionStart ?? el.value.length);
  }

  function pickMention(userId: string) {
    if (!mentionPicker) return;
    const member = profiles.get(userId);
    const firstName = (member?.name ?? 'user').split(/\s+/)[0];
    const placeholder = `@${firstName}`;
    const before = composer.slice(0, mentionPicker.tokenStart);
    // Replace from tokenStart up to the current caret position. Use the
    // textarea's live selection so we don't blow away anything the user
    // typed after the filter.
    const caret =
      textareaRef.current?.selectionStart ??
      mentionPicker.tokenStart + 1 + mentionPicker.filter.length;
    const after = composer.slice(caret);
    const insertion = `${placeholder} `;
    const nextValue = before + insertion + after;
    const nextCaret = before.length + insertion.length;
    setComposer(nextValue);
    // Track the placeholder → userId mapping for substitution on send.
    // Same placeholder picked again just overwrites with the latest userId
    // — acceptable v1 behavior for same-first-name collisions.
    setPendingMentions((prev) => {
      const next = new Map(prev);
      next.set(placeholder, userId);
      return next;
    });
    setMentionPicker(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.selectionStart = nextCaret;
      ta.selectionEnd = nextCaret;
    });
  }

  /**
   * Build the wire-format body: every still-present `@FirstName` placeholder
   * gets substituted with the `<@<uuid>>` token consumed by the renderer.
   * Orphans (placeholder that's no longer in the body because the user
   * edited it out) drop silently.
   *
   * Matches placeholder as a word boundary so "@May" doesn't half-match
   * "@Maya". Replacement is global (every occurrence of the placeholder
   * within the body gets substituted).
   */
  function substituteMentions(body: string): string {
    let out = body;
    for (const [placeholder, userId] of pendingMentions) {
      // Escape regex specials in the placeholder name + add a trailing
      // boundary so "@Maya" doesn't match within "@MayaBeth".
      const esc = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`${esc}(?=$|[^A-Za-z0-9_])`, 'g');
      out = out.replace(re, `<@${userId}>`);
    }
    return out;
  }

  // Active channel data — selected from whichever context is in use.
  const active =
    activeChannel.kind === 'org'
      ? {
          messages: orgChat.messages as ChatMessageLike[],
          loading: orgChat.loading,
          error: orgChat.error,
          post: orgChat.postMessage,
        }
      : {
          messages: protocolChat.messages as ChatMessageLike[],
          loading: protocolChat.loading,
          error: protocolChat.error,
          post: protocolChat.postMessage,
        };

  const channelLabel = useMemo(() => {
    if (activeChannel.kind === 'org') return 'general';
    return chatProtocols.find((p) => p.id === activeChannel.id)?.code ?? 'protocol';
  }, [activeChannel, chatProtocols]);

  const channelSubLabel = useMemo(() => {
    if (activeChannel.kind === 'org') {
      return activeOrg ? `Visible to everyone in ${activeOrg.name}` : '';
    }
    return 'Coordinators + team members';
  }, [activeChannel, activeOrg]);

  // Reset composer state when switching channels so half-typed messages
  // from another channel don't leak into the new one.
  useEffect(() => {
    setComposer('');
    setSendError(null);
    setPendingMentions(new Map());
  }, [activeChannel]);

  // Also clear unread when the new channel's data finishes loading — keeps
  // the badge clean if a fresh message arrived during the fetch.
  useEffect(() => {
    if (active.loading) return;
    markAsRead(activeChannelKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.loading, activeChannelKey, active.messages.length]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasAtBottomRef.current = distanceFromBottom < SCROLL_BOTTOM_THRESHOLD_PX;
  };

  // Auto-scroll on new messages if user was near the bottom.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [active.messages.length]);

  // Snap to bottom on channel switch + first load.
  useEffect(() => {
    const el = listRef.current;
    if (!el || active.loading) return;
    el.scrollTop = el.scrollHeight;
    wasAtBottomRef.current = true;
  }, [active.loading, activeChannel]);

  const composerTooLong = composer.length > MAX_MESSAGE_LENGTH;
  const composerTrimmed = composer.trim();
  const hasValidAttachments = pendingFiles.some((p) => !p.error);
  // A message can be sent with just attachments and no text — supports
  // "here's the document, no caption" use cases.
  const canSend =
    (composerTrimmed.length > 0 || hasValidAttachments) &&
    !composerTooLong &&
    !sending;

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    setSendError(null);
    // Messages tables require length(body) > 0. For attachment-only sends,
    // use a small paperclip emoji as a placeholder body so the message row
    // satisfies the CHECK constraint. Users with text + attachments get
    // their typed body unchanged.
    const wireBody = composerTrimmed.length > 0
      ? substituteMentions(composerTrimmed)
      : '📎';
    const res = await active.post(wireBody);
    if (!res.ok || !res.data) {
      setSending(false);
      setSendError(res.error ?? 'Failed to send message.');
      return;
    }

    // Upload any pending attachments tied to the just-inserted message.
    // Failures don't block the message — surfaced inline so the user can
    // retry by re-attaching and sending an empty follow-up.
    const validFiles = pendingFiles.filter((p) => !p.error);
    if (validFiles.length > 0 && channelRefId) {
      const messageId = res.data.id;
      const uploads = await Promise.all(
        validFiles.map((p) =>
          uploadChatAttachment({
            file: p.file,
            ...(channelKind === 'org'
              ? { org_message_id: messageId, org_id: channelRefId }
              : { protocol_message_id: messageId, protocol_id: channelRefId }),
          }),
        ),
      );
      const failed: string[] = [];
      for (let i = 0; i < uploads.length; i++) {
        const u = uploads[i];
        if (u.ok) addAttachmentLocal(u.data);
        else failed.push(`${validFiles[i].file.name}: ${u.error}`);
      }
      if (failed.length > 0) {
        setSendError(`Message sent, but ${failed.length} attachment${failed.length === 1 ? '' : 's'} failed: ${failed.join('; ')}`);
      }
    }

    setSending(false);
    setComposer('');
    setPendingMentions(new Map());
    setPendingFiles([]);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Mention picker keyboard nav takes precedence when open.
    if (mentionPicker && filteredMentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionPicker({
          ...mentionPicker,
          selectedIdx: Math.min(
            mentionPicker.selectedIdx + 1,
            filteredMentionResults.length - 1,
          ),
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionPicker({
          ...mentionPicker,
          selectedIdx: Math.max(mentionPicker.selectedIdx - 1, 0),
        });
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const member = filteredMentionResults[mentionPicker.selectedIdx];
        if (member) pickMention(member.user_id);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionPicker(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // --- Styling tokens --------------------------------------------------------
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const labelColor = 'text-fg-label';
  const inputBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-brand-600/50'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-brand-300/50';
  const selfBubble = isLight
    ? 'bg-brand-600 text-white'
    : 'bg-brand-300 text-[#0F172A]';
  const otherBubble = isLight
    ? 'bg-[#F1F5F9] text-[#0F172A]'
    : 'bg-white/[0.06] text-[#CBD5E1]';
  const sidebarBg = isLight ? 'bg-[#F8FAFC]' : 'bg-white/[0.02]';
  const channelRowBase =
    'w-full flex items-center gap-2 rounded-md text-sm transition-colors';
  const channelRowInactive = isLight
    ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.04]'
    : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.04]';
  const channelRowActive = isLight
    ? 'text-[#0F172A] bg-[#0F172A]/[0.06]'
    : 'text-white bg-white/[0.08]';

  if (!activeOrg) {
    return (
      <div className={`px-4 py-8 rounded-md border ${border} text-center`}>
        <p className={`${subColor} text-sm`}>No organization linked to your profile.</p>
      </div>
    );
  }

  // --- Render ----------------------------------------------------------------
  function UnreadBadge({ count, wide }: { count: number; wide: boolean }) {
    if (count <= 0) return null;
    const display = count > unreadCap ? `${unreadCap}+` : String(count);
    if (wide) {
      return (
        <span
          className={`ml-auto flex-shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full ${
            isLight
              ? 'bg-brand-600 text-white'
              : 'bg-brand-300 text-[#0F172A]'
          }`}
          aria-label={`${count} unread`}
        >
          {display}
        </span>
      );
    }
    // Collapsed sidebar — small filled dot anchored to the icon corner.
    return (
      <span
        className={`absolute top-0 right-0 w-2 h-2 rounded-full ${
          isLight ? 'bg-brand-600' : 'bg-brand-300'
        }`}
        aria-label={`${count} unread`}
      />
    );
  }

  function MentionBadge({ count, wide }: { count: number; wide: boolean }) {
    if (count <= 0) return null;
    if (wide) {
      return (
        <span
          className={`flex-shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full ${
            isLight ? 'bg-amber-500 text-white' : 'bg-amber-400 text-[#0F172A]'
          }`}
          aria-label={`${count} unread mentions`}
          title="You were @mentioned"
        >
          @
        </span>
      );
    }
    return (
      <span
        className={`absolute bottom-0 right-0 w-2 h-2 rounded-full ${
          isLight ? 'bg-amber-500' : 'bg-amber-400'
        }`}
        aria-label={`${count} unread mentions`}
        title="You were @mentioned"
      />
    );
  }

  function ChannelRow({
    active,
    onClick,
    icon,
    label,
    title,
    unread,
    mentions,
  }: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    title?: string;
    unread: number;
    mentions: number;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={!sidebarWide ? title ?? label : title}
        className={`${channelRowBase} relative ${active ? channelRowActive : channelRowInactive} ${
          sidebarWide ? 'px-2.5 py-1.5 justify-start' : 'px-1.5 py-1.5 justify-center'
        }`}
      >
        <span className="flex-shrink-0 flex items-center justify-center relative">
          {icon}
          {!sidebarWide && <UnreadBadge count={unread} wide={false} />}
          {!sidebarWide && <MentionBadge count={mentions} wide={false} />}
        </span>
        {sidebarWide && <span className="truncate">{label}</span>}
        {sidebarWide && (
          <span className="ml-auto flex items-center gap-1 flex-shrink-0">
            <MentionBadge count={mentions} wide={true} />
            <UnreadBadge count={unread} wide={true} />
          </span>
        )}
      </button>
    );
  }

  /** Colored dot identifying a protocol — matches the shared palette used by
   *  visit chips, calendar accents, and the protocol picker. Wider in the
   *  collapsed sidebar (where it stands in for the icon) and tighter inline. */
  function ProtocolDot({ code }: { code: string }) {
    const colors = getProtocolColors(code);
    const dotClass = isLight ? colors.dotLight : colors.dotDark;
    return (
      <span
        className={`${dotClass} rounded-full inline-block ${
          sidebarWide ? 'w-2 h-2' : 'w-2.5 h-2.5'
        }`}
        aria-hidden="true"
      />
    );
  }

  return (
    <section
      className={`relative flex border ${border} rounded-md overflow-hidden`}
      style={{ height: 'min(70vh, 600px)' }}
      onDragOver={handleSectionDragOver}
      onDragLeave={handleSectionDragLeave}
      onDrop={handleSectionDrop}
    >
      {draggingOver && (
        <div
          className={`absolute inset-0 z-30 flex items-center justify-center pointer-events-none border-2 border-dashed rounded-md ${
            isLight
              ? 'bg-brand-600/[0.08] border-brand-600/40'
              : 'bg-brand-300/[0.12] border-brand-300/40'
          }`}
        >
          <p className={`text-sm font-medium ${isLight ? 'text-brand-600' : 'text-brand-300'}`}>
            Drop files to attach
          </p>
        </div>
      )}

      {/* Sidebar */}
      <aside
        className={`${sidebarBg} border-r ${border} flex flex-col flex-shrink-0 transition-[width] duration-150 ${
          sidebarWide ? 'w-56' : 'w-12'
        }`}
      >
        <div
          className={`flex items-center ${
            sidebarWide ? 'justify-between px-3' : 'justify-center px-1.5'
          } py-2 border-b ${border}`}
        >
          {sidebarWide && (
            <p className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
              Channels
            </p>
          )}
          <button
            type="button"
            onClick={() => setSidebarWide((w) => !w)}
            className={`p-1 rounded ${
              isLight
                ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05]'
                : 'text-[#CBD5E1]/70 hover:bg-white/[0.05]'
            }`}
            aria-label={sidebarWide ? 'Collapse channel list' : 'Expand channel list'}
            title={sidebarWide ? 'Collapse' : 'Expand'}
          >
            {sidebarWide ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
          <ChannelRow
            active={activeChannel.kind === 'org'}
            onClick={() => setActiveChannel({ kind: 'org' })}
            icon={<MessageCircle size={13} />}
            label="general"
            title="Org-wide channel"
            unread={unreadCounts.get('org') ?? 0}
            mentions={mentionCounts.get('org') ?? 0}
          />

          {chatProtocols.length > 0 && (
            <div className={`my-2 border-t ${border}`} />
          )}

          {channelsLoading && sidebarWide && (
            <p className={`${mutedColor} text-[10px] px-2`}>Loading…</p>
          )}

          {chatProtocols.map((p) => (
            <ChannelRow
              key={p.id}
              active={
                activeChannel.kind === 'protocol' && activeChannel.id === p.id
              }
              onClick={() => setActiveChannel({ kind: 'protocol', id: p.id })}
              icon={<ProtocolDot code={p.code} />}
              label={p.code}
              title={p.name || p.code}
              unread={unreadCounts.get(`protocol:${p.id}`) ?? 0}
              mentions={mentionCounts.get(`protocol:${p.id}`) ?? 0}
            />
          ))}
        </nav>
      </aside>

      {/* Main pane */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Channel header */}
        <header className={`flex items-center gap-2 px-4 py-2.5 border-b ${border}`}>
          {activeChannel.kind === 'org' ? (
            <MessageCircle size={13} className={mutedColor} />
          ) : (
            <ProtocolDot code={channelLabel} />
          )}
          <h3 className={`${headingColor} text-sm font-semibold`}>
            {activeChannel.kind === 'org' ? '#general' : `#${channelLabel}`}
          </h3>
          {channelSubLabel && (
            <p className={`${subColor} text-[11px] truncate flex-1 min-w-0 hidden md:block`}>
              {channelSubLabel}
            </p>
          )}
          {/* Spacer keeps the decisions button right-anchored even when the
              subtitle is hidden on narrow viewports. */}
          <div className="flex-1 md:hidden" />
          <button
            type="button"
            onClick={() => setDecisionsPanelOpen(true)}
            disabled={decisionsLoading && decisions.length === 0}
            className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded ${
              isLight
                ? 'text-amber-700 hover:bg-amber-100'
                : 'text-amber-300 hover:bg-amber-500/[0.1]'
            }`}
            aria-label="View decisions for this channel"
            title="Decisions"
          >
            <ClipboardCheck size={12} />
            <span className="hidden sm:inline">
              {decisions.length} decision{decisions.length === 1 ? '' : 's'}
            </span>
            <span className="sm:hidden">{decisions.length}</span>
          </button>
        </header>

        {active.error && (
          <div
            className={`m-3 flex items-start gap-2 px-3 py-2 rounded-md text-xs ${
              isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'
            }`}
          >
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <span>{active.error}</span>
          </div>
        )}

        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3"
        >
          {active.loading ? (
            <p className={`${subColor} text-sm`}>Loading messages…</p>
          ) : active.messages.length === 0 ? (
            <p className={`${subColor} text-sm text-center py-8`}>
              No messages yet. Be the first to say something.
            </p>
          ) : (
            active.messages.map((m) => {
              const isSelf = m.author_user_id === currentUserId;
              const author = authorOf(m.author_user_id);
              const decisionForMessage = decisionsBySourceId.get(m.id);
              const isHighlighted = highlightMessageId === m.id;
              return (
                <div
                  key={m.id}
                  id={`chat-msg-${m.id}`}
                  className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'} ${
                    isHighlighted
                      ? isLight
                        ? 'bg-amber-50 rounded-lg -mx-2 px-2 py-1 transition-colors'
                        : 'bg-amber-500/[0.08] rounded-lg -mx-2 px-2 py-1 transition-colors'
                      : ''
                  }`}
                >
                  {!isSelf && (
                    <p className={`${mutedColor} text-[10px] mb-0.5 ml-1`}>
                      {author.name}
                      {author.isAdmin && ' · admin'}
                    </p>
                  )}
                  {decisionForMessage && (() => {
                    const decAcks = acksByDecisionId.get(decisionForMessage.id) ?? [];
                    const ackedCount = decAcks.filter((a) => a.acknowledged_at).length;
                    const allAcked = decAcks.length > 0 && ackedCount === decAcks.length;
                    const someAcked = decAcks.length > 0 && ackedCount < decAcks.length;
                    return (
                      <button
                        type="button"
                        onClick={() => setDecisionsPanelOpen(true)}
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 mb-1 ${
                          isLight
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                        title={
                          decAcks.length > 0
                            ? `Decision (${ackedCount}/${decAcks.length} acknowledged): ${decisionForMessage.title}`
                            : `Decision: ${decisionForMessage.title}`
                        }
                      >
                        <ClipboardCheck size={10} />
                        Decision
                        <span className="truncate max-w-[160px] normal-case font-medium tracking-normal">
                          — {decisionForMessage.title}
                        </span>
                        {someAcked && (
                          <span
                            className={`inline-flex w-1.5 h-1.5 rounded-full ${
                              isLight ? 'bg-amber-600' : 'bg-amber-400'
                            }`}
                            title="Pending acknowledgments"
                          />
                        )}
                        {allAcked && (
                          <span
                            className={`inline-flex w-1.5 h-1.5 rounded-full ${
                              isLight ? 'bg-emerald-600' : 'bg-emerald-400'
                            }`}
                            title="Fully acknowledged"
                          />
                        )}
                      </button>
                    );
                  })()}
                  <div className="group relative max-w-[80%]">
                    <div
                      className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                        isSelf ? selfBubble : otherBubble
                      }`}
                    >
                      {renderMessageBody(m.body, isSelf)}
                    </div>
                    <AttachmentRender
                      attachments={attachmentsByMessageId.get(m.id) ?? []}
                      canDelete={(a) =>
                        a.uploaded_by_user_id === currentUserId || isOrgAdmin
                      }
                      onDeleted={removeAttachmentLocal}
                    />
                    <MessagePromoteButton
                      isSelf={isSelf}
                      isLight={isLight}
                      onPromote={() =>
                        setPromoteSource({
                          id: m.id,
                          body: m.body,
                          authorUserId: m.author_user_id,
                          createdAt: m.created_at,
                        })
                      }
                    />
                  </div>
                  <p
                    className={`${mutedColor} text-[10px] mt-0.5 ${
                      isSelf ? 'mr-1' : 'ml-1'
                    }`}
                    title={new Date(m.created_at).toLocaleString()}
                  >
                    {formatRelative(m.created_at)}
                  </p>
                </div>
              );
            })
          )}
        </div>

        {sendError && (
          <div
            className={`mx-3 mb-2 flex items-start gap-2 px-3 py-2 rounded-md text-xs ${
              isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'
            }`}
          >
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <span>{sendError}</span>
          </div>
        )}

        {pendingFiles.length > 0 && (
          <div className={`mx-3 mt-2 flex flex-wrap gap-2 ${border}`}>
            {pendingFiles.map((p) => (
              <div
                key={p.id}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs ${
                  p.error
                    ? isLight
                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                      : 'bg-rose-500/[0.06] border-rose-500/30 text-rose-300'
                    : isLight
                      ? 'bg-[#F1F5F9] border-[#E2E8F0] text-[#0F172A]'
                      : 'bg-white/[0.04] border-white/10 text-[#CBD5E1]'
                }`}
                title={p.error ? `${p.file.name} — ${p.error}` : p.file.name}
              >
                <FileIcon size={11} className="flex-shrink-0" />
                <span className="truncate max-w-[160px]">{p.file.name}</span>
                <span className={`flex-shrink-0 ${mutedColor}`}>
                  {p.error ?? formatBytes(p.file.size)}
                </span>
                <button
                  type="button"
                  onClick={() => removePendingFile(p.id)}
                  className={`flex-shrink-0 p-0.5 rounded ${
                    isLight ? 'hover:bg-[#0F172A]/[0.05]' : 'hover:bg-white/[0.05]'
                  }`}
                  aria-label={`Remove ${p.file.name}`}
                >
                  <XIcon size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={`relative border-t ${border} p-2 flex items-end gap-2`}>
          {mentionPicker && filteredMentionResults.length > 0 && (
            <div
              role="listbox"
              aria-label="Mention member"
              className={`absolute bottom-full left-2 right-2 mb-2 max-w-xs rounded-md border shadow-lg overflow-hidden ${
                isLight
                  ? 'bg-white border-[#E2E8F0]'
                  : 'bg-[#0F172A] border-white/10'
              }`}
            >
              <p className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold ${labelColor} border-b ${border}`}>
                Mention a member
              </p>
              <ul className="max-h-56 overflow-y-auto py-1">
                {filteredMentionResults.map((m, idx) => (
                  <li key={m.user_id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={idx === mentionPicker.selectedIdx}
                      onMouseDown={(e) => {
                        // Prevent blur on the textarea before we pick.
                        e.preventDefault();
                      }}
                      onClick={() => pickMention(m.user_id)}
                      className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2 ${
                        idx === mentionPicker.selectedIdx
                          ? isLight
                            ? 'bg-brand-600/[0.08] text-[#0F172A]'
                            : 'bg-brand-300/[0.12] text-white'
                          : isLight
                            ? 'text-[#0F172A] hover:bg-[#0F172A]/[0.04]'
                            : 'text-[#CBD5E1] hover:bg-white/[0.04]'
                      }`}
                    >
                      <span className="truncate">{m.name}</span>
                      {m.role === 'admin' && (
                        <span className={`${mutedColor} text-[10px] uppercase`}>admin</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFilePickerChange}
            className="hidden"
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            className={`p-2 rounded-md flex-shrink-0 ${
              isLight
                ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05] hover:text-[#0F172A]'
                : 'text-[#CBD5E1]/70 hover:bg-white/[0.05] hover:text-white'
            }`}
            title="Attach file (or drag-drop / paste)"
            aria-label="Attach file"
          >
            <Paperclip size={14} />
          </button>
          <textarea
            ref={textareaRef}
            value={composer}
            onChange={handleComposerChange}
            onKeyDown={handleKeyDown}
            onSelect={handleComposerSelect}
            onPaste={handlePaste}
            onBlur={() => {
              // Defer so a click on a picker row registers before close.
              setTimeout(() => setMentionPicker(null), 100);
            }}
            placeholder={`Message #${channelLabel}… (@ to mention, Enter to send, Shift+Enter for newline)`}
            rows={2}
            maxLength={MAX_MESSAGE_LENGTH + 50}
            className={`flex-1 min-w-0 px-2 py-1.5 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30 resize-none`}
            disabled={sending}
            aria-label="Message composer"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md transition-colors ${buttonPrimary}`}
            aria-label="Send message"
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {sending ? 'Sending' : 'Send'}
          </button>
        </div>

        {composerTooLong && (
          <p
            className={`px-3 pb-2 text-[11px] ${
              isLight ? 'text-rose-700' : 'text-rose-300'
            }`}
          >
            Message exceeds the {MAX_MESSAGE_LENGTH.toLocaleString()} character limit.
          </p>
        )}
      </div>

      {/* Decision promotion modal — only when promoting a specific message. */}
      {promoteSource && channelRefId && (
        <DecisionPromoteModal
          kind={channelKind}
          channelId={channelRefId}
          sourceMessage={promoteSource}
          members={Array.from(profiles.values())}
          onClose={() => setPromoteSource(null)}
          onCreated={addDecisionLocal}
        />
      )}

      {/* Decisions panel — slide-in from the right. */}
      {decisionsPanelOpen && (
        <DecisionList
          decisions={decisions}
          acksByDecisionId={acksByDecisionId}
          isAdmin={isOrgAdmin}
          currentUserId={currentUserId}
          members={profiles}
          onClose={() => setDecisionsPanelOpen(false)}
          onJumpToSource={jumpToSourceMessage}
          onDeleted={removeDecisionLocal}
          onAcknowledged={upsertAckLocal}
        />
      )}
    </section>
  );
}

// ============================================================================
// MessagePromoteButton — single icon button shown on bubble hover. Replaces
// the previous dropdown menu so it doesn't overflow on mobile. Tooltip
// communicates the action. Promote is the only per-message action today;
// when we add more, a dropdown can return with viewport-aware positioning.
// ============================================================================

function MessagePromoteButton({
  isSelf,
  isLight,
  onPromote,
}: {
  isSelf: boolean;
  isLight: boolean;
  onPromote: () => void;
}) {
  const positionClass = isSelf
    ? 'left-0 -translate-x-full pr-1'
    : 'right-0 translate-x-full pl-1';
  return (
    <button
      type="button"
      onClick={onPromote}
      className={`absolute top-1 ${positionClass} opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded ${
        isLight
          ? 'text-[#334155]/60 hover:bg-[#0F172A]/[0.06]'
          : 'text-[#CBD5E1]/60 hover:bg-white/[0.06]'
      }`}
      aria-label="Promote to decision"
      title="Promote to decision"
    >
      <ClipboardCheck size={13} />
    </button>
  );
}
