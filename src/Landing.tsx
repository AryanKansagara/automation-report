import { HeroMap } from './HeroMap.tsx'
import { Icon, Link } from './ui.tsx'

export function Landing() {
  return (
    <main>
      <section className="hero gridbg">
        <div className="wrap">
          <span className="pillnote"><b>Private</b>Tickets are processed 100% in your browser</span>
          <h1 className="display">See which tickets an AI agent could <em>actually</em> resolve</h1>
          <p className="lead">Drop in a Zendesk, Intercom or Freshdesk export. Get the intents hiding in your queue, how automatable each one is, what it is worth, and what to fix first.</p>
          <div className="ctas">
            <Link to="/app?sample=1" className="btn primary lg">Try the sample <Icon name="arrow" size={16} /></Link>
            <Link to="/app/import" className="btn lg"><Icon name="upload" size={16} />Import your tickets</Link>
          </div>
          <HeroMap />
        </div>
      </section>

      <section className="section" id="why">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">Why this exists</span>
            <h2>Everyone asks how much AI <em>really</em> resolves</h2>
            <p className="lead">Before you buy or tune an AI agent, you need a number you trust. The only honest source for it is your own ticket history.</p>
          </div>
          <div className="grid3" style={{ marginTop: 48 }}>
            <div className="card quote-card">
              <span className="eyebrow">What support leaders keep asking</span>
              <p className="big">“How much of the queue does AI deflection handle for teams like ours?”</p>
              <p className="small muted">A recurring thread in support communities on Reddit. Replies range from anecdotes to vendor case studies, rarely to the asker's own data.</p>
            </div>
            <div className="card quote-card">
              <span className="eyebrow">The definitions problem</span>
              <p className="big">One vendor's “resolved” is another's “contained”.</p>
              <p className="small muted">Vendors define automated resolution differently. Some count any chat that ended without a handoff, so headline rates rarely compare.</p>
            </div>
            <div className="card quote-card">
              <span className="eyebrow">A bar worth using</span>
              <p className="big">Resolved means the request was addressed, with no escalation to a person.</p>
              <p className="small muted">That is how Ada defines an automated resolution, and the bar this report scores against: automatable means answered end to end, not just deflected.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">How it works</span>
            <h2>From raw export to a plan, <em>in one sitting</em></h2>
          </div>
          <div className="grid4" style={{ marginTop: 48 }}>
            {[
              ['01', 'Import and redact', 'Zendesk JSON or CSV, Intercom, Freshdesk or any CSV. The format is detected and columns mapped. Emails, phones, card numbers and addresses are redacted before anything else, with a preview.'],
              ['02', 'Discover intents', 'A sentence-embedding model runs on your device. Seeded k-means picks the number of intents by silhouette; c-TF-IDF and your customers’ own subject lines name them. Rename, merge, split.'],
              ['03', 'Score automatability', 'Repetition, information vs account action, how consistently agents answer, reopens, time to resolve, sentiment and escalations. Every factor explained, every verdict overridable.'],
              ['04', 'Model value and plan', 'Your cost per ticket, your quoted per-resolution price, your ramp. Conservative, base and optimistic ranges, payback month, knowledge gaps and a roadmap of what to launch first.'],
            ].map(([n, h, p]) => (
              <div className="how-step" key={n}>
                <span className="n">{n}</span>
                <h3 style={{ fontSize: 22 }}>{h}</h3>
                <p className="small muted">{p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="privacy">
        <div className="wrap privacy">
          <div className="section-head">
            <span className="eyebrow">Privacy by architecture</span>
            <h2>Your tickets never leave <em>this tab</em></h2>
            <p className="lead">Parsing, redaction, embedding and clustering all run in your browser. The embedding model downloads once and then works offline.</p>
            <ul className="col small muted" style={{ marginTop: 24, paddingLeft: 18, gap: 8 }}>
              <li>No upload step, no server that ever sees a ticket.</li>
              <li>PII is redacted first, so even local storage holds redacted text only.</li>
              <li>Signing in is optional. It syncs the derived report (intent names, counts, scores, ROI inputs), never ticket text.</li>
              <li>Export everything as JSON, or delete your cloud copy and account, any time.</li>
            </ul>
          </div>
          <div>
            <div className="boundary">
              <span className="eyebrow">Your browser</span>
              <div className="flow">
                <div className="node"><Icon name="upload" />Ticket export<small>CSV / JSON</small></div>
                <div className="arrowdown" />
                <div className="node"><Icon name="shield" />Redact PII<small>emails, phones, cards, addresses</small></div>
                <div className="arrowdown" />
                <div className="node"><Icon name="sparkle" />Embed on device<small>MiniLM in a Web Worker</small></div>
                <div className="arrowdown" />
                <div className="node"><Icon name="map" />Intents, scores, ROI<small>IndexedDB</small></div>
              </div>
            </div>
            <div className="cloud-node"><Icon name="cloud" />Optional sync<span className="faint small" style={{ marginLeft: 'auto' }}>derived report only</span></div>
          </div>
        </div>
      </section>

      <section className="section" id="outputs">
        <div className="wrap">
          <div className="section-head">
            <span className="eyebrow">What you walk away with</span>
            <h2>Artifacts you can <em>act on</em></h2>
          </div>
          <div className="grid4" style={{ marginTop: 48 }}>
            {[
              ['doc', 'Executive report', 'A printable, shareable one-pager: automatable share, hours and dollars saved with a range, payback and the top opportunities.'],
              ['route', 'Automation roadmap', 'Now, next, later: what to launch this month, which help articles to write, which action APIs to connect.'],
              ['list', 'Intent catalogue', 'CSV or JSON with each intent’s description, example phrasings, a suggested answer outline and the actions it needs.'],
              ['compare', 'Snapshots and compare', 'Import every month. See whether automation actually shrank a topic’s share of your queue.'],
            ].map(([ic, h, p]) => (
              <div className="card output-card" key={h}>
                <span className="ico"><Icon name={ic} /></span>
                <h3 style={{ fontSize: 20 }}>{h}</h3>
                <p className="small muted">{p}</p>
              </div>
            ))}
          </div>
          <div className="cta-band">
            <h2>Find your first ten automations <em>this afternoon</em></h2>
            <p className="lead" style={{ maxWidth: 560, margin: '18px auto 0' }}>Start with 2,550 synthetic e-commerce tickets, or bring your own export. No account needed.</p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 28, flexWrap: 'wrap' }}>
              <Link to="/app?sample=1" className="btn primary lg">Try the sample <Icon name="arrow" size={16} /></Link>
              <Link to="/docs" className="btn lg">How to export your tickets</Link>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )
}

export function Footer() {
  return (
    <footer className="wrap footer">
      <span>Built by Aryan Kansagara. Independent project, not affiliated with Ada.</span>
      <span><Link to="/docs">Docs</Link><Link to="/app/settings">Settings</Link><Link to="/app">Open the app</Link></span>
    </footer>
  )
}
