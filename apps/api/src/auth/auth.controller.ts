import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() body: unknown) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(', '));
    }

    return this.authService.login(parsed.data.email, parsed.data.password);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: AuthenticatedRequest) {
    return this.authService.getMe(req.auth.employeeId, req.auth.requestId);
  }
}
