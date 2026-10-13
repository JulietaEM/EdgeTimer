import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { AuthUser } from '../common/auth/auth-user';
import { CurrentUser } from '../common/auth/decorators';
import {
  CatalogosService,
  type UploadedBarberoPhotoFile,
  type UploadedClientePhotoFile,
} from './catalogos.service';

@Controller('catalogos')
export class CatalogosController {
  constructor(private readonly catalogosService: CatalogosService) {}

  @Get('barberos')
  barberos() {
    return this.catalogosService.barberos();
  }

  @Get('barberos/:id')
  barberoById(@Param('id') id: string) {
    return this.catalogosService.barberoById(id);
  }

  @Post('barberos/:id/foto')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
    }),
  )
  uploadBarberoFoto(
    @Param('id') id: string,
    @UploadedFile() file: UploadedBarberoPhotoFile,
    @CurrentUser() user: AuthUser,
  ) {
    // Obsoleto: usar POST /auth/me/foto. Solo el propio barbero puede cambiar su foto.
    if (user.role !== 'barbero' || user.profileId !== id) {
      throw new ForbiddenException('No tienes permisos para esta acción.');
    }
    return this.catalogosService.uploadBarberoPhoto(id, file);
  }

  @Post('clientes/:id/foto')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
    }),
  )
  uploadClienteFoto(
    @Param('id') id: string,
    @UploadedFile() file: UploadedClientePhotoFile,
    @CurrentUser() user: AuthUser,
  ) {
    // Obsoleto: usar POST /auth/me/foto. Solo el propio cliente puede cambiar su foto.
    if (user.role !== 'cliente' || user.profileId !== id) {
      throw new ForbiddenException('No tienes permisos para esta acción.');
    }
    return this.catalogosService.uploadClientePhoto(id, file);
  }

  @Get('procedimientos')
  procedimientos() {
    return this.catalogosService.procedimientos();
  }
}
