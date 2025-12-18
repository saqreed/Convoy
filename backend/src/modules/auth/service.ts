import crypto from 'crypto';
import { prisma } from '../../db/client';
import { OTP_TTL_MINUTES } from '../../config';

export class AuthService {
  async sendOtp(phone: string) {
    const code = (Math.floor(1000 + Math.random() * 9000)).toString();
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    const session = await prisma.otpSession.create({
      data: { phone, codeHash, expiresAt }
    });
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[OTP] phone=${phone} code=${code}`);
    }
    // TODO: integrate SMS provider here to send `code` to `phone`
    return { sessionId: session.id };
  }
  async verifyOtp(sessionId: string, code: string) {
    const session = await prisma.otpSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new Error('Invalid session');
    if (session.verified) throw new Error('Already used');
    if (session.expiresAt.getTime() < Date.now()) throw new Error('Expired');
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    if (codeHash !== session.codeHash) throw new Error('Invalid code');

    await prisma.otpSession.update({ where: { id: session.id }, data: { verified: true } });
    let user = await prisma.user.findFirst({ where: { phone: session.phone } });
    if (!user) {
      user = await prisma.user.create({ data: { phone: session.phone, name: 'User' } });
    }
    return { userId: user.id };
  }
}
