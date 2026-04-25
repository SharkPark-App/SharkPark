import { appConfig, authConfig, dbConfig, privacyConfig, weatherConfig, validateConfig } from './configuration';

describe('Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('appConfig', () => {
    it('should return defaults when env vars are not set', () => {
      delete process.env.NODE_ENV;
      delete process.env.PORT;
      delete process.env.HOST;
      delete process.env.CORS_ORIGINS;

      // registerAs returns a factory function; call it to get config
      const config = (appConfig as unknown as () => ReturnType<typeof Object>)();
      expect(config).toEqual({
        nodeEnv: 'development',
        port: 3000,
        host: '0.0.0.0',
        corsOrigins: [],
      });
    });

    it('should parse CORS_ORIGINS into array', () => {
      process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:8080';

      const config = (appConfig as unknown as () => ReturnType<typeof Object>)();
      expect(config).toEqual(
        expect.objectContaining({
          corsOrigins: ['http://localhost:3000', 'http://localhost:8080'],
        }),
      );
    });

    it('should parse PORT as integer', () => {
      process.env.PORT = '8080';

      const config = (appConfig as unknown as () => ReturnType<typeof Object>)();
      expect(config).toEqual(expect.objectContaining({ port: 8080 }));
    });
  });

  describe('authConfig', () => {
    it('should return empty defaults', () => {
      delete process.env.AZURE_CLIENT_ID;
      delete process.env.AZURE_TENANT_ID;

      const config = (authConfig as unknown as () => ReturnType<typeof Object>)();
      expect(config).toEqual({
        azureClientId: '',
        azureTenantId: '',
      });
    });
  });

  describe('dbConfig', () => {
    it('should read DATABASE_URL', () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/test';

      const config = (dbConfig as unknown as () => ReturnType<typeof Object>)();
      expect(config).toEqual({ url: 'postgresql://localhost:5432/test' });
    });
  });

  describe('privacyConfig', () => {
    it('should use empty string when env is not set', () => {
      delete process.env.DEVICE_HASH_SALT;

      const config = (privacyConfig as unknown as () => ReturnType<typeof Object>)();
      expect(config).toEqual({ deviceHashSalt: '' });
    });
  });

  describe('weatherConfig', () => {
    it('should parse lat/lon as floats with defaults', () => {
      delete process.env.OPENWEATHER_API_KEY;
      delete process.env.WEATHER_LAT;
      delete process.env.WEATHER_LON;

      const config = (weatherConfig as unknown as () => ReturnType<typeof Object>)();
      expect(config).toEqual({
        openWeatherApiKey: '',
        latitude: 33.7838,
        longitude: -118.1134,
      });
    });

    it('should read custom lat/lon from env', () => {
      process.env.WEATHER_LAT = '34.0522';
      process.env.WEATHER_LON = '-118.2437';

      const config = (weatherConfig as unknown as () => ReturnType<typeof Object>)();
      expect(config).toEqual(
        expect.objectContaining({
          latitude: 34.0522,
          longitude: -118.2437,
        }),
      );
    });
  });

  describe('validateConfig', () => {
    it('should throw in production when required vars are missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;
      delete process.env.AZURE_CLIENT_ID;
      delete process.env.AZURE_TENANT_ID;
      delete process.env.DEVICE_HASH_SALT;

      expect(() => validateConfig({})).toThrow('Missing required environment variables');
    });

    it('should not throw in production when all required vars are set', () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      process.env.AZURE_CLIENT_ID = 'test-client-id';
      process.env.AZURE_TENANT_ID = 'test-tenant-id';
      process.env.DEVICE_HASH_SALT = 'test-salt';
      process.env.DEVICE_EVENT_SECRET = 'test-secret';

      expect(() => validateConfig({})).not.toThrow();
    });

    it('should warn but not throw in development when vars are missing', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DATABASE_URL;

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = validateConfig({});

      expect(warnSpy).toHaveBeenCalled();
      expect(result).toEqual({});
      warnSpy.mockRestore();
    });
  });
});
