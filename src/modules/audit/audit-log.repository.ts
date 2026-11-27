import { Injectable } from '@nestjs/common';
import type { Prisma } from '@/database/generated/client.js';
import { PrismaService } from '@/database/prisma.service.js';

export type AuditLogWriter = Pick<Prisma.TransactionClient, 'auditLog'>;

@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 트랜잭션 안에서 함께 남기려면 그 클라이언트를 넘긴다 */
  async create(row: Prisma.AuditLogCreateInput, writer: AuditLogWriter = this.prisma): Promise<void> {
    await writer.auditLog.create({ data: row });
  }
}
