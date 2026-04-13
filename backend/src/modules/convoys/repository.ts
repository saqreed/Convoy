import { prisma } from '../../db/client';
import { buildRouteMetadata } from './routeMetadata';

export class ConvoyRepository {
  async createConvoy(leaderId: string, data: { title: string; startTime?: string; route: any; privacy: 'invite' | 'open' }) {
    const convoy = await (prisma as any).convoy.create({
      data: {
        title: data.title,
        leaderId,
        startTime: data.startTime ? new Date(data.startTime) : undefined,
        privacy: data.privacy,
        route: data.route,
        ...buildRouteMetadata(data.route)
      }
    });
    await prisma.convoyMember.create({ data: { convoyId: convoy.id, userId: leaderId, role: 'leader' } });
    return convoy;
  }

  async createInvite(convoyId: string, code: string, expiresAt: Date) {
    return prisma.invite.create({ data: { convoyId, code, expiresAt } });
  }

  async listForUser(userId: string) {
    return prisma.convoy.findMany({
      where: { members: { some: { userId } } },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getById(id: string) {
    return prisma.convoy.findUnique({
      where: { id },
      include: { members: { include: { user: true } }, invites: true }
    });
  }

  async update(id: string, data: Partial<{ title: string; startTime: string | null; route: any; status: string; privacy: 'invite' | 'open' }>) {
    return (prisma as any).convoy.update({
      where: { id },
      data: {
        title: data.title,
        startTime: data.startTime === undefined ? undefined : data.startTime ? new Date(data.startTime) : null,
        privacy: data.privacy,
        route: data.route,
        status: data.status,
        ...(data.route === undefined ? {} : buildRouteMetadata(data.route))
      }
    });
  }

  async remove(id: string) {
    await prisma.invite.deleteMany({ where: { convoyId: id } });
    await prisma.convoyMember.deleteMany({ where: { convoyId: id } });
    return prisma.convoy.delete({ where: { id } });
  }
}
