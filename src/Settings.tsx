import { useRef, useState } from 'react'
import { useSettings, setSettings, resetSettings, clearAll, toast } from './lib/store.ts'
import { exportAll, importAll } from './lib/actions.ts'
import { useSync } from './lib/sync.ts'
import { DEFAULT_ROI } from './engine/roi.ts'
import { Icon, Modal, download } from './ui.tsx'

export default function SettingsPage() {
  const s = useSettings()
  const sync = useSync()
  const [wipe, setWipe] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const mode = document.documentElement.dataset.themeMode
  const setMode = (m: string) => { document.documentElement.dataset.themeMode = m; localStorage.setItem('themeMode', m); toast({ text: `${m === 'dark' ? 'Dark' : 'Light'} mode` }) }

  const clearModel = async () => {
    const keys = await caches.keys()
    let n = 0
    for (const k of keys) if (/transformers/i.test(k)) { await caches.delete(k); n++ }
    toast({ text: n ? 'Model cache cleared. It downloads again on next use.' : 'No cached model found', kind: 'ok' })
  }

  return (
    <main className="narrow app-main">
      <div className="page-head"><div><span className="eyebrow">Preferences</span><h1 style={{ marginTop: 8 }}>Settings</h1></div></div>
      <div className="col" style={{ gap: 20 }}>
        <section className="card col">
          <h4>Appearance</h4>
          <div className="seg" role="group" aria-label="Theme">
            <button aria-pressed={mode === 'dark'} onClick={() => setMode('dark')}>Dark</button>
            <button aria-pressed={mode === 'light'} onClick={() => setMode('light')}>Light</button>
          </div>
        </section>

        <section className="card col">
          <h4>Analysis</h4>
          <label className="check"><input type="radio" name="emb" checked={s.embedder === 'minilm'} onChange={() => setSettings({ embedder: 'minilm' })} /><span>Semantic (all-MiniLM-L6-v2)<br /><span className="xs muted">Best intents. Downloads a ~23 MB model once, then runs offline in a Web Worker.</span></span></label>
          <label className="check"><input type="radio" name="emb" checked={s.embedder === 'lexical'} onChange={() => setSettings({ embedder: 'lexical' })} /><span>Lexical (offline, instant)<br /><span className="xs muted">Groups by shared words. Use when the model cannot be downloaded.</span></span></label>
          <label className="check"><input type="checkbox" checked={s.reuseCatalogue} onChange={e => setSettings({ reuseCatalogue: e.target.checked })} /><span>Keep the intent catalogue when importing into an existing project<br /><span className="xs muted">Makes month-over-month comparison exact.</span></span></label>
          <div><button className="btn sm" onClick={clearModel}>Clear downloaded model</button></div>
        </section>

        <section className="card col">
          <h4>Redaction</h4>
          <p className="small muted">Emails, phone numbers, Luhn-valid card numbers and IP addresses are always redacted before anything else happens.</p>
          <label className="check"><input type="checkbox" checked={s.redactAddresses} onChange={e => setSettings({ redactAddresses: e.target.checked })} />Street addresses and postal codes</label>
          <label className="check"><input type="checkbox" checked={s.redactNames} onChange={e => setSettings({ redactNames: e.target.checked })} />Names customers introduce (“my name is …”)</label>
        </section>

        <section className="card col">
          <h4>Default ROI assumptions for new projects</h4>
          <div className="grid2" style={{ gap: 14 }}>
            <label className="field">Cost per human-handled ticket ($)<input className="input num" type="number" min={0} step={0.5} value={s.defaultRoi.costPerTicket} onChange={e => setSettings({ defaultRoi: { ...s.defaultRoi, costPerTicket: +e.target.value || 0 } })} /></label>
            <label className="field">AI price per resolution ($)<input className="input num" type="number" min={0} step={0.05} value={s.defaultRoi.pricePerResolution} onChange={e => setSettings({ defaultRoi: { ...s.defaultRoi, pricePerResolution: +e.target.value || 0 } })} /></label>
            <label className="field">Agent minutes per ticket<input className="input num" type="number" min={0} value={s.defaultRoi.minutesPerTicket} onChange={e => setSettings({ defaultRoi: { ...s.defaultRoi, minutesPerTicket: +e.target.value || 0 } })} /></label>
            <label className="field">Setup cost ($)<input className="input num" type="number" min={0} step={1000} value={s.defaultRoi.setupCost} onChange={e => setSettings({ defaultRoi: { ...s.defaultRoi, setupCost: +e.target.value || 0 } })} /></label>
          </div>
          <div><button className="linkish xs" onClick={() => setSettings({ defaultRoi: DEFAULT_ROI })}>Reset to defaults</button></div>
        </section>

        <section className="card col">
          <h4>Your data</h4>
          <p className="small muted">Projects live in this browser’s IndexedDB.{sync.email ? ` Signed in as ${sync.email}; derived reports sync to your account.` : ' You are not signed in, so nothing leaves this device.'}</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={async () => download(`automation-report-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportAll(), 'application/json')}><Icon name="download" size={15} />Export all (JSON)</button>
            <button className="btn sm" onClick={() => file.current?.click()}><Icon name="upload" size={15} />Restore backup</button>
            <button className="btn sm danger" onClick={() => setWipe(true)}><Icon name="trash" size={15} />Delete all local data</button>
            <input ref={file} type="file" hidden accept=".json" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { const n = await importAll(await f.text()); toast({ text: `Restored ${n} projects`, kind: 'ok' }) } catch (x) { toast({ text: (x as Error).message, kind: 'error' }) } }} />
          </div>
          <div><button className="linkish xs" onClick={() => { resetSettings(); toast({ text: 'Settings reset' }) }}>Reset all settings</button></div>
        </section>
      </div>
      {wipe && (
        <Modal title="Delete all local data?" onClose={() => setWipe(false)}>
          <p className="small muted">Removes every project, snapshot and embedding from this browser. Cloud copies (if you are signed in) are not touched. Export a backup first if you might need it.</p>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
            <button className="btn sm" onClick={() => setWipe(false)}>Cancel</button>
            <button className="btn sm danger" onClick={async () => { await clearAll(); setWipe(false); toast({ text: 'Local data deleted', kind: 'ok' }) }}>Delete everything</button>
          </div>
        </Modal>
      )}
    </main>
  )
}
