import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getSocket } from "../lib/socket";
import { timeAgo } from "../lib/types";
import { AppShell } from "../components/AppShell";
import {
  Users, ArrowLeft, Send, Info, X, Camera, Paperclip, FileText,
  FileCode2, Download,
} from "lucide-react";
import { Link } from "react-router-dom";
import { CodeBlock } from "../components/CodeBlock";

interface OtherUser {
  id: string;
  username: string;
  profile: { displayName: string; avatarUrl: string | null; headline: string | null } | null;
}
interface ConversationItem {
  id: string;
  isGroup: boolean;
  title: string | null;
  memberCount: number;
  updatedAt: string;
  other: OtherUser | null;
  lastMessage: { preview: string; mine: boolean; createdAt: string } | null;
}
interface Message {
  id: string;
  senderId: string;
  body: string;
  codeLanguage: string | null;
  codeContent: string | null;
  attachmentUrl: string | null;
  attachmentType: "image" | "file" | null;
  attachmentName: string | null;
  attachmentSize: number | null;
  createdAt: string;
  sender?: { username: string; profile: { displayName: string; avatarUrl: string | null } } | null;
}

interface MediaAttachment {
  id: string;
  attachmentUrl: string;
  attachmentType: "image" | "file";
  attachmentName: string | null;
  attachmentSize: number | null;
  createdAt: string;
}

const fmtSize = (bytes: number | null) => {
  if (bytes == null) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

// بيحول روابط http(s) في نص الرسالة لروابط قابلة للضغط
// روابط التطبيق نفسه (زي رابط بوست متشير) بتتفتح بـ react-router من غير reload
function LinkifiedBody({ body }: { body: string }) {
  const parts = body.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return part;
        const isInternal = part.startsWith(window.location.origin);
        if (isInternal) {
          return (
            <Link key={i} to={part.slice(window.location.origin.length)} className="font-semibold underline hover:opacity-80">
              {part}
            </Link>
          );
        }
        return (
          <a key={i} href={part} target="_blank" rel="noreferrer noopener" className="font-semibold underline hover:opacity-80">
            {part}
          </a>
        );
      })}
    </p>
  );
}

export default function Messages() {
  const { user } = useAuth();
  const myId = user!.id;

  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);

  async function openGroupInfo() {
    if (!activeId) return;
    const res = await api<{ ok: true; conversation: any }>(`/api/conversations/${activeId}/info`).catch(() => null);
    if (res) {
      setGroupMembers(res.conversation.members ?? []);
      setGroupNameDraft(res.conversation.name ?? "");
      setGroupInfoOpen(true);
    }
  }

  async function saveGroupSettings(avatarUrl?: string) {
    if (!activeId) return;
    setSavingGroup(true);
    try {
      await api(`/api/conversations/${activeId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: groupNameDraft || undefined, ...(avatarUrl !== undefined ? { avatarUrl } : {}) }),
      });
      setConversations((prev) => prev.map((c) => (c.id === activeId ? { ...c, title: groupNameDraft || c.title } : c)));
      if (avatarUrl === undefined) setGroupInfoOpen(false);
    } finally {
      setSavingGroup(false);
    }
  }

  async function uploadGroupAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const CN = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const UP = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
    if (!CN || !UP) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", UP);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CN}/image/upload`, { method: "POST", body: fd });
    const data = await res.json();
    if (data.secure_url) await saveGroupSettings(data.secure_url);
  }
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [other, setOther] = useState<OtherUser | null>(null);
  const [online, setOnline] = useState<Record<string, boolean>>({});
  const [peerTyping, setPeerTyping] = useState(false);

  const [draft, setDraft] = useState("");
  const [codeMode, setCodeMode] = useState(false);
  const [codeDraft, setCodeDraft] = useState("");
  const [codeLang, setCodeLang] = useState("typescript");

  // مرفق جاهز للإرسال (اترفع على Cloudinary وبنستنى Send)
  const [pendingAttachment, setPendingAttachment] = useState<{
    url: string; type: "image" | "file"; name: string; size: number;
  } | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // اللوحة اليمين (Shared Media & Files) — بتظهر على الشاشات الواسعة
  const [media, setMedia] = useState<{ attachments: MediaAttachment[]; snippets: { id: string; codeLanguage: string | null }[] } | null>(null);
  const [clearing, setClearing] = useState(false);

  const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
  const uploadsEnabled = !!(CLOUD_NAME && UPLOAD_PRESET);

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return; // حد 15MB
    setUploadingFile(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("upload_preset", UPLOAD_PRESET ?? "");
      // auto = يقبل صور وملفات (PDF, zip, code...)
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`, { method: "POST", body: fd });
      const data = await res.json();
      if (data.secure_url) {
        setPendingAttachment({
          url: data.secure_url,
          type: file.type.startsWith("image/") ? "image" : "file",
          name: file.name,
          size: file.size,
        });
      }
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function loadMedia(conversationId: string) {
    const res = await api<{ ok: true; attachments: MediaAttachment[]; snippets: { id: string; codeLanguage: string | null }[] }>(
      `/api/conversations/${conversationId}/media`
    ).catch(() => null);
    if (res) setMedia({ attachments: res.attachments, snippets: res.snippets });
  }

  async function clearHistory() {
    if (!activeId) return;
    if (!window.confirm("Clear all messages in this conversation for everyone? This can't be undone.")) return;
    setClearing(true);
    try {
      await api(`/api/conversations/${activeId}/messages`, { method: "DELETE" });
      setMessages([]);
      setMedia({ attachments: [], snippets: [] });
      loadConversations();
    } finally {
      setClearing(false);
    }
  }

  const [newChatUser, setNewChatUser] = useState("");
  const [newChatError, setNewChatError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();

  // ---- تحميل قائمة المحادثات ----
  const loadConversations = useCallback(async () => {
    const res = await api<{ ok: true; conversations: ConversationItem[] }>("/api/conversations");
    setConversations(res.conversations);
    // نسأل عن حالة الاتصال لكل الأطراف
    const ids = res.conversations.map((c) => c.other?.id).filter(Boolean) as string[];
    if (ids.length) {
      getSocket().emit("presence:query", ids, (map: Record<string, boolean>) => setOnline(map));
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // ---- أحداث الـ socket ----
  useEffect(() => {
    const s = getSocket();

    const onNew = (m: Message & { conversationId: string }) => {
      // لو الرسالة في المحادثة المفتوحة ضيفها للثريد
      setMessages((prev) =>
        m.conversationId === activeId && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev
      );
      setPeerTyping(false);
      loadConversations(); // تحديث الـ previews والترتيب
    };
    const onTyping = (p: { conversationId: string; typing: boolean }) => {
      if (p.conversationId === activeId) setPeerTyping(p.typing);
    };
    const onPresence = (p: { userId: string; online: boolean }) =>
      setOnline((prev) => ({ ...prev, [p.userId]: p.online }));

    s.on("message:new", onNew);
    s.on("typing", onTyping);
    s.on("presence:update", onPresence);
    return () => {
      s.off("message:new", onNew);
      s.off("typing", onTyping);
      s.off("presence:update", onPresence);
    };
  }, [activeId, loadConversations]);

  // ---- فتح محادثة ----
  async function openConversation(id: string) {
    setActiveId(id);
    setPeerTyping(false);
    setMedia(null);
    const res = await api<{ ok: true; messages: Message[]; other: OtherUser | null }>(
      `/api/conversations/${id}/messages`
    );
    setMessages(res.messages);
    setOther(res.other);
    loadMedia(id); // اللوحة اليمين — في الخلفية
  }

  // scroll لآخر رسالة
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, peerTyping]);

  // ---- إرسال ----
  function send() {
    if (!activeId) return;
    const body = draft.trim();
    // لازم في حاجة تتبعت: نص أو كود أو مرفق
    if (!body && !(codeMode && codeDraft.trim()) && !pendingAttachment) return;
    if (codeMode && !codeDraft.trim()) return;

    getSocket().emit(
      "message:send",
      {
        conversationId: activeId,
        body,
        ...(codeMode ? { codeLanguage: codeLang, codeContent: codeDraft } : {}),
        ...(pendingAttachment
          ? {
              attachmentUrl: pendingAttachment.url,
              attachmentType: pendingAttachment.type,
              attachmentName: pendingAttachment.name,
              attachmentSize: pendingAttachment.size,
            }
          : {}),
      },
      (ack: { ok: boolean; message?: Message }) => {
        if (ack.ok && ack.message) {
          setMessages((prev) =>
            prev.some((x) => x.id === ack.message!.id) ? prev : [...prev, ack.message!]
          );
          loadConversations();
          if (ack.message.attachmentUrl && activeId) loadMedia(activeId);
        }
      }
    );
    setDraft("");
    setCodeDraft("");
    setCodeMode(false);
    setPendingAttachment(null);
  }

  // ---- typing إشعار مع debounce ----
  function handleTyping(v: string) {
    setDraft(v);
    if (!activeId) return;
    const s = getSocket();
    s.emit("typing", { conversationId: activeId, typing: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(
      () => s.emit("typing", { conversationId: activeId, typing: false }),
      1200
    );
  }

  // ---- محادثة جديدة بالـ username ----
  async function startChat() {
    setNewChatError(null);
    try {
      const res = await api<{ ok: true; conversationId: string }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ username: newChatUser.trim() }),
      });
      setNewChatUser("");
      await loadConversations();
      await openConversation(res.conversationId);
    } catch (err) {
      setNewChatError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  const dot = (id?: string) => (
    <span
      className={
        "inline-block h-2.5 w-2.5 rounded-full border-2 border-ink-800 " +
        (id && online[id] ? "bg-emerald-400" : "bg-mist-600")
      }
    />
  );

  return (
    <>
      <AppShell width="full">
      <div className="mx-auto flex h-[calc(100vh-150px)] max-w-6xl">
        {/* ---- قائمة المحادثات ---- */}
        <aside
          className={
            "w-full shrink-0 overflow-y-auto border-r border-ink-700 md:block md:w-80 " +
            (activeId ? "hidden" : "block")
          }
        >
          <div className="border-b border-ink-700 p-4">
            <h1 className="mb-3 text-xl font-bold">Messages</h1>
            <div className="flex gap-2">
              <input
                className="input-field !py-2 text-sm"
                placeholder="Start chat: username..."
                value={newChatUser}
                onChange={(e) => setNewChatUser(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && startChat()}
              />
              <button onClick={startChat} disabled={!newChatUser.trim()} className="btn-primary !px-3 !py-2 disabled:opacity-50">
                +
              </button>
            </div>
            {newChatError && <p className="mt-2 text-xs text-red-400">{newChatError}</p>}
          </div>

          {conversations.length === 0 && (
            <p className="p-4 text-sm text-mist-400">No conversations yet. Start one above.</p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={
                "flex w-full items-center gap-3 border-b border-ink-700/50 px-4 py-3 text-left transition-colors hover:bg-ink-800 " +
                (c.id === activeId ? "bg-ink-800" : "")
              }
            >
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-700 font-bold">
                {c.isGroup ? <Users size={18} /> : (c.other?.profile?.displayName?.[0]?.toUpperCase() ?? "?")}
                <span className="absolute -bottom-0.5 -right-0.5">{dot(c.other?.id)}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.title ?? c.other?.profile?.displayName ?? "Unknown"}</p>
                <p className="truncate text-xs text-mist-400">
                  {c.lastMessage ? (c.lastMessage.mine ? "You: " : "") + c.lastMessage.preview : "Say hi 👋"}
                </p>
              </div>
              {c.lastMessage && (
                <span className="shrink-0 text-[10px] text-mist-600">{timeAgo(c.lastMessage.createdAt)}</span>
              )}
            </button>
          ))}
        </aside>

        {/* ---- الثريد ---- */}
        <section className={"min-w-0 flex-1 flex-col md:flex " + (activeId ? "flex" : "hidden")}>
          {!activeId ? (
            <div className="flex flex-1 items-center justify-center text-sm text-mist-400">
              Select a conversation to start chatting
            </div>
          ) : (
            <>
              {(() => {
                const activeConv = conversations.find((c) => c.id === activeId);
                const isGroup = activeConv?.isGroup ?? false;
                return (
              <div className="flex items-center gap-3 border-b border-ink-700 px-4 py-3">
                <button onClick={() => setActiveId(null)} className="text-mist-400 md:hidden" aria-label="Back">
                  <ArrowLeft size={20} />
                </button>
                <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-ink-700 font-bold">
                  {isGroup ? <Users size={16} /> : (other?.profile?.displayName?.[0]?.toUpperCase() ?? "?")}
                  {!isGroup && <span className="absolute -bottom-0.5 -right-0.5">{dot(other?.id)}</span>}
                </div>
                <div>
                  <p className="font-semibold leading-tight">
                    {isGroup ? activeConv?.title : other?.profile?.displayName}
                  </p>
                  <p className="text-xs text-mist-400">
                    {isGroup
                      ? `${activeConv?.memberCount} members`
                      : peerTyping ? "typing..." : other && online[other.id] ? "Active now" : "Offline"}
                  </p>
                </div>
                {isGroup && (
                  <button onClick={openGroupInfo} className="ml-auto rounded-lg p-2 text-mist-400 hover:bg-ink-800" title="Group info" aria-label="Group info">
                    <Info size={18} />
                  </button>
                )}
              </div>
                );
              })()}

              {/* Group info panel */}
              {groupInfoOpen && (
                <div className="border-b border-ink-700 bg-ink-900 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold"><Users size={15} /> Group settings</h3>
                    <button onClick={() => setGroupInfoOpen(false)} className="text-mist-400 hover:text-mist-100" aria-label="Close"><X size={16} /></button>
                  </div>
                  <div className="mb-3 flex items-center gap-2">
                    <input className="input-field !py-2 text-sm" value={groupNameDraft} onChange={(e) => setGroupNameDraft(e.target.value)} placeholder="Group name" />
                    <button onClick={() => saveGroupSettings()} disabled={savingGroup || !groupNameDraft.trim()} className="btn-primary shrink-0 !py-2 text-sm disabled:opacity-50">
                      {savingGroup ? "..." : "Save"}
                    </button>
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-sm text-mist-400 hover:bg-ink-800">
                      <Camera size={15} /> Photo
                      <input type="file" accept="image/*" className="hidden" onChange={uploadGroupAvatar} />
                    </label>
                  </div>
                  <p className="mb-2 text-xs font-semibold text-mist-600">MEMBERS ({groupMembers.length})</p>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {groupMembers.map((m: any) => (
                      <Link key={m.username} to={`/u/${m.username}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-800">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 text-xs font-bold">
                          {m.profile?.avatarUrl ? <img src={m.profile.avatarUrl} alt="" className="h-full w-full object-cover" /> : m.profile?.displayName?.[0]?.toUpperCase()}
                        </div>
                        <span className="text-sm">{m.profile?.displayName}</span>
                        <span className="text-xs text-mist-600">@{m.username}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.map((m) => {
                  const mine = m.senderId === myId;
                  const activeConvForMsg = conversations.find((c) => c.id === activeId);
                  const showSender = !mine && (activeConvForMsg?.isGroup ?? false) && m.sender;
                  return (
                    <div key={m.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
                      <div
                        className={
                          "min-w-0 max-w-[85%] rounded-2xl px-4 py-2.5 text-sm [overflow-wrap:anywhere] md:max-w-[70%] " +
                          (mine ? "rounded-br-md bg-brand-500 text-white" : "rounded-bl-md bg-ink-800")
                        }
                      >
                        {showSender && (
                          <p className="mb-0.5 text-xs font-semibold text-brand-400">
                            {m.sender!.profile.displayName}
                          </p>
                        )}
                        {m.body && <LinkifiedBody body={m.body} />}
                        {m.codeContent && m.codeLanguage && (
                          <div className="mt-2 min-w-64 text-left">
                            <CodeBlock code={m.codeContent} language={m.codeLanguage} />
                          </div>
                        )}
                        {m.attachmentUrl && m.attachmentType === "image" && (
                          <a href={m.attachmentUrl} target="_blank" rel="noreferrer" className="mt-2 block">
                            <img
                              src={m.attachmentUrl}
                              alt={m.attachmentName ?? "Shared image"}
                              className="max-h-64 rounded-lg border border-black/20 object-cover"
                              loading="lazy"
                            />
                          </a>
                        )}
                        {m.attachmentUrl && m.attachmentType === "file" && (
                          <a
                            href={m.attachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={
                              "mt-2 flex items-center gap-2.5 rounded-lg px-3 py-2 " +
                              (mine ? "bg-white/15 hover:bg-white/25" : "bg-ink-900 hover:bg-ink-700/50")
                            }
                          >
                            <FileText size={18} className="shrink-0" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">{m.attachmentName ?? "File"}</span>
                              <span className={"text-xs " + (mine ? "text-white/60" : "text-mist-600")}>{fmtSize(m.attachmentSize)}</span>
                            </span>
                            <Download size={14} className="ml-auto shrink-0 opacity-70" />
                          </a>
                        )}
                        <p className={"mt-1 text-[10px] " + (mine ? "text-white/60" : "text-mist-600")}>
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {peerTyping && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-md bg-ink-800 px-4 py-2.5 text-sm text-mist-400">
                      <span className="animate-pulse">● ● ●</span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* ---- الإدخال ---- */}
              <div className="border-t border-ink-700 p-3">
                {codeMode && (
                  <div className="mb-2 space-y-2">
                    <select
                      className="input-field !w-auto !py-1.5 text-xs"
                      value={codeLang}
                      onChange={(e) => setCodeLang(e.target.value)}
                      aria-label="Snippet language"
                    >
                      {["javascript", "typescript", "python", "rust", "go", "sql", "bash", "json", "css", "html"].map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                    <textarea
                      className="input-field min-h-24 resize-y font-mono text-xs"
                      placeholder="// paste your snippet"
                      value={codeDraft}
                      onChange={(e) => setCodeDraft(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                )}
                {/* معاينة المرفق قبل الإرسال */}
                {pendingAttachment && (
                  <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
                    {pendingAttachment.type === "image" ? (
                      <img src={pendingAttachment.url} alt="" className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <FileText size={18} className="text-mist-400" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{pendingAttachment.name}</span>
                      <span className="text-xs text-mist-600">{fmtSize(pendingAttachment.size)}</span>
                    </span>
                    <button onClick={() => setPendingAttachment(null)} className="text-mist-600 hover:text-red-400" aria-label="Remove attachment">
                      <X size={15} />
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCodeMode((c) => !c)}
                    className={
                      "shrink-0 rounded-lg border px-3 py-2 font-mono text-xs transition-colors " +
                      (codeMode
                        ? "border-brand-500 bg-brand-500/10 text-brand-400"
                        : "border-ink-700 text-mist-400 hover:text-mist-100")
                    }
                    aria-pressed={codeMode}
                  >
                    {"</>"}
                  </button>
                  {uploadsEnabled && (
                    <>
                      <input ref={fileInputRef} type="file" onChange={handleFilePick} className="hidden" />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingFile}
                        className="shrink-0 rounded-lg border border-ink-700 px-3 py-2 text-mist-400 transition-colors hover:text-mist-100 disabled:opacity-50"
                        title="Attach a file"
                        aria-label="Attach a file"
                      >
                        <Paperclip size={15} className={uploadingFile ? "animate-pulse" : ""} />
                      </button>
                    </>
                  )}
                  <input
                    className="input-field !py-2"
                    placeholder="Type a message..."
                    value={draft}
                    onChange={(e) => handleTyping(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                  />
                  <button
                    onClick={send}
                    disabled={codeMode ? !codeDraft.trim() : !draft.trim() && !pendingAttachment}
                    className="btn-primary !py-2 text-sm disabled:opacity-50"
                  >
                    <Send size={15} /> Send
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* ---- اللوحة اليمين: بروفايل + Shared Media & Files ---- */}
        {activeId && (
          <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-ink-700 p-5 xl:flex">
            {(() => {
              const activeConv = conversations.find((c) => c.id === activeId);
              const isGroup = activeConv?.isGroup ?? false;
              return (
                <div className="flex flex-col items-center text-center">
                  <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-ink-700 text-2xl font-bold">
                    {isGroup ? (
                      <Users size={30} />
                    ) : other?.profile?.avatarUrl ? (
                      <img src={other.profile.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      other?.profile?.displayName?.[0]?.toUpperCase() ?? "?"
                    )}
                  </div>
                  <p className="mt-3 text-lg font-bold">
                    {isGroup ? activeConv?.title : other?.profile?.displayName}
                  </p>
                  <p className="text-sm text-mist-400">
                    {isGroup ? `${activeConv?.memberCount} members` : other?.profile?.headline ?? `@${other?.username}`}
                  </p>
                  {!isGroup && other && (
                    <Link to={`/u/${other.username}`} className="btn-ghost mt-3 w-full justify-center !py-2 text-sm">
                      View Profile
                    </Link>
                  )}
                </div>
              );
            })()}

            {/* Shared Media & Files */}
            <div className="mt-6">
              <h3 className="text-sm font-bold">Shared Media & Files</h3>

              {media && media.attachments.length === 0 && media.snippets.length === 0 && (
                <p className="mt-3 text-xs text-mist-600">Nothing shared yet.</p>
              )}

              {/* صور متشاركة — grid */}
              {media && media.attachments.filter((a) => a.attachmentType === "image").length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  {media.attachments
                    .filter((a) => a.attachmentType === "image")
                    .slice(0, 6)
                    .map((a) => (
                      <a key={a.id} href={a.attachmentUrl} target="_blank" rel="noreferrer">
                        <img src={a.attachmentUrl} alt="" className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
                      </a>
                    ))}
                </div>
              )}

              {/* ملفات */}
              <div className="mt-3 space-y-2">
                {media?.attachments
                  .filter((a) => a.attachmentType === "file")
                  .slice(0, 8)
                  .map((a) => (
                    <a
                      key={a.id}
                      href={a.attachmentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2.5 rounded-lg border border-ink-700/60 bg-ink-800/60 px-3 py-2 hover:border-brand-500/40"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-mist-400">
                        <FileText size={15} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">{a.attachmentName ?? "File"}</span>
                        <span className="text-[10px] text-mist-600">{fmtSize(a.attachmentSize)}</span>
                      </span>
                    </a>
                  ))}
                {media && media.snippets.length > 0 && (
                  <div className="flex items-center gap-2.5 rounded-lg border border-ink-700/60 bg-ink-800/60 px-3 py-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-mist-400">
                      <FileCode2 size={15} />
                    </span>
                    <span className="text-xs text-mist-400">
                      {media.snippets.length} code {media.snippets.length === 1 ? "snippet" : "snippets"} shared
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Clear history — أحمر تحت زي الديزاين */}
            <button
              onClick={clearHistory}
              disabled={clearing}
              className="mt-auto pt-6 text-sm font-semibold text-red-400 hover:underline disabled:opacity-50"
            >
              {clearing ? "Clearing..." : "Clear Conversation History"}
            </button>
          </aside>
        )}
      </div>
    </AppShell>
    </>
  );
}
