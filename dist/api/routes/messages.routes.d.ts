import { Router } from 'express';
import { WhatsAppService } from '../../services/whatsapp.service.js';
export declare function createMessagesRoutes(whatsapp: WhatsAppService): Router;
