import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WebrtcGateway } from './webrtc/webrtc.gateway';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, WebrtcGateway],
})
export class AppModule {}
