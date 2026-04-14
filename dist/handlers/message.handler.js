import { getMemoryService } from '../services/memory.service.js';
import { getTaskRepository } from '../database/repositories/task.repository.js';
import { ScheduleRepository } from '../database/repositories/schedule.repository.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getSongRepository } from '../database/repositories/song.repository.js';
import { getContactRepository } from '../database/repositories/contact.repository.js';
import { getHoshayaDirectoryRepository } from '../database/repositories/hoshaya-directory.repository.js';
import { getCalendarLinkRepository } from '../database/repositories/calendar-link.repository.js';
import { getIntentService } from '../services/intent.service.js';
import { runEmailNewWorkflow } from '../services/workflows/email-new.workflow.js';
import { runCalendarListWorkflow } from '../services/workflows/calendar-list.workflow.js';
import { runCalendarCreateWorkflow } from '../services/workflows/calendar-create.workflow.js';
export class MessageHandler {
    whatsapp;
    gemini;
    scheduler;
    botControl;
    birthdayService;
    calendarService;
    choreRotationService;
    gmailService;
    voiceModeJids = new Set();
    sendMessageCooldowns = new Map();
    SEND_MESSAGE_COOLDOWN_MS = 30_000;
    mediationMessages = new Map();
    MEDIATION_TTL_MS = 60 * 60 * 1000; // 1 hour
    constructor(whatsapp, gemini, scheduler, botControl, birthdayService, calendarService, choreRotationService, gmailService) {
        this.whatsapp = whatsapp;
        this.gemini = gemini;
        this.scheduler = scheduler;
        this.botControl = botControl;
        this.birthdayService = birthdayService;
        this.calendarService = calendarService;
        this.choreRotationService = choreRotationService;
        this.gmailService = gmailService;
    }
    async handle(message) {
        const jid = message.key.remoteJid;
        if (!jid)
            return;
        // Never respond to newsletter/channel messages
        if (jid.endsWith('@newsletter'))
            return;
        // Update display_name from pushName for DM chats
        if (message.pushName && !jid.endsWith('@g.us') && !jid.endsWith('@newsletter')) {
            const existingConfig = this.botControl.getChatConfig(jid);
            const nameIsMissing = !existingConfig?.display_name || existingConfig.display_name === jid;
            if (existingConfig && nameIsMissing) {
                this.botControl.updateChat(jid, { display_name: message.pushName });
                logger.info(`Saved display_name "${message.pushName}" for ${jid}`);
            }
        }
        // Debug: log which message types are present
        const msg = message.message;
        const msgTypes = msg ? Object.keys(msg).filter(k => msg[k] != null) : [];
        logger.info(`DEBUG msgTypes: ${JSON.stringify(msgTypes)} from ${message.key.participant || jid}`);
        // Check for mediation reply (before bot-control — recipient may not be whitelisted)
        const mediationHandled = await this.checkAndHandleMediation(message, jid);
        if (mediationHandled)
            return;
        // Handle voice/audio messages
        const audioMessage = message.message?.audioMessage;
        if (audioMessage) {
            await this.handleAudioMessage(message, jid, audioMessage);
            return;
        }
        // Handle image messages (photos from camera/gallery)
        const imageMessage = message.message?.imageMessage;
        if (imageMessage) {
            await this.handleImageMessage(message, jid, imageMessage);
            return;
        }
        // Handle document messages (PDF, DOC, etc.)
        const documentMessage = message.message?.documentMessage;
        if (documentMessage) {
            await this.handleDocumentMessage(message, jid, documentMessage);
            return;
        }
        const text = this.extractText(message);
        if (!text)
            return;
        // Handle "תמלל" command - transcribe a quoted voice message
        if (/^תמלל\s*$/.test(text)) {
            const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quotedMessage) {
                logger.info(`DEBUG תמלל quotedMessage keys: ${JSON.stringify(Object.keys(quotedMessage))}`);
            }
            const quotedAudio = quotedMessage?.audioMessage;
            if (quotedAudio) {
                await this.handleTranscribeCommand(message, jid, quotedAudio);
                return;
            }
        }
        const isGroup = jid.endsWith('@g.us');
        const sender = isGroup ? message.key.participant : jid;
        logger.info(`Message from ${sender} in ${isGroup ? 'group' : 'DM'}: ${text}`);
        // For groups, check if message starts with prefix
        const hasPrefix = text.startsWith(config.botPrefix);
        // Check if the message is a reply to the bot or mentions the bot
        const isReplyToBot = this.isReplyToBotMessage(message);
        const isMentioningBot = this.isMentioningBot(message);
        // Debug logging
        const botJid = this.whatsapp.getBotJid();
        const botLid = this.whatsapp.getBotLid();
        const contextInfo = message.message?.extendedTextMessage?.contextInfo;
        logger.info(`DEBUG - Bot JID: ${botJid}, Bot LID: ${botLid}`);
        logger.info(`DEBUG - Mentioned JIDs: ${JSON.stringify(contextInfo?.mentionedJid)}`);
        logger.info(`DEBUG - isReplyToBot: ${isReplyToBot}, isMentioningBot: ${isMentioningBot}, hasPrefix: ${hasPrefix}`);
        // Remove prefix or bot mention from text
        let cleanText = hasPrefix
            ? text.slice(config.botPrefix.length).trim()
            : text;
        // Strip bot mention (@<jid-number>) from beginning of message in groups
        if (isGroup && isMentioningBot) {
            cleanText = cleanText.replace(/^@\d+\s*/, '').trim();
        }
        // Check if message contains trigger words (פרופסור / בוט)
        const hasTriggerWord = /(?:^|[\s,.!?])(?:פרופסור|בוט|bot)(?:[\s,.!?]|$)/i.test(text);
        // For groups: respond only if has prefix OR is a reply to bot OR mentions bot OR has trigger word
        if (isGroup && !hasPrefix && !isReplyToBot && !isMentioningBot && !hasTriggerWord) {
            return;
        }
        // Strip trigger word from beginning of message
        if (hasTriggerWord) {
            cleanText = cleanText.replace(/^(?:פרופסור|בוט|bot)[,\s]*/i, '').trim();
        }
        // Get decision from bot control service
        const decision = this.botControl.shouldRespondToMessage(jid, isGroup);
        // Log the activity
        this.botControl.logActivity(jid, sender || undefined, cleanText, isGroup, decision.shouldRespond ?
            (decision.responseType === 'auto_reply' ? 'auto_reply' : 'responded') :
            'ignored', decision.reason);
        // If we shouldn't respond, stop here
        if (!decision.shouldRespond) {
            logger.info(`Not responding: ${decision.reason}`);
            return;
        }
        // Handle empty message after prefix
        if (!cleanText) {
            await this.whatsapp.sendReply(jid, this.getHelpText(), message);
            return;
        }
        // Handle commands (always process if responding)
        if (cleanText.startsWith('/')) {
            await this.handleCommand(jid, cleanText, message);
            return;
        }
        // Handle based on response type
        if (decision.responseType === 'auto_reply' && decision.autoReplyMessage) {
            // Send configured auto-reply message
            await this.whatsapp.sendReply(jid, decision.autoReplyMessage, message);
            return;
        }
        // Check for image generation request (keyword-based)
        const imageResult = this.extractImagePrompt(cleanText);
        if (imageResult !== null) {
            await this.handleImageGeneration(jid, imageResult.prompt, message, imageResult.pro);
            return;
        }
        await this.runAIWithDispatch(jid, cleanText, isGroup, sender, message, decision.customPrompt);
    }
    async runAIWithDispatch(jid, cleanText, isGroup, sender, message, customPrompt) {
        try {
            // Owner-mode: run the intent classifier ONLY as an advisory hint.
            // Hermes/OpenClaw pattern: the model drives — we don't short-circuit to workflows.
            // The model receives the hint in its system prompt and decides whether to call a tool.
            let intentHint;
            if (this.gemini.isOwnerMode(jid, sender || undefined)) {
                const recent = this.gemini.formatRecentForClassifier(jid, 'default', 6);
                const classified = await getIntentService().classify(cleanText, recent);
                logger.info(`[intent-hint] ${classified.intent} — ${classified.reasoning || ''} slots=${JSON.stringify(classified.slots)}`);
                if (classified.intent !== 'general') {
                    const slotSummary = Object.entries(classified.slots)
                        .filter(([, v]) => v)
                        .map(([k, v]) => `${k}="${v}"`)
                        .join(', ');
                    intentHint = `Intent classifier suggests this message resembles "${classified.intent}"${slotSummary ? ` with slots: ${slotSummary}` : ''}. This is ADVISORY — verify against full conversation context before calling any tool. If the user is asking for translation/rephrasing/composition without an explicit email marker ("מייל"/"email"/"@"), respond with text, do NOT call draft_new_email.`;
                }
            }
            // Forward detection: WhatsApp marks forwarded messages in contextInfo.
            // When the owner forwards something (text, voice transcription, image caption, etc.),
            // prepend a marker so the model knows this content originated elsewhere — enables
            // the "turn forwarded message into task" flow without a separate command.
            const fwdCtx = message.message?.extendedTextMessage?.contextInfo
                || message.message?.audioMessage?.contextInfo
                || message.message?.imageMessage?.contextInfo
                || message.message?.videoMessage?.contextInfo
                || message.message?.documentMessage?.contextInfo;
            const isForwarded = Boolean(fwdCtx?.isForwarded
                || (fwdCtx?.forwardingScore && fwdCtx.forwardingScore > 0));
            const forwardMarker = isForwarded ? '[הודעה שהועברה / forwarded]\n' : '';
            const messageForAI = isGroup && message.pushName
                ? `${forwardMarker}[${message.pushName}]: ${cleanText}`
                : `${forwardMarker}${cleanText}`;
            const response = await this.gemini.generateResponse(jid, messageForAI, customPrompt, 'default', sender || undefined, intentHint);
            if (response.type === 'function_call' && response.functionCall) {
                let actionSummary = null;
                if (response.functionCall.name === 'draft_new_email' && this.gmailService) {
                    const args = response.functionCall.args;
                    await runEmailNewWorkflow(jid, { recipient_hint: args.recipient_hint, topic_hint: args.topic, subject_hint: args.subject_hint }, message, { gemini: this.gemini, gmail: this.gmailService, whatsapp: this.whatsapp });
                    actionSummary = `[triggered draft_new_email for "${args.recipient_hint}"]`;
                }
                else if (response.functionCall.name === 'list_calendar_smart' && this.calendarService) {
                    const args = response.functionCall.args;
                    await runCalendarListWorkflow(jid, args, message, { gemini: this.gemini, calendar: this.calendarService, whatsapp: this.whatsapp });
                    actionSummary = `[triggered list_calendar_smart for "${args.date_phrase}"]`;
                }
                else if (response.functionCall.name === 'create_calendar_smart' && this.calendarService) {
                    const args = response.functionCall.args;
                    await runCalendarCreateWorkflow(jid, args, message, { gemini: this.gemini, calendar: this.calendarService, whatsapp: this.whatsapp });
                    actionSummary = `[triggered create_calendar_smart: "${args.summary_hint}"]`;
                }
                else if (response.functionCall.name === 'create_schedule') {
                    const scheduleArgs = response.functionCall.args;
                    actionSummary = await this.handleScheduleFunctionCall(jid, scheduleArgs, message);
                }
                else if (response.functionCall.name === 'search_song') {
                    const args = response.functionCall.args;
                    actionSummary = await this.handleSongSearch(jid, args.query, message);
                }
                else if (response.functionCall.name === 'search_contact') {
                    const args = response.functionCall.args;
                    actionSummary = await this.handleContactSearch(jid, args.query, message);
                }
                else if (response.functionCall.name === 'search_hoshaya_directory') {
                    const args = response.functionCall.args;
                    actionSummary = await this.handleHoshayaDirectorySearch(jid, args.query, message);
                }
                else if (response.functionCall.name === 'list_calendar_events') {
                    actionSummary = await this.handleCalendarList(jid, response.functionCall.args, message);
                }
                else if (response.functionCall.name === 'create_calendar_event') {
                    actionSummary = await this.handleCalendarCreate(jid, response.functionCall.args, message);
                }
                else if (response.functionCall.name === 'update_calendar_event') {
                    actionSummary = await this.handleCalendarUpdate(jid, response.functionCall.args, message);
                }
                else if (response.functionCall.name === 'delete_calendar_event') {
                    actionSummary = await this.handleCalendarDelete(jid, response.functionCall.args, message);
                }
                else if (response.functionCall.name === 'send_message') {
                    const senderName = message.pushName || this.botControl.getChatConfig(jid)?.display_name || 'מישהו';
                    actionSummary = await this.handleSendMessage(jid, response.functionCall.args, message, senderName);
                }
                else if (response.functionCall.name === 'manage_chore_rotation') {
                    actionSummary = await this.handleChoreRotation(jid, response.functionCall.args, message);
                }
                else if (response.functionCall.name?.startsWith('gmail_')) {
                    actionSummary = await this.handleGmailFunction(jid, response.functionCall.name, response.functionCall.args, message);
                }
                else if (response.functionCall.name === 'search_memory' || response.functionCall.name === 'update_core_memory' || response.functionCall.name === 'append_person_note' || response.functionCall.name === 'append_project_note') {
                    actionSummary = await this.handleMemoryFunction(jid, response.functionCall.name, response.functionCall.args, message);
                }
                else if (response.functionCall.name === 'add_task' || response.functionCall.name === 'list_tasks' || response.functionCall.name === 'edit_task' || response.functionCall.name === 'complete_task' || response.functionCall.name === 'snooze_task') {
                    actionSummary = await this.handleTaskFunction(jid, response.functionCall.name, response.functionCall.args, message);
                }
                else {
                    // Unknown function call - log and ignore
                    logger.warn(`Unknown function call: ${response.functionCall.name}`);
                }
                // Save the user's request and bot's action to conversation history
                if (actionSummary) {
                    this.gemini.addToHistory(jid, messageForAI, actionSummary);
                }
                return;
            }
            // Handle regular text response
            if (response.text) {
                await this.sendResponse(jid, response.text, message);
                // Extract user facts asynchronously (non-blocking)
                const senderJid = sender || jid;
                this.gemini.extractUserFacts(senderJid, cleanText, response.text)
                    .catch(err => logger.warn('[memory] Extraction failed:', err));
            }
        }
        catch (error) {
            logger.error('Error generating response:', error);
            await this.whatsapp.sendReply(jid, 'Sorry, something went wrong. Please try again.', message);
        }
    }
    extractText(message) {
        const msg = message.message;
        if (!msg)
            return null;
        return (msg.conversation ||
            msg.extendedTextMessage?.text ||
            msg.videoMessage?.caption ||
            null);
    }
    async handleAudioMessage(message, jid, audioMessage) {
        const isGroup = jid.endsWith('@g.us');
        const sender = isGroup ? message.key.participant : jid;
        logger.info(`Voice message from ${sender} in ${isGroup ? 'group' : 'DM'} (${audioMessage.seconds || '?'}s)`);
        // In groups, voice messages only processed if reply-to-bot
        if (isGroup && !this.isReplyToBotMessage(message)) {
            return;
        }
        const decision = this.botControl.shouldRespondToMessage(jid, isGroup);
        this.botControl.logActivity(jid, sender || undefined, '[הודעה קולית]', isGroup, decision.shouldRespond ? 'responded' : 'ignored', decision.reason);
        if (!decision.shouldRespond) {
            logger.info(`Not responding to voice message: ${decision.reason}`);
            return;
        }
        if (decision.responseType === 'auto_reply' && decision.autoReplyMessage) {
            await this.whatsapp.sendReply(jid, decision.autoReplyMessage, message);
            return;
        }
        try {
            const audioBuffer = await this.whatsapp.downloadAudio(audioMessage);
            const mimeType = audioMessage.mimetype || 'audio/ogg; codecs=opus';
            // Owner mode: transcribe first, then route through the text pipeline so
            // we get full tool access (gmail drafts, calendar, tasks, memory).
            if (this.gemini.isOwnerMode(jid, sender || undefined)) {
                const transcription = await this.gemini.transcribeAudio(audioBuffer, mimeType);
                logger.info(`Owner voice transcription: ${transcription}`);
                if (!transcription || /^לא זוהה דיבור\.?$/.test(transcription.trim())) {
                    await this.whatsapp.sendReply(jid, 'לא הצלחתי לשמוע אותך, נסה שוב.', message);
                    return;
                }
                await this.runAIWithDispatch(jid, transcription, isGroup, sender, message, decision.customPrompt);
                return;
            }
            const contextPrefix = isGroup && message.pushName
                ? `[${message.pushName}]`
                : undefined;
            const response = await this.gemini.generateAudioResponse(jid, audioBuffer, mimeType, decision.customPrompt, contextPrefix, 'default', sender || undefined);
            // Extract user facts asynchronously from voice message response
            const senderJid = sender || jid;
            this.gemini.extractUserFacts(senderJid, '[הודעה קולית]', response)
                .catch(err => logger.warn('[memory] Voice extraction failed:', err));
            // Voice mode: convert text response to speech
            if (this.voiceModeJids.has(jid)) {
                try {
                    const speechBuffer = await this.gemini.generateSpeech(response);
                    await this.whatsapp.sendVoiceReply(jid, speechBuffer, message);
                }
                catch (ttsError) {
                    logger.error('Voice mode TTS failed for audio reply, falling back to text:', ttsError);
                    await this.whatsapp.sendReply(jid, response, message);
                }
            }
            else {
                await this.whatsapp.sendReply(jid, response, message);
            }
        }
        catch (error) {
            logger.error('Error processing voice message:', error);
            await this.whatsapp.sendReply(jid, 'סליחה, לא הצלחתי לעבד את ההודעה הקולית. נסה שוב.', message);
        }
    }
    async handleTranscribeCommand(message, jid, audioMessage) {
        try {
            await this.whatsapp.sendReply(jid, '🎙️ מתמלל...', message);
            const audioBuffer = await this.whatsapp.downloadAudio(audioMessage);
            const mimeType = audioMessage.mimetype || 'audio/ogg; codecs=opus';
            const transcription = await this.gemini.transcribeAudio(audioBuffer, mimeType);
            await this.whatsapp.sendReply(jid, `📝 *תמלול:*\n\n${transcription}`, message);
        }
        catch (error) {
            logger.error('Error transcribing voice message:', error);
            await this.whatsapp.sendReply(jid, 'סליחה, לא הצלחתי לתמלל את ההודעה הקולית. נסה שוב.', message);
        }
    }
    async handleImageMessage(message, jid, imageMessage) {
        const isGroup = jid.endsWith('@g.us');
        const sender = isGroup ? message.key.participant : jid;
        const caption = imageMessage.caption || '';
        logger.info(`Image message from ${sender} in ${isGroup ? 'group' : 'DM'}${caption ? `: ${caption}` : ''}`);
        // In groups: only respond if reply-to-bot, mentioned, or caption has trigger word
        if (isGroup) {
            const isReplyToBot = this.isReplyToBotMessage(message);
            const isMentioned = this.isMentioningBot(message);
            const hasTriggerWord = /(?:^|[\s,.!?])(?:פרופסור|בוט|bot)(?:[\s,.!?]|$)/i.test(caption);
            if (!isReplyToBot && !isMentioned && !hasTriggerWord) {
                return;
            }
        }
        const decision = this.botControl.shouldRespondToMessage(jid, isGroup);
        this.botControl.logActivity(jid, sender || undefined, caption ? `[תמונה] ${caption}` : '[תמונה]', isGroup, decision.shouldRespond ? 'responded' : 'ignored', decision.reason);
        if (!decision.shouldRespond) {
            logger.info(`Not responding to image: ${decision.reason}`);
            return;
        }
        if (decision.responseType === 'auto_reply' && decision.autoReplyMessage) {
            await this.whatsapp.sendReply(jid, decision.autoReplyMessage, message);
            return;
        }
        try {
            const imageBuffer = await this.whatsapp.downloadImage(imageMessage);
            const mimeType = imageMessage.mimetype || 'image/jpeg';
            const contextPrefix = isGroup && message.pushName
                ? `[${message.pushName}]`
                : undefined;
            // Strip trigger words from caption
            const cleanCaption = caption
                ? caption.replace(/(?:^|[\s,.!?])(?:פרופסור|בוט|bot)(?:[\s,.!?]|$)/ig, ' ').trim()
                : undefined;
            const response = await this.gemini.generateDocumentAnalysisResponse(jid, imageBuffer, mimeType, cleanCaption || undefined, decision.customPrompt, contextPrefix);
            await this.sendResponse(jid, response, message);
        }
        catch (error) {
            logger.error('Error processing image:', error);
            await this.whatsapp.sendReply(jid, 'סליחה, לא הצלחתי לעבד את התמונה. נסה שוב.', message);
        }
    }
    async handleDocumentMessage(message, jid, documentMessage) {
        const isGroup = jid.endsWith('@g.us');
        const sender = isGroup ? message.key.participant : jid;
        const fileName = documentMessage.fileName || 'document';
        const caption = documentMessage.caption || '';
        logger.info(`Document message from ${sender} in ${isGroup ? 'group' : 'DM'}: ${fileName}`);
        // In groups: only respond if reply-to-bot, mentioned, or caption has trigger word
        if (isGroup) {
            const isReplyToBot = this.isReplyToBotMessage(message);
            const isMentioned = this.isMentioningBot(message);
            const hasTriggerWord = /(?:^|[\s,.!?])(?:פרופסור|בוט|bot)(?:[\s,.!?]|$)/i.test(caption);
            if (!isReplyToBot && !isMentioned && !hasTriggerWord) {
                return;
            }
        }
        const decision = this.botControl.shouldRespondToMessage(jid, isGroup);
        this.botControl.logActivity(jid, sender || undefined, `[קובץ: ${fileName}]`, isGroup, decision.shouldRespond ? 'responded' : 'ignored', decision.reason);
        if (!decision.shouldRespond) {
            logger.info(`Not responding to document: ${decision.reason}`);
            return;
        }
        if (decision.responseType === 'auto_reply' && decision.autoReplyMessage) {
            await this.whatsapp.sendReply(jid, decision.autoReplyMessage, message);
            return;
        }
        try {
            const docBuffer = await this.whatsapp.downloadDocument(documentMessage);
            const mimeType = documentMessage.mimetype || 'application/pdf';
            logger.info(`DEBUG doc download: ${docBuffer.length} bytes, mime: ${mimeType}, file: ${fileName}`);
            const contextPrefix = isGroup && message.pushName
                ? `[${message.pushName}]`
                : undefined;
            // Strip trigger words from caption
            const cleanCaption = caption
                ? caption.replace(/(?:^|[\s,.!?])(?:פרופסור|בוט|bot)(?:[\s,.!?]|$)/ig, ' ').trim()
                : undefined;
            const response = await this.gemini.generateDocumentAnalysisResponse(jid, docBuffer, mimeType, cleanCaption || undefined, decision.customPrompt, contextPrefix, fileName);
            await this.sendResponse(jid, response, message);
        }
        catch (error) {
            logger.error('Error processing document:', error);
            await this.whatsapp.sendReply(jid, 'סליחה, לא הצלחתי לעבד את הקובץ. נסה שוב.', message);
        }
    }
    parseImageTags(text) {
        const imagePrompts = [];
        const tagRegex = /\[(PRO_IMAGE|IMAGE):\s*(.+?)\]/g;
        let match;
        while ((match = tagRegex.exec(text)) !== null) {
            const prompt = match[2].trim();
            if (prompt.length > 0) {
                imagePrompts.push({ prompt, pro: match[1] === 'PRO_IMAGE' });
            }
        }
        const cleanText = text
            .replace(/\[(?:PRO_IMAGE|IMAGE):\s*.+?\]/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return { cleanText, imagePrompts };
    }
    async sendResponseWithImages(jid, response, message) {
        const parsed = this.parseImageTags(response);
        if (parsed.cleanText) {
            await this.whatsapp.sendReply(jid, parsed.cleanText, message);
        }
        if (config.autoImageGeneration && parsed.imagePrompts.length > 0) {
            for (const { prompt, pro } of parsed.imagePrompts.slice(0, 2)) {
                try {
                    const fullPrompt = `${prompt}. If you include a text caption, write it in Hebrew.`;
                    logger.info(`Auto-generating ${pro ? 'PRO ' : ''}image: "${prompt.substring(0, 80)}..."`);
                    const result = await this.gemini.generateImage(fullPrompt, pro);
                    if (result) {
                        await this.whatsapp.sendImageReply(jid, result.image, result.text || '', message);
                    }
                }
                catch (error) {
                    logger.warn(`Auto image generation failed: ${error}`);
                }
            }
        }
    }
    async sendResponse(jid, text, message) {
        if (!this.voiceModeJids.has(jid)) {
            await this.sendResponseWithImages(jid, text, message);
            return;
        }
        // Voice mode: convert text response to speech
        try {
            const audioBuffer = await this.gemini.generateSpeech(text);
            await this.whatsapp.sendVoiceReply(jid, audioBuffer, message);
        }
        catch (error) {
            logger.error('Voice mode TTS failed, falling back to text:', error);
            await this.sendResponseWithImages(jid, text, message);
        }
    }
    isReplyToBotMessage(message) {
        const contextInfo = message.message?.extendedTextMessage?.contextInfo
            || message.message?.audioMessage?.contextInfo
            || message.message?.imageMessage?.contextInfo
            || message.message?.documentMessage?.contextInfo;
        if (!contextInfo?.participant)
            return false;
        const botJid = this.whatsapp.getBotJid();
        const botLid = this.whatsapp.getBotLid();
        if (!botJid && !botLid)
            return false;
        // Check both phone JID and LID formats
        const participantNormalized = contextInfo.participant.replace(/:.*@/, '@');
        return participantNormalized === botJid || participantNormalized === botLid;
    }
    isMentioningBot(message) {
        const contextInfo = message.message?.extendedTextMessage?.contextInfo
            || message.message?.audioMessage?.contextInfo
            || message.message?.imageMessage?.contextInfo
            || message.message?.documentMessage?.contextInfo;
        const mentionedJids = contextInfo?.mentionedJid;
        if (!mentionedJids || mentionedJids.length === 0)
            return false;
        const botJid = this.whatsapp.getBotJid();
        const botLid = this.whatsapp.getBotLid();
        // Check if any mentioned JID matches the bot's JID or LID
        return mentionedJids.some(jid => {
            const normalizedJid = jid.replace(/:.*@/, '@');
            return normalizedJid === botJid || normalizedJid === botLid;
        });
    }
    async handleCommand(jid, command, originalMessage) {
        const [cmd, ...args] = command.slice(1).split(' ');
        switch (cmd.toLowerCase()) {
            case 'clear':
                this.gemini.clearHistory(jid);
                await this.whatsapp.sendReply(jid, 'Conversation history cleared.', originalMessage);
                break;
            case 'help':
                await this.whatsapp.sendReply(jid, this.getHelpText(), originalMessage);
                break;
            case 'groups':
                await this.handleGroupsCommand(jid, originalMessage);
                break;
            case 'schedule':
                await this.handleScheduleCommand(jid, args, originalMessage);
                break;
            case 'scheduled':
                await this.handleListScheduledCommand(jid, originalMessage);
                break;
            case 'image':
                await this.handleImageGeneration(jid, args.join(' '), originalMessage);
                break;
            case 'proimage':
                await this.handleImageGeneration(jid, args.join(' '), originalMessage, true);
                break;
            case 'voice':
                if (this.voiceModeJids.has(jid)) {
                    this.voiceModeJids.delete(jid);
                    await this.whatsapp.sendReply(jid, 'מצב קול כבוי - חוזר לתשובות טקסט', originalMessage);
                }
                else {
                    this.voiceModeJids.add(jid);
                    await this.whatsapp.sendReply(jid, 'מצב קול פעיל - אענה בהודעות קוליות', originalMessage);
                }
                break;
            case 'birthdays':
                await this.handleBirthdaysCommand(jid, args, originalMessage);
                break;
            default:
                await this.whatsapp.sendReply(jid, `Unknown command: /${cmd}\n\nType /help for available commands.`, originalMessage);
        }
    }
    async handleGroupsCommand(jid, originalMessage) {
        try {
            const groups = await this.whatsapp.getGroups();
            if (groups.length === 0) {
                await this.whatsapp.sendReply(jid, 'No groups found.', originalMessage);
                return;
            }
            const groupList = groups
                .map((g, i) => `${i + 1}. ${g.name}\n   ID: ${g.id}`)
                .join('\n\n');
            await this.whatsapp.sendReply(jid, `*Your Groups:*\n\n${groupList}`, originalMessage);
        }
        catch (error) {
            logger.error('Error fetching groups:', error);
            await this.whatsapp.sendReply(jid, 'Error fetching groups.', originalMessage);
        }
    }
    async handleScheduleCommand(jid, args, originalMessage) {
        // Format: /schedule <target_jid> <cron> <message>
        // Example: /schedule 123456789@g.us "0 9 * * *" Good morning!
        if (args.length < 3) {
            await this.whatsapp.sendReply(jid, `*Schedule Message Usage:*\n\n/schedule <jid> "<cron>" <message>\n\nExample:\n/schedule 123456789@g.us "0 9 * * *" Good morning!\n\nCron format: minute hour day month weekday`, originalMessage);
            return;
        }
        const targetJid = args[0];
        // Extract cron expression (in quotes)
        const cronMatch = args.slice(1).join(' ').match(/"([^"]+)"\s+(.*)/);
        if (!cronMatch) {
            await this.whatsapp.sendReply(jid, 'Invalid format. Put cron expression in quotes: "0 9 * * *"', originalMessage);
            return;
        }
        const cronExpression = cronMatch[1];
        const message = cronMatch[2];
        try {
            const id = this.scheduler.scheduleMessage(targetJid, message, cronExpression);
            await this.whatsapp.sendReply(jid, `Message scheduled!\nID: ${id}\nTarget: ${targetJid}\nCron: ${cronExpression}\nMessage: ${message}`, originalMessage);
        }
        catch (error) {
            await this.whatsapp.sendReply(jid, `Error scheduling message: ${error instanceof Error ? error.message : 'Unknown error'}`, originalMessage);
        }
    }
    async handleListScheduledCommand(jid, originalMessage) {
        const scheduled = this.scheduler.listScheduledMessages();
        if (scheduled.length === 0) {
            await this.whatsapp.sendReply(jid, 'No scheduled messages.', originalMessage);
            return;
        }
        const list = scheduled
            .map((s, i) => `${i + 1}. ${s.useAi ? '[AI] ' : ''}ID: ${s.id}\n   To: ${s.jid}\n   Cron: ${s.cronExpression}\n   ${s.useAi ? 'Prompt' : 'Message'}: ${s.message.substring(0, 50)}${s.message.length > 50 ? '...' : ''}`)
            .join('\n\n');
        await this.whatsapp.sendReply(jid, `*Scheduled Messages:*\n\n${list}`, originalMessage);
    }
    /**
     * Handle natural language schedule requests via Gemini function calling
     */
    async handleScheduleFunctionCall(jid, args, originalMessage) {
        try {
            // Normalize hour/minute - Gemini sometimes returns 14.25 instead of hour=14, minute=25
            let hour = Math.floor(args.hour);
            let minute = args.minute ?? 0;
            // If hour has decimal (e.g., 14.25), extract minutes from it
            if (args.hour !== hour) {
                const decimalPart = args.hour - hour;
                // Check if it looks like HH.MM format (e.g., 14.25 = 14:25)
                if (decimalPart > 0 && decimalPart < 1) {
                    const possibleMinute = Math.round(decimalPart * 100);
                    if (possibleMinute < 60) {
                        minute = possibleMinute;
                    }
                }
            }
            // Ensure minute is valid
            minute = Math.floor(minute);
            if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
                await this.whatsapp.sendReply(jid, '❌ שעה לא תקינה. נסה פורמט כמו: 14:30 או 9 בבוקר', originalMessage);
                return `[ניסיתי לתזמן הודעה אבל השעה לא תקינה: ${args.hour}:${args.minute}]`;
            }
            logger.info(`Normalized time: ${hour}:${minute} (original: hour=${args.hour}, minute=${args.minute})`);
            // Resolve target - find group by name or use current chat
            const targetJid = await this.resolveScheduleTarget(args.targetName, jid);
            const targetName = await this.getTargetDisplayName(targetJid);
            let scheduleId;
            let scheduleDescription;
            const scheduleRepo = new ScheduleRepository();
            if (args.days && args.days.length > 0) {
                // Recurring schedule
                const cronExpression = this.buildCronExpression(hour, minute, args.days);
                scheduleId = this.scheduler.scheduleMessage(targetJid, args.message, cronExpression, false, args.useAi);
                scheduleDescription = this.formatDaysDescription(args.days, hour, minute);
                // Persist to database
                scheduleRepo.create({
                    id: scheduleId,
                    jid: targetJid,
                    message: args.message,
                    cronExpression,
                    oneTime: false,
                    useAi: args.useAi,
                });
            }
            else if (args.oneTimeDate) {
                // One-time schedule
                const scheduledDate = new Date(`${args.oneTimeDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
                if (scheduledDate <= new Date()) {
                    await this.whatsapp.sendReply(jid, '❌ התאריך כבר עבר. נסה תאריך עתידי.', originalMessage);
                    return `[ניסיתי לתזמן הודעה אבל התאריך כבר עבר: ${args.oneTimeDate}]`;
                }
                scheduleId = this.scheduler.scheduleOneTimeMessage(targetJid, args.message, scheduledDate, args.useAi);
                scheduleDescription = `${args.oneTimeDate} ב-${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                // Persist to database
                scheduleRepo.create({
                    id: scheduleId,
                    jid: targetJid,
                    message: args.message,
                    cronExpression: 'one-time',
                    oneTime: true,
                    scheduledAt: scheduledDate.toISOString(),
                    useAi: args.useAi,
                });
            }
            else {
                await this.whatsapp.sendReply(jid, '❌ לא הצלחתי להבין מתי לשלוח. נסה לציין ימים או תאריך.', originalMessage);
                return `[ניסיתי לתזמן הודעה אבל לא הצלחתי להבין מתי לשלוח]`;
            }
            // Build confirmation message
            const targetText = targetJid === jid ? 'כאן' : targetName;
            const typeText = args.useAi ? '🤖 AI (תוכן חדש בכל פעם)' : '📝 טקסט קבוע';
            const confirmation = `✅ *תזמנתי!*

📍 יעד: ${targetText}
⏰ מתי: ${scheduleDescription}
${args.useAi ? '🤖 Prompt' : '💬 הודעה'}: "${args.message.length > 100 ? args.message.substring(0, 100) + '...' : args.message}"
📋 סוג: ${typeText}
🔑 ID: ${scheduleId}`;
            await this.whatsapp.sendReply(jid, confirmation, originalMessage);
            logger.info(`Natural language schedule created: ${scheduleId} for ${targetJid}`);
            return confirmation;
        }
        catch (error) {
            logger.error('Error creating schedule from function call:', error);
            await this.whatsapp.sendReply(jid, `❌ שגיאה ביצירת התזמון: ${error instanceof Error ? error.message : 'שגיאה לא ידועה'}`, originalMessage);
            return `[ניסיתי לתזמן הודעה אבל נכשלתי: ${error instanceof Error ? error.message : 'שגיאה'}]`;
        }
    }
    /**
     * Handle song search via Gemini function calling
     */
    async handleSongSearch(jid, query, originalMessage) {
        const songRepo = getSongRepository();
        const results = songRepo.search(query, 10);
        if (results.length === 0) {
            await this.whatsapp.sendReply(jid, `לא נמצאו שירים עבור "${query}". נסה חיפוש אחר.`, originalMessage);
            return `[חיפשתי שיר "${query}" ולא מצאתי תוצאות]`;
        }
        if (results.length === 1) {
            const song = results[0];
            let text = `🎸 *${song.title}* - ${song.artist}`;
            if (song.capo)
                text += `\nCapo: ${song.capo}`;
            text += `\n\n${song.url}`;
            await this.whatsapp.sendReply(jid, text, originalMessage);
            return `[חיפשתי שיר "${query}" ומצאתי: ${song.title} - ${song.artist}]`;
        }
        const list = results.map((s, i) => `${i + 1}. *${s.title}* - ${s.artist}\n${s.url}`).join('\n\n');
        await this.whatsapp.sendReply(jid, `🎸 נמצאו ${results.length} שירים:\n\n${list}`, originalMessage);
        const titles = results.map(s => `${s.title} - ${s.artist}`).join(', ');
        return `[חיפשתי שיר "${query}" ומצאתי ${results.length} תוצאות: ${titles}]`;
    }
    /**
     * Handle contact search via Gemini function calling
     */
    async handleContactSearch(jid, query, originalMessage) {
        const contactRepo = getContactRepository();
        const results = contactRepo.search(query);
        if (results.length === 0) {
            await this.whatsapp.sendReply(jid, `לא נמצאו אנשי קשר עם השם "${query}".`, originalMessage);
            return `[חיפשתי איש קשר "${query}" ולא מצאתי תוצאות]`;
        }
        const list = results.map((c, i) => {
            let line = `${i + 1}. *${c.name}*: ${c.phone}`;
            if (c.notes)
                line += ` (${c.notes})`;
            return line;
        }).join('\n');
        await this.whatsapp.sendReply(jid, `📞 נמצאו ${results.length} אנשי קשר:\n\n${list}`, originalMessage);
        const names = results.map(c => c.name).join(', ');
        return `[חיפשתי איש קשר "${query}" ומצאתי: ${names}]`;
    }
    /**
     * Handle Hoshaya village directory search via Gemini function calling
     */
    async handleHoshayaDirectorySearch(jid, query, originalMessage) {
        const repo = getHoshayaDirectoryRepository();
        const results = repo.search(query, 10);
        if (results.length === 0) {
            await this.whatsapp.sendReply(jid, `לא נמצאו תושבים בהושעיה עם השם "${query}".`, originalMessage);
            return `[חיפשתי בספר הטלפונים של הושעיה "${query}" ולא מצאתי תוצאות]`;
        }
        const list = results.map((r, i) => {
            const phones = [];
            if (r.mobile_phone)
                phones.push(`נייד: ${r.mobile_phone}`);
            if (r.home_phone)
                phones.push(`בית: ${r.home_phone}`);
            const phoneStr = phones.length > 0 ? phones.join(' | ') : 'אין טלפון';
            let line = `${i + 1}. *${r.last_name} ${r.first_name}*: ${phoneStr}`;
            if (r.address)
                line += `\n   📍 ${r.address}`;
            return line;
        }).join('\n');
        await this.whatsapp.sendReply(jid, `📞 ספר טלפונים הושעיה - נמצאו ${results.length} תוצאות:\n\n${list}`, originalMessage);
        return `[חיפשתי בספר הטלפונים של הושעיה "${query}" ושלחתי ${results.length} תוצאות למשתמש]`;
    }
    /**
     * Handle chore rotation management via Gemini function calling
     */
    async handleChoreRotation(jid, args, originalMessage) {
        if (!this.choreRotationService) {
            await this.whatsapp.sendReply(jid, 'שירות התורנויות לא זמין.', originalMessage);
            return '[שגיאה: שירות תורנויות לא זמין]';
        }
        const repo = this.choreRotationService.getRepository();
        switch (args.action) {
            case 'create': {
                if (!args.rotationName || !args.members || args.members.length < 2) {
                    await this.whatsapp.sendReply(jid, 'צריך שם לתורנות ולפחות 2 משתתפים.', originalMessage);
                    return '[שגיאה: חסרים פרטים ליצירת תורנות]';
                }
                // Check if rotation already exists
                const existing = repo.findByJidAndName(jid, args.rotationName);
                if (existing) {
                    await this.whatsapp.sendReply(jid, `כבר קיימת תורנות בשם "${args.rotationName}". אפשר לערוך אותה או למחוק ולהקים חדשה.`, originalMessage);
                    return `[תורנות "${args.rotationName}" כבר קיימת]`;
                }
                repo.create({
                    jid,
                    name: args.rotationName,
                    members: args.members,
                    frequency: args.frequency || 'daily',
                    reminder_hour: args.reminderHour ?? 8,
                    reminder_minute: args.reminderMinute ?? 0,
                });
                const memberList = args.members.join(', ');
                const timeStr = `${String(args.reminderHour ?? 8).padStart(2, '0')}:${String(args.reminderMinute ?? 0).padStart(2, '0')}`;
                const msg = `✅ *תורנות "${args.rotationName}" נוצרה!*\n\n👥 משתתפים: ${memberList}\n🔄 תדירות: ${args.frequency === 'weekly' ? 'שבועי' : 'יומי'}\n⏰ תזכורת: ${timeStr}\n\nהתור הראשון: *${args.members[0]}*`;
                await this.whatsapp.sendReply(jid, msg, originalMessage);
                return `[יצרתי תורנות "${args.rotationName}" עם ${args.members.length} משתתפים: ${memberList}]`;
            }
            case 'list': {
                const summary = this.choreRotationService.getRotationsSummary(jid);
                await this.whatsapp.sendReply(jid, summary, originalMessage);
                return `[הצגתי את רשימת התורנויות]`;
            }
            case 'status': {
                if (!args.rotationName) {
                    // If no name given, show all
                    const summary = this.choreRotationService.getRotationsSummary(jid);
                    await this.whatsapp.sendReply(jid, summary, originalMessage);
                    return `[הצגתי את כל התורנויות]`;
                }
                const rotation = repo.searchByJidAndName(jid, args.rotationName);
                if (!rotation) {
                    await this.whatsapp.sendReply(jid, `לא נמצאה תורנות בשם "${args.rotationName}".`, originalMessage);
                    return `[לא נמצאה תורנות "${args.rotationName}"]`;
                }
                const assignee = this.choreRotationService.getCurrentAssignee(rotation);
                const members = JSON.parse(rotation.members);
                const msg = `📋 *${rotation.name}*: היום התור של *${assignee}*\n(מתוך: ${members.join(', ')})`;
                await this.whatsapp.sendReply(jid, msg, originalMessage);
                return `[תורנות "${rotation.name}": התור של ${assignee}]`;
            }
            case 'advance': {
                if (!args.rotationName) {
                    await this.whatsapp.sendReply(jid, 'צריך לציין את שם התורנות.', originalMessage);
                    return '[שגיאה: לא צוין שם תורנות לדילוג]';
                }
                const rotation = repo.searchByJidAndName(jid, args.rotationName);
                if (!rotation) {
                    await this.whatsapp.sendReply(jid, `לא נמצאה תורנות בשם "${args.rotationName}".`, originalMessage);
                    return `[לא נמצאה תורנות "${args.rotationName}"]`;
                }
                const members = JSON.parse(rotation.members);
                const newIndex = (rotation.current_index + 1) % members.length;
                repo.advance(rotation.id, newIndex);
                const newAssignee = members[newIndex];
                await this.whatsapp.sendReply(jid, `⏭️ תורנות "${rotation.name}" הועברה. התור עכשיו של *${newAssignee}*.`, originalMessage);
                return `[דילגתי בתורנות "${rotation.name}", התור עכשיו של ${newAssignee}]`;
            }
            case 'delete': {
                if (!args.rotationName) {
                    await this.whatsapp.sendReply(jid, 'צריך לציין את שם התורנות למחיקה.', originalMessage);
                    return '[שגיאה: לא צוין שם תורנות למחיקה]';
                }
                const rotation = repo.searchByJidAndName(jid, args.rotationName);
                if (!rotation) {
                    await this.whatsapp.sendReply(jid, `לא נמצאה תורנות בשם "${args.rotationName}".`, originalMessage);
                    return `[לא נמצאה תורנות "${args.rotationName}"]`;
                }
                repo.delete(rotation.id);
                await this.whatsapp.sendReply(jid, `🗑️ תורנות "${rotation.name}" נמחקה.`, originalMessage);
                return `[מחקתי את התורנות "${rotation.name}"]`;
            }
            case 'edit': {
                if (!args.rotationName) {
                    await this.whatsapp.sendReply(jid, 'צריך לציין את שם התורנות לעריכה.', originalMessage);
                    return '[שגיאה: לא צוין שם תורנות לעריכה]';
                }
                const rotation = repo.searchByJidAndName(jid, args.rotationName);
                if (!rotation) {
                    await this.whatsapp.sendReply(jid, `לא נמצאה תורנות בשם "${args.rotationName}".`, originalMessage);
                    return `[לא נמצאה תורנות "${args.rotationName}"]`;
                }
                if (!args.members || args.members.length < 2) {
                    await this.whatsapp.sendReply(jid, 'צריך לפחות 2 משתתפים.', originalMessage);
                    return '[שגיאה: חסרים משתתפים לעריכה]';
                }
                repo.updateMembers(rotation.id, args.members);
                const memberList = args.members.join(', ');
                await this.whatsapp.sendReply(jid, `✏️ תורנות "${rotation.name}" עודכנה.\n👥 משתתפים חדשים: ${memberList}\nהתור חוזר ל: *${args.members[0]}*`, originalMessage);
                return `[עדכנתי תורנות "${rotation.name}" עם משתתפים: ${memberList}]`;
            }
            default: {
                await this.whatsapp.sendReply(jid, 'פעולה לא מוכרת. אפשר: צור/הצג/מצב/דלג/מחק/ערוך תורנות.', originalMessage);
                return `[פעולת תורנות לא מוכרת: ${args.action}]`;
            }
        }
    }
    /**
     * Resolve target name to JID - search in bot's groups or use current chat
     */
    async resolveScheduleTarget(targetName, currentJid) {
        // Self references
        const selfKeywords = ['self', 'לי', 'לעצמי', 'אלי', 'פה', 'כאן'];
        if (selfKeywords.includes(targetName.toLowerCase())) {
            return currentJid;
        }
        const normalizedTarget = targetName.toLowerCase().replace(/קבוצת\s*/i, '').replace(/ערוץ\s*/i, '');
        // Search in groups
        try {
            const groups = await this.whatsapp.getGroups();
            // Try exact match first
            let match = groups.find(g => g.name.toLowerCase() === normalizedTarget);
            // Try partial match
            if (!match) {
                match = groups.find(g => g.name.toLowerCase().includes(normalizedTarget) ||
                    normalizedTarget.includes(g.name.toLowerCase()));
            }
            if (match) {
                logger.info(`Resolved target "${targetName}" to group ${match.name} (${match.id})`);
                return match.id;
            }
        }
        catch (error) {
            logger.warn('Error searching groups for target:', error);
        }
        // Search in whitelisted chats (includes channels/newsletters)
        const allChats = this.botControl.getAllChats();
        const chatMatch = allChats.find(c => c.display_name?.toLowerCase() === normalizedTarget) || allChats.find(c => c.display_name?.toLowerCase().includes(normalizedTarget) ||
            normalizedTarget.includes(c.display_name?.toLowerCase() || ''));
        if (chatMatch) {
            logger.info(`Resolved target "${targetName}" to whitelisted chat ${chatMatch.display_name} (${chatMatch.jid})`);
            return chatMatch.jid;
        }
        // Fallback to current chat
        logger.info(`Could not find target "${targetName}", using current chat ${currentJid}`);
        return currentJid;
    }
    /**
     * Get display name for a JID (group name or contact name)
     */
    async getTargetDisplayName(targetJid) {
        if (targetJid.endsWith('@g.us')) {
            try {
                const groups = await this.whatsapp.getGroups();
                const group = groups.find(g => g.id === targetJid);
                if (group)
                    return group.name;
            }
            catch { /* ignore */ }
        }
        const config = this.botControl.getChatConfig(targetJid);
        return config?.display_name || targetJid;
    }
    /**
     * Build cron expression from hour, minute, and days array
     */
    buildCronExpression(hour, minute, days) {
        const daysPart = days.length === 7 ? '*' : days.join(',');
        return `${minute} ${hour} * * ${daysPart}`;
    }
    /**
     * Format days array to human readable Hebrew description
     */
    formatDaysDescription(days, hour, minute) {
        const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        if (days.length === 7) {
            return `כל יום ב-${timeStr}`;
        }
        if (days.length === 5 && [0, 1, 2, 3, 4].every(d => days.includes(d))) {
            return `ימי חול ב-${timeStr}`;
        }
        if (days.length === 1) {
            return `כל יום ${dayNames[days[0]]} ב-${timeStr}`;
        }
        const daysList = days.map(d => dayNames[d]).join(', ');
        return `בימים ${daysList} ב-${timeStr}`;
    }
    async handleBirthdaysCommand(jid, args, originalMessage) {
        const subCommand = args[0]?.toLowerCase();
        // /birthdays - show help
        if (!subCommand) {
            await this.whatsapp.sendReply(jid, `*ניהול ימי הולדת 🎂*

*הוספת רשימה:*
/birthdays add <רשימה>
דוגמה: /birthdays add איתי 5 פבר יהודה 25 מרץ שרה 15/12

*הצגת רשימה:*
/birthdays list

*מחיקה:*
/birthdays delete <מספר>

הבוט ישלח ברכה אוטומטית בכל יום הולדת ב-8:00 בבוקר!`, originalMessage);
            return;
        }
        if (subCommand === 'add') {
            const listText = args.slice(1).join(' ');
            if (!listText.trim()) {
                await this.whatsapp.sendReply(jid, 'אנא ציין רשימת ימי הולדת.\nדוגמה: /birthdays add איתי 5 פבר יהודה 25 מרץ', originalMessage);
                return;
            }
            try {
                await this.whatsapp.sendReply(jid, 'מעבד את הרשימה...', originalMessage);
                const parsed = await this.birthdayService.parseBirthdayList(jid, listText);
                const ids = this.birthdayService.addBirthdays(parsed);
                const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
                    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
                const summary = parsed.map((b, i) => `${i + 1}. ${b.person_name} - ${b.birth_day} ${monthNames[b.birth_month - 1]}`).join('\n');
                await this.whatsapp.sendReply(jid, `נוספו ${ids.length} ימי הולדת:\n\n${summary}\n\nאשלח ברכות אוטומטית בכל יום הולדת ב-8:00!`, originalMessage);
            }
            catch (error) {
                logger.error('Failed to add birthdays:', error);
                await this.whatsapp.sendReply(jid, `שגיאה: ${error instanceof Error ? error.message : 'לא הצלחתי להוסיף את ימי ההולדת'}`, originalMessage);
            }
            return;
        }
        if (subCommand === 'list') {
            const birthdays = this.birthdayService.getBirthdaysByJid(jid);
            if (birthdays.length === 0) {
                await this.whatsapp.sendReply(jid, 'אין ימי הולדת שמורים עדיין.\nהוסף עם: /birthdays add <רשימה>', originalMessage);
                return;
            }
            const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
                'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
            const list = birthdays.map((b, i) => `${i + 1}. ${b.person_name} - ${b.birth_day} ${monthNames[b.birth_month - 1]} (ID: ${b.id})`).join('\n');
            await this.whatsapp.sendReply(jid, `*ימי הולדת שמורים 🎂*\n\n${list}\n\nמחק עם: /birthdays delete <ID>`, originalMessage);
            return;
        }
        if (subCommand === 'delete') {
            const idStr = args[1];
            if (!idStr) {
                await this.whatsapp.sendReply(jid, 'ציין ID למחיקה. דוגמה: /birthdays delete 5', originalMessage);
                return;
            }
            const id = parseInt(idStr);
            if (isNaN(id)) {
                await this.whatsapp.sendReply(jid, 'ID לא תקין', originalMessage);
                return;
            }
            const deleted = this.birthdayService.deleteBirthday(id);
            if (deleted) {
                await this.whatsapp.sendReply(jid, 'יום ההולדת נמחק', originalMessage);
            }
            else {
                await this.whatsapp.sendReply(jid, 'לא נמצא יום הולדת עם ID זה', originalMessage);
            }
            return;
        }
        await this.whatsapp.sendReply(jid, `פקודה לא מוכרת: ${subCommand}\nכתוב /birthdays לעזרה`, originalMessage);
    }
    // --- Calendar handlers ---
    async handleCalendarList(jid, args, originalMessage) {
        if (!this.calendarService) {
            await this.whatsapp.sendReply(jid, '❌ שירות היומן לא מוגדר.', originalMessage);
            return `[ניסיתי להציג אירועי יומן אבל שירות היומן לא מוגדר]`;
        }
        const repo = getCalendarLinkRepository();
        const links = repo.findByJid(jid);
        if (links.length === 0) {
            await this.whatsapp.sendReply(jid, '❌ אין לך יומן מקושר. בקש מהמנהל לקשר את היומן שלך.', originalMessage);
            return `[ניסיתי להציג אירועי יומן אבל אין יומן מקושר]`;
        }
        try {
            const startDate = args.startDate ? new Date(args.startDate) : new Date();
            const endDate = args.endDate ? new Date(args.endDate) : new Date(startDate);
            const startOfDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            const endOfDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1);
            const events = await this.calendarService.listEventsForJid(jid, startOfDay, endOfDay, args.query);
            // Build date label
            const isSameDay = startDate.toDateString() === endDate.toDateString();
            const today = new Date();
            let label;
            if (isSameDay && startDate.toDateString() === today.toDateString()) {
                label = 'היום';
            }
            else if (isSameDay) {
                label = `ב-${args.startDate}`;
            }
            else {
                label = `מ-${args.startDate} עד ${args.endDate}`;
            }
            const formatted = this.calendarService.formatEventList(events, label);
            await this.whatsapp.sendReply(jid, formatted, originalMessage);
            const eventNames = events.map(e => e.summary || 'ללא שם').join(', ');
            return `[הצגתי אירועי יומן ${label}: ${events.length} אירועים${events.length > 0 ? ' - ' + eventNames : ''}]`;
        }
        catch (error) {
            logger.error('Calendar list error:', error);
            await this.whatsapp.sendReply(jid, '❌ שגיאה בשליפת אירועים מהיומן.', originalMessage);
            return `[ניסיתי להציג אירועי יומן אבל נכשלתי]`;
        }
    }
    async handleCalendarCreate(jid, args, originalMessage) {
        if (!this.calendarService) {
            await this.whatsapp.sendReply(jid, '❌ שירות היומן לא מוגדר.', originalMessage);
            return `[ניסיתי ליצור אירוע ביומן אבל שירות היומן לא מוגדר]`;
        }
        const repo = getCalendarLinkRepository();
        const defaultLink = repo.findDefaultByJid(jid);
        if (!defaultLink) {
            await this.whatsapp.sendReply(jid, '❌ אין לך יומן מקושר. בקש מהמנהל לקשר את היומן שלך.', originalMessage);
            return `[ניסיתי ליצור אירוע ביומן אבל אין יומן מקושר]`;
        }
        try {
            const hour = Math.floor(args.startHour);
            const minute = args.startMinute ?? 0;
            const duration = args.durationMinutes ?? 60;
            const startTime = new Date(`${args.date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
            const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
            const event = await this.calendarService.createEventForJid(jid, args.summary, startTime, endTime);
            if (!event) {
                await this.whatsapp.sendReply(jid, '❌ לא הצלחתי ליצור את האירוע.', originalMessage);
                return `[ניסיתי ליצור אירוע "${args.summary}" ביומן אבל נכשלתי]`;
            }
            const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            await this.whatsapp.sendReply(jid, `✅ *אירוע נוצר!*\n\n📌 ${args.summary}\n📅 ${args.date}\n🕐 ${timeStr} (${duration} דקות)`, originalMessage);
            return `[יצרתי אירוע ביומן: "${args.summary}" בתאריך ${args.date} בשעה ${timeStr}]`;
        }
        catch (error) {
            logger.error('Calendar create error:', error);
            await this.whatsapp.sendReply(jid, '❌ שגיאה ביצירת אירוע ביומן.', originalMessage);
            return `[ניסיתי ליצור אירוע "${args.summary}" ביומן אבל נכשלתי]`;
        }
    }
    async handleCalendarUpdate(jid, args, originalMessage) {
        if (!this.calendarService) {
            await this.whatsapp.sendReply(jid, '❌ שירות היומן לא מוגדר.', originalMessage);
            return `[ניסיתי לעדכן אירוע ביומן אבל שירות היומן לא מוגדר]`;
        }
        const repo = getCalendarLinkRepository();
        const links = repo.findByJid(jid);
        if (links.length === 0) {
            await this.whatsapp.sendReply(jid, '❌ אין לך יומן מקושר.', originalMessage);
            return `[ניסיתי לעדכן אירוע ביומן אבל אין יומן מקושר]`;
        }
        try {
            const searchDate = new Date(args.searchDate);
            const found = await this.calendarService.searchEventForJid(jid, args.searchQuery, searchDate);
            if (!found) {
                await this.whatsapp.sendReply(jid, `❌ לא מצאתי אירוע "${args.searchQuery}" בתאריך ${args.searchDate}.`, originalMessage);
                return `[ניסיתי לעדכן אירוע "${args.searchQuery}" אבל לא מצאתי אותו]`;
            }
            const updates = {};
            if (args.newSummary)
                updates.summary = args.newSummary;
            if (args.newDate || args.newStartHour !== undefined) {
                // Calculate new start time
                const existingStart = found.event.start?.dateTime
                    ? new Date(found.event.start.dateTime)
                    : new Date(args.searchDate);
                const existingEnd = found.event.end?.dateTime
                    ? new Date(found.event.end.dateTime)
                    : new Date(existingStart.getTime() + 60 * 60 * 1000);
                const duration = existingEnd.getTime() - existingStart.getTime();
                const newDate = args.newDate || args.searchDate;
                const newHour = args.newStartHour ?? existingStart.getHours();
                const newMinute = args.newStartMinute ?? existingStart.getMinutes();
                const newStart = new Date(`${newDate}T${String(newHour).padStart(2, '0')}:${String(newMinute).padStart(2, '0')}:00`);
                updates.start = newStart;
                updates.end = new Date(newStart.getTime() + duration);
            }
            await this.calendarService.updateEvent(found.calendarId, found.event.id, updates);
            const changes = [];
            if (args.newSummary)
                changes.push(`📌 כותרת: ${args.newSummary}`);
            if (args.newDate)
                changes.push(`📅 תאריך: ${args.newDate}`);
            if (args.newStartHour !== undefined) {
                const m = args.newStartMinute ?? 0;
                changes.push(`🕐 שעה: ${String(args.newStartHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
            }
            await this.whatsapp.sendReply(jid, `✅ *אירוע עודכן!*\n\nאירוע: "${found.event.summary}"\n${changes.join('\n')}`, originalMessage);
            const changeDesc = changes.map(c => c.replace(/^[^\s]+\s/, '')).join(', ');
            return `[עדכנתי אירוע "${found.event.summary}": ${changeDesc}]`;
        }
        catch (error) {
            logger.error('Calendar update error:', error);
            await this.whatsapp.sendReply(jid, '❌ שגיאה בעדכון האירוע.', originalMessage);
            return `[ניסיתי לעדכן אירוע "${args.searchQuery}" אבל נכשלתי]`;
        }
    }
    async handleCalendarDelete(jid, args, originalMessage) {
        if (!this.calendarService) {
            await this.whatsapp.sendReply(jid, '❌ שירות היומן לא מוגדר.', originalMessage);
            return `[ניסיתי למחוק אירוע מהיומן אבל שירות היומן לא מוגדר]`;
        }
        const repo = getCalendarLinkRepository();
        const links = repo.findByJid(jid);
        if (links.length === 0) {
            await this.whatsapp.sendReply(jid, '❌ אין לך יומן מקושר.', originalMessage);
            return `[ניסיתי למחוק אירוע מהיומן אבל אין יומן מקושר]`;
        }
        try {
            const searchDate = new Date(args.searchDate);
            const found = await this.calendarService.searchEventForJid(jid, args.searchQuery, searchDate);
            if (!found) {
                await this.whatsapp.sendReply(jid, `❌ לא מצאתי אירוע "${args.searchQuery}" בתאריך ${args.searchDate}.`, originalMessage);
                return `[ניסיתי למחוק אירוע "${args.searchQuery}" אבל לא מצאתי אותו]`;
            }
            await this.calendarService.deleteEvent(found.calendarId, found.event.id);
            await this.whatsapp.sendReply(jid, `🗑️ *אירוע נמחק!*\n\n"${found.event.summary}" בתאריך ${args.searchDate}`, originalMessage);
            return `[מחקתי אירוע מהיומן: "${found.event.summary}" בתאריך ${args.searchDate}]`;
        }
        catch (error) {
            logger.error('Calendar delete error:', error);
            await this.whatsapp.sendReply(jid, '❌ שגיאה במחיקת האירוע.', originalMessage);
            return `[ניסיתי למחוק אירוע "${args.searchQuery}" אבל נכשלתי]`;
        }
    }
    // --- Send message to others ---
    async resolveMessageTarget(targetName) {
        // 1. Phone number — normalize Israeli 05x → 9725x
        const phoneDigits = targetName.replace(/[-\s()+]/g, '');
        if (/^\d{7,15}$/.test(phoneDigits)) {
            let normalized = phoneDigits;
            if (/^05\d{8}$/.test(normalized)) {
                normalized = '972' + normalized.slice(1);
            }
            return { jid: `${normalized}@s.whatsapp.net`, displayName: targetName };
        }
        // 2. Contacts DB
        const contactRepo = getContactRepository();
        const contacts = contactRepo.search(targetName);
        if (contacts.length > 0) {
            const contact = contacts[0];
            let phone = contact.phone.replace(/[-\s()]/g, '');
            if (/^05\d{8}$/.test(phone)) {
                phone = '972' + phone.slice(1);
            }
            return { jid: `${phone}@s.whatsapp.net`, displayName: contact.name };
        }
        // 3. WhatsApp groups
        try {
            const groups = await this.whatsapp.getGroups();
            const normalizedTarget = targetName.toLowerCase().replace(/קבוצת\s*/i, '');
            let match = groups.find(g => g.name.toLowerCase() === normalizedTarget);
            if (!match) {
                match = groups.find(g => g.name.toLowerCase().includes(normalizedTarget) ||
                    normalizedTarget.includes(g.name.toLowerCase()));
            }
            if (match) {
                return { jid: match.id, displayName: match.name };
            }
        }
        catch (err) {
            logger.warn('Error searching groups for send_message target:', err);
        }
        // 4. Whitelisted chats (search display_name)
        const allChats = this.botControl.getAllChats();
        const normalizedTarget = targetName.toLowerCase();
        const chatMatch = allChats.find(c => c.display_name?.toLowerCase().includes(normalizedTarget));
        if (chatMatch) {
            return { jid: chatMatch.jid, displayName: chatMatch.display_name || chatMatch.jid };
        }
        return null;
    }
    async handleSendMessage(senderJid, args, originalMessage, senderName) {
        try {
            // Rate limit check
            const now = Date.now();
            const lastSend = this.sendMessageCooldowns.get(senderJid);
            if (lastSend && now - lastSend < this.SEND_MESSAGE_COOLDOWN_MS) {
                const secondsLeft = Math.ceil((this.SEND_MESSAGE_COOLDOWN_MS - (now - lastSend)) / 1000);
                await this.whatsapp.sendReply(senderJid, `⏳ נא להמתין ${secondsLeft} שניות לפני שליחת הודעה נוספת.`, originalMessage);
                return `[ניסיתי לשלוח הודעה ל"${args.targetName}" אבל יש cooldown]`;
            }
            // Resolve target
            const target = await this.resolveMessageTarget(args.targetName);
            if (!target) {
                await this.whatsapp.sendReply(senderJid, `❌ לא מצאתי את "${args.targetName}". ודא ששם איש הקשר/קבוצה נכון, או נסה מספר טלפון.`, originalMessage);
                return `[ניסיתי לשלוח הודעה ל"${args.targetName}" אבל לא מצאתי את הנמען]`;
            }
            // Prepare content
            logger.info(`[send_message] target="${args.targetName}" generateContent=${args.generateContent} messageContent="${args.messageContent}"`);
            let content = args.messageContent;
            if (args.generateContent) {
                content = await this.gemini.generateScheduledContent(`צור תוכן בעברית לפי הבקשה הבאה: ${args.messageContent}. אם מבקשים שיר - כתוב שיר עם בתים וחרוזים. אם מבקשים ברכה - כתוב ברכה יפה ומלאה. אם מבקשים סיפור - כתוב סיפור. התאם את אורך התוכן לסוג הבקשה. כתוב רק את התוכן עצמו, בלי הקדמה או הסבר.`);
            }
            // Format with sender attribution and reply instruction
            const outgoingMessage = `📩 *${senderName}* שלח/ה לך הודעה:\n\n${content}\n\n↩️ _השב/י על הודעה זו כדי לשלוח תשובה_`;
            // Check timing
            const isScheduled = args.timing && args.timing !== 'now' && args.scheduledDate;
            if (isScheduled && args.scheduledDate && args.scheduledHour !== undefined) {
                // Scheduled send
                const hour = Math.floor(args.scheduledHour);
                const minute = Math.floor(args.scheduledMinute ?? 0);
                const scheduledDate = new Date(`${args.scheduledDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
                if (scheduledDate <= new Date()) {
                    await this.whatsapp.sendReply(senderJid, '❌ הזמן שצוין כבר עבר. נסה זמן עתידי.', originalMessage);
                    return `[ניסיתי לתזמן הודעה ל"${target.displayName}" אבל הזמן כבר עבר]`;
                }
                const scheduleId = this.scheduler.scheduleOneTimeMessage(target.jid, outgoingMessage, scheduledDate, false);
                // Persist to DB
                const scheduleRepo = new ScheduleRepository();
                scheduleRepo.create({
                    id: scheduleId,
                    jid: target.jid,
                    message: outgoingMessage,
                    cronExpression: 'one-time',
                    oneTime: true,
                    scheduledAt: scheduledDate.toISOString(),
                    useAi: false,
                });
                const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                await this.whatsapp.sendReply(senderJid, `✅ *ההודעה תזומנה!*\n\n📍 ל: ${target.displayName}\n⏰ מתי: ${args.scheduledDate} ב-${timeStr}\n💬 "${content.length > 100 ? content.substring(0, 100) + '...' : content}"`, originalMessage);
                // Update cooldown
                this.sendMessageCooldowns.set(senderJid, Date.now());
                return `[תזמנתי הודעה ל${target.displayName} בתאריך ${args.scheduledDate} בשעה ${timeStr}. תוכן ההודעה: "${content}"]`;
            }
            else {
                // Immediate send
                // Check for image tags in AI-generated content
                const parsed = this.parseImageTags(outgoingMessage);
                const sentKey = await this.whatsapp.sendTextMessage(target.jid, parsed.cleanText || outgoingMessage);
                // Send images if any
                if (config.autoImageGeneration && parsed.imagePrompts.length > 0) {
                    for (const { prompt, pro } of parsed.imagePrompts.slice(0, 1)) {
                        try {
                            const result = await this.gemini.generateImage(prompt, pro);
                            if (result) {
                                await this.whatsapp.sendImageBuffer(target.jid, result.image, result.text || '');
                            }
                        }
                        catch (imgErr) {
                            logger.warn('Failed to generate image for send_message:', imgErr);
                        }
                    }
                }
                // Register mediation session so recipient can reply
                if (sentKey?.id) {
                    const session = {
                        initiatorJid: senderJid,
                        initiatorName: senderName,
                        recipientJid: target.jid,
                        recipientName: target.displayName,
                        lastActivity: Date.now(),
                    };
                    this.mediationMessages.set(sentKey.id, { session, sentToJid: target.jid });
                    logger.info(`[mediation] Registered stanzaId=${sentKey.id} for ${senderName} → ${target.displayName}`);
                }
                await this.whatsapp.sendReply(senderJid, `✅ ההודעה נשלחה ל${target.displayName}!\n_${target.displayName} יכול/ה להשיב, ואעביר לך את התשובה._`, originalMessage);
                // Update cooldown
                this.sendMessageCooldowns.set(senderJid, Date.now());
                return `[שלחתי הודעה ל${target.displayName}. תוכן ההודעה: "${content}"]`;
            }
        }
        catch (error) {
            logger.error('Error handling send_message:', error);
            await this.whatsapp.sendReply(senderJid, `❌ שגיאה בשליחת ההודעה: ${error instanceof Error ? error.message : 'שגיאה לא ידועה'}`, originalMessage);
            return `[ניסיתי לשלוח הודעה ל"${args.targetName}" אבל נכשלתי: ${error instanceof Error ? error.message : 'שגיאה'}]`;
        }
    }
    // --- Mediation (reply forwarding) ---
    cleanExpiredMediations() {
        const now = Date.now();
        for (const [stanzaId, entry] of this.mediationMessages) {
            if (now - entry.session.lastActivity > this.MEDIATION_TTL_MS) {
                this.mediationMessages.delete(stanzaId);
            }
        }
    }
    async checkAndHandleMediation(message, jid) {
        this.cleanExpiredMediations();
        // Extract stanzaId from quoted message (check all message types that carry contextInfo)
        const contextInfo = message.message?.extendedTextMessage?.contextInfo
            || message.message?.audioMessage?.contextInfo
            || message.message?.imageMessage?.contextInfo
            || message.message?.documentMessage?.contextInfo;
        const stanzaId = contextInfo?.stanzaId;
        if (!stanzaId)
            return false;
        const entry = this.mediationMessages.get(stanzaId);
        if (!entry)
            return false;
        // Verify the replier is the person this message was sent to
        const replierJid = jid;
        if (replierJid !== entry.sentToJid)
            return false;
        // Extract reply text (text-only for v1)
        const replyText = message.message?.conversation
            || message.message?.extendedTextMessage?.text;
        if (!replyText) {
            logger.info(`[mediation] Non-text reply from ${replierJid} — ignoring`);
            return true; // consumed but not forwarded
        }
        const { session } = entry;
        // Determine forward target and sender name
        let forwardToJid;
        let senderName;
        if (entry.sentToJid === session.initiatorJid) {
            // Initiator is replying → forward to recipient
            forwardToJid = session.recipientJid;
            senderName = session.initiatorName;
        }
        else {
            // Recipient is replying → forward to initiator
            forwardToJid = session.initiatorJid;
            senderName = session.recipientName;
        }
        // Use pushName if available for more accurate name
        if (message.pushName) {
            senderName = message.pushName;
        }
        const forwardMessage = `💬 *${senderName}*:\n${replyText}\n\n↩️ _השב/י על הודעה זו כדי להמשיך את השיחה_`;
        try {
            const sentKey = await this.whatsapp.sendTextMessage(forwardToJid, forwardMessage);
            // Register new stanzaId to continue the chain
            if (sentKey?.id) {
                session.lastActivity = Date.now();
                this.mediationMessages.set(sentKey.id, { session, sentToJid: forwardToJid });
                logger.info(`[mediation] Forwarded reply from ${senderName} → ${forwardToJid}, new stanzaId=${sentKey.id}`);
            }
        }
        catch (error) {
            logger.error('[mediation] Failed to forward reply:', error);
        }
        return true;
    }
    extractImagePrompt(text) {
        const lower = text.toLowerCase();
        // Hebrew PRO triggers (check first)
        const hebrewProPatterns = [
            /^(?:תייצר|ייצר|לייצר|צור|תצור)\s+(?:לי\s+)?תמונת?\s+פרו\s+(?:של\s+)?(.+)/i,
            /^(?:תצייר|צייר|לצייר)\s+(?:לי\s+)?פרו\s+(.+)/i,
            /^תמונת?\s+פרו\s+(?:של\s+)?(.+)/i,
        ];
        for (const pattern of hebrewProPatterns) {
            const match = text.match(pattern);
            if (match)
                return { prompt: match[1].trim(), pro: true };
        }
        // Hebrew triggers
        const hebrewPatterns = [
            /^(?:תייצר|ייצר|לייצר|צור|תצור)\s+(?:לי\s+)?תמונה\s+(?:של\s+)?(.+)/i,
            /^(?:תצייר|צייר|לצייר)\s+(?:לי\s+)?(.+)/i,
            /^תמונה\s+של\s+(.+)/i,
        ];
        for (const pattern of hebrewPatterns) {
            const match = text.match(pattern);
            if (match)
                return { prompt: match[1].trim(), pro: false };
        }
        // English PRO triggers (check first)
        const englishProPatterns = [
            /^(?:generate|create)\s+(?:an?\s+)?pro\s+image\s+(?:of\s+)?(.+)/i,
            /^pro\s+(?:draw|imagine)\s+(.+)/i,
        ];
        for (const pattern of englishProPatterns) {
            const match = lower.match(pattern);
            if (match)
                return { prompt: match[1].trim(), pro: true };
        }
        // English triggers
        const englishPatterns = [
            /^(?:generate|create)\s+(?:an?\s+)?image\s+(?:of\s+)?(.+)/i,
            /^(?:draw|imagine)\s+(.+)/i,
        ];
        for (const pattern of englishPatterns) {
            const match = lower.match(pattern);
            if (match)
                return { prompt: match[1].trim(), pro: false };
        }
        return null;
    }
    async handleImageGeneration(jid, prompt, originalMessage, pro = false) {
        if (!prompt.trim()) {
            await this.whatsapp.sendReply(jid, 'מה לצייר? כתוב תיאור.\nדוגמה: /image חתול על הירח', originalMessage);
            return;
        }
        try {
            await this.whatsapp.sendReply(jid, pro ? '🎨 מייצר תמונת PRO...' : '🎨 מייצר תמונה...', originalMessage);
            const result = await this.gemini.generateImage(prompt.trim(), pro);
            if (result) {
                await this.whatsapp.sendImageReply(jid, result.image, result.text || '', originalMessage);
            }
            else {
                await this.whatsapp.sendReply(jid, 'לא הצלחתי ליצור את התמונה. נסה תיאור אחר.', originalMessage);
            }
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error('Error generating image:', error);
            await this.whatsapp.sendReply(jid, `שגיאה ביצירת התמונה: ${errMsg}`, originalMessage);
        }
    }
    getHelpText() {
        return `*Bayles Bot - Help*

*Chat with AI:*
${config.botPrefix} <your message>

*כלי למידה:*
שלח תמונה או קובץ (PDF, מסמך) ואעזור לך:
- חזרה לקראת מבחן
- עזרה בפתרון תרגיל
- סיכום החומר
- שאלות תרגול

*Image Generation:*
/image <description> - Generate an image
/proimage <description> - Generate PRO image (higher quality)
Or: "ייצר תמונה של..." / "תצייר..."
PRO: "ייצר תמונת פרו של..." / "תמונת פרו של..."

*Birthday Reminders:*
/birthdays - Manage birthdays
/birthdays add <list> - Add birthdays
/birthdays list - Show saved birthdays
/birthdays delete <id> - Remove birthday

*Commands:*
/help - Show this help message
/clear - Clear conversation history
/voice - Toggle voice mode (respond with voice messages)
/image - Generate an image from text
/proimage - Generate PRO image (Nano Banana Pro)
/groups - List all groups with IDs
/schedule - Schedule a message
/scheduled - List scheduled messages
תמלל - השב להודעה קולית כדי לקבל תמלול מילה במילה

*Examples:*
${config.botPrefix} What's the weather like?
${config.botPrefix} Tell me a joke
/image a cat sitting on the moon
ייצר תמונה של חתול על הירח
/birthdays add איתי 5 פבר יהודה 25 מרץ`;
    }
    async handleTaskFunction(jid, name, args, message) {
        if (!this.gmailService || !this.gmailService.isOwner(jid)) {
            await this.whatsapp.sendReply(jid, 'Tasks are restricted to the owner.', message);
            return null;
        }
        const repo = getTaskRepository();
        try {
            switch (name) {
                case 'add_task': {
                    const title = String(args.title || '').trim();
                    if (!title) {
                        await this.whatsapp.sendReply(jid, 'אין כותרת למשימה.', message);
                        return '[add_task: empty title]';
                    }
                    const dueIso = args.due_iso ? String(args.due_iso) : undefined;
                    const dueAt = dueIso ? Date.parse(dueIso) : undefined;
                    const category = args.category ? String(args.category).trim().toLowerCase() : undefined;
                    const task = repo.add(jid, title, {
                        notes: args.notes ? String(args.notes) : undefined,
                        dueAt: dueAt && !isNaN(dueAt) ? dueAt : undefined,
                        category,
                    });
                    const dueStr = task.due_at ? ` · ${new Date(task.due_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}` : '';
                    const catStr = task.category ? ` · [${task.category}]` : '';
                    await this.whatsapp.sendReply(jid, `✅ הוספתי משימה #${task.id}: ${task.title}${catStr}${dueStr}`, message);
                    return `[add_task: #${task.id} "${title}" cat=${task.category || 'general'}]`;
                }
                case 'list_tasks': {
                    const filter = args.filter || 'active';
                    const status = filter === 'all' ? undefined : filter;
                    const categoryFilter = args.category ? String(args.category).trim().toLowerCase() : undefined;
                    const tasks = repo.list(jid, status, categoryFilter);
                    const label = categoryFilter ? `${filter} · ${categoryFilter}` : filter;
                    if (tasks.length === 0) {
                        await this.whatsapp.sendReply(jid, categoryFilter ? `אין משימות ב-${categoryFilter}. 🎉` : 'אין משימות פעילות. 🎉', message);
                        return `[list_tasks: 0 filter=${label}]`;
                    }
                    const text = tasks.slice(0, 20).map(t => {
                        const due = t.due_at ? ` · ${new Date(t.due_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' })}` : '';
                        const cat = !categoryFilter && t.category ? ` · [${t.category}]` : '';
                        const mark = t.status === 'done' ? '✓' : t.status === 'snoozed' ? '💤' : '◻️';
                        return `${mark} *#${t.id}* ${t.title}${cat}${due}`;
                    }).join('\n');
                    await this.whatsapp.sendReply(jid, `📋 משימות (${label}):\n${text}`, message);
                    return `[list_tasks: ${tasks.length} filter=${label}]`;
                }
                case 'edit_task': {
                    let id = args.id ? Number(args.id) : undefined;
                    if (!id && args.query) {
                        const matches = repo.findByTitle(jid, String(args.query));
                        if (matches.length === 0) {
                            await this.whatsapp.sendReply(jid, `לא מצאתי משימה תואמת ל-"${args.query}".`, message);
                            return '[edit_task: no match]';
                        }
                        if (matches.length > 1) {
                            const list = matches.map(m => `#${m.id} ${m.title}`).join('\n');
                            await this.whatsapp.sendReply(jid, `מספר התאמות:\n${list}\nציין id מדויק.`, message);
                            return '[edit_task: ambiguous]';
                        }
                        id = matches[0].id;
                    }
                    if (!id) {
                        await this.whatsapp.sendReply(jid, 'ציין id או query של המשימה.', message);
                        return '[edit_task: no id]';
                    }
                    const existing = repo.getById(id);
                    if (!existing || existing.jid !== jid) {
                        await this.whatsapp.sendReply(jid, `לא מצאתי משימה #${id}.`, message);
                        return `[edit_task: #${id} not found]`;
                    }
                    const patch = {};
                    if (args.title !== undefined)
                        patch.title = String(args.title).trim() || existing.title;
                    if (args.category !== undefined) {
                        const c = String(args.category).trim().toLowerCase();
                        patch.category = c || null;
                    }
                    if (args.due_iso !== undefined) {
                        const iso = String(args.due_iso).trim();
                        if (!iso)
                            patch.dueAt = null;
                        else {
                            const t = Date.parse(iso);
                            if (!isNaN(t))
                                patch.dueAt = t;
                        }
                    }
                    if (args.notes !== undefined) {
                        const n = String(args.notes);
                        patch.notes = n.length === 0 ? null : n;
                    }
                    const updated = repo.edit(id, patch);
                    if (!updated) {
                        await this.whatsapp.sendReply(jid, `כשל בעדכון #${id}.`, message);
                        return `[edit_task: #${id} failed]`;
                    }
                    const dueStr = updated.due_at ? ` · ${new Date(updated.due_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}` : '';
                    const catStr = updated.category ? ` · [${updated.category}]` : '';
                    await this.whatsapp.sendReply(jid, `✏️ עודכנה #${updated.id}: ${updated.title}${catStr}${dueStr}`, message);
                    return `[edit_task: #${id} patched=${Object.keys(patch).join(',')}]`;
                }
                case 'complete_task': {
                    let id = args.id ? Number(args.id) : undefined;
                    if (!id && args.query) {
                        const matches = repo.findByTitle(jid, String(args.query));
                        if (matches.length === 0) {
                            await this.whatsapp.sendReply(jid, `לא מצאתי משימה תואמת ל-"${args.query}".`, message);
                            return '[complete_task: no match]';
                        }
                        if (matches.length > 1) {
                            const list = matches.map(m => `#${m.id} ${m.title}`).join('\n');
                            await this.whatsapp.sendReply(jid, `מספר התאמות:\n${list}\nציין id מדויק.`, message);
                            return '[complete_task: ambiguous]';
                        }
                        id = matches[0].id;
                    }
                    if (!id)
                        return '[complete_task: no id]';
                    const ok = repo.complete(id);
                    await this.whatsapp.sendReply(jid, ok ? `✅ #${id} סומן כ-done.` : `לא הצלחתי להשלים #${id}.`, message);
                    return `[complete_task: #${id} ok=${ok}]`;
                }
                case 'snooze_task': {
                    let id = args.id ? Number(args.id) : undefined;
                    if (!id && args.query) {
                        const matches = repo.findByTitle(jid, String(args.query));
                        if (matches.length === 1)
                            id = matches[0].id;
                    }
                    if (!id) {
                        await this.whatsapp.sendReply(jid, 'ציין id של המשימה.', message);
                        return '[snooze_task: no id]';
                    }
                    const until = Date.parse(String(args.until_iso));
                    if (isNaN(until)) {
                        await this.whatsapp.sendReply(jid, 'until_iso לא תקין.', message);
                        return '[snooze_task: bad until_iso]';
                    }
                    const ok = repo.snooze(id, until);
                    await this.whatsapp.sendReply(jid, ok ? `💤 #${id} נדחתה ל-${new Date(until).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}.` : `כשל.`, message);
                    return `[snooze_task: #${id} until=${until}]`;
                }
                default:
                    return null;
            }
        }
        catch (err) {
            logger.error(`Task function ${name} failed:`, err);
            const errMsg = err instanceof Error ? err.message : 'unknown error';
            await this.whatsapp.sendReply(jid, `שגיאה ב-${name}: ${errMsg}`, message);
            return `[${name}: error]`;
        }
    }
    async handleMemoryFunction(jid, name, args, message) {
        if (!this.gmailService || !this.gmailService.isOwner(jid)) {
            // Memory tools are owner-only (mirrors gmail gating)
            await this.whatsapp.sendReply(jid, 'Memory tools are restricted to the owner.', message);
            return null;
        }
        const mem = getMemoryService();
        try {
            switch (name) {
                case 'search_memory': {
                    const query = String(args.query || '');
                    const category = (args.category === 'people' || args.category === 'projects') ? args.category : undefined;
                    const hits = await mem.search(query, category);
                    if (hits.length === 0) {
                        await this.whatsapp.sendReply(jid, `לא נמצא דבר ב-memory עבור "${query}".`, message);
                        return `[search_memory: 0 results for ${query}]`;
                    }
                    const text = hits.slice(0, 5).map(h => `📁 *${h.category}/${h.slug}*\n${h.excerpt.slice(0, 250)}`).join('\n\n');
                    await this.whatsapp.sendReply(jid, text, message);
                    return `[search_memory: ${hits.length} hits for ${query}]`;
                }
                case 'update_core_memory': {
                    const section = String(args.section || 'Notes');
                    const fact = String(args.fact || '').trim();
                    if (!fact)
                        return '[update_core_memory: empty fact ignored]';
                    await mem.addFact(section, fact);
                    await this.whatsapp.sendReply(jid, `🧠 שמרתי בזיכרון תחת "${section}".`, message);
                    return `[update_core_memory: ${section} += ${fact}]`;
                }
                case 'append_person_note': {
                    const slug = await mem.appendPersonNote(String(args.person || ''), String(args.note || ''));
                    await this.whatsapp.sendReply(jid, `📝 הוספתי הערה ל-people/${slug}.`, message);
                    return `[append_person_note: ${slug}]`;
                }
                case 'append_project_note': {
                    const slug = await mem.appendProjectNote(String(args.project || ''), String(args.note || ''));
                    await this.whatsapp.sendReply(jid, `📝 הוספתי הערה ל-projects/${slug}.`, message);
                    return `[append_project_note: ${slug}]`;
                }
                default:
                    return null;
            }
        }
        catch (err) {
            logger.error(`Memory function ${name} failed:`, err);
            const errMsg = err instanceof Error ? err.message : 'unknown error';
            await this.whatsapp.sendReply(jid, `שגיאה ב-${name}: ${errMsg}`, message);
            return `[${name}: error]`;
        }
    }
    async handleGmailFunction(jid, name, args, message) {
        if (!this.gmailService || !this.gmailService.isOwner(jid)) {
            await this.whatsapp.sendReply(jid, 'Gmail tools are disabled for this chat.', message);
            return null;
        }
        try {
            switch (name) {
                case 'gmail_list_recent_emails': {
                    const list = await this.gmailService.listRecentEmails(jid, {
                        labelName: args.labelName,
                        query: args.query,
                        max: args.max,
                    });
                    if (list.length === 0) {
                        await this.whatsapp.sendReply(jid, 'לא נמצאו מיילים.', message);
                        return '[gmail_list_recent_emails: 0 results]';
                    }
                    const text = list.map(e => `• *${e.subject || '(ללא נושא)'}*\n  מאת: ${e.from}\n  ${e.snippet}\n  id: ${e.id}`).join('\n\n');
                    await this.whatsapp.sendReply(jid, text, message);
                    return `[gmail_list_recent_emails: ${list.length} results]`;
                }
                case 'gmail_read_email': {
                    const msg = await this.gmailService.readEmail(jid, args.messageId);
                    const body = msg.body.length > 1500 ? msg.body.slice(0, 1500) + '…' : msg.body;
                    const text = `📧 *${msg.subject || '(ללא נושא)'}*\nמאת: ${msg.from}\n${msg.date}\n\n${body}`;
                    await this.whatsapp.sendReply(jid, text, message);
                    return `[gmail_read_email: ${args.messageId}]`;
                }
                case 'gmail_draft_reply': {
                    const res = await this.gmailService.createDraftReply(jid, args.messageId, args.body);
                    const link = res.threadId ? `https://mail.google.com/mail/u/0/#drafts/${res.threadId}` : 'https://mail.google.com/mail/u/0/#drafts';
                    await this.whatsapp.sendReply(jid, `✅ טיוטה מוכנה.\n🔗 ${link}\n_לא נשלח — פתח לבדיקה ושלח מהדפדפן._`, message);
                    return `[gmail_draft_reply created draftId=${res.draftId}]`;
                }
                case 'gmail_draft_new': {
                    const res = await this.gmailService.createDraftNew(jid, String(args.to), String(args.subject), String(args.body));
                    const link = res.threadId ? `https://mail.google.com/mail/u/0/#drafts/${res.threadId}` : 'https://mail.google.com/mail/u/0/#drafts';
                    await this.whatsapp.sendReply(jid, `✅ טיוטה מוכנה.\n📬 ל: ${args.to}\n📝 ${args.subject}\n🔗 ${link}\n_לא נשלח — פתח לבדיקה ושלח מהדפדפן._`, message);
                    return `[gmail_draft_new created draftId=${res.draftId}]`;
                }
                case 'gmail_add_watch_label': {
                    const res = await this.gmailService.addWatchLabel(jid, args.labelName);
                    if (!res.ok) {
                        await this.whatsapp.sendReply(jid, res.reason || 'לא הצלחתי להוסיף תווית.', message);
                        return `[gmail_add_watch_label: failed]`;
                    }
                    await this.whatsapp.sendReply(jid, `✅ עוקב אחרי התווית "${args.labelName}". אני אבדוק כל 7 דק' ואודיע על מיילים חדשים.`, message);
                    return `[gmail_add_watch_label: ${args.labelName}]`;
                }
                case 'gmail_remove_watch_label': {
                    const n = await this.gmailService.removeWatchLabel(jid, args.labelName);
                    await this.whatsapp.sendReply(jid, n > 0 ? `🗑 הפסקתי לעקוב אחרי "${args.labelName}".` : `התווית "${args.labelName}" לא הייתה במעקב.`, message);
                    return `[gmail_remove_watch_label: ${n}]`;
                }
                case 'gmail_list_watch_labels': {
                    const labels = this.gmailService.listWatchLabels(jid);
                    const text = labels.length === 0
                        ? 'אין תוויות במעקב.'
                        : 'תוויות במעקב:\n' + labels.map(l => `• ${l.label_name}`).join('\n');
                    await this.whatsapp.sendReply(jid, text, message);
                    return `[gmail_list_watch_labels: ${labels.length}]`;
                }
                case 'gmail_add_watch_sender': {
                    const email = String(args.email || '').trim().toLowerCase();
                    if (!email.includes('@')) {
                        await this.whatsapp.sendReply(jid, 'כתובת מייל לא תקינה.', message);
                        return '[gmail_add_watch_sender: bad email]';
                    }
                    this.gmailService.addWatchSender(jid, email);
                    await this.whatsapp.sendReply(jid, `✅ עוקב אחרי מיילים מ-${email}. בדיקה כל 7 דק'.`, message);
                    return `[gmail_add_watch_sender: ${email}]`;
                }
                case 'gmail_remove_watch_sender': {
                    const email = String(args.email || '').trim().toLowerCase();
                    const n = this.gmailService.removeWatchSender(jid, email);
                    await this.whatsapp.sendReply(jid, n > 0 ? `🗑 הפסקתי לעקוב אחרי ${email}.` : `${email} לא היה במעקב.`, message);
                    return `[gmail_remove_watch_sender: ${n}]`;
                }
                case 'gmail_list_watch_senders': {
                    const senders = this.gmailService.listWatchSenders(jid);
                    const text = senders.length === 0
                        ? 'אין שולחים במעקב.'
                        : 'שולחים במעקב:\n' + senders.map(s => `• ${s}`).join('\n');
                    await this.whatsapp.sendReply(jid, text, message);
                    return `[gmail_list_watch_senders: ${senders.length}]`;
                }
                case 'gmail_block_sender': {
                    const pattern = String(args.pattern || '').trim().toLowerCase();
                    if (!pattern) {
                        await this.whatsapp.sendReply(jid, 'לא סופק דפוס לחסימה.', message);
                        return '[gmail_block_sender: empty]';
                    }
                    this.gmailService.blockSender(jid, pattern);
                    await this.whatsapp.sendReply(jid, `🚫 נחסם: *${pattern}*. כל מייל עם זה ב-From לא יודיע יותר.`, message);
                    return `[gmail_block_sender: ${pattern}]`;
                }
                case 'gmail_unblock_sender': {
                    const pattern = String(args.pattern || '').trim().toLowerCase();
                    const n = this.gmailService.unblockSender(jid, pattern);
                    await this.whatsapp.sendReply(jid, n > 0 ? `✅ ${pattern} הוסר מהחסימה.` : `${pattern} לא היה חסום.`, message);
                    return `[gmail_unblock_sender: ${n}]`;
                }
                case 'gmail_list_blocked': {
                    const blocked = this.gmailService.listBlocked(jid);
                    const text = blocked.length === 0
                        ? 'אין חסימות.'
                        : 'חסימות אקטיביות:\n' + blocked.map(p => `• ${p}`).join('\n');
                    await this.whatsapp.sendReply(jid, text, message);
                    return `[gmail_list_blocked: ${blocked.length}]`;
                }
                case 'gmail_enable_personal_inbox': {
                    this.gmailService.setPersonalInboxEnabled(true);
                    await this.whatsapp.sendReply(jid, '✅ מעקב אחרי הדואר האישי פעיל. תקבל הודעה על כל מייל אישי חדש ב-Primary.', message);
                    return '[gmail_enable_personal_inbox]';
                }
                case 'gmail_disable_personal_inbox': {
                    this.gmailService.setPersonalInboxEnabled(false);
                    await this.whatsapp.sendReply(jid, '🔕 מעקב אחרי הדואר האישי כבוי. תוויות ושולחים שהגדרת עדיין פעילים.', message);
                    return '[gmail_disable_personal_inbox]';
                }
                default:
                    logger.warn(`Unhandled gmail function: ${name}`);
                    return null;
            }
        }
        catch (err) {
            logger.error(`Gmail function ${name} failed:`, err);
            const errMsg = err instanceof Error ? err.message : 'unknown error';
            await this.whatsapp.sendReply(jid, `שגיאה ב-${name}: ${errMsg}`, message);
            return `[${name}: error]`;
        }
    }
}
