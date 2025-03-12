import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from "socket.io";
import * as webrtc from 'wrtc';

@WebSocketGateway({ origin:'*' })
export class StreamGateway  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect{
   viewers = new Map(); // Map to store viewer connections
 broadcasterStream = null; // Store the broadcaster's MediaStream
  broadcaster = null;

  afterInit(server: any) {
    console.log("initialized")
  }
  handleConnection(client: any, ...args: any[]) {
    console.log("connected");
    
  }
  handleDisconnect(client: any) {
   console.log("client disconnected")
  }
  @WebSocketServer()
  server: Server;
  @SubscribeMessage('message')
  handleMessage(client: any, payload: any): string {
    return 'Hello world!';
  }

  @SubscribeMessage('broadcaster')
  broadcast(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { key: string, sdp: any }
  ) {
    this.broadcaster = socket.id;
    console.log('Broadcaster connected:', this.broadcaster);
    socket.broadcast.emit('broadcaster_connected');
  }
 @SubscribeMessage('broadcaster_offer')
 async broadcasterOffer(
    @ConnectedSocket() socket: Socket,
    @MessageBody() description:any
  ) {
     try {
      const peerConnection = new webrtc.RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.stunprotocol.org:3478' },
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      });
      this.broadcasterStream = new webrtc.MediaStream();
        // Store broadcaster's tracks when they are received
        peerConnection.ontrack = (event) => {
          console.log('Received track from broadcaster:', event.track.kind);
          
          // Add the track to our broadcasterStream
          this.broadcasterStream.addTrack(event.track);
          
          console.log(`Broadcaster stream now has ${this.broadcasterStream.getTracks().length} tracks`);
          console.log(`Track types: ${this.broadcasterStream.getTracks().map(t => t.kind).join(', ')}`);
         this.updateAllViewers()
     }
      // Set up ICE handling
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('broadcaster_ice_candidate', event.candidate);
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
      
      await peerConnection.setRemoteDescription(description); 
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      // Send answer back to broadcaster
      socket.emit('broadcaster_answer', peerConnection.localDescription);
      
      // Save the peer connection
      // socket.peerConnection = peerConnection;
      
      console.log('Broadcaster peer connection setup complete');
      
  } catch (error) {
    console.error('Error handling broadcaster offer:', error);
    socket.emit('error', { message: 'Failed to establish broadcaster connection' });
   }

  }

  @SubscribeMessage('broadcaster_ice_candidate')
  broadcastIceCandidate(
    @ConnectedSocket() socket:any,
    @MessageBody() candidate:any
  ) {
    if (socket.id !== this.broadcaster || !socket.peerConnection) return;
    try {
      socket.peerConnection.addIceCandidate(new webrtc.RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Error adding broadcaster ICE candidate:', error);
    }

  }

 @SubscribeMessage('viewer_request')
 async viewerRequest(
    @ConnectedSocket() socket:any,
  ) {
    if (!this.broadcaster) {
      socket.emit('no_broadcaster');
      return;
    }
    try {
      // Create a new RTCPeerConnection for this viewer
      const viewerPC = new webrtc.RTCPeerConnection({
        iceServers: [
            {
              urls: "stun:stun.relay.metered.ca:80",
            },
            {
              urls: "turn:global.relay.metered.ca:80",
              username: "f5baae95181d1a3b2947f791",
              credential: "n67tiC1skstIO4zc",
            },
            {
              urls: "turn:global.relay.metered.ca:80?transport=tcp",
              username: "f5baae95181d1a3b2947f791",
              credential: "n67tiC1skstIO4zc",
            },
            {
              urls: "turn:global.relay.metered.ca:443",
              username: "f5baae95181d1a3b2947f791",
              credential: "n67tiC1skstIO4zc",
            },
            {
              urls: "turns:global.relay.metered.ca:443?transport=tcp",
              username: "f5baae95181d1a3b2947f791",
              credential: "n67tiC1skstIO4zc",
            },
          ],
      });
      
      // Add this viewer to our map
      this.viewers.set(socket.id, viewerPC);
      
      // Handle ICE candidate events
      viewerPC.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('viewer_ice_candidate', event.candidate);
        }
      };
      
      // Log connection state changes for debugging
      viewerPC.onconnectionstatechange = () => {
        console.log(`Viewer ${socket.id} connection state: ${viewerPC.connectionState}`);
        if (viewerPC.connectionState === 'connected') {
          console.log(`Viewer ${socket.id} fully connected!`);
        }
      };
      
      viewerPC.oniceconnectionstatechange = () => {
        console.log(`Viewer ${socket.id} ICE connection state: ${viewerPC.iceConnectionState}`);
      };
      
      // Check if we have tracks to send
      let tracksAdded = false;
      
      if (this.broadcasterStream && this.broadcasterStream.getTracks().length > 0) {
        console.log(`Adding ${this.broadcasterStream.getTracks().length} tracks to viewer ${socket.id}`);
        
        // Important: Clone the MediaStream to ensure proper handling
        const viewerStream = new webrtc.MediaStream();
        
        // Add all tracks from broadcaster stream to viewer stream and peer connection
        this.broadcasterStream.getTracks().forEach(track => {
          console.log(`Adding ${track.kind} track to viewer ${socket.id}`);
          viewerPC.addTrack(track, viewerStream);
          tracksAdded = true;
        });
      }
      
      if (!tracksAdded) {
        console.warn('No tracks available to add to the viewer connection');
        socket.emit('error', { message: 'No broadcast stream available yet. Please try again in a moment.' });
        return;
      }
      
      // Create offer for viewer
      const offer = await viewerPC.createOffer();
      await viewerPC.setLocalDescription(offer);
      
      // Send offer to viewer
      socket.emit('viewer_offer', viewerPC.localDescription);
    } catch (error) {
      console.error('Error setting up viewer connection:', error);
      socket.emit('error', { message: 'Failed to establish viewer connection' });
    }

  }
@SubscribeMessage('viewer_answer')
 async viewerAnswer(
    @ConnectedSocket() socket:any,
    @MessageBody() description:any
  ) {
    const viewerPC = this.viewers.get(socket.id);
    if (!viewerPC) return;
    
    try {
      await viewerPC.setRemoteDescription(description);
      console.log(`Viewer ${socket.id} answer processed successfully`);
    } catch (error) {
      console.error('Error setting viewer remote description:', error);
    }
  }
  @SubscribeMessage('viewer_ice_candidate')
  viewerIceCandidate(
    @ConnectedSocket() socket:any,
    @MessageBody() candidate:any
  ) {
    const viewerPC = this.viewers.get(socket.id);
    if (!viewerPC) return;
    
    try {
      viewerPC.addIceCandidate(new webrtc.RTCIceCandidate(candidate));
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
            const stream = new webrtc.MediaStream();
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
