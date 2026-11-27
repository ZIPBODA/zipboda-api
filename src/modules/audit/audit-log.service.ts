import { Injectable } from '@nestjs/common';
import type { UserRole } from '@/common/constants/interface-codes.js';
import type { ClientMeta } from '@/common/decorators/client-meta.decorator.js';
import { AuditLogRepository, type AuditLogWriter } from './audit-log.repository.js';
import type { AuditAction, AuditTarget } from './constants.js';

export interface AuditEntry {
  action: AuditAction;
  /** 회원을 모르는 로그인 실패는 비운다 — 입력한 이메일은 남기지 않는다(ERD §4.19) */
  actorUserId: string | null;
  actorRole: UserRole | null;
  target?: { type: AuditTarget; id: string };
  /** 바뀐 항목 이름만. 비밀번호·토큰·개인정보 값은 넣지 않는다 */
  changedFields?: string[];
  client: ClientMeta;
}

/** 더하기만 하는 감사 로그(ERD §5 규칙 26) */
@Injectable()
export class AuditLogService {
  constructor(private readonly repository: AuditLogRepository) {}

  record(entry: AuditEntry, writer?: AuditLogWriter): Promise<void> {
    return this.repository.create(
      {
        action: entry.action,
        actorUserId: entry.actorUserId,
        actorRole: entry.actorRole,
        targetType: entry.target?.type ?? null,
        targetId: entry.target?.id ?? null,
        changes: entry.changedFields,
        ip: entry.client.ip,
        userAgent: entry.client.userAgent,
      },
      writer,
    );
  }
}
