import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WebrtcGateway } from './webrtc/webrtc.gateway';
import { WebrtcService } from './webrtc/webrtc.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, WebrtcGateway],
})
export class AppModule {}
