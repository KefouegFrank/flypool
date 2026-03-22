import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const SLOW_REQUEST_THRESHOLD_MS = 500;

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Performance');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const durationMs = Date.now() - start;
        const logPayload = {
          method: req.method,
          path: req.url,
          durationMs,
          userId: req.user?.id ?? 'anonymous',
          timestamp: new Date().toISOString(),
        };

        this.logger.log(JSON.stringify(logPayload));

        if (durationMs > SLOW_REQUEST_THRESHOLD_MS) {
          this.logger.warn(
            JSON.stringify({
              message: 'Slow request detected',
              method: req.method,
              path: req.url,
              durationMs,
            }),
          );
        }
      }),
    );
  }
}
