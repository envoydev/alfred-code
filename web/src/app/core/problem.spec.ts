import { HttpErrorResponse } from '@angular/common/http';

import { problemMessage } from './problem';

describe('problemMessage', () => {
  it('prefers the problem detail', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { title: 'Conflict', status: 409, detail: 'The item is already on loan.' },
    });

    expect(problemMessage(error)).toBe('The item is already on loan.');
  });

  it('falls back to the first validation error, then the title', () => {
    const validation = new HttpErrorResponse({
      status: 400,
      error: {
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { Email: ['Email is already registered.'], Name: ['Name is too long.'] },
      },
    });
    const titleOnly = new HttpErrorResponse({
      status: 403,
      error: { title: 'Forbidden', status: 403 },
    });

    expect(problemMessage(validation)).toBe('Email is already registered.');
    expect(problemMessage(titleOnly)).toBe('Forbidden');
  });
});
