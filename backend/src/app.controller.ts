import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/auth/decorators';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Ruta pública: la usa Render como chequeo de que el servidor está vivo.
  @Public()
  @Get()
  getMessage(): string {
    return this.appService.getMessage();
  }
}
