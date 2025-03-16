import { Injectable } from '@nestjs/common';
import * as wrtc from 'wrtc';

@Injectable()
export class WebrtcService {
  broadcaster: string = null;
  broadcasterStream: any = null;
  viewers = new Map<string, any>();

  updateAllViewers() {
    if (!this.broadcasterStream || this.broadcasterStream.getTracks().length === 0) {
      console.log('No broadcaster stream available to update viewers');
      return;
    }
    
    console.log(`Updating all viewers with ${this.broadcasterStream.getTracks().length} tracks`);
    
    this.viewers.forEach((viewerPC, viewerId) => {
      try {
        // Get current senders
        const senders = viewerPC.getSenders();
        const existingKinds = senders.map(sender => sender.track?.kind).filter(Boolean);
        
        // Check each track from broadcaster
        this.broadcasterStream.getTracks().forEach(track => {
          if (!existingKinds.includes(track.kind)) {
            console.log(`Adding ${track.kind} track to existing viewer ${viewerId}`);
            const stream = new wrtc.MediaStream();
            stream.addTrack(track);
            viewerPC.addTrack(track, stream);
          }
        });
      } catch (error) {
        console.error(`Error updating viewer ${viewerId}:`, error);
      }
    });
  }
}