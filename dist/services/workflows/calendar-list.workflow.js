import { getCalendarLinkRepository } from '../../database/repositories/calendar-link.repository.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
/**
 * Deterministic workflow for "what's on my schedule?".
 * - Resolves date phrase via one focused LLM call (no tool loop).
 * - Picks calendar(s) by hint, otherwise lists across all linked calendars
 *   for this JID (matches existing handleCalendarList behavior).
 * - Always replies — never declines.
 */
export async function runCalendarListWorkflow(jid, slots, message, deps) {
    const { gemini, calendar, whatsapp } = deps;
    logger.info(`[workflow:calendar_list] slots=${JSON.stringify(slots)}`);
    const links = getCalendarLinkRepository().findByJid(jid);
    if (links.length === 0) {
        await whatsapp.sendReply(jid, '❌ אין לך יומן מקושר. בקש מהמנהל לקשר את היומן שלך.', message);
        return true;
    }
    // 1. Pick calendars to query.
    const targetLinks = pickCalendars(links, slots.calendar_hint);
    logger.info(`[workflow:calendar_list] querying ${targetLinks.length} calendar(s): ${targetLinks.map(l => l.calendar_id).join(', ')}`);
    // 2. Resolve date range.
    const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: config.calendarTimezone });
    let startIso;
    let endIso;
    if (!slots.date_phrase || /^(today|היום)$/i.test(slots.date_phrase.trim())) {
        // Fast path: today.
        startIso = `${todayIso}T00:00:00`;
        const tomorrow = new Date(`${todayIso}T00:00:00`);
        tomorrow.setDate(tomorrow.getDate() + 1);
        endIso = `${tomorrow.toISOString().slice(0, 10)}T00:00:00`;
    }
    else {
        const parsed = await gemini.parseDateTimePhrase({
            mode: 'range',
            datePhrase: slots.date_phrase,
            todayIso,
            timezone: config.calendarTimezone,
        });
        if (!parsed.startIso || !parsed.endIso) {
            await whatsapp.sendReply(jid, `לא הצלחתי להבין את הטווח "${slots.date_phrase}". נסה "היום", "מחר", "השבוע".`, message);
            return true;
        }
        startIso = parsed.startIso;
        endIso = parsed.endIso;
    }
    logger.info(`[workflow:calendar_list] range ${startIso} → ${endIso}`);
    // 3. List events across selected calendars.
    const allEvents = [];
    for (const link of targetLinks) {
        try {
            const events = await calendar.listEvents(link.calendar_id, new Date(startIso), new Date(endIso), slots.query_hint);
            allEvents.push({ calendarId: link.calendar_id, calendarLabel: link.display_name || link.calendar_id, events });
        }
        catch (err) {
            logger.error(`[workflow:calendar_list] list failed for ${link.calendar_id}:`, err);
            allEvents.push({ calendarId: link.calendar_id, calendarLabel: link.display_name || link.calendar_id, events: [] });
        }
    }
    const totalCount = allEvents.reduce((n, c) => n + c.events.length, 0);
    logger.info(`[workflow:calendar_list] found ${totalCount} events across ${allEvents.length} calendar(s)`);
    // 4. Format reply.
    const label = humanizeRange(slots.date_phrase, startIso, endIso);
    if (totalCount === 0) {
        const where = targetLinks.length === 1 ? ` ביומן ${targetLinks[0].display_name || targetLinks[0].calendar_id}` : '';
        await whatsapp.sendReply(jid, `אין אירועים ${label}${where}.`, message);
        return true;
    }
    const sections = [];
    for (const c of allEvents) {
        if (c.events.length === 0)
            continue;
        const header = allEvents.length > 1 ? `📅 *${c.calendarLabel}*\n` : '';
        const lines = c.events.map(e => {
            const time = formatEventTime(e);
            const summary = e.summary || '(ללא כותרת)';
            return `• ${time} ${summary}`;
        });
        sections.push(`${header}${lines.join('\n')}`);
    }
    const headerLine = `📅 אירועים ${label}:\n\n`;
    await whatsapp.sendReply(jid, headerLine + sections.join('\n\n'), message);
    return true;
}
function pickCalendars(links, hint) {
    if (!hint)
        return links;
    const h = hint.toLowerCase();
    const matched = links.filter(l => (l.calendar_id || '').toLowerCase().includes(h.replace(/@gmail\.com$/, '')) ||
        (l.display_name || '').toLowerCase().includes(h) ||
        (h.includes('אסתר') || h.includes('ester')) && /ester|esther/i.test(l.calendar_id || '') ||
        (h.includes('איתי') || h.includes('itai')) && /itai/i.test(l.calendar_id || ''));
    return matched.length > 0 ? matched : links;
}
function humanizeRange(phrase, startIso, endIso) {
    if (phrase)
        return phrase;
    const startDay = startIso.slice(0, 10);
    const endStartDay = new Date(new Date(endIso).getTime() - 1).toISOString().slice(0, 10);
    if (startDay === endStartDay)
        return `ב-${startDay}`;
    return `מ-${startDay} עד ${endStartDay}`;
}
function formatEventTime(event) {
    if (!event.start)
        return '';
    if (event.start.dateTime) {
        const d = new Date(event.start.dateTime);
        return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: config.calendarTimezone });
    }
    if (event.start.date)
        return '(כל היום)';
    return '';
}
