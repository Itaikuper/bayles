import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { WhatsAppService } from './whatsapp.service.js';
import { GeminiService } from './gemini.service.js';
import { ChoreRotationRepository, type ChoreRotationRecord, getChoreRotationRepository } from '../database/repositories/chore-rotation.repository.js';
import { logger } from '../utils/logger.js';

export class ChoreRotationService {
  private cronTask: ScheduledTask | null = null;
  private repo: ChoreRotationRepository;
  private whatsapp: WhatsAppService;
  private gemini: GeminiService;

  constructor(whatsapp: WhatsAppService, gemini: GeminiService) {
    this.whatsapp = whatsapp;
    this.gemini = gemini;
    this.repo = getChoreRotationRepository();
  }

  /**
   * Start the reminder cron - checks every 5 minutes between 07:00-22:00
   */
  start(): void {
    if (this.cronTask) {
      logger.warn('ChoreRotation service already started');
      return;
    }

    this.cronTask = cron.schedule('*/5 7-22 * * *', async () => {
      try {
        await this.checkAndSendReminders();
      } catch (error) {
        logger.error('ChoreRotation reminder check failed:', error);
      }
    });

    logger.info('ChoreRotation service started - checking every 5 min (07:00-22:00)');
  }

  stop(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
      logger.info('ChoreRotation service stopped');
    }
  }

  /**
   * Check all active rotations and send reminders where due
   */
  async checkAndSendReminders(): Promise<void> {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const todayStr = now.toISOString().split('T')[0];

    const rotations = this.repo.getActiveRotations();
    if (rotations.length === 0) return;

    // Group rotations by JID so we can send one combined message per group
    const dueByJid = new Map<string, ChoreRotationRecord[]>();

    for (const rotation of rotations) {
      // Check if this rotation's reminder time matches current time (within the 5-min window)
      if (rotation.reminder_hour !== currentHour) continue;
      if (Math.abs(rotation.reminder_minute - currentMinute) > 4) continue;

      // Check if already sent today
      if (rotation.last_sent_date === todayStr) continue;

      // For weekly: only send on Sundays (day 0)
      if (rotation.frequency === 'weekly' && now.getDay() !== 0) continue;

      const existing = dueByJid.get(rotation.jid) || [];
      existing.push(rotation);
      dueByJid.set(rotation.jid, existing);
    }

    // Send combined messages per JID
    for (const [jid, dueRotations] of dueByJid) {
      try {
        const lines = dueRotations.map(rotation => {
          const members = JSON.parse(rotation.members) as string[];
          const assignee = members[rotation.current_index % members.length];
          return `• *${rotation.name}*: ${assignee}`;
        });

        const message = `📋 *תורנויות להיום:*\n\n${lines.join('\n')}`;
        await this.whatsapp.sendTextMessage(jid, message);

        // Mark sent and advance each rotation
        for (const rotation of dueRotations) {
          const members = JSON.parse(rotation.members) as string[];
          const newIndex = (rotation.current_index + 1) % members.length;
          this.repo.markSent(rotation.id, todayStr);
          this.repo.advance(rotation.id, newIndex);
        }

        logger.info(`Sent ${dueRotations.length} chore rotation reminder(s) to ${jid}`);
      } catch (error) {
        logger.error(`Failed to send chore rotation reminders to ${jid}:`, error);
      }
    }
  }

  /**
   * Get current assignee for a rotation without advancing
   */
  getCurrentAssignee(rotation: ChoreRotationRecord): string {
    const members = JSON.parse(rotation.members) as string[];
    return members[rotation.current_index % members.length];
  }

  /**
   * Get formatted summary of all rotations for a JID
   */
  getRotationsSummary(jid: string): string {
    const rotations = this.repo.findByJid(jid);
    if (rotations.length === 0) return 'אין תורנויות מוגדרות.';

    const lines = rotations.map(r => {
      const members = JSON.parse(r.members) as string[];
      const assignee = members[r.current_index % members.length];
      const memberList = members.join(', ');
      return `• *${r.name}*: התור של *${assignee}* (מתוך: ${memberList})`;
    });

    return `📋 *תורנויות:*\n\n${lines.join('\n')}`;
  }

  getRepository(): ChoreRotationRepository {
    return this.repo;
  }
}
