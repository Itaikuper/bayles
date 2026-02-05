import { Express } from 'express';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { GeminiService } from '../services/gemini.service.js';
import { SchedulerService } from '../services/scheduler.service.js';
import { BotControlService } from '../services/bot-control.service.js';
import { BirthdayService } from '../services/birthday.service.js';
export declare function createApiServer(whatsapp: WhatsAppService, gemini: GeminiService, scheduler: SchedulerService, botControl: BotControlService, birthdayService: BirthdayService): Express;
export declare function startApiServer(app: Express, port?: number): void;
