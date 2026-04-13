import { getMemoryService } from '../memory.service.js';
import { logger } from '../../utils/logger.js';
/**
 * Deterministic workflow for "draft a new email".
 * Sequence is owned by this function — the LLM is used only for the
 * sub-tasks it's good at (recipient resolution, body generation).
 *
 * Returns true if the workflow handled the request (success or user-visible
 * error), false if the caller should fall back to the agent path.
 */
export async function runEmailNewWorkflow(jid, slots, message, deps) {
    const { gemini, gmail, whatsapp } = deps;
    const recipientHint = (slots.recipient_hint || '').trim();
    logger.info(`[workflow:email_new] slots=${JSON.stringify(slots)}`);
    if (!recipientHint) {
        await whatsapp.sendReply(jid, 'למי לשלוח את המייל? (שם או כתובת)', message);
        return true;
    }
    // 1. Resolve recipient.
    const { email, label } = await gemini.resolveEmailRecipient(recipientHint);
    if (!email) {
        await whatsapp.sendReply(jid, `לא מצאתי את "${recipientHint}" בזיכרון. מה הכתובת המלאה?`, message);
        return true;
    }
    logger.info(`[workflow:email_new] resolved recipient "${recipientHint}" → ${email}${label ? ` (${label})` : ''}`);
    // 2. Fetch prior thread context (best-effort; don't block on failure).
    let priorThreadSnippets;
    try {
        const prior = await gmail.listRecentEmails(jid, { query: `from:${email} OR to:${email}`, max: 3 });
        if (prior.length) {
            priorThreadSnippets = prior.map(e => `${e.subject || '(ללא נושא)'} — ${e.snippet}`);
            logger.info(`[workflow:email_new] found ${prior.length} prior messages with ${email}`);
        }
    }
    catch (err) {
        logger.warn('[workflow:email_new] prior-thread fetch failed (continuing):', err);
    }
    // 3. Load core memory to ground the body.
    let ownerCoreMemory;
    try {
        ownerCoreMemory = await getMemoryService().readCore();
    }
    catch (err) {
        logger.warn('[workflow:email_new] core memory read failed (continuing):', err);
    }
    // 4. Generate body (single focused LLM call, structured output).
    const { subject, body } = await gemini.generateEmailBody({
        topicHint: slots.topic_hint || slots.subject_hint || '',
        subjectHint: slots.subject_hint,
        recipientLabel: label,
        recipientEmail: email,
        priorThreadSnippets,
        ownerCoreMemory,
    });
    logger.info(`[workflow:email_new] generated subject="${subject}" bodyLen=${body.length}`);
    if (!body) {
        await whatsapp.sendReply(jid, 'לא הצלחתי לכתוב את גוף המייל. נסה לנסח שוב.', message);
        return true;
    }
    // 5. Create the draft. Deterministic — this is the line the old flow kept skipping.
    try {
        const res = await gmail.createDraftNew(jid, email, subject, body);
        const link = res.threadId
            ? `https://mail.google.com/mail/u/0/#drafts/${res.threadId}`
            : 'https://mail.google.com/mail/u/0/#drafts';
        const preview = body.length > 280 ? body.slice(0, 280) + '…' : body;
        await whatsapp.sendReply(jid, `✅ טיוטה מוכנה.\n📬 ל: ${label ? `${label} <${email}>` : email}\n📝 ${subject}\n\n${preview}\n\n🔗 ${link}\n_לא נשלח — פתח לבדיקה ושלח מהדפדפן._`, message);
        logger.info(`[workflow:email_new] draft created: ${res.draftId}`);
        return true;
    }
    catch (err) {
        logger.error('[workflow:email_new] createDraftNew failed:', err);
        await whatsapp.sendReply(jid, 'שגיאה ביצירת הטיוטה. נסה שוב.', message);
        return true;
    }
}
