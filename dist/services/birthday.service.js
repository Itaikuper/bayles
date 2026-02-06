import cron from 'node-cron';
import { BirthdayRepository } from '../database/repositories/birthday.repository.js';
import { logger } from '../utils/logger.js';
export class BirthdayService {
    dailyTask = null;
    birthdayRepo;
    whatsapp;
    gemini;
    constructor(whatsapp, gemini) {
        this.whatsapp = whatsapp;
        this.gemini = gemini;
        this.birthdayRepo = new BirthdayRepository();
    }
    /**
     * Start the daily birthday check cron (08:00)
     */
    start() {
        if (this.dailyTask) {
            logger.warn('Birthday service already started');
            return;
        }
        this.dailyTask = cron.schedule('0 8 * * *', async () => {
            await this.checkAndSendBirthdays();
        });
        logger.info('Birthday service started - daily check at 08:00');
    }
    /**
     * Stop the daily cron
     */
    stop() {
        if (this.dailyTask) {
            this.dailyTask.stop();
            this.dailyTask = null;
            logger.info('Birthday service stopped');
        }
    }
    /**
     * Check today's birthdays and send greetings
     */
    async checkAndSendBirthdays() {
        const now = new Date();
        const day = now.getDate();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();
        logger.info(`Checking birthdays for ${day}/${month}`);
        const todays = this.birthdayRepo.findByDate(day, month);
        if (todays.length === 0) {
            logger.info('No birthdays today');
            return;
        }
        logger.info(`Found ${todays.length} birthday(s) today`);
        for (const birthday of todays) {
            if (birthday.last_sent_year === year) {
                logger.info(`Already sent for ${birthday.person_name} this year`);
                continue;
            }
            try {
                const message = await this.generateBirthdayMessage(birthday);
                await this.whatsapp.sendTextMessage(birthday.jid, message);
                this.birthdayRepo.markSent(birthday.id, year);
                logger.info(`Sent birthday message for ${birthday.person_name} to ${birthday.jid}`);
            }
            catch (error) {
                logger.error(`Failed to send birthday for ${birthday.person_name}:`, error);
            }
        }
    }
    /**
     * Generate birthday greeting - custom message or AI-generated
     */
    async generateBirthdayMessage(birthday) {
        if (birthday.custom_message?.trim()) {
            return birthday.custom_message.trim();
        }
        try {
            const prompt = `צור ברכת יום הולדת חמה ומקורית עבור ${birthday.person_name}. הברכה צריכה להיות בעברית, קצרה (2-3 משפטים), חמה ואישית.`;
            const systemPrompt = 'You are a birthday message generator. ' +
                'Output ONLY the birthday greeting in Hebrew. ' +
                'Do NOT add any conversational prefix like "Sure!", "Here it is:", etc. ' +
                'Just produce the birthday greeting directly.';
            const response = await this.gemini.generateResponse(`birthday:${birthday.jid}`, prompt, systemPrompt);
            return response.text || `יום הולדת שמח ${birthday.person_name}!`;
        }
        catch (error) {
            logger.error('Failed to generate AI birthday message:', error);
            return `יום הולדת שמח ${birthday.person_name}! מאחלים לך שנה מדהימה מלאה באושר ובריאות!`;
        }
    }
    /**
     * Parse a natural language birthday list using Gemini AI
     */
    async parseBirthdayList(jid, text) {
        const prompt = `אתה מנתח רשימות ימי הולדת. חלץ שמות ותאריכים מהטקסט הבא:

"${text}"

כללים:
- כל ערך: שם, יום (1-31), חודש (1-12)
- חודשים בעברית: ינואר/ינו=1, פברואר/פבר=2, מרץ/מרס=3, אפריל/אפר=4, מאי=5, יוני=6, יולי=7, אוגוסט/אוג=8, ספטמבר/ספט=9, אוקטובר/אוק=10, נובמבר/נוב=11, דצמבר/דצמ=12
- תמיכה בפורמט DD/MM

החזר רק JSON array:
[{"person_name":"שם","birth_day":5,"birth_month":2}]`;
        const systemPrompt = 'You extract birthday data from text. Output ONLY a valid JSON array, nothing else.';
        const geminiResponse = await this.gemini.generateResponse(`birthday-parser:${jid}`, prompt, systemPrompt);
        const responseText = geminiResponse.text || '';
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            throw new Error('לא הצלחתי להבין את הרשימה. נסה פורמט כמו: "שם 5 פבר, שם2 15/03"');
        }
        const parsed = JSON.parse(jsonMatch[0]);
        // Validate
        for (const item of parsed) {
            if (!item.person_name || item.birth_day < 1 || item.birth_day > 31 || item.birth_month < 1 || item.birth_month > 12) {
                throw new Error(`נתון לא תקין: ${item.person_name} ${item.birth_day}/${item.birth_month}`);
            }
        }
        return parsed.map(item => ({
            jid,
            person_name: item.person_name,
            birth_day: item.birth_day,
            birth_month: item.birth_month,
        }));
    }
    /**
     * Add parsed birthdays to DB
     */
    addBirthdays(birthdays) {
        return birthdays.map(b => this.birthdayRepo.create(b));
    }
    getBirthdaysByJid(jid) {
        return this.birthdayRepo.findByJid(jid);
    }
    getAllBirthdays() {
        return this.birthdayRepo.getAll();
    }
    deleteBirthday(id) {
        return this.birthdayRepo.delete(id);
    }
}
