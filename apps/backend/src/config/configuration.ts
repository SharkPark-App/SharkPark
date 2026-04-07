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
  deviceHashSalt: process.env.DEVICE_HASH_SALT || 'sharkpark-default-salt-2026',
}));
