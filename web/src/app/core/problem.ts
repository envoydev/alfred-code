import { HttpErrorResponse } from '@angular/common/http';

import { ProblemDetails } from './models';

const FALLBACK = 'Something went wrong. Please try again.';

/** Turns a failed request into the one line of text a page shows to the user. */
export function problemMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return FALLBACK;
  }
  if (error.status === 0) {
    return 'The server could not be reached.';
  }
  const body = error.error as Partial<ProblemDetails> | null;
  if (body && typeof body === 'object') {
    if (body.detail) {
      return body.detail;
    }
    const firstValidationError = Object.values(body.errors ?? {}).flat()[0];
    if (firstValidationError) {
      return firstValidationError;
    }
    if (body.title) {
      return body.title;
    }
  }
  return FALLBACK;
}
