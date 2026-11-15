import React, { useCallback, useEffect, useState } from 'react';
import { Bot, KeyRound, Loader2, Save, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { Alert, Card, Field, Spinner, useToast } from '../../ui';

const EMPTY = {
  base_url: '', model: '', api_key_set: false, env_key_set: false, database_key_set: false,
  fallback_base_url: 'https://api.groq.com/openai/v1', fallback_model: 'llama-3.3-70b-versatile',
  fallback_key_set: false, fallback_env_key_set: false, fallback_database_key_set: false
};

export default function SuperAI() {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [fallbackApiKey, setFallbackApiKey] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await api('/api/super/ai-config');
    setConfig({ ...EMPTY, ...result });
  }, []);

  useEffect(() => { load().catch(error => toast.err(error.message)); }, [load]);

  if (!config) return <Spinner label="Memuat konfigurasi AI…" />;

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api('/api/super/ai-config', {
        method: 'POST',
        body: { api_key: apiKey, base_url: config.base_url, model: config.model }
      });
      setApiKey('');
      setConfig({ ...config, ...result });
      toast.ok(result.pesan);
    } catch (error) {
      toast.err(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    if (!window.confirm('Hapus API key yang tersimpan di pengaturan Super Admin?')) return;
    setBusy(true);
    try {
      const result = await api('/api/super/ai-config', {
        method: 'POST',
        body: { api_key_clear: true, base_url: config.base_url, model: config.model }
      });
      setConfig({ ...config, ...result });
      setApiKey('');
      toast.ok(result.pesan);
    } catch (error) {
      toast.err(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveFallback(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api('/api/super/ai-config', {
        method: 'POST',
        body: {
          fallback_api_key: fallbackApiKey,
          fallback_base_url: config.fallback_base_url,
          fallback_model: config.fallback_model
        }
      });
      setFallbackApiKey('');
      setConfig({ ...config, ...result });
      toast.ok(result.pesan);
    } catch (error) {
      toast.err(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearFallbackKey() {
    if (!window.confirm('Hapus API key penyedia cadangan yang tersimpan?')) return;
    setBusy(true);
    try {
      const result = await api('/api/super/ai-config', {
        method: 'POST',
        body: {
          fallback_api_key_clear: true,
          fallback_base_url: config.fallback_base_url,
          fallback_model: config.fallback_model
        }
      });
      setConfig({ ...config, ...result });
      setFallbackApiKey('');
      toast.ok(result.pesan);
    } catch (error) {
      toast.err(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-page="super-ai">
      <div>
        <h2 className="text-[19px] font-extrabold text-slate-800">Pengaturan AI Tutorial</h2>
        <p className="text-[12.5px] text-slate-500">Hubungkan Asisten Panduan edupoin untuk seluruh sekolah.</p>
      </div>

      <Card title="Kredensial Penyedia AI" subtitle="API key hanya dikirim ke server, tidak pernah ditampilkan kembali pada halaman ini."
        right={<span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${config.api_key_set || config.fallback_key_set
          ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
          {config.api_key_set || config.fallback_key_set ? 'Terhubung' : 'Belum dikonfigurasi'}
        </span>}>
        <form className="space-y-3" onSubmit={save}>
          <Alert tone={config.env_key_set ? 'info' : config.api_key_set ? 'ok' : 'warn'}
            title={config.env_key_set ? 'API key dari environment aktif' : config.database_key_set ? 'API key tersimpan' : 'API key belum diatur'}>
            {config.env_key_set
              ? 'EDUPOIN_AI_API_KEY pada environment server memiliki prioritas atas key dari halaman ini.'
              : config.database_key_set
                ? 'Key tersimpan di database platform dan tidak dikirim balik ke browser.'
                : 'Masukkan API key dari penyedia AI yang kompatibel dengan OpenAI. Jangan memasukkan key sekolah atau token lain.'}
          </Alert>

          <Field label="API Key" hint={config.database_key_set
            ? 'Key tersimpan. Isi kolom ini hanya jika ingin menggantinya.'
            : 'Dapatkan API key dari dashboard penyedia AI; jangan membagikannya kepada pengguna sekolah.'}>
            <input className="input" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)}
              placeholder={config.database_key_set ? '•••••••••••• (tersimpan)' : 'Tempel API key di sini'}
              autoComplete="new-password" maxLength={500} data-ai-api-key />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Base URL" hint="Bawaan OpenAI: https://api.openai.com/v1">
              <input className="input font-mono text-[11.5px]" value={config.base_url || ''}
                onChange={event => setConfig(value => ({ ...value, base_url: event.target.value }))}
                placeholder="https://api.openai.com/v1" data-ai-base-url />
            </Field>
            <Field label="Model" hint="Bawaan: gpt-4o-mini">
              <input className="input" value={config.model || ''}
                onChange={event => setConfig(value => ({ ...value, model: event.target.value }))}
                placeholder="gpt-4o-mini" maxLength={120} data-ai-model />
            </Field>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            {config.database_key_set ? (
              <button type="button" className="btn-danger btn-sm" onClick={clearKey} disabled={busy} data-ai-key-clear>
                <Trash2 size={14} /> Hapus key tersimpan
              </button>
            ) : null}
            <button type="submit" className="btn-primary" disabled={busy} data-ai-save>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Simpan Pengaturan AI
            </button>
          </div>
        </form>
      </Card>

      <Card title="Penyedia Cadangan — Groq" subtitle="Dipakai otomatis jika penyedia utama gagal atau mengembalikan jawaban yang tidak valid."
        right={<span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${config.fallback_key_set
          ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          {config.fallback_key_set ? 'Cadangan aktif' : 'Belum diatur'}
        </span>}>
        <form className="space-y-3" onSubmit={saveFallback}>
          <Alert tone={config.fallback_env_key_set ? 'info' : config.fallback_key_set ? 'ok' : 'warn'}
            title={config.fallback_env_key_set ? 'API key cadangan dari environment aktif' : 'Groq sebagai penyedia alternatif'}>
            {config.fallback_env_key_set
              ? 'EDUPOIN_AI_FALLBACK_API_KEY pada environment server memiliki prioritas atas key dari halaman ini.'
              : 'Buat API key Groq di console.groq.com/keys. Saat layanan utama gagal, pertanyaan dan konteks FAQ yang sama akan dikirim ke Groq. Tanpa key cadangan, sistem tidak dapat beralih otomatis.'}
          </Alert>
          <Field label="API Key Groq" hint={config.fallback_database_key_set
            ? 'Key cadangan tersimpan. Isi hanya bila ingin menggantinya.'
            : 'Masukkan API key Groq. Jangan membagikannya melalui chat.'}>
            <input className="input" type="password" value={fallbackApiKey}
              onChange={event => setFallbackApiKey(event.target.value)}
              placeholder={config.fallback_database_key_set ? '•••••••••••• (tersimpan)' : 'Tempel API key Groq di sini'}
              autoComplete="new-password" maxLength={500} data-ai-fallback-key />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Base URL Groq">
              <input className="input font-mono text-[11.5px]" value={config.fallback_base_url || ''}
                onChange={event => setConfig(value => ({ ...value, fallback_base_url: event.target.value }))}
                placeholder="https://api.groq.com/openai/v1" data-ai-fallback-base-url />
            </Field>
            <Field label="Model Groq" hint="Model bawaan dapat diubah jika provider memperbaruinya.">
              <input className="input" value={config.fallback_model || ''}
                onChange={event => setConfig(value => ({ ...value, fallback_model: event.target.value }))}
                placeholder="llama-3.3-70b-versatile" maxLength={120} data-ai-fallback-model />
            </Field>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {config.fallback_database_key_set ? (
              <button type="button" className="btn-danger btn-sm" onClick={clearFallbackKey} disabled={busy} data-ai-fallback-key-clear>
                <Trash2 size={14} /> Hapus key cadangan
              </button>
            ) : null}
            <button type="submit" className="btn-primary" disabled={busy} data-ai-fallback-save>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Simpan Penyedia Cadangan
            </button>
          </div>
        </form>
      </Card>

      <Card title="Status Asisten edupoin">
        <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
            {config.api_key_set || config.fallback_key_set ? <Bot size={18} /> : <KeyRound size={18} />}
          </span>
          <div className="text-[12px] leading-relaxed text-slate-600">
            <p className="font-semibold text-slate-800">Penyedia utama: {config.api_key_source === 'environment'
                ? 'Railway Variables'
                : config.api_key_source === 'super_admin'
                  ? 'Pengaturan Super Admin'
                  : 'belum tersedia'}
            </p>
            <p>Penyedia cadangan: {config.fallback_key_source === 'environment'
              ? 'Railway Variables'
              : config.fallback_key_source === 'super_admin'
                ? 'Pengaturan Super Admin (Groq)'
                : 'belum tersedia'}</p>
            <p>Pengaturan berlaku global untuk sekolah. Jika penyedia utama gagal, permintaan otomatis dicoba ke Groq. Perubahan berlaku tanpa deploy ulang.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
