# Mobile Network Configuration

## Quick Setup for Team Members

### iOS Simulator
**No configuration needed** - uses `localhost:3000` automatically

### Android Emulator  
**No configuration needed** - uses `10.0.2.2:3000` automatically

### iOS Physical Device
📱 **Manual setup required**:

1. **Get your local IP address:**
   ```bash
   # Option 1: Terminal command
   ifconfig | grep "inet " | grep -v 127.0.0.1
   
   # Option 2: System Preferences
   # System Preferences > Network > WiFi > Advanced > TCP/IP
   ```

2. **Update the config:**
   - Edit `apps/mobile/src/services/api/config.ts`
   - Replace `localhost` with your IP in the iOS section
   - Example: `http://192.168.1.45:3000/api/v1`

3. **Don't commit your IP:**
   - Only change it locally for testing
   - Reset to `localhost` before committing
   - Your IP is in `.gitignore` to prevent accidental commits

## Troubleshooting

### "Network request failed"
1. Check backend is running: `cd apps/backend && pnpm dev`
2. Verify Docker services: `docker-compose -f docker/docker-compose.yml up -d`
3. Test API: `curl http://localhost:3000/api/v1/health`
4. For iOS physical device: update IP in config.ts

### "404 Not Found"
- Backend database might not be seeded
- Run: `pnpm db:seed` from project root

## Security Notes

- **Never commit personal IPs** to version control
- **Use localhost by default** in the config file  
- **Team members set their own IPs** locally as needed
- **IPs change with WiFi networks** - update as needed
