import { Module } from '@nestjs/common';
import { AuditLogRepository } from './audit-log.repository.js';
import { AuditLogService } from './audit-log.service.js';

@Module({
  providers: [AuditLogService, AuditLogRepository],
  exports: [AuditLogService],
})
export class AuditModule {}
