import React, { useEffect, useRef, useState } from 'react';
import { Bot, CircleHelp, LoaderCircle, MousePointerClick, Send, Sparkles, X } from 'lucide-react';
import { api } from '../api';

const WELCOME = {
  role: 'assistant',
  content: 'Halo! Saya Asisten Panduan edupoin. Tanyakan cara menggunakan fitur aplikasi, misalnya absensi, jadwal, kalender akademik, jurnal, atau cetak dokumen.'
};

export default function HelpChatWidget({ onShowTour }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([WELCOME]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
      inputRef.current?.focus();
    }
  }, [open, messages, busy]);

  async function send(event) {
    event?.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    const history = messages.slice(1).slice(-8).map(({ role, content }) => ({ role, content }));
    setMessages(items => [...items, { role: 'user', content: text }]);
    setQuestion('');
    setBusy(true);
    try {
      const result = await api('/api/assistant/chat', {
        method: 'POST',
        body: { message: text, history }
      });
      setMessages(items => [...items, {
        role: 'assistant',
        content: result.answer,
        tour: result.tour || null
      }]);
    } catch (error) {
      setMessages(items => [...items, { role: 'assistant', content: error.message || 'Asisten edupoin tidak tersedia. Coba lagi.' }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-24 right-3 z-[70] flex flex-col items-end gap-2 sm:right-5 lg:bottom-5" data-edupoin-assistant>
      {open ? (
        <section className="flex h-[min(520px,calc(100dvh-150px))] w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          aria-label="Asisten Panduan edupoin" aria-live="polite">
          <header className="flex items-center gap-2.5 bg-gradient-to-r from-orange-600 to-amber-500 px-3.5 py-3 text-white">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/20"><Bot size={19} /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-extrabold">AI Tutorial edupoin</p>
              <p className="text-[10.5px] text-white/85">Panduan fitur aplikasi sekolah</p>
            </div>
            <button type="button" className="rounded-lg p-1.5 hover:bg-white/15" onClick={() => setOpen(false)} aria-label="Tutup bantuan">
              <X size={16} />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-3" role="log" aria-label="Riwayat percakapan">
            {messages.map((message, index) => (
              <div key={index} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={message.role === 'user'
                  ? 'max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-orange-600 px-3 py-2 text-[12px] leading-relaxed text-white'
                  : 'max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2.5 text-[12px] leading-relaxed text-slate-700 shadow-sm'}>
                  {message.role === 'assistant' ? (
                    <p className="mb-1 flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wide text-orange-600">
                      <Sparkles size={11} /> Panduan edupoin
                    </p>
                  ) : null}
                  {message.content}
                  {message.tour ? (
                    <button type="button" className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[10.5px] font-bold text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100"
                      onClick={() => { onShowTour(message.tour); setOpen(false); }}
                      data-show-tour={message.tour.id}>
                      <MousePointerClick size={13} /> Tunjukkan Tombolnya
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {busy ? (
              <div className="flex justify-start" data-assistant-typing>
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2.5 text-[11px] text-slate-500">
                  <LoaderCircle size={14} className="animate-spin text-orange-500" /> edupoin sedang menyiapkan panduan…
                </div>
              </div>
            ) : null}
          </div>

          <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-200 bg-white p-2.5">
            <textarea ref={inputRef} value={question} onChange={event => setQuestion(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send(event);
                }
              }}
              maxLength={1200} rows={1} placeholder="Tanyakan cara memakai edupoin…"
              className="max-h-24 min-h-10 flex-1 resize-y rounded-xl border border-slate-200 px-3 py-2 text-[12px] text-slate-700 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              aria-label="Pertanyaan untuk Asisten edupoin" />
            <button type="submit" disabled={!question.trim() || busy}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-600 text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Kirim pertanyaan" data-assistant-send>
              <Send size={15} />
            </button>
          </form>
          <p className="border-t border-slate-100 px-3 py-1.5 text-center text-[9.5px] text-slate-400">Hanya panduan aplikasi. Jangan kirim kata sandi atau token rahasia.</p>
        </section>
      ) : null}
      <button type="button" onClick={() => setOpen(value => !value)}
        className="flex h-12 items-center gap-2 rounded-full bg-orange-600 px-4 text-white shadow-lg ring-1 ring-white/80 transition hover:-translate-y-0.5 hover:bg-orange-700 focus:outline-none focus:ring-4 focus:ring-orange-200"
        aria-label={open ? 'Tutup Asisten edupoin' : 'Buka Asisten edupoin'} title="Bantuan edupoin"
        data-edupoin-assistant-toggle>
        {open ? <X size={18} /> : <CircleHelp size={19} />}
        <span className="text-[12px] font-extrabold">Bantuan edupoin</span>
      </button>
    </div>
  );
}
