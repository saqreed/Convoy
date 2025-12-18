import 'dotenv/config';
export const PORT = Number(process.env.PORT || 3000);
export const JWT_SECRET = process.env.JWT_SECRET || 'change_me_please_change_me_32chars_min';
export const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 5);
export const WS_TTL_SECONDS = Number(process.env.WS_TTL_SECONDS || 120);
export const WS_MIN_PING_INTERVAL_MS = Number(process.env.WS_MIN_PING_INTERVAL_MS || 3000);
