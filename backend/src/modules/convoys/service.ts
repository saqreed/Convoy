import { ConvoyRepository } from './repository';
import crypto from 'crypto';
import { prisma } from '../../db/client';

export class ConvoyService {
  repo = new ConvoyRepository();

  async createConvoy(userId: string, data: { title: string; startTime?: string; route: any; privacy: 'invite' | 'open' }) {
    const convoy = await this.repo.createConvoy(userId, data);
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.repo.createInvite(convoy.id, code, expires);
    return { ...convoy, inviteCode: code };
  }

  async joinConvoy(convoyId: string, userId: string, code?: string) {
    const convoy = await prisma.convoy.findUnique({
      where: { id: convoyId },
      select: { id: true, privacy: true }
    });
    if (!convoy) throw new Error('Convoy not found');

    if (convoy.privacy !== 'open') {
      if (!code) throw new Error('Invite code is required for private convoys');

      const invite = await prisma.invite.findFirst({ where: { convoyId, code } });
      if (!invite) throw new Error('Invalid code');
      if (invite.expiresAt.getTime() < Date.now()) throw new Error('Expired code');
    }

    await prisma.convoyMember.upsert({
      where: { convoyId_userId: { convoyId, userId } },
      update: {},
      create: { convoyId, userId, role: 'member' }
    });
    return { ok: true };
  }
}
