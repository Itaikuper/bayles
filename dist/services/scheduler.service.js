import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { ScheduleRepository } from '../database/repositories/schedule.repository.js';
export class SchedulerService {
    scheduledMessages = new Map();
    whatsapp;
    gemini;
    constructor(whatsapp, gemini) {
        this.whatsapp = whatsapp;
        this.gemini = gemini;
    }
    /**
     * Create the execution callback for a scheduled message
     */
    createExecutionCallback(id, jid, message, oneTime, useAi, fromDatabase = false) {
        return async () => {
            try {
                let textToSend = message;
                if (useAi) {
                    try {
                        const schedulerJid = `scheduled:${jid}`;
                        const schedulerPrompt = 'You are a content generator for scheduled messages. ' +
                            'Output ONLY the requested content. ' +
                            'Do NOT add any conversational prefix, greeting, or introduction like "Sure!", "Here it is:", etc. ' +
                            'Just produce the content directly as instructed by the prompt.';
                        textToSend = await this.gemini.generateResponse(schedulerJid, message, schedulerPrompt);
                        logger.info(`AI processed scheduled message ${id} for ${jid}`);
                    }
                    catch (aiError) {
                        logger.error(`AI processing failed for scheduled message ${id}:`, aiError);
                        textToSend = `[הודעת AI מתוזמנת נכשלה. הפרומפט: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}]`;
                    }
                }
                await this.whatsapp.sendTextMessage(jid, textToSend);
                logger.info(`Scheduled message ${id} sent to ${jid}`);
                if (oneTime) {
                    this.cancelScheduledMessage(id);
                    if (fromDatabase) {
                        const scheduleRepo = new ScheduleRepository();
                        scheduleRepo.markInactive(id);
                    }
                }
            }
            catch (error) {
                logger.error(`Failed to send scheduled message ${id} to ${jid}:`, error);
            }
        };
    }
    /**
     * Schedule a message with a cron expression
     */
    scheduleMessage(jid, message, cronExpression, oneTime = false, useAi = false) {
        if (!cron.validate(cronExpression)) {
            throw new Error(`Invalid cron expression: ${cronExpression}`);
        }
        const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const task = cron.schedule(cronExpression, this.createExecutionCallback(id, jid, message, oneTime, useAi));
        this.scheduledMessages.set(id, {
            id,
            jid,
            message,
            cronExpression,
            task,
            oneTime,
            useAi,
        });
        logger.info(`Scheduled message ${id} for ${jid} with cron: ${cronExpression}${oneTime ? ' (one-time)' : ''}${useAi ? ' (AI)' : ''}`);
        return id;
    }
    /**
     * Schedule a one-time message at a specific date/time
     */
    scheduleOneTimeMessage(jid, message, date, useAi = false) {
        const now = new Date();
        if (date <= now) {
            throw new Error('Scheduled date must be in the future');
        }
        const cronExpression = this.dateToCron(date);
        return this.scheduleMessage(jid, message, cronExpression, true, useAi);
    }
    /**
     * Convert a Date to a cron expression
     */
    dateToCron(date) {
        const minute = date.getMinutes();
        const hour = date.getHours();
        const dayOfMonth = date.getDate();
        const month = date.getMonth() + 1;
        return `${minute} ${hour} ${dayOfMonth} ${month} *`;
    }
    /**
     * Cancel a scheduled message
     */
    cancelScheduledMessage(id) {
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
    listScheduledMessages() {
        return Array.from(this.scheduledMessages.values()).map(({ id, jid, message, cronExpression, oneTime, useAi }) => ({
            id,
            jid,
            message,
            cronExpression,
            oneTime,
            useAi,
        }));
    }
    /**
     * Cancel all scheduled messages
     */
    cancelAll() {
        for (const [id, scheduled] of this.scheduledMessages) {
            scheduled.task.stop();
            logger.info(`Cancelled scheduled message ${id}`);
        }
        this.scheduledMessages.clear();
    }
    /**
     * Restore scheduled messages from database after restart
     */
    restoreFromDatabase() {
        const scheduleRepo = new ScheduleRepository();
        const savedSchedules = scheduleRepo.findAllActive();
        for (const schedule of savedSchedules) {
            try {
                const useAi = schedule.use_ai === 1;
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
                    this.scheduleMessageWithId(schedule.id, schedule.jid, schedule.message, cronExpr, true, useAi);
                }
                else {
                    // Recreate the scheduled task with same ID
                    this.scheduleMessageWithId(schedule.id, schedule.jid, schedule.message, schedule.cron_expression, schedule.one_time === 1, useAi);
                }
                logger.info(`Restored scheduled message: ${schedule.id}`);
            }
            catch (error) {
                logger.error(`Failed to restore scheduled message ${schedule.id}:`, error);
                scheduleRepo.markInactive(schedule.id);
            }
        }
        logger.info(`Restored ${savedSchedules.length} scheduled messages from database`);
    }
    /**
     * Schedule a message with a specific ID (for restoring from database)
     */
    scheduleMessageWithId(id, jid, message, cronExpression, oneTime, useAi = false) {
        if (!cron.validate(cronExpression)) {
            throw new Error(`Invalid cron expression: ${cronExpression}`);
        }
        const task = cron.schedule(cronExpression, this.createExecutionCallback(id, jid, message, oneTime, useAi, true));
        this.scheduledMessages.set(id, {
            id,
            jid,
            message,
            cronExpression,
            task,
            oneTime,
            useAi,
        });
    }
}
