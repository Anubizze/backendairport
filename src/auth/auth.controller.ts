import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { LoginDto } from './dto/login.dto';
import { AuthUser } from './auth-user.interface';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Anti-brute-force: max 5 login attempts per minute per IP.
  @Throttle({ short: { ttl: 60_000, limit: 5 }, medium: { ttl: 900_000, limit: 20 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() request: { user?: AuthUser }) {
    return request.user ?? null;
  }
}
