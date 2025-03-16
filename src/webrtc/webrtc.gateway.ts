import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server,Socket } from "socket.io";
import * as wrtc from 'wrtc'

@WebSocketGateway({cors:true})
export class WebrtcGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect{
  @WebSocketServer() server: Server;

  afterInit(server: any) {
  }
  handleConnection(client: any, ...args: any[]) {
    console.log('Client connected:', client.id);

  }
  handleDisconnect(client: any) {
    console.log('Client disconnected:', client.id);
    
    if (client.id === this.broadcaster) {
      console.log('Broadcaster disconnected');
      this.broadcaster = null;
      
      // Clean up broadcaster peer connection
      if (client.peerConnection) {
        client.peerConnection.close();
        delete client.peerConnection;
      }
      
      // Clear broadcaster stream
      if (this.broadcasterStream) {
        this.broadcasterStream.getTracks().forEach(track => track.stop());
        this.broadcasterStream = null;
      }
      
      // Notify all viewers that the broadcaster is gone
      this.server.emit('broadcaster_disconnected');
      
      // Close all viewer connections
      this.viewers.forEach((viewerPC) => {
        viewerPC.close();
      });
      this.viewers.clear();
    } else if (this.viewers.has(client.id)) {
      console.log('Viewer disconnected:', client.id);
      
      // Clean up viewer peer connection
      const viewerPC = this.viewers.get(client.id);
      if (viewerPC) {
        viewerPC.close();
      }
      this.viewers.delete(client.id);
    }

  }
 broadcaster = null;
  viewers = new Map(); // Map to store viewer connections
 broadcasterStream = null; // Store the broadcaster's MediaStream
 @SubscribeMessage('broadcaster')
 handleBroadcaster(@ConnectedSocket() client: Socket) {
   // If there's already a broadcaster, notify the existing one
   if (this.broadcaster) {
     this.server.to(this.broadcaster).emit('broadcaster_exists');
   }

   // Set the new broadcaster
   this.broadcaster = client.id;
   console.log('Broadcaster connected:', this.broadcaster);

   // Notify all viewers about the new broadcaster
   client.broadcast.emit('broadcaster_connected');
 }

@SubscribeMessage('broadcaster_offer')
async broadcasterOffer(@ConnectedSocket() client: Socket,
  @MessageBody() description: any) {
    if (client.id !== this.broadcaster) return;
    try {
      // Close any existing peer connection for the client
      if (client['peerConnection']) {
        client['peerConnection'].close();
      }

      // Create a new RTCPeerConnection
      const peerConnection = new wrtc.RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.stunprotocol.org:3478' },
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      });

      // Store the peer connection in the client object for later reference
      client['peerConnection'] = peerConnection;

      // Set the remote description from the broadcaster's offer
      await peerConnection.setRemoteDescription(description);

      console.log('Remote description set successfully.');

      // Respond with an answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      // Emit the answer back to the broadcaster
      client.emit('broadcaster_answer', peerConnection.localDescription);

      console.log('Answer sent to broadcaster:', peerConnection.localDescription);
// Update all existing viewers with the new track
      this.updateAllViewers();

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          client.emit('broadcaster_ice_candidate', event.candidate);
        }
      };

      peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
      };
    } catch (error) {
      console.error('Error handling broadcaster offer:', error.message);
      client.emit('error', { message: 'Error processing offer', details: error.message });
    }
  }

@SubscribeMessage('broadcaster_ice_candidate')
handleBroadcasterIceCandidate(
  @MessageBody() candidate: RTCIceCandidateInit,
  @ConnectedSocket() client: Socket,
) {
  // Check if the client is the broadcaster and has an active peer connection
  if (client.id !== this.broadcaster || !client['peerConnection']) {
    console.warn('Client is not the broadcaster or peer connection is missing.');
    return;
  }

  try {
    // Add the ICE candidate to the existing peer connection
    const peerConnection = client['peerConnection'];
    peerConnection.addIceCandidate(new wrtc.RTCIceCandidate(candidate))
      .then(() => console.log('Broadcaster ICE candidate added successfully.'))
      .catch((error) => console.error('Error adding broadcaster ICE candidate:', error.message));
  } catch (error) {
    console.error('Unexpected error while adding broadcaster ICE candidate:', error.message);
  }
}

@SubscribeMessage('viewer_request')
async handleViewerRequest(
  @ConnectedSocket() client: Socket,
) {
  if (!this.broadcaster) {
    client.emit('no_broadcaster');
    return;
  }

  try {
    // Create a new RTCPeerConnection for the viewer
    const viewerPC = new wrtc.RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.relay.metered.ca:80' },
        {
          urls: 'turn:global.relay.metered.ca:80',
          username: 'f5baae95181d1a3b2947f791',
          credential: 'n67tiC1skstIO4zc',
        },
        {
          urls: 'turn:global.relay.metered.ca:80?transport=tcp',
          username: 'f5baae95181d1a3b2947f791',
          credential: 'n67tiC1skstIO4zc',
        },
        {
          urls: 'turn:global.relay.metered.ca:443',
          username: 'f5baae95181d1a3b2947f791',
          credential: 'n67tiC1skstIO4zc',
        },
        {
          urls: 'turns:global.relay.metered.ca:443?transport=tcp',
          username: 'f5baae95181d1a3b2947f791',
          credential: 'n67tiC1skstIO4zc',
        },
      ],
    });

    // Store the viewer's peer connection
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

      const viewerStream = new wrtc.MediaStream();

      this.broadcasterStream.getTracks().forEach((track) => {
        console.log(`Adding ${track.kind} track to viewer ${client.id}`);
        viewerPC.addTrack(track, viewerStream);
        tracksAdded = true;
      });
    }

    if (!tracksAdded) {
      console.warn('No tracks available to add to the viewer connection');
      client.emit('error', { message: 'No broadcast stream available yet. Please try again later.' });
      return;
    }

    // Create an offer for the viewer
    const offer = await viewerPC.createOffer();
    await viewerPC.setLocalDescription(offer);

    // Send the offer to the viewer
    client.emit('viewer_offer', viewerPC.localDescription);
  } catch (error) {
    console.error('Error setting up viewer connection:', error);
    client.emit('error', { message: 'Failed to establish viewer connection' });
  }
}

@SubscribeMessage('viewer_answer')
async handleViewerAnswer(
  @ConnectedSocket() client: Socket,
  @MessageBody() description: RTCSessionDescriptionInit,
) {
  const viewerPC = this.viewers.get(client.id); // Retrieve the viewer's RTCPeerConnection
  if (!viewerPC) {
    console.warn(`No peer connection found for viewer ${client.id}`);
    return;
  }

  try {
    // Set the remote description from the viewer's answer
    await viewerPC.setRemoteDescription(description);
    console.log(`Viewer ${client.id} answer processed successfully`);
  } catch (error) {
    console.error(`Error setting remote description for viewer ${client.id}:`, error);
  }
}

@SubscribeMessage('viewer_ice_candidate')
async handleViewerIceCandidate(
  @ConnectedSocket() client: Socket,
  @MessageBody() candidate: RTCIceCandidateInit,
) {
  const viewerPC = this.viewers.get(client.id); // Retrieve the viewer's RTCPeerConnection
  if (!viewerPC) {
    console.warn(`No peer connection found for viewer ${client.id}`);
    return;
  }

  try {
    // Add the ICE candidate to the viewer's peer connection
    await viewerPC.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
    console.log(`Added ICE candidate for viewer ${client.id}`);
  } catch (error) {
    console.error(`Error adding ICE candidate for viewer ${client.id}:`, error);
  }
}





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



