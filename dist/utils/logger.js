const getTimestamp = () => {
    return new Date().toISOString();
};
export const logger = {
    info: (message, ...args) => {
        console.log(`[${getTimestamp()}] INFO:`, message, ...args);
    },
    warn: (message, ...args) => {
        console.warn(`[${getTimestamp()}] WARN:`, message, ...args);
    },
    error: (message, ...args) => {
        console.error(`[${getTimestamp()}] ERROR:`, message, ...args);
    },
    debug: (message, ...args) => {
        if (process.env.DEBUG === 'true') {
            console.log(`[${getTimestamp()}] DEBUG:`, message, ...args);
        }
    },
};
