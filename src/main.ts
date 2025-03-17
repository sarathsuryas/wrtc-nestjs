import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WebrtcService } from './webrtc/webrtc.service';

async function bootstrap() {
   const app = await NestFactory.create(AppModule);
  //  const socketService = app.get(WebrtcService);

  app.enableCors({
    origin:'https://wrtc-angular.vercel.app', // Allow requests from any origin
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // Allowed HTTP methods
  });  
  const server = await app.listen(process.env.PORT ?? 3000);
  // socketService.initializeSocket(server);
}
bootstrap();
