import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquareText, Send, Sparkles, X, Loader2, Trash2 } from "lucide-react";
import { api, DocumentT } from "../lib/api";

type ChatMessage = { role: "user" | "assistant"; content: string };

interface Props {
  doc: DocumentT;
}

const SUGGESTIONS = [
  "Summarize this document in 5 bullets.",
  "What is the document about?",
  "Who are the people mentioned?",
  "List all the dates in chronological order.",
  "What action does it require?",
];

export default function DocumentChat({ doc }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setMessages([]);
    setInput("");
    setError(null);
  }, [doc.id]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, busy]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await api.chatWithDocument(doc.id, next);
      setMessages([...next, { role: "assistant", content: res.reply }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Chat failed";
      setError(msg);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => taRef.current?.focus());
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const clear = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 shadow-lg ring-1 transition ${
          open
            ? "bg-zinc-900 text-white ring-white/20"
            : "bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white ring-violet-400/40 hover:scale-105"
        }`}
        title="Chat with this document (Gemini)"
        aria-label="Open document chat"
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquareText className="h-5 w-5" />}
        <span className="text-sm font-semibold">{open ? "Close" : "Ask document"}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="chat-panel"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-24 right-6 z-30 flex h-[min(80vh,720px)] w-[min(96vw,440px)] flex-col overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-2xl"
            role="dialog"
            aria-label="Document chat"
          >
            <div className="flex items-center justify-between gap-2 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-fuchsia-50 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-violet-900">
                  <Sparkles className="h-4 w-4" /> Ask this document
                </div>
                <div className="truncate text-[11px] text-violet-700/80" title={doc.filename}>
                  {doc.filename}
                </div>
              </div>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={clear}
                  className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-white/80 px-2 py-1 text-[11px] text-violet-800 hover:bg-violet-50"
                  title="Clear conversation"
                >
                  <Trash2 className="h-3 w-3" /> Clear
                </button>
              )}
            </div>

            <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <p className="text-xs text-ink-600 leading-relaxed">
                    Powered by <strong>Gemini</strong> on this document's English text.
                    {(doc.raw_ocr_english ?? "").trim() === "" && (doc.raw_ocr ?? "").trim() === "" && (
                      <span className="block mt-1 text-amber-700">
                        Run OCR (and Translate to English) first — there's no extracted text yet.
                      </span>
                    )}
                  </p>
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-violet-700">Try</div>
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        disabled={busy}
                        className="block w-full rounded-lg border border-violet-200/80 bg-violet-50/40 px-3 py-2 text-left text-[12px] text-ink-800 hover:bg-violet-100/60 disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${
                      m.role === "user"
                        ? "bg-violet-600 text-white"
                        : "bg-white border border-violet-100 text-ink-900"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}

              {busy && (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-2 rounded-2xl border border-violet-100 bg-white px-3 py-2 text-sm text-violet-700 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  {error}
                </div>
              )}
            </div>

            <div className="border-t border-violet-100 bg-violet-50/30 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={taRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Ask anything about the document…"
                  rows={2}
                  disabled={busy}
                  className="input flex-1 resize-none text-sm leading-snug"
                />
                <button
                  type="button"
                  onClick={() => send()}
                  disabled={busy || !input.trim()}
                  className="btn-primary px-3 py-2"
                  title="Send (Enter)"
                  aria-label="Send"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-ink-500">
                Enter to send · Shift+Enter for newline · answers cite page numbers when relevant
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
