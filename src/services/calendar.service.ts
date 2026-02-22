import { google, calendar_v3 } from 'googleapis';
import { readFileSync } from 'fs';
import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getCalendarLinkRepository } from '../database/repositories/calendar-link.repository.js';
import type { WhatsAppService } from './whatsapp.service.js';

export class CalendarService {
  private calendar: calendar_v3.Calendar;
  private cronTask: ScheduledTask | null = null;

  constructor(private whatsapp: WhatsAppService) {
    // Initialize Google Calendar API with service account
    const keyFile = JSON.parse(readFileSync(config.googleServiceAccountPath, 'utf-8'));
    const auth = new google.auth.GoogleAuth({
      credentials: keyFile,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    this.calendar = google.calendar({ version: 'v3', auth });
    logger.info('CalendarService initialized with service account');
  }

  // --- Cron for daily summaries ---

  start(): void {
    this.cronTask = cron.schedule(config.calendarDailySummaryCron, () => {
      this.sendDailySummaries().catch(err =>
        logger.error('Daily calendar summary error:', err)
      );
    }, { timezone: config.calendarTimezone });
    logger.info(`Calendar daily summary cron started: ${config.calendarDailySummaryCron}`);
  }

  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
      logger.info('Calendar daily summary cron stopped');
    }
  }

  async sendDailySummaries(): Promise<void> {
    const repo = getCalendarLinkRepository();
    const links = repo.findDailySummaryLinks();
    if (links.length === 0) return;

    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    // Group links by JID so we send one summary per user
    const byJid = new Map<string, string[]>();
    for (const link of links) {
      const calIds = byJid.get(link.jid) || [];
      calIds.push(link.calendar_id);
      byJid.set(link.jid, calIds);
    }

    for (const [jid, calendarIds] of byJid) {
      try {
        const allEvents: calendar_v3.Schema$Event[] = [];
        for (const calId of calendarIds) {
          const events = await this.listEvents(calId, startOfDay, endOfDay);
          allEvents.push(...events);
        }

        if (allEvents.length === 0) {
          await this.whatsapp.sendTextMessage(jid, '📅 *סיכום יומי*\n\nאין אירועים היום. יום פנוי! 🎉');
        } else {
          allEvents.sort((a, b) => {
            const aTime = a.start?.dateTime || a.start?.date || '';
            const bTime = b.start?.dateTime || b.start?.date || '';
            return aTime.localeCompare(bTime);
          });
          const formatted = this.formatEventList(allEvents, 'היום');
          await this.whatsapp.sendTextMessage(jid, `📅 *סיכום יומי*\n\n${formatted}`);
        }
      } catch (err) {
        logger.error(`Failed to send daily summary to ${jid}:`, err);
      }
    }
  }

  // --- Core Calendar API methods ---

  async listEvents(
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
    query?: string
  ): Promise<calendar_v3.Schema$Event[]> {
    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: config.calendarTimezone,
    };
    if (query) params.q = query;

    const res = await this.calendar.events.list(params);
    return res.data.items || [];
  }

  async createEvent(
    calendarId: string,
    summary: string,
    startTime: Date,
    endTime: Date
  ): Promise<calendar_v3.Schema$Event> {
    const res = await this.calendar.events.insert({
      calendarId,
      requestBody: {
        summary,
        start: { dateTime: startTime.toISOString(), timeZone: config.calendarTimezone },
        end: { dateTime: endTime.toISOString(), timeZone: config.calendarTimezone },
      },
    });
    return res.data;
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    updates: { summary?: string; start?: Date; end?: Date }
  ): Promise<calendar_v3.Schema$Event> {
    const body: calendar_v3.Schema$Event = {};
    if (updates.summary) body.summary = updates.summary;
    if (updates.start) body.start = { dateTime: updates.start.toISOString(), timeZone: config.calendarTimezone };
    if (updates.end) body.end = { dateTime: updates.end.toISOString(), timeZone: config.calendarTimezone };

    const res = await this.calendar.events.patch({
      calendarId,
      eventId,
      requestBody: body,
    });
    return res.data;
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.calendar.events.delete({ calendarId, eventId });
  }

  // --- JID-aware wrappers ---

  async listEventsForJid(
    jid: string,
    startDate: Date,
    endDate: Date,
    query?: string
  ): Promise<calendar_v3.Schema$Event[]> {
    const repo = getCalendarLinkRepository();
    const links = repo.findByJid(jid);
    if (links.length === 0) return [];

    const allEvents: calendar_v3.Schema$Event[] = [];
    for (const link of links) {
      try {
        const events = await this.listEvents(link.calendar_id, startDate, endDate, query);
        allEvents.push(...events);
      } catch (err) {
        logger.error(`Failed to list events from calendar ${link.calendar_id}:`, err);
      }
    }

    allEvents.sort((a, b) => {
      const aTime = a.start?.dateTime || a.start?.date || '';
      const bTime = b.start?.dateTime || b.start?.date || '';
      return aTime.localeCompare(bTime);
    });

    return allEvents;
  }

  async createEventForJid(
    jid: string,
    summary: string,
    startTime: Date,
    endTime: Date
  ): Promise<calendar_v3.Schema$Event | null> {
    const repo = getCalendarLinkRepository();
    const defaultLink = repo.findDefaultByJid(jid);
    if (!defaultLink) return null;

    return this.createEvent(defaultLink.calendar_id, summary, startTime, endTime);
  }

  async searchEventForJid(
    jid: string,
    query: string,
    searchDate: Date
  ): Promise<{ event: calendar_v3.Schema$Event; calendarId: string } | null> {
    const repo = getCalendarLinkRepository();
    const links = repo.findByJid(jid);
    if (links.length === 0) return null;

    // Search in a window around the given date (same day)
    const startOfDay = new Date(searchDate.getFullYear(), searchDate.getMonth(), searchDate.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    for (const link of links) {
      try {
        const events = await this.listEvents(link.calendar_id, startOfDay, endOfDay, query);
        if (events.length > 0) {
          return { event: events[0], calendarId: link.calendar_id };
        }
      } catch (err) {
        logger.error(`Failed to search events in calendar ${link.calendar_id}:`, err);
      }
    }

    return null;
  }

  // --- Formatting ---

  formatEventList(events: calendar_v3.Schema$Event[], label?: string): string {
    if (events.length === 0) {
      return label ? `אין אירועים ${label}` : 'אין אירועים';
    }

    const lines = events.map(event => {
      const summary = event.summary || '(ללא כותרת)';
      const timeStr = this.formatEventTime(event);
      return `• ${timeStr} ${summary}`;
    });

    const header = label ? `📅 אירועים ${label}:\n\n` : '';
    return `${header}${lines.join('\n')}`;
  }

  private formatEventTime(event: calendar_v3.Schema$Event): string {
    if (event.start?.date) {
      // All-day event
      return '🌅 כל היום -';
    }

    if (event.start?.dateTime) {
      const start = new Date(event.start.dateTime);
      const hours = String(start.getHours()).padStart(2, '0');
      const minutes = String(start.getMinutes()).padStart(2, '0');

      if (event.end?.dateTime) {
        const end = new Date(event.end.dateTime);
        const endHours = String(end.getHours()).padStart(2, '0');
        const endMinutes = String(end.getMinutes()).padStart(2, '0');
        return `🕐 ${hours}:${minutes}-${endHours}:${endMinutes}`;
      }

      return `🕐 ${hours}:${minutes}`;
    }

    return '🕐';
  }
}
