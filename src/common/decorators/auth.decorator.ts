import { applyDecorators, UseGuards } from '@nestjs/common';
import type { UserRole } from '@/common/constants/interface-codes.js';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '@/common/guards/roles.guard.js';
import { Roles } from './roles.decorator.js';

/**
 * 로그인(역할을 주면 그 역할까지)이 필요한 API에 건다. 역할 표시(@Roles)만으로는 가드가 돌지 않아 둘을 묶어 빠뜨리지 않게 하고,
 * JwtAuthGuard가 요청에 로그인 정보를 채운 뒤 RolesGuard가 보도록 순서를 고정한다
 */
export const Auth = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  applyDecorators(Roles(roles), UseGuards(JwtAuthGuard, RolesGuard));
