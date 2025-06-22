const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, './.env') });

// --- DEBUGGING ---
console.log('--- Checking Environment Variables ---');
console.log('Project ID from .env:', process.env.FIREBASE_PROJECT_ID);
console.log('------------------------------------');
// --- END DEBUGGING ---

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Firebase Initialization ---
let db;
try {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
  db = getFirestore();
  console.log('Firebase connected successfully.');
} catch (error) {
  console.error('Firebase initialization error:', error);
  process.exit(1);
}

// In-memory map to track WebSocket connections for each room
const roomConnections = new Map();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Whiteboard route - requires room authentication
app.get('/whiteboard/:roomId', async (req, res) => {
    const { roomId } = req.params;
    const { user } = req.query;

    if (!user) {
        return res.redirect(`/?error=user_required`);
    }

    try {
        const roomRef = db.collection('rooms').doc(roomId);
        const doc = await roomRef.get();

        if (!doc.exists) {
            console.log('Room not found in Firestore, redirecting to home');
            return res.redirect(`/?error=room_not_found&roomId=${roomId}`);
        }

        const room = doc.data();
        if (!room.participants.includes(user)) {
            console.log('User not authorized for room, redirecting to home');
            return res.redirect(`/?error=unauthorized&roomId=${roomId}`);
        }

        console.log('Room authentication successful, serving whiteboard');
        res.sendFile(path.join(__dirname, 'public', 'whiteboard.html'));
    } catch (error) {
        console.error('Error during whiteboard authentication:', error);
        return res.status(500).redirect('/?error=server_error');
    }
});

// --- API Routes ---

// Create a new room
app.post('/api/rooms', async (req, res) => {
    const { roomName, passcode, creatorName } = req.body;
    
    if (!roomName || !passcode || !creatorName) {
        return res.status(400).json({ error: 'Room name, passcode, and creator name are required' });
    }

    const roomId = uuidv4();
    const roomData = {
        id: roomId,
        name: roomName,
        passcode: passcode, // In a real app, this should be hashed
        creator: creatorName,
        participants: [creatorName],
        createdAt: new Date().toISOString()
    };
    
    try {
        await db.collection('rooms').doc(roomId).set(roomData);
        console.log(`Room created in Firestore with ID: ${roomId}`);
        res.status(201).json({ 
            success: true, 
            roomId: roomId,
            message: 'Room created successfully' 
        });
    } catch (error) {
        console.error("Error creating room in Firestore:", error);
        res.status(500).json({ error: 'Failed to create room' });
    }
});

// Join an existing room
app.post('/api/rooms/join', async (req, res) => {
    const { roomId, passcode, participantName } = req.body;
    
    if (!roomId || !passcode || !participantName) {
        return res.status(400).json({ error: 'Room ID, passcode, and participant name are required' });
    }
    
    try {
        const roomRef = db.collection('rooms').doc(roomId);
        const doc = await roomRef.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Room not found' });
        }
        
        const room = doc.data();

        if (room.passcode !== passcode) {
            return res.status(401).json({ error: 'Invalid passcode' });
        }
    
        if (room.participants.includes(participantName)) {
            // Allow rejoining, but don't add duplicate name
            console.log(`Participant ${participantName} is rejoining room ${roomId}`);
        } else {
            // Add new participant
            await roomRef.update({
                participants: FieldValue.arrayUnion(participantName)
            });
            console.log(`Participant ${participantName} added to room ${roomId} in Firestore`);
        }
        
        // Fetch the updated room data to return
        const updatedDoc = await roomRef.get();
        const updatedRoom = updatedDoc.data();

        res.json({ 
            success: true, 
            room: { id: updatedRoom.id, name: updatedRoom.name, participants: updatedRoom.participants },
            message: 'Joined room successfully' 
        });
    } catch (error) {
        console.error(`Error joining room ${roomId}:`, error);
        res.status(500).json({ error: 'Failed to join room' });
    }
});

// Get room details
app.get('/api/rooms/:roomId', async (req, res) => {
    try {
        const roomRef = db.collection('rooms').doc(req.params.roomId);
        const doc = await roomRef.get();
        
        if (!doc.exists) {
            return res.status(404).json({ error: 'Room not found' });
        }
        
        res.json(doc.data());
    } catch (error) {
        console.error(`Error fetching room ${req.params.roomId}:`, error);
        res.status(500).json({ error: 'Failed to fetch room data' });
    }
});


// --- WebSocket Connection Handling ---
wss.on('connection', (ws, req) => {
    let currentRoomId = null;
    let currentUser = null;
    
    const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 30000);
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'join_room':
                    const roomRef = db.collection('rooms').doc(data.roomId);
                    const doc = await roomRef.get();

                    if (doc.exists && doc.data().participants.includes(data.userName)) {
                        currentRoomId = data.roomId;
                        currentUser = data.userName;
                        
                        // Add this connection to the in-memory map
                        if (!roomConnections.has(currentRoomId)) {
                            roomConnections.set(currentRoomId, new Set());
                        }
                        roomConnections.get(currentRoomId).add(ws);
                        
                        console.log(`User ${currentUser} connected to WebSocket for room ${currentRoomId}`);
                        
                        const room = doc.data();
                        
                        // Send confirmation to the joining user
                        ws.send(JSON.stringify({
                            type: 'room_joined',
                            room: { id: room.id, name: room.name, participants: room.participants }
                        }));
                        
                        // Notify other users in the room
                        broadcastToRoom(currentRoomId, {
                            type: 'user_joined',
                            userName: currentUser,
                            participants: room.participants
                        }, ws);
                    } else {
                        console.log('Invalid WebSocket join attempt:', data);
                        ws.close();
                    }
                    break;
                    
                case 'drawing_data':
                case 'clear_canvas':
                    if (currentRoomId) {
                        console.log(`[WS RELAY] Relaying '${data.type}' to room ${currentRoomId}`);
                        // Broadcast drawing and clear events to other clients in the same room
                        broadcastToRoom(currentRoomId, { ...data, user: currentUser }, ws);
                    }
                    break;
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });
    
    ws.on('close', async () => {
        clearInterval(heartbeat);
        
        if (currentRoomId && currentUser) {
            console.log(`WebSocket closed for user ${currentUser} in room ${currentRoomId}`);
            
            // Remove the connection from the in-memory map
            const roomWsSet = roomConnections.get(currentRoomId);
            if (roomWsSet) {
                roomWsSet.delete(ws);
                if (roomWsSet.size === 0) {
                    roomConnections.delete(currentRoomId);
                }
            }
            
            try {
                const roomRef = db.collection('rooms').doc(currentRoomId);
                const doc = await roomRef.get();

                if (doc.exists) {
                    const room = doc.data();
                    const remainingParticipants = room.participants.filter(p => p !== currentUser);

                    // If user was the last one, schedule room deletion
                    if (remainingParticipants.length === 0) {
                        console.log(`Room ${currentRoomId} is empty. Scheduling deletion.`);
                        setTimeout(async () => {
                            // Re-check before deleting in case someone rejoins
                            const latestDoc = await roomRef.get();
                            if (latestDoc.exists && latestDoc.data().participants.length === 0) {
                                await roomRef.delete();
                                console.log(`Deleted empty room ${currentRoomId} from Firestore.`);
                            }
                        }, 60000); // 1-minute delay
                    } else {
                         // Otherwise, just update the participant list
                        await roomRef.update({ participants: remainingParticipants });

                        // Notify remaining users
                        broadcastToRoom(currentRoomId, {
                            type: 'user_left',
                            userName: currentUser,
                            participants: remainingParticipants
                        });
                    }
                }
            } catch (error) {
                console.error(`Error handling user exit for room ${currentRoomId}:`, error);
            }
        }
    });

    ws.on('error', (error) => console.error('WebSocket error:', error));
});

function broadcastToRoom(roomId, message, excludeWs = null) {
    const roomWsSet = roomConnections.get(roomId);
    if (roomWsSet) {
        console.log(`[WS BROADCAST] Broadcasting to ${roomWsSet.size} client(s) in room ${roomId}`);
        const stringifiedMessage = JSON.stringify(message);
        roomWsSet.forEach(client => {
            if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
                client.send(stringifiedMessage);
            }
        });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});