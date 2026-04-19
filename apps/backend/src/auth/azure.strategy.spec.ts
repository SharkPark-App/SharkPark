import { UnauthorizedException } from '@nestjs/common';
import { AzureADStrategy, AzureJwtPayload } from './azure.strategy';

// Mock passport-jwt and jwks-rsa to avoid real HTTP calls
jest.mock('passport-jwt', () => ({
  ExtractJwt: { fromAuthHeaderAsBearerToken: jest.fn(() => jest.fn()) },
  Strategy: class MockStrategy {
    constructor() {
      // no-op
    }
  },
}));
jest.mock('jwks-rsa', () => ({
  passportJwtSecret: jest.fn(() => jest.fn()),
}));

describe('AzureADStrategy', () => {
  let strategy: AzureADStrategy;
  let mockUsersService: { findOrCreateUser: jest.Mock };

  beforeEach(() => {
    mockUsersService = { findOrCreateUser: jest.fn() };
    strategy = new AzureADStrategy(mockUsersService as any);
  });

  it('should extract email from preferred_username', async () => {
    const mockUser = { id: '1', email: 'test@csulb.edu' };
    mockUsersService.findOrCreateUser.mockResolvedValueOnce(mockUser);

    const payload: AzureJwtPayload = {
      preferred_username: 'test@csulb.edu',
      name: 'John Doe',
    };

    const result = await strategy.validate(payload);

    expect(mockUsersService.findOrCreateUser).toHaveBeenCalledWith('test@csulb.edu', 'John', 'Doe');
    expect(result).toEqual(mockUser);
  });

  it('should fall back to email claim', async () => {
    const mockUser = { id: '2', email: 'fallback@csulb.edu' };
    mockUsersService.findOrCreateUser.mockResolvedValueOnce(mockUser);

    const payload: AzureJwtPayload = {
      email: 'fallback@csulb.edu',
      name: 'Jane Smith',
    };

    const result = await strategy.validate(payload);

    expect(mockUsersService.findOrCreateUser).toHaveBeenCalledWith('fallback@csulb.edu', 'Jane', 'Smith');
    expect(result).toEqual(mockUser);
  });

  it('should throw UnauthorizedException when no email is present', async () => {
    const payload: AzureJwtPayload = { name: 'No Email' };

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate(payload)).rejects.toThrow('Token missing email claim');
  });

  it('should throw UnauthorizedException when user is not returned', async () => {
    mockUsersService.findOrCreateUser.mockResolvedValueOnce(null);

    const payload: AzureJwtPayload = {
      preferred_username: 'ghost@csulb.edu',
      name: 'Ghost User',
    };

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });

  it('should use defaults when name is missing', async () => {
    const mockUser = { id: '3', email: 'noname@csulb.edu' };
    mockUsersService.findOrCreateUser.mockResolvedValueOnce(mockUser);

    const payload: AzureJwtPayload = {
      preferred_username: 'noname@csulb.edu',
    };

    const result = await strategy.validate(payload);

    expect(mockUsersService.findOrCreateUser).toHaveBeenCalledWith('noname@csulb.edu', 'first_name', 'last_name');
    expect(result).toEqual(mockUser);
  });

  it('should handle single-word names', async () => {
    const mockUser = { id: '4', email: 'mono@csulb.edu' };
    mockUsersService.findOrCreateUser.mockResolvedValueOnce(mockUser);

    const payload: AzureJwtPayload = {
      preferred_username: 'mono@csulb.edu',
      name: 'Mononym',
    };

    const result = await strategy.validate(payload);

    expect(mockUsersService.findOrCreateUser).toHaveBeenCalledWith('mono@csulb.edu', 'Mononym', '');
    expect(result).toEqual(mockUser);
  });
});
