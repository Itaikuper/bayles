import { getCalendarLinkRepository } from '../../database/repositories/calendar-link.repository.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
/**
 * Deterministic workflow for "create a calendar event".
 * - Picks calendar by hint, falls back to default.
 * - Resolves date+time via one focused LLM call.
 * - Calls calendar.events.insert directly. Reply ALWAYS shows which calendar
 *   the event landed on + a clickable htmlLink, so silent mis-routing is impossible.
 */
export async function runCalendarCreateWorkflow(jid, slots, message, deps) {
    const { gemini, calendar, whatsapp } = deps;
    logger.info(`[workflow:calendar_create] slots=${JSON.stringify(slots)}`);
    if (!slots.summary_hint) {
        await whatsapp.sendReply(jid, 'מה הכותרת של האירוע? (לדוגמה: "פגישה עם דנה")', message);
        return true;
    }
    // 1. Pick target calendar.
    const repo = getCalendarLinkRepository();
    const links = repo.findByJid(jid);
    if (links.length === 0) {
        await whatsapp.sendReply(jid, '❌ אין לך יומן מקושר. בקש מהמנהל לקשר את היומן שלך.', message);
        return true;
    }
    const targetLink = pickTargetCalendar(links, slots.calendar_hint, repo, jid);
    logger.info(`[workflow:calendar_create] target calendar = ${targetLink.calendar_id} (${targetLink.display_name || '(no label)'})${slots.calendar_hint ? ` [hint: "${slots.calendar_hint}"]` : ' [default]'}`);
    // 2. Resolve date+time.
    const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: config.calendarTimezone });
    let parsed;
    try {
        parsed = await gemini.parseDateTimePhrase({
            mode: 'point',
            datePhrase: slots.date_phrase,
            timePhrase: slots.time_phrase,
            durationPhrase: slots.duration_phrase,
            todayIso,
            timezone: config.calendarTimezone,
        });
    }
    catch (err) {
        logger.error('[workflow:calendar_create] parseDateTimePhrase failed:', err);
        await whatsapp.sendReply(jid, 'לא הצלחתי להבין את התאריך/שעה. נסה שוב עם פירוט.', message);
        return true;
    }
    if (!parsed.startIso || !parsed.endIso) {
        await whatsapp.sendReply(jid, `לא הצלחתי להבין מתי לקבוע — date="${slots.date_phrase || ''}", time="${slots.time_phrase || ''}". נסה שוב.`, message);
        return true;
    }
    const startTime = new Date(parsed.startIso);
    const endTime = new Date(parsed.endIso);
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
        await whatsapp.sendReply(jid, `שגיאה בפירוש זמן: ${parsed.startIso} → ${parsed.endIso}.`, message);
        return true;
    }
    logger.info(`[workflow:calendar_create] time: ${parsed.startIso} → ${parsed.endIso}${parsed.note ? ` (${parsed.note})` : ''}`);
    // 3. Create the event.
    let event;
    try {
        event = await calendar.createEvent(targetLink.calendar_id, slots.summary_hint, startTime, endTime);
    }
    catch (err) {
        logger.error('[workflow:calendar_create] createEvent failed:', err);
        const reason = err instanceof Error ? err.message : 'unknown';
        await whatsapp.sendReply(jid, `❌ לא הצלחתי ליצור אירוע ביומן ${targetLink.display_name || targetLink.calendar_id}.\nסיבה: ${reason}`, message);
        return true;
    }
    logger.info(`[workflow:calendar_create] event created: id=${event.id}`);
    // 4. Build confirmation reply — explicit about WHICH calendar.
    const dateStr = startTime.toLocaleDateString('he-IL', { timeZone: config.calendarTimezone });
    const timeStr = startTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: config.calendarTimezone });
    const durationMin = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
    const lines = [
        `✅ *אירוע נוצר*`,
        `📌 ${slots.summary_hint}`,
        `📅 ${dateStr} בשעה ${timeStr} (${durationMin} דק')`,
        `📁 יומן: ${targetLink.display_name || targetLink.calendar_id}`,
    ];
    if (event.htmlLink)
        lines.push(`🔗 ${event.htmlLink}`);
    if (parsed.note)
        lines.push(`_${parsed.note}_`);
    // Mention other linked calendars so the owner knows hints are available.
    const others = links.filter(l => l.calendar_id !== targetLink.calendar_id);
    if (others.length > 0 && !slots.calendar_hint) {
        const names = others.map(l => l.display_name || l.calendar_id).join(', ');
        lines.push(`_לקביעה ביומן אחר: הוסף "ביומן של ${names}"._`);
    }
    await whatsapp.sendReply(jid, lines.join('\n'), message);
    return true;
}
function pickTargetCalendar(links, hint, repo, jid) {
    if (hint) {
        const h = hint.toLowerCase();
        const matched = links.find(l => (l.calendar_id || '').toLowerCase().includes(h.replace(/@gmail\.com$/, '')) ||
            (l.display_name || '').toLowerCase().includes(h) ||
            ((h.includes('אסתר') || h.includes('ester')) && /ester|esther/i.test(l.calendar_id || '')) ||
            ((h.includes('איתי') || h.includes('itai')) && /itai/i.test(l.calendar_id || '')) ||
            ((h.includes('משותף') || h.includes('shared')) && links.length > 1 && l.calendar_id !== (repo.findDefaultByJid(jid)?.calendar_id || '')));
        if (matched)
            return matched;
        logger.warn(`[workflow:calendar_create] calendar_hint "${hint}" did not match any linked calendar; falling back to default.`);
    }
    return repo.findDefaultByJid(jid) || links[0];
}
