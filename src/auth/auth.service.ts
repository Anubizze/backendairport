import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';

import { DrizzleService } from '../db/drizzle.service';
import { users } from '../db/schema';

import { LoginDto } from './dto/login.dto';
import { UserRole } from './auth-user.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly drizzle: DrizzleService,
  ) {}

  private getConfiguredAccounts() {
    return [
      {
        login: this.configService.get<string>('ADMIN_LOGIN', 'admin'),
        password: this.configService.get<string>('ADMIN_PASSWORD', 'admin123'),
        role: 'superadmin' as UserRole,
        fullName: 'Super Admin',
      },
      {
        login: this.configService.get<string>('DISPATCHER_LOGIN', 'dispatcher'),
        password: this.configService.get<string>('DISPATCHER_PASSWORD', 'dispatcher123'),
        role: 'dispatcher' as UserRole,
        fullName: 'Flight Dispatcher',
      },
      {
        login: this.configService.get<string>('EDITOR_LOGIN', 'editor'),
        password: this.configService.get<string>('EDITOR_PASSWORD', 'editor123'),
        role: 'news_editor' as UserRole,
        fullName: 'News Editor',
      },
    ];
  }

  async login(dto: LoginDto) {
    const account = this.getConfiguredAccounts().find(
      (item) => item.login === dto.login && item.password === dto.password,
    );

    if (!account) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    let [user] = await this.drizzle.db
      .select()
      .from(users)
      .where(eq(users.email, account.login))
      .limit(1);

    if (!user) {
      [user] = await this.drizzle.db
        .insert(users)
        .values({
          email: account.login,
          passwordHash: account.password,
          role: account.role,
          fullName: account.fullName,
        })
        .returning();
    }

    const payload = {
      sub: user.id,
      login: account.login,
      role: user.role,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: payload.sub,
        login: payload.login,
        role: payload.role,
      },
    };
  }
}
