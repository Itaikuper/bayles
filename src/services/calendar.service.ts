import { google, calendar_v3 } from 'googleapis';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class CalendarService {
  private calendar: calendar_v3.Calendar;
  private calendarId: string;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      keyFile: config.googleServiceAccountKeyFile,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    this.calendar = google.calendar({ version: 'v3', auth });
    this.calendarId = config.googleCalendarId;
  }

  async createEvent(params: {
    summary: string;
    start_datetime: string;
    end_datetime: string;
    location?: string;
    description?: string;
  }): Promise<Record<string, unknown>> {
    try {
      const event: calendar_v3.Schema$Event = {
        summary: params.summary,
        location: params.location,
        description: params.description,
        start: {
          dateTime: params.start_datetime,
          timeZone: config.calendarTimeZone,
        },
        end: {
          dateTime: params.end_datetime,
          timeZone: config.calendarTimeZone,
        },
      };

      const res = await this.calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: event,
      });

      logger.info(`Calendar event created: ${res.data.id}`);
      return {
        success: true,
        event_id: res.data.id,
        summary: res.data.summary,
        start: res.data.start?.dateTime,
        end: res.data.end?.dateTime,
        link: res.data.htmlLink,
      };
    } catch (error) {
      logger.error('Calendar create event error:', error);
      return { success: false, error: String(error) };
    }
  }

  async listEvents(params: {
    time_min?: string;
    time_max?: string;
    max_results?: number;
  }): Promise<Record<string, unknown>> {
    try {
      const now = new Date().toISOString();
      const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const res = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: params.time_min || now,
        timeMax: params.time_max || weekFromNow,
        maxResults: params.max_results || 10,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = (res.data.items || []).map((e) => ({
        event_id: e.id,
        summary: e.summary,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        location: e.location,
        description: e.description,
      }));

      logger.info(`Calendar listed ${events.length} events`);
      return { success: true, events, count: events.length };
    } catch (error) {
      logger.error('Calendar list events error:', error);
      return { success: false, error: String(error) };
    }
  }

  async updateEvent(params: {
    event_id: string;
    summary?: string;
    start_datetime?: string;
    end_datetime?: string;
    location?: string;
    description?: string;
  }): Promise<Record<string, unknown>> {
    try {
      const existing = await this.calendar.events.get({
        calendarId: this.calendarId,
        eventId: params.event_id,
      });

      const updatedEvent: calendar_v3.Schema$Event = {
        summary: params.summary || existing.data.summary,
        location: params.location !== undefined ? params.location : existing.data.location,
        description: params.description !== undefined ? params.description : existing.data.description,
        start: params.start_datetime
          ? { dateTime: params.start_datetime, timeZone: config.calendarTimeZone }
          : existing.data.start,
        end: params.end_datetime
          ? { dateTime: params.end_datetime, timeZone: config.calendarTimeZone }
          : existing.data.end,
      };

      const res = await this.calendar.events.update({
        calendarId: this.calendarId,
        eventId: params.event_id,
        requestBody: updatedEvent,
      });

      logger.info(`Calendar event updated: ${params.event_id}`);
      return {
        success: true,
        event_id: res.data.id,
        summary: res.data.summary,
        start: res.data.start?.dateTime,
        end: res.data.end?.dateTime,
      };
    } catch (error) {
      logger.error('Calendar update event error:', error);
      return { success: false, error: String(error) };
    }
  }

  async deleteEvent(params: { event_id: string }): Promise<Record<string, unknown>> {
    try {
      await this.calendar.events.delete({
        calendarId: this.calendarId,
        eventId: params.event_id,
      });

      logger.info(`Calendar event deleted: ${params.event_id}`);
      return { success: true, event_id: params.event_id };
    } catch (error) {
      logger.error('Calendar delete event error:', error);
      return { success: false, error: String(error) };
    }
  }

  async executeFunction(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (name) {
      case 'calendar_create_event':
        return this.createEvent(args as any);
      case 'calendar_list_events':
        return this.listEvents(args as any);
      case 'calendar_update_event':
        return this.updateEvent(args as any);
      case 'calendar_delete_event':
        return this.deleteEvent(args as any);
      default:
        return { success: false, error: `Unknown function: ${name}` };
    }
  }
}
