import { ConnectedSocket, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import * as wrtc from'wrtc'
import { Server } from "socket.io";
import { WebrtcService } from "./stream.service";
@WebSocketGateway({
  cors: {
    origin: ['http://localhost:3000', 'https://wrtc-angular.vercel.app'], // Allowed origins
    methods: ['GET', 'POST'], // Allowed methods
    credentials: true, // Include cookies and credentials
  },
})
export class WebrtcGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server:Server;

  constructor(private readonly webrtcService: WebrtcService) {}

  handleConnection(client: any) {
    console.log('Client connected:', client.id);
  }

  handleDisconnect(client:any) {
    console.log('Client disconnected:', client.id);
    
    if (client.id === this.webrtcService.broadcaster) {
      console.log('Broadcaster disconnected');
      this.webrtcService.broadcaster = null;
      
      // Clean up broadcaster peer connection
      if (client['peerConnection']) {
        client['peerConnection'].close();
        delete client['peerConnection'];
      }
      
      // Clear broadcaster stream
      if (this.webrtcService.broadcasterStream) {
        this.webrtcService.broadcasterStream.getTracks().forEach(track => track.stop());
        this.webrtcService.broadcasterStream = null;
      }
      
      // Notify all viewers that the broadcaster is gone
      this.server.emit('broadcaster_disconnected');
      
      // Close all viewer connections
      this.webrtcService.viewers.forEach((viewerPC) => {
        viewerPC.close();
      });
      this.webrtcService.viewers.clear();
    } else if (this.webrtcService.viewers.has(client.id)) {
      console.log('Viewer disconnected:', client.id);
      
      // Clean up viewer peer connection
      const viewerPC = this.webrtcService.viewers.get(client.id);
      if (viewerPC) {
        viewerPC.close();
      }
      this.webrtcService.viewers.delete(client.id);
    }
  }

  @SubscribeMessage('broadcaster')
  handleBroadcaster(@ConnectedSocket() client: any) {
    // If there's already a broadcaster, disconnect the previous one
    if (this.webrtcService.broadcaster) {
      this.server.to(this.webrtcService.broadcaster).emit('broadcaster_exists');
    }
    
    this.webrtcService.broadcaster = client.id;
    console.log('Broadcaster connected:', this.webrtcService.broadcaster);
    
    // Let all viewers know a broadcaster is available
    client.broadcast.emit('broadcaster_connected');
  }

  @SubscribeMessage('broadcaster_offer')
  async handleBroadcasterOffer(@ConnectedSocket() client: any, payload: any) {
    if (client.id !== this.webrtcService.broadcaster) return;
    
    try {
      // Close any existing peer connection
      if (client['peerConnection']) {
        client['peerConnection'].close();
      }
      
      const peerConnection = new wrtc.RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.stunprotocol.org:3478' },
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      });
      
      // Create a new MediaStream to hold the broadcaster's tracks
      this.webrtcService.broadcasterStream = new wrtc.MediaStream();
      
      // Store broadcaster's tracks when they are received
      peerConnection.ontrack = (event) => {
        console.log('Received track from broadcaster:', event.track.kind);
        
        // Add the track to our broadcasterStream
        this.webrtcService.broadcasterStream.addTrack(event.track);
        
        console.log(`Broadcaster stream now has ${this.webrtcService.broadcasterStream.getTracks().length} tracks`);
        console.log(`Track types: ${this.webrtcService.broadcasterStream.getTracks().map(t => t.kind).join(', ')}`);
        
        // Update all existing viewers with the new track
        this.webrtcService.updateAllViewers();
      };
      
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
      
      await peerConnection.setRemoteDescription(payload);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      // Send answer back to broadcaster
      client.emit('broadcaster_answer', peerConnection.localDescription);
      
      // Save the peer connection
      client['peerConnection'] = peerConnection;
      
      console.log('Broadcaster peer connection setup complete');
    } catch (error) {
      console.error('Error handling broadcaster offer:', error);
      client.emit('error', { message: 'Failed to establish broadcaster connection' });
    }
  }

  @SubscribeMessage('broadcaster_ice_candidate')
  handleBroadcasterIceCandidate(@ConnectedSocket() client: any, payload: any) {
    if (client.id !== this.webrtcService.broadcaster || !client['peerConnection']) return;
    
    try {
      client['peerConnection'].addIceCandidate(new wrtc.RTCIceCandidate(payload));
    } catch (error) {
      console.error('Error adding broadcaster ICE candidate:', error);
    }
  }

  @SubscribeMessage('viewer_request')
  async handleViewerRequest(@ConnectedSocket() client: any) {
    if (!this.webrtcService.broadcaster) {
      client.emit('no_broadcaster');
      return;
    }
    
    try {
      // Create a new RTCPeerConnection for this viewer
      const viewerPC = new wrtc.RTCPeerConnection({
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
      this.webrtcService.viewers.set(client.id, viewerPC);
      
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
      
      if (this.webrtcService.broadcasterStream && this.webrtcService.broadcasterStream.getTracks().length > 0) {
        console.log(`Adding ${this.webrtcService.broadcasterStream.getTracks().length} tracks to viewer ${client.id}`);
        
        // Important: Clone the MediaStream to ensure proper handling
        const viewerStream = new wrtc.MediaStream();
        
        // Add all tracks from broadcaster stream to viewer stream and peer connection
        this.webrtcService.broadcasterStream.getTracks().forEach(track => {
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

  @SubscribeMessage('viewer_answer')
  async handleViewerAnswer(@ConnectedSocket() client: any, payload: any) {
    const viewerPC = this.webrtcService.viewers.get(client.id);
    if (!viewerPC) return;
    
    try {
      await viewerPC.setRemoteDescription(payload);
      console.log(`Viewer ${client.id} answer processed successfully`);
    } catch (error) {
      console.error('Error setting viewer remote description:', error);
    }
  }

  @SubscribeMessage('viewer_ice_candidate')
  handleViewerIceCandidate(@ConnectedSocket() client: any, payload: any) {
    const viewerPC = this.webrtcService.viewers.get(client.id);
    if (!viewerPC) return;
    
    try {
      viewerPC.addIceCandidate(new wrtc.RTCIceCandidate(payload));
    } catch (error) {
      console.error('Error adding viewer ICE candidate:', error);
    }
  }
}