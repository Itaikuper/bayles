import { Router } from 'express';
import { WhatsAppService } from '../../services/whatsapp.service.js';
import { GeminiService } from '../../services/gemini.service.js';
import { SchedulerService } from '../../services/scheduler.service.js';
export declare function createStatsRoutes(whatsapp: WhatsAppService, _gemini: GeminiService, scheduler: SchedulerService): Router;
