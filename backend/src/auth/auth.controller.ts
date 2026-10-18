import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { AuthUser } from '../common/auth/auth-user';
import {
  AllowPendingPasswordChange,
  CurrentUser,
  Public,
} from '../common/auth/decorators';
import {
  MAX_IMAGE_BYTES,
  type UploadedFile as PhotoFile,
} from '../common/storage';
import { AuthService } from './auth.service';
import type {
  ChangePasswordDto,
  DeleteAccountDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterBarberiaDto,
  RegisterClientDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register-client')
  registerClient(@Body() dto: RegisterClientDto) {
    return this.authService.registerClient(dto);
  }

  @Public()
  @Post('register-barberia')
  registerBarberia(@Body() dto: RegisterBarberiaDto) {
    return this.authService.registerBarberia(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('logout')
  @AllowPendingPasswordChange()
  @HttpCode(200)
  logout(@CurrentUser() user: AuthUser) {
    return this.authService.logout(user);
  }

  @Get('me')
  @AllowPendingPasswordChange()
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user);
  }

  @Post('me/password')
  @AllowPendingPasswordChange()
  @HttpCode(200)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user, dto);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateMe(user, dto);
  }

  @Post('me/foto')
  @UseInterceptors(
    FileInterceptor('photo', {
      // multer no trae tipos en este proyecto (mismo patrón que catalogos)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES },
    }),
  )
  uploadPhoto(@CurrentUser() user: AuthUser, @UploadedFile() file: PhotoFile) {
    return this.authService.uploadMyPhoto(user, file);
  }

  @Delete('me')
  deleteMe(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto) {
    return this.authService.deleteMe(user, dto);
  }
}
