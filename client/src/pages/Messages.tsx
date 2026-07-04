import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { getSocket } from "../lib/socket";
import { timeAgo } from "../lib/types";
import { Navbar } from "../components/Navbar";
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
  createdAt: string;
}

export default function Messages() {
  const { user } = useAuth();
  const myId = user!.id;

  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [other, setOther] = useState<OtherUser | null>(null);
  const [online, setOnline] = useState<Record<string, boolean>>({});
  const [peerTyping, setPeerTyping] = useState(false);

  const [draft, setDraft] = useState("");
  const [codeMode, setCodeMode] = useState(false);
  const [codeDraft, setCodeDraft] = useState("");
  const [codeLang, setCodeLang] = useState("typescript");

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
    const res = await api<{ ok: true; messages: Message[]; other: OtherUser | null }>(
      `/api/conversations/${id}/messages`
    );
    setMessages(res.messages);
    setOther(res.other);
  }

  // scroll لآخر رسالة
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, peerTyping]);

  // ---- إرسال ----
  function send() {
    if (!activeId) return;
    const body = codeMode ? draft.trim() || "Code snippet" : draft.trim();
    if (!body && !codeMode) return;
    if (codeMode && !codeDraft.trim()) return;

    getSocket().emit(
      "message:send",
      {
        conversationId: activeId,
        body,
        ...(codeMode ? { codeLanguage: codeLang, codeContent: codeDraft } : {}),
      },
      (ack: { ok: boolean; message?: Message }) => {
        if (ack.ok && ack.message) {
          setMessages((prev) =>
            prev.some((x) => x.id === ack.message!.id) ? prev : [...prev, ack.message!]
          );
          loadConversations();
        }
      }
    );
    setDraft("");
    setCodeDraft("");
    setCodeMode(false);
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
      <Navbar />
      <main className="mx-auto flex h-[calc(100vh-61px)] max-w-6xl">
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
                {c.isGroup ? "👥" : (c.other?.profile?.displayName?.[0]?.toUpperCase() ?? "?")}
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
                  ←
                </button>
                <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-ink-700 font-bold">
                  {isGroup ? "👥" : (other?.profile?.displayName?.[0]?.toUpperCase() ?? "?")}
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
              </div>
                );
              })()}

              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.map((m) => {
                  const mine = m.senderId === myId;
                  return (
                    <div key={m.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
                      <div
                        className={
                          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm md:max-w-[70%] " +
                          (mine ? "rounded-br-md bg-brand-500 text-white" : "rounded-bl-md bg-ink-800")
                        }
                      >
                        {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                        {m.codeContent && m.codeLanguage && (
                          <div className="mt-2 min-w-64 text-left">
                            <CodeBlock code={m.codeContent} language={m.codeLanguage} />
                          </div>
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
                  <input
                    className="input-field !py-2"
                    placeholder="Type a message..."
                    value={draft}
                    onChange={(e) => handleTyping(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                  />
                  <button
                    onClick={send}
                    disabled={codeMode ? !codeDraft.trim() : !draft.trim()}
                    className="btn-primary !py-2 text-sm disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </>
  );
}
