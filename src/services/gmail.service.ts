import { google, gmail_v1 } from 'googleapis';
import cron from 'node-cron';
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
import type { ScheduledTask } from 'node-cron';
import { config, isGmailEnabled } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getGmailRepository, type GmailWatchLabel } from '../database/repositories/gmail.repository.js';
import { encryptToken, decryptToken } from './gmail-crypto.js';
import type { WhatsAppService } from './whatsapp.service.js';
import type { GeminiService } from './gemini.service.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
];

const SEEN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_MESSAGES_PER_POLL = 10;

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  labelNames: string[];
}

export class GmailService {
  private cronTask: ScheduledTask | null = null;
  private polling = false;

  constructor(private whatsapp: WhatsAppService, private gemini: GeminiService) {}

  // --- Lifecycle ---

  async start(): Promise<void> {
    if (!isGmailEnabled()) {
      logger.info('GmailService disabled (missing GMAIL_* env vars)');
      return;
    }
    this.cronTask = cron.schedule(config.gmailPollCron, () => {
      this.pollInbox().catch(err => logger.error('Gmail poll error:', err));
    });
    logger.info(`GmailService started, polling on cron: ${config.gmailPollCron}`);
  }

  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
    logger.info('GmailService stopped');
  }

  // --- Owner-JID guard ---

  isOwner(jid: string): boolean {
    return isGmailEnabled() && jid === config.gmailOwnerJid;
  }

  private assertOwner(jid: string): void {
    if (!this.isOwner(jid)) {
      throw new Error('Gmail tools are restricted to the owner JID');
    }
  }

  // --- OAuth2 ---

  private buildOAuthClient(): OAuth2Client {
    return new google.auth.OAuth2(
      config.gmailClientId,
      config.gmailClientSecret,
      config.gmailRedirectUri
    );
  }

  getAuthUrl(jid: string): string {
    this.assertOwner(jid);
    const oauth = this.buildOAuthClient();
    return oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // force refresh_token on every consent
      scope: SCOPES,
      state: jid,
    });
  }

  async handleOAuthCallback(code: string, state: string): Promise<{ email: string }> {
    this.assertOwner(state);
    const oauth = this.buildOAuthClient();
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error('Google did not return a refresh_token. Revoke prior consent at https://myaccount.google.com/permissions and try again.');
    }
    oauth.setCredentials(tokens);
    const profile = await google.gmail({ version: 'v1', auth: oauth }).users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress || '';

    getGmailRepository().saveCredentials({
      jid: state,
      refresh_token_enc: encryptToken(tokens.refresh_token),
      email_address: email,
      scopes: SCOPES.join(' '),
    });
    logger.info(`Gmail linked for JID ${state.slice(0, 6)}... (email address hidden)`);
    return { email };
  }

  private async getGmailClient(jid: string): Promise<gmail_v1.Gmail> {
    this.assertOwner(jid);
    const rec = getGmailRepository().getCredentials(jid);
    if (!rec) throw new Error('Gmail not linked for this JID. Run the OAuth flow first.');
    const oauth = this.buildOAuthClient();
    oauth.setCredentials({ refresh_token: decryptToken(rec.refresh_token_enc) });
    return google.gmail({ version: 'v1', auth: oauth });
  }

  // --- Polling ---

  async pollInbox(): Promise<void> {
    if (this.polling) return; // reentrancy guard
    this.polling = true;
    try {
      const ownerJid = config.gmailOwnerJid;
      const repo = getGmailRepository();
      const labels = repo.listWatchLabels(ownerJid);
      const senders = repo.listWatchSenders(ownerJid);
      if (labels.length === 0 && senders.length === 0) return;

      const credentials = repo.getCredentials(ownerJid);
      if (!credentials) {
        logger.warn('Gmail poll: owner not linked, skipping');
        return;
      }

      const gmail = await this.getGmailClient(ownerJid);

      // Label-based queries
      for (const label of labels) {
        try {
          const list = await gmail.users.messages.list({
            userId: 'me',
            labelIds: [label.label_id],
            q: 'is:unread newer_than:1d',
            maxResults: MAX_MESSAGES_PER_POLL,
          });
          const messages = list.data.messages || [];
          for (const m of messages) {
            if (!m.id) continue;
            if (repo.isSeen(ownerJid, m.id)) continue;
            try {
              await this.notifyAboutMessage(gmail, ownerJid, m.id, label.label_name);
              repo.markSeen(ownerJid, m.id);
            } catch (err) {
              logger.error(`Failed to notify about message id=${m.id}:`, err);
            }
          }
        } catch (err) {
          logger.error(`Failed to list messages for label ${label.label_name}:`, err);
        }
      }

      // Sender-based query (single combined OR query)
      if (senders.length > 0) {
        try {
          const fromClause = senders.map(e => `from:${e}`).join(' OR ');
          const list = await gmail.users.messages.list({
            userId: 'me',
            q: `(${fromClause}) is:unread newer_than:1d`,
            maxResults: MAX_MESSAGES_PER_POLL,
          });
          const messages = list.data.messages || [];
          for (const m of messages) {
            if (!m.id) continue;
            if (repo.isSeen(ownerJid, m.id)) continue;
            try {
              await this.notifyAboutMessage(gmail, ownerJid, m.id, 'sender-watch');
              repo.markSeen(ownerJid, m.id);
            } catch (err) {
              logger.error(`Failed to notify (sender) about message id=${m.id}:`, err);
            }
          }
        } catch (err) {
          logger.error('Failed to list messages by sender watch:', err);
        }
      }

      const pruned = repo.pruneSeen(SEEN_RETENTION_MS);
      if (pruned > 0) logger.info(`Pruned ${pruned} old seen-message records`);
    } finally {
      this.polling = false;
    }
  }

  private async notifyAboutMessage(
    gmail: gmail_v1.Gmail,
    jid: string,
    messageId: string,
    source: string
  ): Promise<void> {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });
    const headers = msg.data.payload?.headers || [];
    const get = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
    const from = get('From');
    const subject = get('Subject') || '(ללא נושא)';
    const snippet = (msg.data.snippet || '').slice(0, 300);

    const text = [
      `📧 *מייל חדש* (${source})`,
      `*מאת:* ${from}`,
      `*נושא:* ${subject}`,
      '',
      snippet,
      '',
      `_id: ${messageId}_`,
    ].join('\n');

    await this.whatsapp.sendTextMessage(jid, text);
    logger.info(`Gmail notified jid=${jid.slice(0, 6)}... source=${source} msgId=${messageId}`);
  }

  // --- Public read/write API (used by Gemini function handlers) ---

  async listRecentEmails(jid: string, opts: { labelName?: string; query?: string; max?: number } = {}): Promise<EmailSummary[]> {
    const gmail = await this.getGmailClient(jid);
    const repo = getGmailRepository();

    let labelIds: string[] | undefined;
    if (opts.labelName) {
      const all = repo.listWatchLabels(jid);
      const match = all.find(l => l.label_name.toLowerCase() === opts.labelName!.toLowerCase());
      if (match) labelIds = [match.label_id];
    }

    const list = await gmail.users.messages.list({
      userId: 'me',
      labelIds,
      q: opts.query,
      maxResults: Math.min(opts.max ?? 10, 20),
    });
    const messages = list.data.messages || [];
    const out: EmailSummary[] = [];
    for (const m of messages) {
      if (!m.id) continue;
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });
      const headers = msg.data.payload?.headers || [];
      const get = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
      out.push({
        id: m.id,
        threadId: msg.data.threadId || '',
        from: get('From'),
        subject: get('Subject'),
        date: get('Date'),
        snippet: (msg.data.snippet || '').slice(0, 200),
        labelNames: (msg.data.labelIds || []),
      });
    }
    return out;
  }

  async readEmail(jid: string, messageId: string): Promise<{ from: string; subject: string; date: string; body: string; threadId: string }> {
    const gmail = await this.getGmailClient(jid);
    const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const headers = msg.data.payload?.headers || [];
    const get = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
    const body = extractPlainBody(msg.data.payload) || msg.data.snippet || '';
    return {
      from: get('From'),
      subject: get('Subject'),
      date: get('Date'),
      body,
      threadId: msg.data.threadId || '',
    };
  }

  /**
   * Create a fresh (non-reply) draft email. To/Subject/Body only. Never sends.
   */
  async createDraftNew(jid: string, to: string, subject: string, body: string): Promise<{ draftId: string; threadId: string | null }> {
    const gmail = await this.getGmailClient(jid);
    const mime = buildMime({ to, subject, body });
    const raw = Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw } },
    });
    if (!res.data.id) throw new Error('Gmail drafts.create returned no id');
    logger.info(`Gmail new draft created id=${res.data.id} to=${to.replace(/<.*/, '')}`);
    return { draftId: res.data.id, threadId: res.data.message?.threadId || null };
  }

  /**
   * Create a draft reply. This is a write path. No send. No drafts.send.
   */
  async createDraftReply(jid: string, messageId: string, body: string): Promise<{ draftId: string; threadId: string | null }> {
    const gmail = await this.getGmailClient(jid);
    const orig = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Message-ID', 'References'] });
    const headers = orig.data.payload?.headers || [];
    const get = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const to = get('From');
    const origSubject = get('Subject') || '';
    const subject = origSubject.toLowerCase().startsWith('re:') ? origSubject : `Re: ${origSubject}`;
    const origMsgId = get('Message-ID');
    const refs = get('References');
    const references = refs ? `${refs} ${origMsgId}`.trim() : origMsgId;

    const mime = buildMime({
      to,
      subject,
      body,
      inReplyTo: origMsgId,
      references,
    });
    const raw = Buffer.from(mime).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const res = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          raw,
          threadId: orig.data.threadId || undefined,
        },
      },
    });
    if (!res.data.id) throw new Error('Gmail drafts.create returned no id');
    logger.info(`Gmail draft created id=${res.data.id} for msgId=${messageId}`);
    return { draftId: res.data.id, threadId: res.data.message?.threadId || orig.data.threadId || null };
  }

  // --- Label management (called from WhatsApp) ---

  async addWatchLabel(jid: string, labelName: string): Promise<{ ok: boolean; reason?: string; labelId?: string }> {
    const gmail = await this.getGmailClient(jid);
    const labels = await gmail.users.labels.list({ userId: 'me' });
    const match = (labels.data.labels || []).find(l => l.name?.toLowerCase() === labelName.toLowerCase());
    if (!match || !match.id) return { ok: false, reason: `Label "${labelName}" not found in Gmail. Create it first.` };
    getGmailRepository().addWatchLabel(jid, match.id, match.name!);
    return { ok: true, labelId: match.id };
  }

  async removeWatchLabel(jid: string, labelName: string): Promise<number> {
    this.assertOwner(jid);
    return getGmailRepository().removeWatchLabelByName(jid, labelName);
  }

  listWatchLabels(jid: string): GmailWatchLabel[] {
    this.assertOwner(jid);
    return getGmailRepository().listWatchLabels(jid);
  }

  // --- Sender management (called from WhatsApp) ---

  addWatchSender(jid: string, email: string): void {
    this.assertOwner(jid);
    getGmailRepository().addWatchSender(jid, email);
  }
  removeWatchSender(jid: string, email: string): number {
    this.assertOwner(jid);
    return getGmailRepository().removeWatchSender(jid, email);
  }
  listWatchSenders(jid: string): string[] {
    this.assertOwner(jid);
    return getGmailRepository().listWatchSenders(jid);
  }

  async listAllGmailLabels(jid: string): Promise<{ id: string; name: string }[]> {
    const gmail = await this.getGmailClient(jid);
    const res = await gmail.users.labels.list({ userId: 'me' });
    return (res.data.labels || [])
      .filter(l => l.id && l.name)
      .map(l => ({ id: l.id!, name: l.name! }));
  }
}

// --- Helpers ---

function extractPlainBody(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64').toString('utf-8');
  }
  if (part.parts) {
    for (const p of part.parts) {
      const found = extractPlainBody(p);
      if (found) return found;
    }
  }
  if (part.body?.data) {
    // fallback: decode whatever we have (e.g. text/html)
    return Buffer.from(part.body.data, 'base64').toString('utf-8');
  }
  return '';
}

function detectDir(text: string): 'ltr' | 'rtl' {
  // Hebrew range U+0590-U+05FF, Arabic U+0600-U+06FF + U+0750-U+077F, U+FB50-U+FDFF, U+FE70-U+FEFF
  const rtlChars = text.match(/[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g)?.length || 0;
  const letters = text.match(/[\p{L}]/gu)?.length || 0;
  if (letters === 0) return 'ltr';
  return rtlChars / letters > 0.3 ? 'rtl' : 'ltr';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function plainToHtml(body: string, dir: 'ltr' | 'rtl'): string {
  const escaped = escapeHtml(body);
  // Preserve double-newlines as paragraph breaks, single newlines as <br>
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 1em 0;text-align:${dir === 'rtl' ? 'right' : 'left'};">${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  return `<div dir="${dir}" style="text-align:${dir === 'rtl' ? 'right' : 'left'};">${paragraphs}</div>`;
}

function buildMime(opts: { to: string; subject: string; body: string; inReplyTo?: string; references?: string }): string {
  const dir = detectDir(opts.body);
  const htmlBody = plainToHtml(opts.body, dir);
  const headers: string[] = [
    `To: ${opts.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(opts.subject, 'utf-8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);
  return `${headers.join('\r\n')}\r\n\r\n${htmlBody}`;
}

let instance: GmailService | null = null;
export function getGmailServiceInstance(): GmailService | null {
  return instance;
}
export function setGmailServiceInstance(svc: GmailService | null): void {
  instance = svc;
}
