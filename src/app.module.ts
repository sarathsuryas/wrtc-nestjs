import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WebrtcGateway } from './stream/stream.gateway';
import { WebrtcService } from './stream/stream.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, WebrtcGateway,WebrtcService],
})
export class AppModule {}
