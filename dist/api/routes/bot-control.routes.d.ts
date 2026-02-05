import { Router } from 'express';
import { BotControlService } from '../../services/bot-control.service.js';
import { WhatsAppService } from '../../services/whatsapp.service.js';
export declare function createBotControlRoutes(botControl: BotControlService, whatsapp: WhatsAppService): Router;
