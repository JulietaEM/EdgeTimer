import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Roles } from '../common/auth/decorators';
import { AdminService } from './admin.service';
import type {
  CreateBarberoDto,
  CreateProcedimientoDto,
  ResenaQuery,
  UpdateBarberoDto,
  UpdateProcedimientoDto,
} from './admin.types';

/** Todo lo de este controlador es solo para administradores y de su propia barbería. */
@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('barberos')
  listBarberos(@CurrentUser() user: AuthUser) {
    return this.adminService.listBarberos(user);
  }

  @Post('barberos')
  createBarbero(@CurrentUser() user: AuthUser, @Body() dto: CreateBarberoDto) {
    return this.adminService.createBarbero(user, dto);
  }

  @Patch('barberos/:id')
  updateBarbero(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBarberoDto,
  ) {
    return this.adminService.updateBarbero(user, id, dto);
  }

  @Delete('barberos/:id')
  deleteBarbero(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.adminService.deleteBarbero(user, id);
  }

  @Get('procedimientos')
  listProcedimientos(@CurrentUser() user: AuthUser) {
    return this.adminService.listProcedimientos(user);
  }

  @Post('procedimientos')
  createProcedimiento(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProcedimientoDto,
  ) {
    return this.adminService.createProcedimiento(user, dto);
  }

  @Patch('procedimientos/:id')
  updateProcedimiento(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProcedimientoDto,
  ) {
    return this.adminService.updateProcedimiento(user, id, dto);
  }

  @Get('resenas')
  listResenas(@CurrentUser() user: AuthUser, @Query() query: ResenaQuery) {
    return this.adminService.listResenas(user, query);
  }
}
