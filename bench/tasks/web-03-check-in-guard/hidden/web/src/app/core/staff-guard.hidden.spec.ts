import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';

import { Session } from './session';
import { staffGuard } from './staff-guard';

describe('Hidden.Web03 staffGuard', () => {
  let session: Session;
  let router: Router;

  function runGuard(): unknown {
    const guard: CanActivateFn = staffGuard;
    return TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    session = TestBed.inject(Session);
    router = TestBed.inject(Router);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('returns true for the staff and admin roles', () => {
    session.role.set('staff');
    expect(runGuard()).toBe(true);

    session.role.set('admin');
    expect(runGuard()).toBe(true);
  });

  it('returns a UrlTree for /loans for the member role, without navigating by itself', () => {
    const navigate = vi.spyOn(router, 'navigate');
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl');
    session.role.set('member');

    const result = runGuard();

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/loans');
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('reads the role at the moment it runs', () => {
    session.role.set('member');
    expect(runGuard()).toBeInstanceOf(UrlTree);

    session.role.set('staff');
    expect(runGuard()).toBe(true);

    session.role.set('member');
    expect(runGuard()).toBeInstanceOf(UrlTree);

    session.role.set('admin');
    expect(runGuard()).toBe(true);
  });
});
