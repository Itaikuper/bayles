import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';

export const calendarFunctionDeclarations: FunctionDeclaration[] = [
  {
    name: 'calendar_create_event',
    description: 'Create a new event on the family Google Calendar. Use when the user wants to schedule a meeting, appointment, reminder, or any time-based event.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: {
          type: Type.STRING,
          description: 'Event title/name in Hebrew (e.g., "פגישה עם אבי")',
        },
        start_datetime: {
          type: Type.STRING,
          description: 'Event start date and time in ISO 8601 format (e.g., "2025-03-15T10:00:00"). Calculate actual date from relative references like "tomorrow", "next Tuesday".',
        },
        end_datetime: {
          type: Type.STRING,
          description: 'Event end date and time in ISO 8601 format. If not specified by user, default to 1 hour after start.',
        },
        location: {
          type: Type.STRING,
          description: 'Event location (e.g., "זכרון יעקב"). Optional.',
        },
        description: {
          type: Type.STRING,
          description: 'Additional event details/notes. Optional.',
        },
      },
      required: ['summary', 'start_datetime', 'end_datetime'],
    },
  },
  {
    name: 'calendar_list_events',
    description: 'List upcoming events from the family Google Calendar. Use when the user asks what is scheduled, what is coming up, or wants to see the calendar.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        time_min: {
          type: Type.STRING,
          description: 'Start of time range in ISO 8601 format. Default to now if not specified.',
        },
        time_max: {
          type: Type.STRING,
          description: 'End of time range in ISO 8601 format. Default to 7 days from now if not specified.',
        },
        max_results: {
          type: Type.INTEGER,
          description: 'Maximum number of events to return. Default 10.',
        },
      },
    },
  },
  {
    name: 'calendar_update_event',
    description: 'Update an existing event on the family Google Calendar. Use when the user wants to change the time, location, title, or other details of an existing event. You must first list events to find the event_id.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        event_id: {
          type: Type.STRING,
          description: 'The ID of the event to update. Get this from calendar_list_events first.',
        },
        summary: {
          type: Type.STRING,
          description: 'New event title. Only provide if changing.',
        },
        start_datetime: {
          type: Type.STRING,
          description: 'New start date/time in ISO 8601. Only provide if changing.',
        },
        end_datetime: {
          type: Type.STRING,
          description: 'New end date/time in ISO 8601. Only provide if changing.',
        },
        location: {
          type: Type.STRING,
          description: 'New location. Only provide if changing.',
        },
        description: {
          type: Type.STRING,
          description: 'New description. Only provide if changing.',
        },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'calendar_delete_event',
    description: 'Delete/cancel an event from the family Google Calendar. Use when the user wants to remove or cancel an event. You must first list events to find the event_id.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        event_id: {
          type: Type.STRING,
          description: 'The ID of the event to delete. Get this from calendar_list_events first.',
        },
      },
      required: ['event_id'],
    },
  },
];
