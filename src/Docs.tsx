import { toCsv } from './engine/csv.ts'
import { sampleNdjson, sampleFreshdeskCsv } from './engine/sample.ts'
import { DEFAULT_ROI } from './engine/roi.ts'
import { Link, download, copy, Icon } from './ui.tsx'

const TEMPLATE = toCsv(['id', 'subject', 'body', 'channel', 'created_at', 'solved_at', 'agent_reply', 'reopens', 'csat', 'tags', 'escalated', 'handle_minutes'], [
  ['1001', 'Where is my order?', 'I ordered a jacket last week and tracking has not updated.', 'email', '2026-10-02 09:14:00', '2026-10-02 10:01:00', 'Your order shipped yesterday; tracking updates within 24 hours.', 0, 'good', 'shipping, order_status', 'false', 47],
  ['1002', 'Cancel my order', 'Please cancel order 55120, wrong size.', 'chat', '2026-10-02 11:40:00', '2026-10-02 11:52:00', 'Done, the order is cancelled and refunded.', 0, '', 'cancellation', 'false', 12],
])

const SQL = `-- Zendesk tickets synced to a warehouse (e.g. Fivetran schema). Adjust names to yours.
SELECT
  t.id                                   AS id,
  t.subject                              AS subject,
  t.description                          AS body,
  t.via_channel                          AS channel,
  t.created_at                           AS created_at,
  m.solved_at                            AS solved_at,
  m.reopens                              AS reopens,
  m.full_resolution_time_in_minutes      AS handle_minutes,
  t.satisfaction_rating_score            AS csat,
  ARRAY_TO_STRING(t.tags, ',')           AS tags,
  m.group_stations > 1                   AS escalated,
  (SELECT c.body FROM ticket_comment c
    WHERE c.ticket_id = t.id AND c.public AND c.user_id <> t.requester_id
    ORDER BY c.created ASC LIMIT 1)      AS agent_reply
FROM ticket t
JOIN ticket_metric_set m ON m.ticket_id = t.id
WHERE t.created_at >= DATE '2026-10-01' AND t.created_at < DATE '2026-11-01';`

const INTERCOM = `# Pull conversations with their first message via the Intercom REST API.
# Needs an access token with read conversations scope.
curl -s "https://api.intercom.io/conversations?per_page=150" \\
  -H "Authorization: Bearer $INTERCOM_TOKEN" \\
  -H "Intercom-Version: 2.11" \\
  | jq '.conversations' > intercom-conversations.json
# Follow pages.next.starting_after for more pages, then upload the JSON file.`

export default function Docs() {
  return (
    <main className="wrap app-main">
      <div className="page-head"><div><span className="eyebrow">Documentation</span><h1 style={{ marginTop: 8 }}>Getting your tickets out</h1><p className="muted" style={{ marginTop: 10, maxWidth: 640 }}>Export steps checked against each vendor’s help docs in November 2026. Menus move; if a step differs, the field names below are what matters.</p></div></div>
      <div className="docs-layout">
        <nav className="toc" aria-label="On this page">
          {[['zendesk', 'Zendesk'], ['intercom', 'Intercom'], ['freshdesk', 'Freshdesk'], ['generic', 'Generic CSV / SQL'], ['articles', 'Help centre articles'], ['scoring', 'How scoring works'], ['roi', 'ROI assumptions'], ['privacy', 'Privacy and sync'], ['samples', 'Sample files']].map(([id, l]) => <a key={id} href={`#${id}`}>{l}</a>)}
        </nav>
        <div className="docs">
          <h2 id="zendesk" style={{ marginTop: 0 }}>Zendesk</h2>
          <h3>Recommended: JSON export</h3>
          <p>The JSON export includes ticket descriptions and comments, which gives the best intents and lets the app measure how consistently agents answer.</p>
          <ol>
            <li>Make sure data export is enabled. If it is not, the account owner asks Zendesk Support to turn it on.</li>
            <li>In Admin Center, open <b>Account → Tools → Reports</b>, then the <b>Export</b> tab.</li>
            <li>Choose <b>JSON</b>, pick a date range (one month is ideal), choose <b>Tickets</b>, and click <b>Export</b>.</li>
            <li>Zendesk emails a download link. Unzip it and drop the <code>.json</code> file into the importer. It is newline-delimited JSON, one ticket per line; the app reads it as-is.</li>
          </ol>
          <p>Fields used: <code>subject</code>, <code>description</code>, <code>via.channel</code>, <code>created_at</code>, <code>tags</code>, <code>satisfaction_rating.score</code>, <code>metric_set.reopens</code>, <code>metric_set.solved_at</code>, <code>metric_set.full_resolution_time_in_minutes</code>, <code>metric_set.group_stations</code>, and public <code>comments</code> by someone other than the requester (agent replies).</p>
          <h3>CSV export</h3>
          <p>Same screen, choose <b>CSV</b>. Zendesk’s CSV leaves out descriptions and comments, so intents come from subjects only. Detected columns include <code>Id</code>, <code>Subject</code>, <code>Via</code>, <code>Created at</code>, <code>Solved at</code>, <code>Satisfaction Score</code>, <code>Reopens</code>, <code>Replies</code>, <code>Tags</code>, <code>Group stations</code> and <code>Full resolution time in minutes</code>.</p>

          <h2 id="intercom">Intercom</h2>
          <h3>Dataset export (CSV)</h3>
          <ol>
            <li>Go to <b>Reports → Dataset export</b> and select the <b>Conversations</b> dataset.</li>
            <li>Pick the time period, then the columns. Useful ones: Conversation ID, Conversation created at, Channel, Conversation tags, Conversation rating, reopens, Last closed at, First contacted by, and any title or topic attribute.</li>
            <li>Click <b>Export CSV</b>. Browser downloads are capped at 10,000 rows; larger exports are emailed.</li>
          </ol>
          <p>Intercom’s CSV holds reporting metadata, not message text. Map a title or topic column as the subject, or, better, use the API for the first customer message:</p>
          <pre>{INTERCOM}</pre>
          <p>The importer reads <code>source.subject</code>, <code>source.body</code>, <code>statistics.count_reopens</code>, <code>conversation_rating.rating</code>, <code>tags</code>, teammate replies in <code>conversation_parts</code>, and treats an AI agent hand-off to a team as an escalation.</p>

          <h2 id="freshdesk">Freshdesk</h2>
          <ol>
            <li>Open <b>Tickets</b>, filter to the period you want, then click <b>Export</b>.</li>
            <li>Choose CSV and tick: Ticket ID, Subject, Description, Source, Created time, Resolved time, Resolution time (in hrs), Agent interactions, Tags, and Survey results if your plan exposes it.</li>
            <li>Freshdesk emails the file. Upload it; resolution hours are converted to minutes automatically.</li>
          </ol>
          <p>Admins can also schedule this from <b>Admin → Account → Data exports</b>.</p>

          <h2 id="generic">Generic CSV or warehouse SQL</h2>
          <p>Any CSV with a header row works. Only a subject or a message column is required; everything else sharpens the score. You map columns on import, so names do not need to match.</p>
          <div className="row" style={{ margin: '12px 0' }}><button className="btn sm" onClick={() => download('automation-report-template.csv', TEMPLATE, 'text/csv')}><Icon name="download" size={15} />Download CSV template</button></div>
          <p>From a warehouse, a query shaped like this produces a ready file:</p>
          <pre>{SQL}</pre>
          <div className="row"><button className="btn xs" onClick={() => copy(SQL, 'SQL copied')}><Icon name="copy" size={13} />Copy SQL</button></div>

          <h2 id="articles">Help centre articles</h2>
          <p>On a project’s Knowledge tab, enter a Zendesk subdomain (or a custom help-centre domain). The app calls <code>/api/v2/help_center/articles.json</code> directly from your browser; public Help Centers allow this. Private help centres, or other tools, can upload a CSV with <code>title</code>, <code>body</code> and <code>url</code> columns or a JSON array.</p>
          <p>Each intent is matched to its closest article by cosine similarity of MiniLM embeddings: ≥ 0.50 is covered, ≥ 0.36 partial, below that a gap.</p>

          <h2 id="scoring">How scoring works</h2>
          <p>Every intent gets a 0–100 automatability score from up to seven factors, each a 0–1 value with a weight. Factors with no data in your export are dropped and the remaining weights renormalised, never guessed.</p>
          <ul>
            <li><b>Repetitive phrasing</b> (20%): cohesion of the cluster in embedding space, ranked against your other intents.</li>
            <li><b>Information vs account action</b> (24%): share of tickets asking to change something (refund, cancel, address, password…) or to look something up.</li>
            <li><b>Agents give the same answer</b> (14%): similarity between first agent replies within the intent.</li>
            <li><b>Customer sentiment</b> (12%) and <b>escalation history</b> (12%).</li>
            <li><b>Reopen rate</b> (10%), <b>time to resolve</b> vs your median (8%), and <b>satisfaction today</b> (6%).</li>
          </ul>
          <p>Verdicts: <b>human only</b> if the score is under 42, more than 35% of messages are angry, or more than 40% were escalated; <b>needs action API</b> if 30%+ ask for an account change; otherwise <b>automatable</b>. You can override any verdict.</p>
          <p>The number of intents is chosen by silhouette score on a 450-ticket sample (k = 6–22), taking the smallest k within 12% of the best. Merge and split to taste.</p>

          <h2 id="roi">ROI assumptions</h2>
          <p>Assumptions dated November 2026. The app asserts no vendor pricing: per-resolution price, platform fee and setup cost are yours to enter. Defaults for new projects are placeholders:</p>
          <ul>
            <li>Cost per human-handled ticket ${DEFAULT_ROI.costPerTicket}; agent time {DEFAULT_ROI.minutesPerTicket} minutes per ticket.</li>
            <li>AI price ${DEFAULT_ROI.pricePerResolution.toFixed(2)} per resolution (replace with your quote); setup ${DEFAULT_ROI.setupCost.toLocaleString()}; {DEFAULT_ROI.rampMonths}-month S-curve ramp.</li>
            <li>Full-ramp resolution rates: automatable {DEFAULT_ROI.tierRates.automatable * 100}%, needs action API {DEFAULT_ROI.tierRates.action * 100}% (assuming the integration is built), human only 0%.</li>
            <li>Per intent: tier rate × (0.6 + 0.8 × score/100), capped at 95%. Missing help article: ×0.5 conservative, ×0.8 base, ×1 optimistic (assumes you write it).</li>
            <li>Scenarios: conservative ×0.6, base ×1, optimistic ×1.25.</li>
          </ul>
          <p>“Resolved” means answered without escalating to a person, the outcome-based definition Ada uses, rather than any conversation that simply ended without a handoff.</p>

          <h2 id="privacy">Privacy and sync</h2>
          <ul>
            <li>Files are read with the browser File API. Redaction of emails, phones, card numbers (Luhn-checked), IP addresses, street addresses, postal codes and self-introduced names happens first, then cleaning, then embedding.</li>
            <li>The embedding model (all-MiniLM-L6-v2, quantized) downloads from the Hugging Face CDN once and runs in a Web Worker. No ticket text is sent anywhere.</li>
            <li>Signed out, everything stays in IndexedDB on this device. Signed in, the project settings and the derived report sync: intent names, descriptions, keywords, counts, scores, overrides, ROI inputs and article titles. Ticket text, example phrasings, embeddings and article bodies never sync.</li>
            <li>Account menu: export all your data as JSON, delete your cloud data, or delete your account.</li>
          </ul>

          <h2 id="samples">Sample files</h2>
          <p>Northwind Outfitters is a fictional outdoor-apparel store. Its tickets are synthetic, generated with fifteen intents, noise (spam, vague replies, French and Spanish), quoted replies, signatures, HTML and planted PII. October simulates an AI agent going live for order status and sizing.</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => download('northwind-zendesk-sep-2026.json', sampleNdjson(0), 'application/x-ndjson')}><Icon name="download" size={15} />Zendesk JSON · September</button>
            <button className="btn sm" onClick={() => download('northwind-zendesk-oct-2026.json', sampleNdjson(1), 'application/x-ndjson')}><Icon name="download" size={15} />Zendesk JSON · October</button>
            <button className="btn sm" onClick={() => download('northwind-freshdesk-oct-2026.csv', sampleFreshdeskCsv(1), 'text/csv')}><Icon name="download" size={15} />Freshdesk CSV · October</button>
            <Link to="/app?sample=1" className="btn sm primary">Open the sample project</Link>
          </div>
        </div>
      </div>
    </main>
  )
}
