import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean),
}));

export const authConfig = registerAs('auth', () => ({
  azureClientId: process.env.AZURE_CLIENT_ID || '',
  azureTenantId: process.env.AZURE_TENANT_ID || '',
}));

export const dbConfig = registerAs('db', () => ({
  url: process.env.DATABASE_URL || '',
}));

export const privacyConfig = registerAs('privacy', () => ({
  deviceHashSalt: process.env.DEVICE_HASH_SALT || '',
}));

export const weatherConfig = registerAs('weather', () => ({
  openWeatherApiKey: process.env.OPENWEATHER_API_KEY || '',
  latitude: parseFloat(process.env.WEATHER_LAT || '33.7838'),
  longitude: parseFloat(process.env.WEATHER_LON || '-118.1134'),
}));

// Firebase service-account fields.
// If any of these are absent the NotificationsService logs a warning and
// disables push sending; the app still starts normally.
export const notificationsConfig = registerAs('notifications', () => ({
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
  firebasePrivateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
}));

/**
 * Validates critical environment variables at startup.
 * In production, missing required vars cause an immediate crash with a clear message.
 * In development, logs warnings but allows startup with defaults.
 */
export function validateConfig(config: Record<string, unknown>): Record<string, unknown> {
  const isProduction = process.env.NODE_ENV === 'production';

  const requiredInProduction = [
    { key: 'DATABASE_URL', envVar: 'DATABASE_URL' },
    { key: 'AZURE_CLIENT_ID', envVar: 'AZURE_CLIENT_ID' },
    { key: 'AZURE_TENANT_ID', envVar: 'AZURE_TENANT_ID' },
    { key: 'DEVICE_HASH_SALT', envVar: 'DEVICE_HASH_SALT' },
    { key: 'DEVICE_EVENT_SECRET', envVar: 'DEVICE_EVENT_SECRET' },
  ];

  const missing: string[] = [];
  for (const { envVar } of requiredInProduction) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(', ')}`;
    if (isProduction) {
      throw new Error(message);
    }
    // In dev, allow startup — will use defaults / empty values
    console.warn(`[Config] WARNING: ${message}`);
  }

  return config;
}
