import { Module } from '@nestjs/common';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { ClienteController } from './cliente.controller';
import { ClienteService } from './cliente.service';

@Module({
  imports: [NotificacionesModule],
  controllers: [ClienteController],
  providers: [ClienteService],
})
export class ClienteModule {}
