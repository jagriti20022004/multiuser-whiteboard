const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Room Data Persistence ---
const ROOMS_FILE = path.join(__dirname, 'rooms.json');

// Function to read rooms from the JSON file
const readRoomsFromFile = () => {
    try {
        if (fs.existsSync(ROOMS_FILE)) {
            const data = fs.readFileSync(ROOMS_FILE);
            return new Map(Object.entries(JSON.parse(data)));
        }
    } catch (error) {
        console.error('Error reading rooms file:', error);
    }
    return new Map();
};

// Function to write rooms to the JSON file
const writeRoomsToFile = (rooms) => {
    try {
        fs.writeFileSync(ROOMS_FILE, JSON.stringify(Object.fromEntries(rooms), null, 4));
    } catch (error) {
        console.error('Error writing rooms file:', error);
    }
};

let rooms = readRoomsFromFile();
const roomConnections = new Map();

// Middleware
app.use(express.json());

// Routes
app.get('/', (req, res) => {
    console.log('Home page requested');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Direct whiteboard route - no room authentication required
app.get('/whiteboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'whiteboard.html'));
});

// Static files middleware (before room routes to serve CSS/JS files)
app.use(express.static(path.join(__dirname, 'public')));

// Test route to debug redirection
app.get('/test-redirect', (req, res) => {
    console.log('Test redirect route accessed');
    res.json({ 
        message: 'Test route working',
        rooms: Array.from(rooms.keys()),
        timestamp: new Date().toISOString()
    });
});

// Debug route to check rooms
app.get('/debug/rooms', (req, res) => {
    const roomList = Array.from(rooms.entries()).map(([id, room]) => ({
        id,
        name: room.name,
        creator: room.creator,
        participants: room.participants,
        createdAt: room.createdAt
    }));
    
    res.json({
        totalRooms: rooms.size,
        rooms: roomList,
        timestamp: new Date().toISOString()
    });
});

// Whiteboard route - requires room authentication (after static files)
app.get('/whiteboard/:roomId', (req, res) => {
    const { roomId } = req.params;
    const { user } = req.query;
    
    console.log('Whiteboard route accessed:', { roomId, user });
    
    rooms = readRoomsFromFile(); // Always read the latest rooms state
    const room = rooms.get(roomId);

    console.log('Room lookup result:', room ? 'found' : 'not found');
    if (room) {
        console.log('Room participants:', room.participants);
        console.log('User authorized:', room.participants.includes(user));
    }

    if (!room) {
        console.log('Room not found, redirecting to home');
        return res.redirect(`/?error=room_not_found&roomId=${roomId}`);
    }
    
    if (!room.participants.includes(user)) {
        console.log('User not authorized, redirecting to home');
        return res.redirect(`/?error=unauthorized&roomId=${roomId}`);
    }
    
    console.log('Room authentication successful, serving whiteboard');
    res.sendFile(path.join(__dirname, 'public', 'whiteboard.html'));
});

// API Routes
app.post('/api/rooms', (req, res) => {
    const { roomName, passcode, creatorName } = req.body;
    
    if (!roomName || !passcode || !creatorName) {
        return res.status(400).json({ error: 'Room name, passcode, and creator name are required' });
    }
    
    const roomId = uuidv4();
    const room = {
        id: roomId,
        name: roomName,
        passcode: passcode,
        creator: creatorName,
        participants: [creatorName],
        createdAt: new Date().toISOString()
    };
    
    rooms.set(roomId, room);
    writeRoomsToFile(rooms);
    
    res.json({ 
        success: true, 
        roomId: roomId,
        message: 'Room created successfully' 
    });
});

app.post('/api/rooms/join', (req, res) => {
    const { roomId, passcode, participantName } = req.body;
    
    if (!roomId || !passcode || !participantName) {
        return res.status(400).json({ error: 'Room ID, passcode, and participant name are required' });
    }
    
    rooms = readRoomsFromFile();
    const room = rooms.get(roomId);
    
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }
    
    if (room.passcode !== passcode) {
        return res.status(401).json({ error: 'Invalid passcode' });
    }
    
    if (room.participants.includes(participantName)) {
        return res.status(400).json({ error: 'Name already taken in this room' });
    }
    
    room.participants.push(participantName);
    rooms.set(roomId, room);
    writeRoomsToFile(rooms);
    
    res.json({ 
        success: true, 
        room: { id: room.id, name: room.name, participants: room.participants },
        message: 'Joined room successfully' 
    });
});

app.get('/api/rooms/:roomId', (req, res) => {
    rooms = readRoomsFromFile();
    const room = rooms.get(req.params.roomId);
    
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }
    
    res.json(room);
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    let currentRoom = null;
    let currentUser = null;
    let heartbeatInterval = null;
    
    // Set up heartbeat
    heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    }, 30000); // Send ping every 30 seconds
    
    ws.on('pong', () => {
        // Client responded to ping, connection is alive
    });
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('WebSocket message received:', data);
            
            switch (data.type) {
                case 'join_room':
                    const room = rooms.get(data.roomId);
                    if (room && room.participants.includes(data.userName)) {
                        currentRoom = data.roomId;
                        currentUser = data.userName;
                        
                        // Add this connection to the room
                        if (!roomConnections.has(currentRoom)) {
                            roomConnections.set(currentRoom, new Set());
                        }
                        roomConnections.get(currentRoom).add(ws);
                        
                        console.log(`User ${currentUser} joined room ${currentRoom}`);
                        
                        // Send confirmation to the new user (without drawing data)
                        ws.send(JSON.stringify({
                            type: 'room_joined',
                            room: {
                                id: room.id,
                                name: room.name,
                                participants: room.participants
                            }
                        }));
                        
                        // Notify other users in the room
                        broadcastToRoom(currentRoom, {
                            type: 'user_joined',
                            userName: data.userName,
                            participants: room.participants
                        }, ws);
                    } else {
                        console.log('Invalid room join attempt:', data);
                    }
                    break;
                    
                case 'drawing_data':
                    if (currentRoom) {
                        // The server's only job is to broadcast the drawing data.
                        // Persistence is handled by the clients via Firestore.
                        broadcastToRoom(currentRoom, {
                            type: 'drawing_update',
                            drawingData: data.drawingData,
                            user: currentUser
                        }, ws);
                    }
                    break;
                    
                case 'clear_canvas':
                    if (currentRoom) {
                        // The server's only job is to broadcast the clear canvas command.
                        // Persistence is handled by the clients via Firestore.
                        broadcastToRoom(currentRoom, {
                            type: 'clear_canvas',
                            user: currentUser
                        }, ws);
                    }
                    break;
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });
    
    ws.on('close', () => {
        // Clear heartbeat interval
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }
        
        if (currentRoom && currentUser) {
            console.log(`WebSocket closed for user ${currentUser} in room ${currentRoom}`);
            
            // Remove from room connections
            const roomWsSet = roomConnections.get(currentRoom);
            if (roomWsSet) {
                roomWsSet.delete(ws);
                if (roomWsSet.size === 0) {
                    roomConnections.delete(currentRoom);
                }
            }
            
            // Read fresh room data from file
            rooms = readRoomsFromFile();
            const room = rooms.get(currentRoom);
            
            if (room) {
                // Remove user from participants
                room.participants = room.participants.filter(p => p !== currentUser);
                rooms.set(currentRoom, room);
                
                // Save updated room data
                writeRoomsToFile(rooms);
                
                // Remove room if no participants left, but with a delay to prevent race conditions
                if (room.participants.length === 0) {
                    console.log('Room is empty, scheduling removal:', currentRoom);
                    setTimeout(() => {
                        // Re-check if room is still empty before removing
                        rooms = readRoomsFromFile();
                        const currentRoomData = rooms.get(currentRoom);
                        if (currentRoomData && currentRoomData.participants.length === 0) {
                            console.log('Removing empty room after delay:', currentRoom);
                            rooms.delete(currentRoom);
                            roomConnections.delete(currentRoom);
                            writeRoomsToFile(rooms);
                        }
                    }, 5000); // 5 second delay
                } else {
                    // Notify remaining users
                    broadcastToRoom(currentRoom, {
                        type: 'user_left',
                        userName: currentUser,
                        participants: room.participants
                    });
                }
            }
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        // Clear heartbeat interval on error
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }
    });
});

function broadcastToRoom(roomId, message, excludeWs = null) {
    const roomWsSet = roomConnections.get(roomId);
    if (roomWsSet) {
        roomWsSet.forEach(client => {
            if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}`);
}); 