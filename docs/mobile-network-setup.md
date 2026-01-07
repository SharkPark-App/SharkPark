# Mobile Development Network Configuration

## Overview
This guide helps team members configure the mobile app to connect to the local backend during development.

## Quick Setup

### 1. Start Backend Services
```bash
# From project root
docker-compose -f docker/docker-compose.yml up -d  # Start DynamoDB & LocalStack
pnpm db:setup     # Create database tables (first time only)
pnpm db:seed      # Seed with test data (first time only)
cd apps/backend && pnpm dev  # Start backend API
```

### 2. Check Network Configuration
```bash
# From project root
pnpm network-ip   # Shows your machine's IP and configuration instructions
```

### 3. Configure Mobile App for Your Platform

#### Android Emulator
✅ **Already configured** - Uses `10.0.2.2:3000` automatically

#### iOS Simulator 
✅ **Already configured** - Uses `localhost:3000` automatically

#### iOS Physical Device
📝 **Manual configuration required**:

1. Run `pnpm network-ip` to get your local IP
2. Edit `apps/mobile/src/services/api/config.ts`
3. Update the iOS case to use your IP:
   ```typescript
   return 'http://YOUR_LOCAL_IP:3000/api/v1';
   ```

## Backend URLs

- **Local access**: `http://localhost:3000/api/v1`
- **Network access**: `http://YOUR_LOCAL_IP:3000/api/v1`
- **Health check**: `GET /api/v1/health`
- **Parking lots**: `GET /api/v1/lots`

## API Testing

Test the backend is working:
```bash
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/lots
```

## Common Issues

### "Network request failed" or "Aborted(0)"
1. ✅ Check backend is running (`pnpm dev` in `apps/backend`)
2. ✅ Verify database is seeded (`pnpm db:seed`)
3. ✅ For physical iOS devices, update IP in config.ts
4. ✅ Check your phone and computer are on same WiFi network

### Backend can't connect to database
1. ✅ Start Docker services: `docker-compose -f docker/docker-compose.yml up -d`
2. ✅ Run setup: `pnpm db:setup && pnpm db:seed`

### IP changed after switching networks
1. ✅ Run `pnpm network-ip` to get new IP
2. ✅ Update `config.ts` with new IP for physical devices

## Team Guidelines

- **Never commit** hardcoded IP addresses to version control
- **Always use** the `localhost` default in config.ts
- **Document** any network configuration changes in team chat
- **Test** on both simulator and physical device before pushing changes

## Scripts Reference

```bash
pnpm network-ip        # Get your local network IP
pnpm db:setup         # Create database tables
pnpm db:seed          # Populate with test data
pnpm dev              # Start all services (backend + mobile)
```
