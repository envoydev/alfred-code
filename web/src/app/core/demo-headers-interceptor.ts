import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { Session } from './session';

export const demoHeadersInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(Session);
  return next(
    req.clone({
      setHeaders: {
        'X-Demo-User': session.user(),
        'X-Demo-Role': session.role(),
      },
    }),
  );
};
