import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { successEnvelope, type ApiEnvelope } from '../http/api-envelope.js';

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler<unknown>): Observable<ApiEnvelope<unknown>> {
    return next.handle().pipe(map((data) => successEnvelope(data ?? null)));
  }
}
