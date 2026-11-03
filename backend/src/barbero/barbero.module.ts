import { Module } from '@nestjs/common';
import { AccountsModule } from '../common/accounts.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { BarberoController } from './barbero.controller';
import { BarberoService } from './barbero.service';

@Module({
  imports: [AccountsModule, NotificacionesModule],
  controllers: [BarberoController],
  providers: [BarberoService],
})
export class BarberoModule {}
