import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from '@/common/decorators/roles.decorator.js';
import { AppException } from '@/common/errors/app.exception.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

/** ITF-012 RBAC. @Auth가 JwtAuthGuard 뒤에 건다 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride(Roles, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true;
    const { auth } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!auth) throw new AppException('UNAUTHORIZED');
    if (!auth.roles.some((role) => required.includes(role))) throw new AppException('FORBIDDEN');
    return true;
  }
}
