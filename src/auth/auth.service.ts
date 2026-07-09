import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { TokenType } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Registrasi User Baru & Generate Token Verifikasi
   */
  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email sudah terdaftar');
    }

    // Hash password menggunakan Argon2id
    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    // Gunakan transaksi agar pembuatan user & token verifikasi bersifat atomik
    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
        },
      });

      // Generate token verifikasi acak 32-byte hex
      const verificationToken = randomBytes(32).toString('hex');
      // Token berlaku selama 24 jam
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      await tx.token.create({
        data: {
          userId: newUser.id,
          token: verificationToken,
          type: TokenType.EMAIL_VERIFICATION,
          expiresAt,
        },
      });

      // TODO: Panggil MailService di sini untuk mengirimkan email berisi verificationToken
      console.log(`[MOCK EMAIL] Verification token for ${dto.email}: ${verificationToken}`);

      return newUser;
    });

    return {
      message: 'Registrasi berhasil. Silakan cek email untuk verifikasi akun Anda.',
      userId: user.id,
    };
  }

  /**
   * Verifikasi Email User
   */
  async verifyEmail(tokenString: string) {
    const tokenRecord = await this.prisma.token.findUnique({where: { token: tokenString },include: { user: true },});

    if (!tokenRecord || tokenRecord.type !== TokenType.EMAIL_VERIFICATION) {
      throw new BadRequestException('Token verifikasi tidak valid');
    }

    if (new Date() > tokenRecord.expiresAt) {
      await this.prisma.token.delete({ where: { id: tokenRecord.id } });
      throw new BadRequestException('Token verifikasi sudah kedaluwarsa');
    }

    // Ubah status user menjadi verified dan hapus token dari database
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: tokenRecord.userId },
        data: { isVerified: true },
      }),
      this.prisma.token.delete({
        where: { id: tokenRecord.id },
      }),
    ]);

    return { message: 'Email berhasil diverifikasi. Anda sekarang dapat login.' };
  }

  /**
   * Login User & Generate JWT Access Token
   */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { profile: true },
    });

    if (!user) {
      throw new UnauthorizedException('Kredensial email atau password salah');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Kredensial email atau password salah');
    }

    if (!user.isVerified) {
      throw new UnauthorizedException('Akun belum diverifikasi. Silakan cek email Anda.');
    }

    // Generate JWT Payload
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      isProfileCompleted: !!user.profile,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isProfileCompleted: !!user.profile,
      },
    };
  }
}