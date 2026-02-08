import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { UsersService } from '../users/users.service';

// Azure AD Configuration - should match mobile app
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '9aea0ab1-4502-4868-a31b-0a8f333cec9c';
const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || 'd175679b-acd3-4644-be82-af041982977a';

export interface AzureJwtPayload {
  preferred_username?: string;
  email?: string;
  name?: string;
  oid?: string;
  sub?: string;
}

@Injectable()
export class AzureADStrategy extends PassportStrategy(Strategy, 'azure-ad') {
  constructor(
    private usersService: UsersService,
  ) {
    super({
      // token resides within auth header
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      // manually downloading public microsoft keys
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://login.microsoftonline.com/${AZURE_TENANT_ID}/discovery/v2.0/keys`,
      }),

      // config for validation (same tenant/client IDs used for user auth)
      // Accept both id_token (audience = client_id) and access_token (audience = api://client_id)
      ignoreExpiration: false,
      audience: [AZURE_CLIENT_ID, `api://${AZURE_CLIENT_ID}`],
      issuer: `https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0`,
      algorithms: ['RS256'],
    });
  }

  // validation after signature is verified
  async validate(payload: AzureJwtPayload) {
    // Azure v2.0 tokens use email, firstName, and lastName as standard claims
    const email = payload.preferred_username || payload.email;
    const firstName = payload.name ? payload.name.split(' ')[0] : 'first_name';
    const lastName = payload.name ? payload.name.split(' ').slice(1).join(' ') : 'last_name';

    if (!email) {
      throw new UnauthorizedException('Token missing email claim');
    }

    // call to database
    const user = await this.usersService.findOrCreateUser(email, firstName, lastName);

    if (!user) {
        throw new UnauthorizedException('Token missing user info');
    }

    return user;
  }
}