import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server,Socket } from "socket.io";
import * as wrtc from 'wrtc'
interface ISocket extends Socket {
peerConnection:any
}

@WebSocketGateway({cors:true})
export class WebrtcGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect{
  @WebSocketServer() server: Server;

  broadcaster = null;
  viewers = new Map();
  broadcasterStream = null;
  handleConnection(client: ISocket, ...args: any[]) {
    console.log('Client connected:', client.id);
  }

  handleDisconnect(client: ISocket) {
    console.log('Client disconnected:', client.id);

  }
  afterInit(server: Server) {
  }

// When a broadcaster connects
@SubscribeMessage('broadcaster')
broadCasterConnect(client: ISocket, data: any) {
  // If there's already a broadcaster, disconnect the previous one
  if (this.broadcaster) {
    this.server.to(this.broadcaster).emit('broadcaster_exists');
  }
  this.broadcaster = client.id;
  console.log('Broadcaster connected:', this.broadcaster);
    
  // Let all viewers know a broadcaster is available
  client.broadcast.emit('broadcaster_connected')
}
@SubscribeMessage('broadcaster_offer')
async BroadCasterOffer(client:ISocket,description:any) {
  if (client.id !== this.broadcaster) return;
  try {
    if (client.peerConnection) {
      client.peerConnection.close();
    }

    const peerConnection = new wrtc.RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.stunprotocol.org:3478' },
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });
    this.broadcasterStream = new wrtc.MediaStream();
     // Store broadcaster's tracks when they are received
     peerConnection.ontrack = (event) => {
      console.log('Received track from broadcaster:', event.track.kind);
      
      // Add the track to our broadcasterStream
      this.broadcasterStream.addTrack(event.track);
      
      console.log(`Broadcaster stream now has ${this.broadcasterStream.getTracks().length} tracks`);
      console.log(`Track types: ${this.broadcasterStream.getTracks().map(t => t.kind).join(', ')}`);
      
      // Update all existing viewers with the new track
      this.updateAllViewers();
  // Set up ICE handling
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      client.emit('broadcaster_ice_candidate', event.candidate);
    }
  };
  
  // Log connection state changes for debugging
  peerConnection.onconnectionstatechange = () => {
    console.log(`Broadcaster connection state: ${peerConnection.connectionState}`);
    if (peerConnection.connectionState === 'connected') {
      console.log('Broadcaster fully connected!');
    }
  };
  
  peerConnection.oniceconnectionstatechange = () => {
    console.log(`Broadcaster ICE connection state: ${peerConnection.iceConnectionState}`);
  };
    };
    await peerConnection.setRemoteDescription(description);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      // Send answer back to broadcaster
      client.emit('broadcaster_answer', peerConnection.localDescription);
      
      // Save the peer connection
      client.peerConnection = peerConnection;
      console.log('Broadcaster peer connection setup complete');  
  } catch (error) {
    console.error('Error handling broadcaster offer:', error);
    client.emit('error', { message: 'Failed to establish broadcaster connection' });
  }
} 
  // Handle ICE candidates from broadcaster
@SubscribeMessage('broadcaster_ice_candidate')
broadcasterIceCandidate(client:ISocket,candidate:any) {
  if (client.id !== this.broadcaster || !client.peerConnection) return;
    
  try {
    client.peerConnection.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
  } catch (error) {
    console.error('Error adding broadcaster ICE candidate:', error);
  }
}
 // Handle viewer connection requests
@SubscribeMessage('viewer_request') 
async viewerRequest(client:ISocket) {
  if (!this.broadcaster) {
    client.emit('no_broadcaster');
    return;
  }
  try {
    // Create a new RTCPeerConnection for this viewer
    const viewerPC = new wrtc.RTCPeerConnection({
      iceServers: [{   urls: [ "stun:bn-turn2.xirsys.com" ]}, {   username: "o8_s2lbVKiqxpNa5Ntw5kG_h7g9zYj-AbK49RHWtnH26b_exoUgSkD5MrvzAQkpMAAAAAGcrwiBzYXJhdGhz",   credential: "90886c3c-9c74-11ef-8e6e-0242ac140004",   urls: [       "turn:bn-turn2.xirsys.com:80?transport=udp",       "turn:bn-turn2.xirsys.com:3478?transport=udp",       "turn:bn-turn2.xirsys.com:80?transport=tcp",       "turn:bn-turn2.xirsys.com:3478?transport=tcp",       "turns:bn-turn2.xirsys.com:443?transport=tcp",       "turns:bn-turn2.xirsys.com:5349?transport=tcp"   ]}]
    });
    
    // Add this viewer to our map
    this.viewers.set(client.id, viewerPC);
    
    // Handle ICE candidate events
    viewerPC.onicecandidate = (event) => {
      if (event.candidate) {
        client.emit('viewer_ice_candidate', event.candidate);
      }
    };
    
    // Log connection state changes for debugging
    viewerPC.onconnectionstatechange = () => {
      console.log(`Viewer ${client.id} connection state: ${viewerPC.connectionState}`);
      if (viewerPC.connectionState === 'connected') {
        console.log(`Viewer ${client.id} fully connected!`);
      }
    };
    
    viewerPC.oniceconnectionstatechange = () => {
      console.log(`Viewer ${client.id} ICE connection state: ${viewerPC.iceConnectionState}`);
    };
    
    // Check if we have tracks to send
    let tracksAdded = false;
    
    if (this.broadcasterStream && this.broadcasterStream.getTracks().length > 0) {
      console.log(`Adding ${this.broadcasterStream.getTracks().length} tracks to viewer ${client.id}`);
      
      // Important: Clone the MediaStream to ensure proper handling
      const viewerStream = new wrtc.MediaStream();
      
      // Add all tracks from broadcaster stream to viewer stream and peer connection
      this.broadcasterStream.getTracks().forEach(track => {
        console.log(`Adding ${track.kind} track to viewer ${client.id}`);
        viewerPC.addTrack(track, viewerStream);
        tracksAdded = true;
      });
    }
    
    if (!tracksAdded) {
      console.warn('No tracks available to add to the viewer connection');
      client.emit('error', { message: 'No broadcast stream available yet. Please try again in a moment.' });
      return;
    }
    
    // Create offer for viewer
    const offer = await viewerPC.createOffer();
    await viewerPC.setLocalDescription(offer);
    
    // Send offer to viewer
    client.emit('viewer_offer', viewerPC.localDescription);
  } catch (error) {
    console.error('Error setting up viewer connection:', error);
    client.emit('error', { message: 'Failed to establish viewer connection' });
  }
}

  // Handle answer from viewer
  @SubscribeMessage('viewer_answer') 
 async viewerAnswer(client:ISocket,description:any) {
  const viewerPC = this.viewers.get(client.id);
  if (!viewerPC) return;
  
  try {
    await viewerPC.setRemoteDescription(description);
    console.log(`Viewer ${client.id} answer processed successfully`);
  } catch (error) {
    console.error('Error setting viewer remote description:', error);
  }
 } 
   // Handle ICE candidates from viewer
 @SubscribeMessage('viewer_ice_candidate') 
async viewerIceCandidate(client:ISocket,candidate:any) {
  const viewerPC = this.viewers.get(client.id);
    if (!viewerPC) return;
    
    try {
      viewerPC.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Error adding viewer ICE candidate:', error);
    }
}  

// Helper function to update all viewers with current broadcaster stream
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



