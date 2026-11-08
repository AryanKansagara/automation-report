// Synthetic e-commerce support export ("Northwind Outfitters", fictional).
// Deterministic, so the precomputed embedding cache always matches it.
// Contains realistic noise: quoted replies, signatures, HTML, typos, spam, and PII to redact.

import { mulberry32 } from './util.ts'
import { toCsv } from './csv.ts'

type R = () => number
const pick = <T,>(r: R, xs: T[]): T => xs[Math.floor(r() * xs.length)]

const PRODUCTS = ['Trailhead rain jacket', 'Merino base layer', 'Summit 40L pack', 'Coastline sneakers', 'Alpine down vest', 'Cascade hiking boots', 'Harbor fleece', 'Ridge running shorts', 'Lakeside hoodie', 'Basecamp duffel', 'Glacier gloves', 'Canyon water bottle']
const CITIES = ['Toronto', 'Vancouver', 'Calgary', 'Montreal', 'Seattle', 'Denver', 'Austin', 'Chicago', 'Portland', 'Boston', 'Ottawa', 'Halifax']
const FIRST = ['Maya', 'Liam', 'Priya', 'Jordan', 'Sofia', 'Noah', 'Aisha', 'Ethan', 'Chloe', 'Mateo', 'Hannah', 'Owen', 'Zara', 'Lucas', 'Emma', 'Ravi', 'Grace', 'Diego', 'Nora', 'Sam']
const LAST = ['Patel', 'Nguyen', 'Smith', 'Garcia', 'Chen', 'Okafor', 'Martin', 'Kowalski', 'Haddad', 'Silva', 'Brown', 'Tremblay', 'Singh', 'Rossi', 'Kim']
const STREETS = ['Maple Avenue', 'King Street', 'Oak Drive', 'Queen Street', 'Birch Lane', 'Elm Road', 'Lakeshore Boulevard', 'Cedar Court', 'Pine Crescent', 'Harbour Way']
const POSTAL = ['M5V 2T6', 'V6B 1A1', 'T2P 3H4', 'H3B 2Y5', 'K1P 5J2', 'B3J 1V4']
const CARDS = ['4111 1111 1111 1111', '5555 5555 5555 4444', '4012 8888 8888 1881', '3782 822463 10005']

interface Intent {
  key: string
  weight: [number, number] // share weight in month A, month B
  subjects: string[]
  asks: string[]
  details: string[]
  replies: string[]
  channel: [string, number][]
  handle: [number, number] // median minutes, spread
  reopen: number
  escalate: number
  csatGood: number
  angry: number
  tags: string[]
  agentReplies: [number, number]
}

const I: Intent[] = [
  { key: 'wismo', weight: [16, 9], tags: ['order_status', 'shipping'], channel: [['email', 5], ['chat', 4], ['web', 1]], handle: [35, 0.7], reopen: 0.05, escalate: 0.02, csatGood: 0.86, angry: 0.06, agentReplies: [1, 1],
    subjects: ['Where is my order?', 'Order #{order} not arrived', 'Tracking not updating', 'When will my order ship?', 'Package status', 'Still waiting on order {order}', 'order hasnt shipped'],
    asks: ['Where is my order? I placed it {days} days ago and haven\'t received anything.', 'My tracking number hasn\'t updated since {weekday}. Can you tell me where my package is?', 'I ordered the {product} on {weekday} and it still says processing. When will it ship?', 'Hi, just checking on order #{order}. The tracking page shows nothing yet.', 'My order #{order} was supposed to arrive {weekday} but it\'s not here. Is it lost?', 'can u tell me when my order will arrive? its been {days} days', 'Tracking says delivered but I never got the package for order {order}.'],
    details: ['I need it before a trip next week.', 'It was a gift so I\'m a bit worried.', '', 'Shipping to {city}.', 'The email said 3-5 business days.'],
    replies: ['Thanks for reaching out! I checked order #{order} and it shipped on {weekday} with Canada Post. You can follow it here: tracking link. It should arrive within 2 business days.', 'Your order #{order} is with the carrier and currently in transit to {city}. Tracking updates can lag by 24 hours, so you should see movement soon. Expected delivery is within 3 business days.', 'I looked up order #{order}: it was packed today and will ship tonight. You will get a tracking email as soon as the carrier scans it.'] },
  { key: 'return', weight: [10, 10], tags: ['returns'], channel: [['email', 6], ['web', 3], ['chat', 2]], handle: [70, 0.6], reopen: 0.08, escalate: 0.03, csatGood: 0.8, angry: 0.04, agentReplies: [1, 2],
    subjects: ['Return request', 'How do I return an item', 'Need a return label', 'Exchange for a different size', 'Return {product}'],
    asks: ['I\'d like to start a return for the {product}. It doesn\'t fit. Can you send me a return label?', 'How do I send this back? The {product} isn\'t what I expected.', 'Can I exchange the {product} for a size {size}? Do I need a return label?', 'I need to return my order #{order}. What\'s the process?', 'I want to return the {product}, it\'s unworn with tags. Please send a return label.'],
    details: ['Order number is {order}.', 'I bought it {days} days ago.', '', 'I live in {city}.'],
    replies: ['I\'ve created a prepaid return label for order #{order}; it\'s attached to this email. Drop the parcel at any post office within 30 days and we\'ll refund you once it arrives.', 'Happy to help with an exchange. I\'ve set up the exchange for size {size} and emailed you a prepaid return label. The new item ships as soon as the return is scanned.'] },
  { key: 'refund-status', weight: [7, 7], tags: ['refund'], channel: [['email', 7], ['chat', 3]], handle: [60, 0.7], reopen: 0.12, escalate: 0.05, csatGood: 0.7, angry: 0.12, agentReplies: [1, 2],
    subjects: ['Refund status', 'Where is my refund?', 'Refund not received', 'Return received but no refund'],
    asks: ['I returned the {product} {days} days ago and still haven\'t seen my refund. When will it come through?', 'You received my return last week but I haven\'t been refunded yet. Order #{order}.', 'How long do refunds take? My return was delivered on {weekday}.', 'Still waiting for my refund for order {order}. Can you check?'],
    details: ['It was paid by credit card.', '', 'The refund should be ${amount}.', 'I paid with PayPal.'],
    replies: ['I checked order #{order}: your refund of ${amount} was issued on {weekday}. Banks usually take 5-10 business days to post it to your statement.', 'Your return arrived and the refund was processed today. You should see it within 5-10 business days depending on your bank.'] },
  { key: 'cancel', weight: [6, 6], tags: ['cancellation'], channel: [['chat', 5], ['email', 4], ['phone', 1]], handle: [25, 0.6], reopen: 0.04, escalate: 0.03, csatGood: 0.82, angry: 0.05, agentReplies: [1, 1],
    subjects: ['Cancel my order', 'Please cancel order {order}', 'Cancellation request', 'ordered by mistake'],
    asks: ['Please cancel my order #{order}, I ordered the wrong size.', 'I need to cancel my order placed this morning. Is it too late?', 'Can you cancel order {order}? I found it cheaper elsewhere.', 'I accidentally ordered two {product}s, please cancel one of them.'],
    details: ['', 'It hasn\'t shipped yet I think.', 'Thanks in advance.'],
    replies: ['Done! I\'ve cancelled order #{order} before it shipped. The refund of ${amount} will go back to your original payment method in 3-5 business days.', 'Unfortunately order #{order} already shipped, so I can\'t cancel it, but you can return it free of charge once it arrives.'] },
  { key: 'address', weight: [4, 4], tags: ['address_change'], channel: [['chat', 5], ['email', 5]], handle: [20, 0.6], reopen: 0.03, escalate: 0.02, csatGood: 0.85, angry: 0.03, agentReplies: [1, 1],
    subjects: ['Change shipping address', 'Wrong address on order', 'Update delivery address', 'Address change for {order}'],
    asks: ['I put the wrong shipping address on order #{order}. Can you change it to {address}?', 'Can I update the delivery address for my order? I\'m moving next week.', 'Please change the address on order {order}, it should go to my office instead.'],
    details: ['The new address is {address}.', '', 'Phone number if needed: {phone}.'],
    replies: ['I\'ve updated the shipping address on order #{order}. You\'ll get a confirmation email shortly.', 'The order has already left our warehouse, so I\'ve asked the carrier to redirect it. You\'ll get an update from them within a day.'] },
  { key: 'damaged', weight: [6, 7], tags: ['damaged', 'quality'], channel: [['email', 8], ['chat', 2]], handle: [260, 0.8], reopen: 0.18, escalate: 0.22, csatGood: 0.55, angry: 0.35, agentReplies: [2, 4],
    subjects: ['Item arrived damaged', 'Defective {product}', 'Broken zipper', 'Quality issue', 'Torn seam after one wear'],
    asks: ['The {product} arrived with a torn seam. This is really disappointing for the price.', 'The zipper on my {product} broke after two days. I want a replacement or refund.', 'My {product} came damaged, the box was crushed and the item is scuffed. Photos attached.', 'The sole of my boots is already coming apart after {days} days. This is unacceptable.', 'Received the {product} with a stain on it. Not happy.'],
    details: ['I have photos if you need them.', 'This is the second time this has happened!!', '', 'Order {order}.'],
    replies: ['I\'m really sorry about this. Could you send a photo of the damage? Once I have it, I\'ll arrange a replacement and a prepaid return label for the damaged item.', 'That\'s not the quality we stand behind. I\'ve sent the photos to our quality team and issued a replacement, which ships today.'] },
  { key: 'wrong-item', weight: [3, 3], tags: ['wrong_item', 'fulfillment'], channel: [['email', 7], ['chat', 3]], handle: [180, 0.7], reopen: 0.12, escalate: 0.1, csatGood: 0.6, angry: 0.2, agentReplies: [2, 3],
    subjects: ['Wrong item received', 'Received someone else\'s order', 'Wrong size sent', 'Not what I ordered'],
    asks: ['I ordered the {product} in size {size} but received a size {size2}.', 'The package had the wrong item in it, I got a {product} instead of what I ordered.', 'You sent me the wrong colour. I ordered black and got navy.'],
    details: ['Order #{order}.', 'I need the right one by {weekday}.', ''],
    replies: ['Sorry for the mix-up! I\'ve shipped the correct item with express shipping and emailed a prepaid label for the wrong one.', 'Thanks for letting us know. I\'ve sent a replacement in size {size} and you can keep or donate the wrong item.'] },
  { key: 'sizing', weight: [8, 4], tags: ['product_question', 'sizing'], channel: [['chat', 7], ['email', 2], ['web', 1]], handle: [12, 0.5], reopen: 0.02, escalate: 0.01, csatGood: 0.9, angry: 0.01, agentReplies: [1, 1],
    subjects: ['Sizing question', 'What size should I get?', 'Does the {product} run small?', 'Fit question'],
    asks: ['Does the {product} run true to size? I\'m usually a {size} in other brands.', 'What size should I get in the {product}? I\'m 5\'10 and 170 lbs.', 'Is the {product} more of a slim fit or relaxed fit?', 'Should I size up in the {product} if I want to layer underneath?', 'how does the {product} fit compared to the older version?'],
    details: ['', 'I want to wear it for hiking.', 'Thanks!'],
    replies: ['Great question! The {product} fits true to size with room for a light layer. If you\'re between sizes or want to layer a fleece underneath, size up. Our size guide is on the product page.', 'The {product} has a slim, athletic fit. Most customers who are usually a {size} stay with their size; size up if you prefer a relaxed fit.'] },
  { key: 'promo', weight: [5, 5], tags: ['promo'], channel: [['chat', 7], ['email', 3]], handle: [15, 0.5], reopen: 0.04, escalate: 0.02, csatGood: 0.8, angry: 0.08, agentReplies: [1, 1],
    subjects: ['Promo code not working', 'Discount code issue', 'Coupon won\'t apply', 'Forgot to use my code'],
    asks: ['The discount code WELCOME15 isn\'t working at checkout. It says invalid.', 'My promo code from the newsletter doesn\'t apply to the {product}.', 'I forgot to use my discount code on order #{order}, can you apply it?', 'Why doesn\'t my coupon code work on sale items?'],
    details: ['', 'It says the code is expired but the email says it\'s valid until Sunday.'],
    replies: ['That code excludes items that are already on sale, which is why it didn\'t apply. I\'ve refunded the 15% to your card as a one-time courtesy.', 'The code is valid for first orders only. I\'ve applied the discount manually to order #{order}.'] },
  { key: 'login', weight: [4, 4], tags: ['account', 'login'], channel: [['chat', 5], ['email', 5]], handle: [18, 0.5], reopen: 0.06, escalate: 0.03, csatGood: 0.8, angry: 0.06, agentReplies: [1, 1],
    subjects: ['Can\'t log in', 'Password reset not working', 'Locked out of my account', 'Login issue'],
    asks: ['I can\'t log in to my account. The password reset email never arrives.', 'I\'m locked out after too many attempts. Can you reset my password?', 'The login code never shows up in my inbox. My email is {email}.', 'How do I reset my password? The link says expired.'],
    details: ['', 'I checked spam already.', 'My account email is {email}.'],
    replies: ['I\'ve unlocked your account and sent a fresh password reset link. It\'s valid for one hour, so please use it soon.', 'I sent a new login link to the email on file. If it doesn\'t show up in 5 minutes, check the promotions tab.'] },
  { key: 'payment', weight: [4, 4], tags: ['billing', 'payment'], channel: [['email', 6], ['phone', 2], ['chat', 2]], handle: [90, 0.7], reopen: 0.1, escalate: 0.12, csatGood: 0.62, angry: 0.25, agentReplies: [1, 2],
    subjects: ['Charged twice', 'Payment declined', 'Double charge on my card', 'Pending charge'],
    asks: ['I was charged twice for order #{order}. Please fix this.', 'My card was declined but I still see a pending charge of ${amount}.', 'Why is there a charge from you on my statement? I cancelled that order.', 'Payment didn\'t go through at checkout but the money left my account.'],
    details: ['My card number is {card} if that helps.', '', 'This needs to be fixed today.', 'Call me at {phone}.'],
    replies: ['I checked and the second charge is an authorization hold, not a real charge. It will drop off within 3-5 business days.', 'You\'re right, there were two charges. I\'ve refunded the duplicate; you\'ll see it in 5-10 business days.'] },
  { key: 'shipping-info', weight: [5, 3], tags: ['shipping', 'policy'], channel: [['chat', 6], ['email', 3], ['web', 1]], handle: [10, 0.5], reopen: 0.02, escalate: 0.01, csatGood: 0.9, angry: 0.01, agentReplies: [1, 1],
    subjects: ['Do you ship internationally?', 'Shipping cost question', 'Shipping to the US', 'Express shipping options'],
    asks: ['Do you ship to the UK? How much is shipping?', 'How long does standard shipping take to {city}?', 'Is there free shipping over a certain amount?', 'Do you offer express or overnight shipping?', 'Will I have to pay duties shipping to the US?'],
    details: ['', 'Thinking of ordering a {product}.'],
    replies: ['We ship to Canada, the US and the UK. Standard shipping is free over $100 and takes 3-5 business days; express takes 1-2. US orders ship duty-free.', 'Standard shipping to {city} takes 3-5 business days and is free over $100. Express is available at checkout.'] },
  { key: 'subscription', weight: [4, 4], tags: ['subscription'], channel: [['email', 6], ['chat', 4]], handle: [22, 0.5], reopen: 0.05, escalate: 0.03, csatGood: 0.8, angry: 0.06, agentReplies: [1, 1],
    subjects: ['Skip this month', 'Cancel my subscription', 'Pause sock club', 'Subscription question'],
    asks: ['Can I skip next month\'s sock club box? I have plenty.', 'Please cancel my subscription, I don\'t need it anymore.', 'How do I pause my subscription for two months?', 'I was charged for my subscription but meant to cancel. Can you help?'],
    details: ['', 'Account email {email}.'],
    replies: ['I\'ve skipped your next sock club box. You won\'t be charged this month and your subscription resumes after that.', 'Your subscription is cancelled and you won\'t be charged again. You can restart anytime from your account.'] },
  { key: 'stock', weight: [4, 4], tags: ['product_question', 'stock'], channel: [['chat', 5], ['email', 3], ['web', 2]], handle: [14, 0.5], reopen: 0.02, escalate: 0.01, csatGood: 0.85, angry: 0.02, agentReplies: [1, 1],
    subjects: ['When will {product} be back in stock?', 'Restock date', 'Out of stock', 'Available in size {size}?'],
    asks: ['When will the {product} be back in stock in size {size}?', 'Is the {product} going to be restocked? It\'s sold out everywhere.', 'Do you have the {product} in green? The site says sold out.'],
    details: ['', 'Please let me know!'],
    replies: ['We expect the {product} back in stock in about three weeks. Tap "Notify me" on the product page and you\'ll get an email the moment it\'s available.'] },
  { key: 'complaint', weight: [3, 3], tags: ['complaint', 'escalated'], channel: [['email', 6], ['phone', 4]], handle: [900, 0.9], reopen: 0.3, escalate: 0.75, csatGood: 0.3, angry: 0.8, agentReplies: [2, 5],
    subjects: ['Formal complaint', 'Worst experience ever', 'I want to speak to a manager', 'Disputing the charge', 'Third time contacting you'],
    asks: ['This is the third time I\'ve contacted you and no one has responded. I want to speak to a manager NOW.', 'Your courier left my package in the rain and was rude to me. This is unacceptable and I will be disputing the charge.', 'I am filing a chargeback with my bank. Your company is a scam.', 'I have been waiting {days} days for a resolution. I\'m going to report you to the BBB.'],
    details: ['I want a full refund and an apology.', 'Absolutely ridiculous!!', 'My lawyer will be in touch.', ''],
    replies: ['I\'m very sorry, and I understand your frustration. I\'ve escalated this to our customer care lead, who will call you today.', 'You\'re right to be upset. I\'ve issued a full refund and escalated the courier issue to our logistics manager.'] },
]

const SPAM = ['Boost your SEO ranking today!! Click here for a free audit', 'Partnership opportunity: influencer marketing for your brand', 'Congratulations you have won a gift card, claim now', 'We can build you a mobile app at 50% off']
const VAGUE = ['Thanks!', 'ok', 'Hello?', 'Got it, thank you', 'test', 'Can someone call me back']
const FOREIGN = ['Bonjour, où est ma commande? Je l\'ai passée il y a une semaine.', 'Hola, quiero devolver mi chaqueta, ¿cómo lo hago?', 'Bonjour, je voudrais annuler ma commande s\'il vous plaît.']

const SIGS = ['\n\nThanks,\n{first}\n\nSent from my iPhone', '\n\nBest regards,\n{first} {last}\n{phone}', '\n\nCheers,\n{first}', '\n\n--\n{first} {last}\nSenior Manager, Acme Corp\n{email}', '', '', '']
const QUOTE = '\n\nOn Mon, Sep 8, 2026 at 9:14 AM Northwind Support <help@northwind.example> wrote:\n> Hi {first}, thanks for contacting Northwind Outfitters.\n> We received your request.'
const DISCLAIMER = '\n\nThis email and any attachments are confidential and intended solely for the addressee.'

function fill(r: R, s: string, ctx: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? '')
}

function typo(r: R, s: string): string {
  if (r() > 0.12) return s
  const words = s.split(' ')
  const i = Math.floor(r() * words.length)
  const w = words[i]
  if (w.length > 4) words[i] = w.slice(0, 2) + w[3] + w[2] + w.slice(4)
  return r() < 0.3 ? words.join(' ').toLowerCase() : words.join(' ')
}

function lognormal(r: R, med: number, spread: number) {
  const u = Math.max(1e-6, r()), v = r()
  return med * Math.exp(spread * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v))
}

export interface ZendeskLike {
  id: number
  subject: string
  description: string
  via: { channel: string }
  created_at: string
  requester_id: number
  tags: string[]
  satisfaction_rating: { score: string }
  metric_set: { reopens: number; replies: number; solved_at: string; full_resolution_time_in_minutes: { calendar: number }; group_stations: number }
  comments: { author_id: number; body: string; public: boolean }[]
}

export const SAMPLE_MONTHS = [
  { key: 'sep', label: 'September 2026', start: Date.UTC(2026, 8, 1, 12), days: 30, n: 1400, seed: 901 },
  { key: 'oct', label: 'October 2026 · AI agent live', start: Date.UTC(2026, 9, 1, 12), days: 31, n: 1150, seed: 1002 },
] as const

export function generateSample(month: 0 | 1 = 0): ZendeskLike[] {
  const cfg = SAMPLE_MONTHS[month]
  const r = mulberry32(cfg.seed)
  const totalW = I.reduce((a, x) => a + x.weight[month], 0)
  const out: ZendeskLike[] = []
  for (let n = 0; n < cfg.n; n++) {
    const id = 48000 + month * 2000 + n
    const first = pick(r, FIRST), last = pick(r, LAST)
    const ctx: Record<string, string> = {
      first, last, product: pick(r, PRODUCTS), city: pick(r, CITIES), order: String(100000 + Math.floor(r() * 899999)),
      days: String(3 + Math.floor(r() * 12)), weekday: pick(r, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']),
      size: pick(r, ['S', 'M', 'L', 'XL']), size2: pick(r, ['S', 'M', 'L', 'XL']), amount: (20 + Math.floor(r() * 280)).toFixed(2),
      email: `${first.toLowerCase()}.${last.toLowerCase()}${Math.floor(r() * 90)}@${pick(r, ['gmail.com', 'outlook.com', 'yahoo.ca', 'icloud.com'])}`,
      phone: `(${pick(r, ['416', '604', '403', '514', '206', '312'])}) 555-0${String(100 + Math.floor(r() * 899))}`,
      card: pick(r, CARDS),
      address: `${10 + Math.floor(r() * 980)} ${pick(r, STREETS)}, ${pick(r, CITIES)} ON ${pick(r, POSTAL)}`,
    }
    const created = cfg.start + Math.floor(r() * cfg.days * 86400000)
    const roll = r()
    let subject: string, body: string, it: Intent | null = null
    if (roll < 0.025) { subject = pick(r, ['Business inquiry', 'Quick question', 'Collaboration']); body = pick(r, SPAM) }
    else if (roll < 0.045) { subject = pick(r, ['Re: your request', '(no subject)', 'Follow up']); body = pick(r, VAGUE) }
    else if (roll < 0.055) { subject = pick(r, ['Commande', 'Pedido', 'Question']); body = pick(r, FOREIGN) }
    else {
      let w = r() * totalW
      it = I[I.length - 1]
      for (const x of I) { w -= x.weight[month]; if (w <= 0) { it = x; break } }
      subject = fill(r, pick(r, it.subjects), ctx)
      body = typo(r, fill(r, pick(r, it.asks), ctx))
      const det = fill(r, pick(r, it.details), ctx)
      if (det) body += ' ' + det
      // Extra PII the way customers really volunteer it.
      const p = r()
      if (p < 0.08) body += ` You can reach me at ${ctx.email} or ${ctx.phone}.`
      else if (p < 0.12) body += ` My address is ${ctx.address}.`
      else if (p < 0.13) body += ` My name is ${first} ${last}.`
      if (it.angry > r() && !/!!/.test(body)) body += pick(r, [' Very frustrated.', ' This is ridiculous.', ' Please hurry!!', ''])
    }
    const style = r()
    let description = body + fill(r, pick(r, SIGS), ctx)
    if (style < 0.12) description += fill(r, QUOTE, ctx)
    else if (style < 0.16) description += DISCLAIMER
    else if (style < 0.2) description = `<div><p>${description.replace(/\n/g, '<br>')}</p></div>`
    const channel = it ? weighted(r, it.channel) : pick(r, ['email', 'web'])
    const handle = it ? lognormal(r, it.handle[0], it.handle[1]) : 5 + r() * 30
    const replies = it ? it.agentReplies[0] + Math.floor(r() * (it.agentReplies[1] - it.agentReplies[0] + 1)) : 1
    const reopens = it && r() < it.reopen ? 1 + (r() < 0.2 ? 1 : 0) : 0
    const esc = it ? r() < it.escalate : false
    const rated = r() < 0.38
    const good = it ? r() < it.csatGood : r() < 0.7
    const tags = [...(it?.tags ?? ['other']), ...(esc ? ['escalated', 'tier_2'] : []), ...(r() < 0.1 ? ['vip'] : [])]
    const comments = [{ author_id: 9000 + n, body: description, public: true }]
    if (it) {
      const reply = fill(r, pick(r, it.replies), ctx)
      comments.push({ author_id: 700 + Math.floor(r() * 12), body: `Hi ${first},\n\n${reply}\n\nBest,\n${pick(r, ['Alex', 'Jamie', 'Taylor', 'Morgan', 'Casey'])}\nNorthwind Outfitters Support`, public: true })
    }
    out.push({
      id, subject, description,
      via: { channel },
      created_at: new Date(created).toISOString().replace('.000', ''),
      requester_id: 9000 + n,
      tags,
      satisfaction_rating: { score: rated ? (good ? 'good' : 'bad') : 'unoffered' },
      metric_set: { reopens, replies, solved_at: new Date(created + handle * 60000).toISOString().replace('.000', ''), full_resolution_time_in_minutes: { calendar: Math.round(handle) }, group_stations: esc ? 2 : 1 },
      comments,
    })
  }
  return out
}

function weighted(r: R, xs: [string, number][]): string {
  let w = r() * xs.reduce((a, x) => a + x[1], 0)
  for (const [v, x] of xs) { w -= x; if (w <= 0) return v }
  return xs[0][0]
}

export const sampleNdjson = (month: 0 | 1) => generateSample(month).map(t => JSON.stringify(t)).join('\n') + '\n'

/** Same tickets shaped like a Freshdesk CSV export, for the docs' download links. */
export function sampleFreshdeskCsv(month: 0 | 1): string {
  const rows = generateSample(month).map(t => [t.id, t.subject, t.description, 'Closed', 'Medium', t.via.channel === 'web' ? 'Portal' : t.via.channel[0].toUpperCase() + t.via.channel.slice(1), '', 'Alex', 'Support', t.created_at.replace('T', ' ').replace('Z', ''), t.metric_set.solved_at.replace('T', ' ').replace('Z', ''), (t.metric_set.full_resolution_time_in_minutes.calendar / 60).toFixed(2), t.metric_set.replies, 1, t.tags.join(','), t.satisfaction_rating.score === 'good' ? 'Happy' : t.satisfaction_rating.score === 'bad' ? 'Unhappy' : ''])
  return toCsv(['Ticket ID', 'Subject', 'Description', 'Status', 'Priority', 'Source', 'Type', 'Agent', 'Group', 'Created time', 'Resolved time', 'Resolution time (in hrs)', 'Agent interactions', 'Customer interactions', 'Tags', 'Survey results'], rows)
}

/** A small help centre for the sample brand. Deliberately missing articles for some intents. */
export const SAMPLE_ARTICLES = [
  { id: 'a1', title: 'Tracking your order', body: 'Once your order ships you will receive an email with a tracking number. Tracking can take up to 24 hours to update. Orders ship within 1 business day and arrive in 3-5 business days.', url: 'https://help.northwind.example/tracking' },
  { id: 'a2', title: 'How to return or exchange an item', body: 'You can return unworn items within 30 days. Start a return from your account to get a prepaid return label. Exchanges for a different size ship once the return is scanned.', url: 'https://help.northwind.example/returns' },
  { id: 'a3', title: 'When will I get my refund?', body: 'Refunds are issued to the original payment method once we receive your return. Banks take 5-10 business days to post the refund.', url: 'https://help.northwind.example/refunds' },
  { id: 'a4', title: 'Shipping rates and international delivery', body: 'We ship to Canada, the US and the UK. Standard shipping is free over $100. Express shipping takes 1-2 business days. US orders ship duty-free.', url: 'https://help.northwind.example/shipping' },
  { id: 'a5', title: 'Size guide', body: 'Our jackets and base layers fit true to size. Size up if you want to layer. See each product page for measurements and fit notes.', url: 'https://help.northwind.example/size-guide' },
  { id: 'a6', title: 'Managing your sock club subscription', body: 'Skip a month, pause, or cancel your subscription anytime from your account before the billing date.', url: 'https://help.northwind.example/subscription' },
  { id: 'a7', title: 'Resetting your password', body: 'Use Forgot password on the sign-in page. Reset links expire after one hour. Check your spam folder if the email does not arrive.', url: 'https://help.northwind.example/password' },
  { id: 'a8', title: 'Our sustainability commitments', body: 'We use recycled materials and offset shipping emissions.', url: 'https://help.northwind.example/sustainability' },
]
