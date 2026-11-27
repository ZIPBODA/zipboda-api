import { Reflector } from '@nestjs/core';
import type { UserRole } from '@/common/constants/interface-codes.js';

/** RolesGuard가 읽는 표시다. 이것만 걸면 가드가 돌지 않아 아무것도 막지 않는다 — API에는 @Auth(...역할)로 건다 */
export const Roles = Reflector.createDecorator<UserRole[]>();
