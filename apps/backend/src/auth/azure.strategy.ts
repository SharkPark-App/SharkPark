import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { UsersService } from '../users/users.service';

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
        jwksUri: 'https://login.microsoftonline.com/d175679b-acd3-4644-be82-af041982977a/discovery/v2.0/keys',
      }),

      // config for validation (same tenant/client IDs used for user auth)
      ignoreExpiration: false,
      audience: '9aea0ab1-4502-4868-a31b-0a8f333cec9c',
      issuer: 'https://login.microsoftonline.com/d175679b-acd3-4644-be82-af041982977a/v2.0',
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