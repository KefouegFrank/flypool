import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const mockContext = (role: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
      getHandler: () => {},
      getClass: () => {},
    }) as unknown as ExecutionContext;

  it('should allow access when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(null);
    expect(guard.canActivate(mockContext('PASSENGER'))).toBe(true);
  });

  it('should allow access when user has the required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DRIVER']);
    expect(guard.canActivate(mockContext('DRIVER'))).toBe(true);
  });

  it('should deny access when user does not have the required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DRIVER']);
    expect(guard.canActivate(mockContext('PASSENGER'))).toBe(false);
  });

  it('should allow ADMIN when ADMIN role is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(guard.canActivate(mockContext('ADMIN'))).toBe(true);
  });

  it('should deny PASSENGER when DRIVER or ADMIN is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      'DRIVER',
      'ADMIN',
    ]);
    expect(guard.canActivate(mockContext('PASSENGER'))).toBe(false);
  });
});
