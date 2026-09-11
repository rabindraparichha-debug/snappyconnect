import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { UserStatus } from '../common/enums';
import { MailerService } from '../common/mailer.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailer: MailerService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmailWithPassword(email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash ?? ''))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is deactivated. Contact your administrator.');
    }

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    delete user.passwordHash;
    return { accessToken, user };
  }

  me(user: User) {
    return user;
  }

  /**
   * Start a password reset. Always resolves the same way — an unknown address
   * must be indistinguishable from a known one, or this becomes a way to
   * discover who has an account.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findByEmailWithPassword(email);
    if (!user || user.status !== UserStatus.ACTIVE) return;

    const token = randomBytes(32).toString('base64url');
    await this.usersService.setResetToken(
      user.id,
      createHash('sha256').update(token).digest('hex'),
      new Date(Date.now() + 60 * 60 * 1000),
    );
    await this.mailer.sendPasswordReset(user.email, user.name, token);
  }

  /** Complete a reset. The link is single-use and expires. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const hash = createHash('sha256').update(token).digest('hex');
    const user = await this.usersService.findByResetTokenHash(hash);
    if (!user || !user.resetExpiresAt || user.resetExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('That reset link has expired. Request a new one.');
    }
    await this.usersService.setPassword(user.id, await bcrypt.hash(newPassword, 10));
  }
}
