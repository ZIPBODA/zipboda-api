import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

export const ClientMetaOf = createParamDecorator((_data: unknown, context: ExecutionContext): ClientMeta => {
  const request = context.switchToHttp().getRequest<Request>();
  return { ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null };
});
