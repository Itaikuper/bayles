import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { WhatsAppService } from './whatsapp.service.js';
import { logger } from '../utils/logger.js';
import type { ScheduledMessage, ScheduledMessageInfo } from '../types/index.js';
import { ScheduleRepository } from '../database/repositories/schedule.repository.js';

export class SchedulerService {
  private scheduledMessages: Map<string, ScheduledMessage> = new Map();
  private whatsapp: WhatsAppService;

  constructor(whatsapp: WhatsAppService) {
    this.whatsapp = whatsapp;
  }

  /**
   * Schedule a message with a cron expression
   * @param jid - WhatsApp JID (phone@s.whatsapp.net or groupId@g.us)
   * @param message - Message text to send
   * @param cronExpression - Cron expression (e.g., "0 9 * * *" for 9 AM daily)
   * @param oneTime - If true, cancel after first execution
   * @returns Scheduled message ID
   */
  scheduleMessage(
    jid: string,
    message: string,
    cronExpression: string,
    oneTime: boolean = false
  ): string {
    if (!cron.validate(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const task: ScheduledTask = cron.schedule(cronExpression, async () => {
      try {
        await this.whatsapp.sendTextMessage(jid, message);
        logger.info(`Scheduled message ${id} sent to ${jid}`);

        if (oneTime) {
          this.cancelScheduledMessage(id);
        }
      } catch (error) {
        logger.error(`Failed to send scheduled message ${id} to ${jid}:`, error);
      }
    });

    this.scheduledMessages.set(id, {
      id,
      jid,
      message,
      cronExpression,
      task,
      oneTime,
    });

    logger.info(
      `Scheduled message ${id} for ${jid} with cron: ${cronExpression}${
        oneTime ? ' (one-time)' : ''
      }`
    );
    return id;
  }

  /**
   * Schedule a one-time message at a specific date/time
   * @param jid - WhatsApp JID
   * @param message - Message text
   * @param date - Date to send the message
   * @returns Scheduled message ID
   */
  scheduleOneTimeMessage(jid: string, message: string, date: Date): string {
    const now = new Date();
    if (date <= now) {
      throw new Error('Scheduled date must be in the future');
    }

    const cronExpression = this.dateToCron(date);
    return this.scheduleMessage(jid, message, cronExpression, true);
  }

  /**
   * Convert a Date to a cron expression
   */
  private dateToCron(date: Date): string {
    const minute = date.getMinutes();
    const hour = date.getHours();
    const dayOfMonth = date.getDate();
    const month = date.getMonth() + 1;
    return `${minute} ${hour} ${dayOfMonth} ${month} *`;
  }

  /**
   * Cancel a scheduled message
   * @param id - Scheduled message ID
   * @returns true if cancelled, false if not found
   */
  cancelScheduledMessage(id: string): boolean {
    const scheduled = this.scheduledMessages.get(id);
    if (scheduled) {
      scheduled.task.stop();
      this.scheduledMessages.delete(id);
      logger.info(`Cancelled scheduled message ${id}`);
      return true;
    }
    return false;
  }

  /**
   * List all scheduled messages
   */
  listScheduledMessages(): ScheduledMessageInfo[] {
    return Array.from(this.scheduledMessages.values()).map(
      ({ id, jid, message, cronExpression, oneTime }) => ({
        id,
        jid,
        message,
        cronExpression,
        oneTime,
      })
    );
  }

  /**
   * Cancel all scheduled messages
   */
  cancelAll(): void {
    for (const [id, scheduled] of this.scheduledMessages) {
      scheduled.task.stop();
      logger.info(`Cancelled scheduled message ${id}`);
    }
    this.scheduledMessages.clear();
  }

  /**
   * Restore scheduled messages from database after restart
   */
  restoreFromDatabase(): void {
    const scheduleRepo = new ScheduleRepository();
    const savedSchedules = scheduleRepo.findAllActive();

    for (const schedule of savedSchedules) {
      try {
        // Skip one-time messages that were in the past
        if (schedule.one_time && schedule.scheduled_at) {
          const scheduledDate = new Date(schedule.scheduled_at);
          if (scheduledDate <= new Date()) {
            scheduleRepo.markInactive(schedule.id);
            logger.info(`Skipped past one-time message: ${schedule.id}`);
            continue;
          }
        }

        // Skip if cron expression is just 'one-time' (needs datetime conversion)
        if (schedule.cron_expression === 'one-time' && schedule.scheduled_at) {
          const date = new Date(schedule.scheduled_at);
          const cronExpr = this.dateToCron(date);
          this.scheduleMessageWithId(
            schedule.id,
            schedule.jid,
            schedule.message,
            cronExpr,
            true
          );
        } else {
          // Recreate the scheduled task with same ID
          this.scheduleMessageWithId(
            schedule.id,
            schedule.jid,
            schedule.message,
            schedule.cron_expression,
            schedule.one_time === 1
          );
        }

        logger.info(`Restored scheduled message: ${schedule.id}`);
      } catch (error) {
        logger.error(`Failed to restore scheduled message ${schedule.id}:`, error);
        scheduleRepo.markInactive(schedule.id);
      }
    }

    logger.info(`Restored ${savedSchedules.length} scheduled messages from database`);
  }

  /**
   * Schedule a message with a specific ID (for restoring from database)
   */
  private scheduleMessageWithId(
    id: string,
    jid: string,
    message: string,
    cronExpression: string,
    oneTime: boolean
  ): void {
    if (!cron.validate(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    const task: ScheduledTask = cron.schedule(cronExpression, async () => {
      try {
        await this.whatsapp.sendTextMessage(jid, message);
        logger.info(`Scheduled message ${id} sent to ${jid}`);

        if (oneTime) {
          this.cancelScheduledMessage(id);
          const scheduleRepo = new ScheduleRepository();
          scheduleRepo.markInactive(id);
        }
      } catch (error) {
        logger.error(`Failed to send scheduled message ${id} to ${jid}:`, error);
      }
    });

    this.scheduledMessages.set(id, {
      id,
      jid,
      message,
      cronExpression,
      task,
      oneTime,
    });
  }
}
