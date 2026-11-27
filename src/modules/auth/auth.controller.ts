import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Auth } from '@/common/decorators/auth.decorator.js';
import { ClientMetaOf, type ClientMeta } from '@/common/decorators/client-meta.decorator.js';
import { CurrentAuth } from '@/common/decorators/current-auth.decorator.js';
import type { AccessTokenClaims } from '@/common/security/access-token.service.js';
import { AuthService } from './auth.service.js';
import { LoginRequest, SignupRequest, TokenRefreshRequest } from './dto/auth.request.js';
import type { LoginResponse, MeResponse, SignupResponse, TokenPairResponse } from './dto/auth.response.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** API-001 회원가입 */
  @Post('signup')
  signup(@Body() body: SignupRequest, @ClientMetaOf() client: ClientMeta): Promise<SignupResponse> {
    return this.authService.signup(body, client);
  }

  /** API-002 이메일 로그인 */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginRequest, @ClientMetaOf() client: ClientMeta): Promise<LoginResponse> {
    return this.authService.login(body, client);
  }

  /** API-004 로그아웃 */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Auth()
  logout(@CurrentAuth() auth: AccessTokenClaims, @ClientMetaOf() client: ClientMeta): Promise<null> {
    return this.authService.logout(auth, client);
  }

  /** API-005 토큰 재발급 */
  @Post('token/refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: TokenRefreshRequest, @ClientMetaOf() client: ClientMeta): Promise<TokenPairResponse> {
    return this.authService.refresh(body, client);
  }

  /** API-008 내 인증 정보 */
  @Get('me')
  @Auth()
  me(@CurrentAuth() auth: AccessTokenClaims): Promise<MeResponse> {
    return this.authService.me(auth);
  }
}
